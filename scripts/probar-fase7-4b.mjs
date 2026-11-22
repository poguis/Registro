// Fase 7.4b — Historial de ritmo, fecha de inicio fija y R10–R12 (con migración).
//
// Tablas "entrada → resultado esperado" escritas desde las decisiones del plan (no desde lo que
// la app hace hoy):
//   1. Un cambio de ritmo hoy no cambia la meta de hoy y sí la de los días siguientes (video y
//      lectura); la frecuencia de lectura no recalcula el pasado (el inverso de C9); un NULL viejo
//      se congela al cerrar el período.
//   2. R10: dos ediciones el mismo día dejan un solo período futuro; deshacer el mismo día lo quita
//      y reabre el anterior. Nunca queda un período con fin anterior a su inicio.
//   3. R11: sin cambios (o con las claves en otro orden), o cambiando solo nombre, descripción o
//      límite, no se crea ningún período ni entrada en la outbox.
//   4. Fecha de inicio: bloqueada con registros (pantalla y repositorio); sin registros, editable
//      hacia atrás y hacia adelante, y el primer período se mueve con ella.
//   5. R12: pausar y reanudar el mismo día borra la pausa (sin efecto).
//   6. "1 cada N días" con cambios de N: fracciones exactas, días de atraso y adelanto.
//   7. Migración 6 sobre una BD v5 con datos (creada con el código real de 47f358c): conteos,
//      columna, copia pre-migracion-v6, fallo → queda en v5; respaldos v5 y v6 válidos e idénticos
//      según comparar-sync.
//   8. Servidor: privilegios de entertainment_quotas_history idénticos antes y después de la
//      migración 20261121000100 (ajuste a); verificar-fase7-4b.sql todo ok, y el negativo sin ella.
//   9. Push y pull de frequency por PGlite (migraciones reales) entre dos dispositivos.
//  10. Compatibilidad a: la app 1.3.7 (47f358c) contra un servidor CON la columna.
//  11. Compatibilidad b: la app nueva contra un servidor SIN la columna (bloqueada → SQL → Reintentar).
//
// Código real: fachada src/services/db.js sobre node:sqlite, motor src/entertainment/,
// backlogUtils, la pantalla de categorías extraída con scripts/lib/extraer-pantalla.mjs, el motor
// de sync y, para la versión vieja, src/ de 47f358c (git show → temporal). Datos SOLO sintéticos en
// un temporal del sistema (nunca .local-data/). Nunca toca un proyecto remoto.
//
// Uso: node scripts/probar-fase7-4b.mjs
import { extraer, instanciar as instanciarPantalla } from './lib/extraer-pantalla.mjs'; // antes que test-hooks
import { hojasDesdeAlert } from './lib/hojas-stub.mjs'; // dirección visual: confirm/informar/avisar → el mismo registro que Alert
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.TZ = 'America/Guayaquil';

const { createDevices, createServer, engine, TABLES, quiet } = await import('./lib/sync-devices.mjs');
const { createPgliteTransport } = await import('./lib/pglite-transport.mjs');
const { snapshotDb, compareSnapshots } = await import('./comparar-sync.mjs');
const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const { setConnection } = await import('../src/data/db/connection.ts');
const { __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { backupCalls } = await import('./lib/backup-stub.mjs');
const utils = await import('../src/services/backlogUtils.js');
const motorCategoria = await import('../src/entertainment/category.ts');
const rhythm = await import('../src/entertainment/rhythm.ts');
const { calculateBacklog, getQuotasForDate, getFrequencyForDate, getLocalDateString } = utils;

let fallas = 0, total = 0;
const check = (nombre, ok, detalle = '') => {
    total++;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}${!ok && detalle ? ` — ${detalle}` : ''}`);
    if (!ok) fallas++;
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tabla = (titulo, filas) => {
    const malas = filas.filter((f) => !igual(f.esperado, f.obtenido));
    check(`${titulo} (${filas.length} casos)`, malas.length === 0,
        malas.map((f) => `${f.caso}: esperado ${JSON.stringify(f.esperado)} obtenido ${JSON.stringify(f.obtenido)}`).join(' | '));
};
const seccion = (t) => console.log(`\n== ${t} ==`);
const instanciar = (ext, deps) => instanciarPantalla(ext, { ...utils, ...motorCategoria, ...deps });
const CATEGORIAS = 'src/screens/SeriesAnimeScreen.js';
const MIGRACION_NUEVA = '20261121000100_frecuencia_cuotas.sql';
const REF_VIEJA = '47f358c';

const WORK = join(tmpdir(), 'registro-pruebas-fase7-4b').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const D = createDevices(`${WORK}/disp`);
const UID = '00000000-0000-4000-8000-0000000074b1'; // uid SINTÉTICO
let nBD = 0;

const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hoyMas = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const dia = (n) => getLocalDateString(hoyMas(n));
const todas = (q) => Object.fromEntries(DIAS.map((d) => [d, q]));
const HOY = dia(0);
const rel = (f) => { if (!f) return null; for (let n = -40; n <= 40; n++) if (dia(n) === f) return n === 0 ? 'hoy' : `hoy${n > 0 ? '+' : ''}${n}`; return f; };

// Categoría desplazada n días (fechas del inicio, los períodos y las pausas): la meta de HOY de la
// copia desplazada −7 es la meta del original dentro de 7 días (mismo día de la semana).
const desplazar = (cat, n) => ({
    ...cat,
    start_date: cat.start_date && rhythm.addDays(cat.start_date, n),
    quotas_history: (cat.quotas_history || []).map((h) => ({ ...h, start_date: rhythm.addDays(h.start_date, n), end_date: h.end_date && rhythm.addDays(h.end_date, n) })),
    pauses: (cat.pauses || []).map((p) => ({ ...p, pause_start: rhythm.addDays(p.pause_start, n), pause_end: p.pause_end && rhythm.addDays(p.pause_end, n) })),
});
const metas = (cat, vistos = 0) => ({ hoy: calculateBacklog(cat, vistos).targetItems, en7: calculateBacklog(desplazar(cat, -7), vistos).targetItems });

function crearAlert(eleccion = null) {
    const registro = [];
    return {
        registro,
        Alert: { alert: (titulo, mensaje, botones) => { registro.push({ titulo, mensaje }); const b = botones && eleccion && botones.find((x) => x.text === eleccion); if (b && b.onPress) b.onPress(); } },
    };
}

async function entorno(uid = UID) {
    const dev = await D.newDevice(`bd-${++nBD}`);
    D.use(dev);
    const db = dev.svc;
    const r = await quiet(() => db.createLinkedUser(uid, 'prueba@ejemplo.test'));
    if (!r.success) throw new Error('createLinkedUser falló');
    const user = { id: uid };
    const usar = () => D.use(dev);
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && res.error}`); return res; };
    const categoria = async (id) => { usar(); return (ok(await db.getEntertainmentCategories(uid), 'getEntertainmentCategories')).categories.find((c) => c.id === id); };
    const crearCategoria = async ({ type = 'video', startDate = dia(-9), quotas = todas(1), frequency = type === 'reading' ? 2 : 0, seriesCount = 3 } = {}) => {
        usar();
        const res = ok(await db.addEntertainmentCategory(uid, { name: `Cat ${type}`, type, startDate, daysOfWeek: quotas, frequency, seriesCount, description: null }), 'addEntertainmentCategory');
        return categoria(res.id);
    };
    // "Guardar" del formulario de categoría (handleSave real de SeriesAnimeScreen) al editar.
    const editar = async (cat, cambios = {}) => {
        usar();
        const A = crearAlert();
        const datos = {
            name: cat.name, type: cat.type, startDate: cat.start_date, selectedDays: cat.days_of_week,
            frequency: cat.type === 'reading' ? String(cat.frequency) : '', seriesCount: String(cat.series_count), description: cat.description || '', ...cambios,
        };
        const handleSave = instanciar(extraer(CATEGORIAS, 'handleSave'), {
            ...datos, isEditing: true, editingId: cat.id, db, user, Alert: A.Alert, ...hojasDesdeAlert(A.Alert), setModalVisible: () => {}, fetchCategories: () => {},
        });
        await quiet(() => handleSave());
        const error = A.registro.find((a) => a.titulo === 'Error');
        if (error) throw new Error(`handleSave: ${error.mensaje}`);
        return categoria(cat.id);
    };
    const periodos = async (id) => {
        usar();
        return D.all(dev, `SELECT id, quotas, start_date, end_date, frequency, deleted_at FROM entertainment_quotas_history WHERE category_id = ? ORDER BY start_date, rowid`, [id]);
    };
    const vivos = async (id) => (await periodos(id)).filter((p) => !p.deleted_at);
    const resumen = async (id) => (await vivos(id)).map((p) => ({ desde: rel(p.start_date), hasta: rel(p.end_date), lunes: JSON.parse(p.quotas).Monday, f: p.frequency }));
    const outboxDe = async (tabla) => (await D.one(dev, 'SELECT COUNT(*) n FROM outbox WHERE table_name = ?', [tabla])).n;
    const conRegistros = async (cat) => {
        usar();
        ok(await db.addSeriesWithSeasons({ category_id: cat.id, name: 'S', description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 5 }]), 'addSeriesWithSeasons');
        const s = (ok(await db.getSeriesByCategory(cat.id), 'getSeriesByCategory')).series[0];
        ok(await db.markEpisodesWatched(s.id, cat.type, [{ season: 1, episode: 1 }], { season: 1, episode: 2, status: 'Mirando' }, Date.now()), 'markEpisodesWatched');
        return categoria(cat.id);
    };
    return { dev, db, uid, user, usar, ok, categoria, crearCategoria, editar, periodos, vivos, resumen, outboxDe, conRegistros };
}

// Ningún período vivo con fin anterior a su inicio.
const sinFinAntes = (ps) => ps.every((p) => !p.end_date || p.end_date >= p.start_date);

// =============================================================================================
seccion('1. Un cambio de ritmo hoy no cambia la meta de hoy (video y lectura)');
{
    const E = await entorno();
    let v = await E.crearCategoria({ type: 'video', startDate: dia(-9), quotas: todas(1) });
    const vAntes = metas(v);
    v = await E.editar(v, { selectedDays: todas(2) });
    const vDespues = metas(v);
    let l = await E.crearCategoria({ type: 'reading', startDate: dia(-9), quotas: todas(1), frequency: 2 });
    const lAntes = metas(l);
    l = await E.editar(l, { frequency: '3' });
    const lDespues = metas(l);
    tabla('ritmo desde mañana', [
        {
            caso: 'video: cuotas 1 → 2 (inicio hoy-9)',
            esperado: { antes: { hoy: 10, en7: 17 }, despues: { hoy: 10, en7: 24 }, cuotaHoy: 1, cuotaManana: 2, periodos: [{ desde: 'hoy-9', hasta: 'hoy', lunes: 1, f: null }, { desde: 'hoy+1', hasta: null, lunes: 2, f: null }] },
            obtenido: { antes: vAntes, despues: vDespues, cuotaHoy: getQuotasForDate(hoyMas(0), v)[DIAS[hoyMas(0).getDay()]], cuotaManana: getQuotasForDate(hoyMas(1), v)[DIAS[hoyMas(1).getDay()]], periodos: await E.resumen(v.id) },
        },
        {
            // El inverso de C9: la frecuencia no recalcula el pasado (antes: 20 → 30 hoy mismo).
            caso: 'lectura: frecuencia 2 → 3 (inicio hoy-9)',
            esperado: { antes: { hoy: 20, en7: 34 }, despues: { hoy: 20, en7: 41 }, freqHoy: 2, freqManana: 3, categoria: 3, periodos: [{ desde: 'hoy-9', hasta: 'hoy', lunes: 1, f: 2 }, { desde: 'hoy+1', hasta: null, lunes: 1, f: 3 }] },
            obtenido: { antes: lAntes, despues: lDespues, freqHoy: getFrequencyForDate(hoyMas(0), l), freqManana: getFrequencyForDate(hoyMas(1), l), categoria: l.frequency, periodos: await E.resumen(l.id) },
        },
    ]);

    // Un período de lectura de antes de la 7.4b (frequency NULL = la de la categoría) se congela al cerrarse.
    let n = await E.crearCategoria({ type: 'reading', startDate: dia(-9), quotas: todas(1), frequency: 2 });
    await D.sql(E.dev, 'UPDATE entertainment_quotas_history SET frequency = NULL WHERE category_id = ?', [n.id]);
    n = await E.categoria(n.id);
    const nAntes = metas(n);
    n = await E.editar(n, { frequency: '3' });
    const ps = await E.vivos(n.id);
    tabla('NULL viejo congelado al cerrar', [{
        caso: 'período NULL, categoría 2 → editar a 3',
        esperado: { antes: { hoy: 20, en7: 34 }, despues: { hoy: 20, en7: 41 }, congelado: 2, nuevo: 3 },
        obtenido: { antes: nAntes, despues: metas(n), congelado: ps[0].frequency, nuevo: ps[1] && ps[1].frequency },
    }]);
}

// =============================================================================================
seccion('2. R10: dos ediciones el mismo día y deshacer');
{
    const E = await entorno();
    let c = await E.crearCategoria({ type: 'video', startDate: dia(-5), quotas: todas(1) });
    c = await E.editar(c, { selectedDays: todas(2) });
    c = await E.editar(c, { selectedDays: todas(3) });
    const dos = await E.resumen(c.id);
    const okDos = sinFinAntes(await E.vivos(c.id));
    const borradosDos = (await E.periodos(c.id)).filter((p) => p.deleted_at).length;
    c = await E.editar(c, { selectedDays: todas(1) }); // vuelve al ritmo de hoy: se deshace
    const tres = await E.resumen(c.id);
    const borradosTres = (await E.periodos(c.id)).filter((p) => p.deleted_at).length;
    let l = await E.crearCategoria({ type: 'reading', startDate: dia(-5), frequency: 2 });
    l = await E.editar(l, { frequency: '3' });
    l = await E.editar(l, { frequency: '-2' });
    tabla('R10', [
        { caso: 'video 1 → 2 → 3 el mismo día', esperado: { periodos: [{ desde: 'hoy-5', hasta: 'hoy', lunes: 1, f: null }, { desde: 'hoy+1', hasta: null, lunes: 3, f: null }], finAntesInicio: false, borrados: 0 }, obtenido: { periodos: dos, finAntesInicio: !okDos, borrados: borradosDos } },
        { caso: '… y luego otra vez 1 (deshacer)', esperado: { periodos: [{ desde: 'hoy-5', hasta: null, lunes: 1, f: null }], borrados: 1 }, obtenido: { periodos: tres, borrados: borradosTres } },
        { caso: 'lectura 2 → 3 → −2 el mismo día', esperado: [{ desde: 'hoy-5', hasta: 'hoy', lunes: 1, f: 2 }, { desde: 'hoy+1', hasta: null, lunes: 1, f: -2 }], obtenido: await E.resumen(l.id) },
    ]);
}

// =============================================================================================
seccion('3. R11: sin cambios no se crea período');
{
    const E = await entorno();
    let c = await E.crearCategoria({ type: 'video', startDate: dia(-5), quotas: todas(1) });
    const ob0 = await E.outboxDe('entertainment_quotas_history');
    const reordenado = Object.fromEntries([...DIAS].reverse().map((d) => [d, 1]));
    c = await E.editar(c, { selectedDays: reordenado });
    const trasOrden = { periodos: (await E.vivos(c.id)).length, outbox: (await E.outboxDe('entertainment_quotas_history')) - ob0 };
    c = await E.editar(c, { name: 'Otro nombre', description: 'otra', seriesCount: '7' });
    const trasNombre = { periodos: (await E.vivos(c.id)).length, outbox: (await E.outboxDe('entertainment_quotas_history')) - ob0, nombre: c.name, limite: c.series_count };
    let l = await E.crearCategoria({ type: 'reading', startDate: dia(-5), frequency: 2 });
    const obL = await E.outboxDe('entertainment_quotas_history');
    l = await E.editar(l, { frequency: '2' });
    tabla('R11', [
        { caso: 'cuotas iguales con las claves en otro orden', esperado: { periodos: 1, outbox: 0 }, obtenido: trasOrden },
        { caso: 'solo nombre, descripción y límite', esperado: { periodos: 1, outbox: 0, nombre: 'Otro nombre', limite: 7 }, obtenido: trasNombre },
        { caso: 'lectura: misma frecuencia', esperado: { periodos: 1, outbox: 0 }, obtenido: { periodos: (await E.vivos(l.id)).length, outbox: (await E.outboxDe('entertainment_quotas_history')) - obL } },
    ]);
    check('sameRhythm (puro): video ignora la frecuencia; lectura la compara; faltantes = 0',
        rhythm.sameRhythm({ quotas: rhythm.normalizeQuotas({ Monday: 1 }), frequency: null }, { quotas: rhythm.normalizeQuotas({ Monday: 1, Tuesday: 0 }), frequency: 5 }, 'video')
        && !rhythm.sameRhythm({ quotas: rhythm.normalizeQuotas(todas(1)), frequency: 2 }, { quotas: rhythm.normalizeQuotas(todas(1)), frequency: 3 }, 'reading'));
}

// =============================================================================================
seccion('4. Fecha de inicio: fija con registros, editable sin ellos');
{
    const E = await entorno();
    // Con registros: la pantalla la bloquea (openModal) y el repositorio la conserva.
    let c = await E.crearCategoria({ type: 'video', startDate: dia(-9), quotas: todas(1) });
    c = await E.conRegistros(c);
    let bloqueada = null;
    const noop = () => {};
    const openModal = instanciar(extraer(CATEGORIAS, 'openModal'), {
        setIsEditing: noop, setEditingId: noop, setName: noop, setType: noop, setStartDate: noop, console,
        setSelectedDays: noop, setFrequency: noop, setSeriesCount: noop, setDescription: noop, setModalVisible: noop, setStartDateLocked: (x) => { bloqueada = x; },
    });
    openModal(c);
    const bloqueadaConRegistros = bloqueada;
    const antes = await E.resumen(c.id);
    E.usar();
    E.ok(await E.db.updateEntertainmentCategory(c.id, { name: c.name, type: 'video', startDate: dia(-20), daysOfWeek: c.days_of_week, frequency: 0, seriesCount: 3, description: null }), 'updateEntertainmentCategory');
    const c2 = await E.categoria(c.id);
    const sin = await E.crearCategoria({ type: 'video', startDate: dia(-9), quotas: todas(1) });
    openModal(sin);
    const bloqueadaSinRegistros = bloqueada;
    openModal(null);
    const bloqueadaNueva = bloqueada;
    tabla('con registros', [{
        caso: 'pantalla y repositorio',
        esperado: { pantalla: true, sinRegistros: false, nueva: false, inicio: 'hoy-9', periodos: antes, meta: 10 },
        obtenido: { pantalla: bloqueadaConRegistros, sinRegistros: bloqueadaSinRegistros, nueva: bloqueadaNueva, inicio: rel(c2.start_date), periodos: await E.resumen(c.id), meta: calculateBacklog(c2, 0).targetItems },
    }]);
    // Sin registros: hacia atrás, hacia adelante y después de un cambio de ritmo.
    let a = await E.crearCategoria({ type: 'video', startDate: dia(-9), quotas: todas(1) });
    a = await E.editar(a, { startDate: dia(-19) });
    let b = await E.crearCategoria({ type: 'video', startDate: dia(-9), quotas: todas(1) });
    b = await E.editar(b, { selectedDays: todas(2) });
    b = await E.editar(b, { startDate: dia(-4) });
    let f = await E.crearCategoria({ type: 'video', startDate: dia(-9), quotas: todas(1) });
    f = await E.editar(f, { selectedDays: todas(2) });
    f = await E.editar(f, { startDate: dia(3) });
    const todos = [...await E.vivos(a.id), ...await E.vivos(b.id), ...await E.vivos(f.id)];
    tabla('sin registros', [
        { caso: 'hacia atrás (hoy-9 → hoy-19)', esperado: { inicio: 'hoy-19', periodos: [{ desde: 'hoy-19', hasta: null, lunes: 1, f: null }], meta: 20 }, obtenido: { inicio: rel(a.start_date), periodos: await E.resumen(a.id), meta: calculateBacklog(a, 0).targetItems } },
        { caso: 'hacia adelante tras un cambio de ritmo (→ hoy-4)', esperado: { inicio: 'hoy-4', periodos: [{ desde: 'hoy-4', hasta: 'hoy', lunes: 1, f: null }, { desde: 'hoy+1', hasta: null, lunes: 2, f: null }], meta: 5 }, obtenido: { inicio: rel(b.start_date), periodos: await E.resumen(b.id), meta: calculateBacklog(b, 0).targetItems } },
        { caso: 'al futuro tras un cambio de ritmo (→ hoy+3)', esperado: { inicio: 'hoy+3', periodos: [{ desde: 'hoy+3', hasta: null, lunes: 2, f: null }], meta: 0 }, obtenido: { inicio: rel(f.start_date), periodos: await E.resumen(f.id), meta: calculateBacklog(f, 0).targetItems } },
    ]);
    check('ningún período vivo con fin anterior a su inicio', sinFinAntes(todos));
}

// =============================================================================================
seccion('5. R12: pausar y reanudar el mismo día');
{
    const E = await entorno();
    const c = await E.crearCategoria({ type: 'video', startDate: dia(-6), quotas: todas(1) });
    const metaAntes = calculateBacklog(c, 0).targetItems;
    // Botón de pausa de la lista de categorías (handleTogglePause real): pausa hoy, reanuda con ayer.
    const toggle = async (item) => {
        E.usar();
        const A = crearAlert();
        const handleTogglePause = instanciar(extraer(CATEGORIAS, 'handleTogglePause'), { db: E.db, fetchCategories: () => {}, Alert: A.Alert, ...hojasDesdeAlert(A.Alert) });
        await quiet(() => handleTogglePause(item));
    };
    await toggle(c);
    const enPausa = await E.categoria(c.id);
    await toggle(enPausa);
    const despues = await E.categoria(c.id);
    const filas = await D.all(E.dev, 'SELECT pause_start, pause_end, deleted_at FROM entertainment_pauses WHERE category_id = ?', [c.id]);
    // Una pausa de días anteriores sí se cierra normalmente.
    const c2 = await E.crearCategoria({ type: 'video', startDate: dia(-6), quotas: todas(1) });
    E.usar();
    E.ok(await E.db.pauseCategory(c2.id, dia(-3)), 'pauseCategory');
    E.ok(await E.db.resumeCategory(c2.id, dia(-2)), 'resumeCategory');
    const c2d = await E.categoria(c2.id);
    tabla('R12', [
        { caso: 'pausar y reanudar hoy', esperado: { pausadaEntremedio: true, pausadaDespues: false, pausasVivas: 0, filas: 1, borrada: true, meta: [7, 7] }, obtenido: { pausadaEntremedio: enPausa.is_paused, pausadaDespues: despues.is_paused, pausasVivas: despues.pauses.length, filas: filas.length, borrada: !!(filas[0] && filas[0].deleted_at), meta: [metaAntes, calculateBacklog(despues, 0).targetItems] } },
        { caso: 'pausa hoy-3 → reanuda hoy-2', esperado: { pausas: [{ desde: 'hoy-3', hasta: 'hoy-2' }], meta: 5 }, obtenido: { pausas: c2d.pauses.map((p) => ({ desde: rel(p.pause_start), hasta: rel(p.pause_end) })), meta: calculateBacklog(c2d, 0).targetItems } },
    ]);
    check('decideResume (puro)', motorCategoria.decideResume({ pause_start: HOY }, dia(-1)) === 'delete' && motorCategoria.decideResume({ pause_start: dia(-3) }, dia(-2)) === 'close');
}

// =============================================================================================
seccion('6. "1 cada N días" con cambios de N (fracciones exactas)');
{
    const E = await entorno();
    // Períodos pasados sembrados a mano (los cambios de la app rigen desde mañana).
    const conPeriodos = async (startDate, periodos) => {
        const c = await E.crearCategoria({ type: 'reading', startDate, quotas: todas(1), frequency: periodos[periodos.length - 1].f });
        await D.sql(E.dev, 'UPDATE entertainment_quotas_history SET start_date = ?, end_date = ?, frequency = ? WHERE category_id = ?', [dia(periodos[0].desde), periodos[0].hasta === null ? null : dia(periodos[0].hasta), periodos[0].f, c.id]);
        for (const p of periodos.slice(1)) {
            await D.sql(E.dev, `INSERT INTO entertainment_quotas_history (id, user_id, category_id, quotas, start_date, end_date, frequency, created_at, updated_at)
                VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?)`, [UID, c.id, JSON.stringify(todas(1)), dia(p.desde), p.hasta === null ? null : dia(p.hasta), p.f, new Date().toISOString(), new Date().toISOString()]);
        }
        return E.categoria(c.id);
    };
    const r = (cat, vistos) => { const x = calculateBacklog(cat, vistos); return { meta: x.targetItems, atraso: x.backlogItems, diasAtraso: x.diffDays, adelanto: x.adelantoItems, diasAdelanto: x.adelantoDays }; };
    const c1 = await conPeriodos(dia(-4), [{ desde: -4, hasta: -3, f: -3 }, { desde: -2, hasta: null, f: -2 }]);
    const c2 = await conPeriodos(dia(-3), [{ desde: -3, hasta: -2, f: -3 }, { desde: -1, hasta: null, f: -3 }]);
    const c2u = await conPeriodos(dia(-3), [{ desde: -3, hasta: null, f: -3 }]);
    const c3 = await conPeriodos(dia(-6), [{ desde: -6, hasta: -4, f: 2 }, { desde: -3, hasta: null, f: -3 }]);
    const c8 = await conPeriodos(dia(-8), [{ desde: -8, hasta: null, f: -3 }]);
    tabla('acumulación', [
        // 2/3 + 3/2 = 13/6 → 2. Atraso (0 vistos, N de hoy = 2): ⌈13/6 × 2⌉ = 5 días.
        { caso: 'N=3 2 días + N=2 3 días, 0 vistos', esperado: { meta: 2, atraso: 2, diasAtraso: 5, adelanto: 0, diasAdelanto: 0 }, obtenido: r(c1, 0) },
        // 3 vistos: adelanto 1; días (N de mañana = 2): ⌈(3 − 13/6) × 2⌉ = 2.
        { caso: '… con 3 vistos', esperado: { meta: 2, atraso: 0, diasAtraso: 0, adelanto: 1, diasAdelanto: 2 }, obtenido: r(c1, 3) },
        // Partir 4 días de N=3 en 2 + 2 (cambio solo de días) no cambia la meta: 4/3 → 1.
        { caso: 'N=3 4 días partidos 2 + 2', esperado: r(c2u, 0), obtenido: r(c2, 0) },
        { caso: '… = 1 sin partir', esperado: 1, obtenido: r(c2u, 0).meta },
        // 2/día 3 días + N=3 4 días: 6 + 4/3 → 7.
        { caso: '2/día 3 días + N=3 4 días', esperado: 7, obtenido: r(c3, 0).meta },
        // Un solo período N=3, 9 días (C8): 3; con 1 visto, días de atraso = 9 − 1×3 = 6 (fórmula de siempre).
        { caso: 'un solo período N=3, 9 días, 1 visto', esperado: { meta: 3, atraso: 2, diasAtraso: 6, adelanto: 0, diasAdelanto: 0 }, obtenido: r(c8, 1) },
        { caso: '… con 4 vistos: adelanto 1, días 4×3 − 9 = 3', esperado: { meta: 3, atraso: 0, diasAtraso: 0, adelanto: 1, diasAdelanto: 3 }, obtenido: r(c8, 4) },
    ]);
}

// =============================================================================================
// Código real de la app 1.3.7 (47f358c): src/ completo a un temporal (git show por archivo) con un
// package.json {"type":"module"}; los mismos hooks (no dependen de la ruta) resuelven expo-sqlite,
// './backup', etc.
async function cargarAppVieja() {
    const dir = `${WORK}/app-${REF_VIEJA}`;
    const archivos = execFileSync('git', ['ls-tree', '-r', '--name-only', REF_VIEJA, 'src'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const f of [...archivos, 'app.json']) {
        const destino = `${dir}/${f}`;
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(destino, execFileSync('git', ['show', `${REF_VIEJA}:${f}`], { maxBuffer: 64 * 1024 * 1024 }));
    }
    writeFileSync(`${dir}/package.json`, '{"type":"module"}');
    const url = (p) => pathToFileURL(`${dir}/${p}`).href;
    return {
        archivos: archivos.length,
        DatabaseService: (await import(url('src/services/db.js'))).DatabaseService,
        conn: await import(url('src/data/db/connection.ts')),
        engine: await import(url('src/sync/engine.ts')),
        config: await import(url('src/sync/config.ts')),
        mapping: await import(url('src/sync/mapping.ts')),
    };
}
const vieja = await cargarAppVieja();
let nVieja = 0;
async function dispositivoViejo(uid) {
    const path = `${WORK}/viejo-${++nVieja}/app_registro_v3.db`;
    mkdirSync(dirname(path), { recursive: true });
    __setDatabasePath(path);
    const svc = new vieja.DatabaseService();
    if (!(await quiet(() => svc.init()))) throw new Error('la app vieja no abrió su BD');
    const usar = () => vieja.conn.setConnection(svc.db);
    usar();
    const r = await quiet(() => svc.createLinkedUser(uid, 'prueba@ejemplo.test'));
    if (!r.success) throw new Error('createLinkedUser (vieja) falló');
    return { svc, path, usar };
}
const outboxDB = async (db) => db.getFirstAsync('SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');

// =============================================================================================
seccion('7. Migración 6 sobre una BD v5 con datos (creada con la app 1.3.7)');
{
    check(`app 1.3.7 cargada de ${REF_VIEJA} (${vieja.archivos} archivos de src/)`, vieja.archivos > 50);
    const O = await dispositivoViejo(UID);
    O.usar();
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && res.error}`); return res; };
    const add = ok(await O.svc.addEntertainmentCategory(UID, { name: 'Lectura vieja', type: 'reading', startDate: dia(-9), daysOfWeek: todas(1), frequency: 2, seriesCount: 3, description: null }), 'addEntertainmentCategory');
    ok(await O.svc.addSeriesWithSeasons({ category_id: add.id, name: 'Obra', description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 4 }]), 'addSeriesWithSeasons');
    const uv5 = (await O.svc.db.getFirstAsync('PRAGMA user_version')).user_version;
    await O.svc.db.closeAsync();
    // Copias: la que falla y la que migra.
    const falla = `${WORK}/mig/falla/app_registro_v3.db`, migra = `${WORK}/mig/migra/app_registro_v3.db`;
    for (const p of [falla, migra]) { mkdirSync(dirname(p), { recursive: true }); copyFileSync(O.path, p); }
    const contar = (db) => Promise.all(TABLES.map(async (t) => (await db.getFirstAsync(`SELECT COUNT(*) n FROM ${t}`)).n));
    // Fallo simulado: queda en v5, sin la columna.
    DEV_FLAGS.DEV_FAIL_MIGRATION = true;
    let fallo = null;
    try { await D.openDevice('mig-falla', falla); } catch (e) { fallo = e.message; }
    DEV_FLAGS.DEV_FAIL_MIGRATION = false;
    const { DatabaseSync } = await import('node:sqlite');
    const leer = (p) => { const d = new DatabaseSync(p, { readOnly: true }); try { return { uv: d.prepare('PRAGMA user_version').get().user_version, col: d.prepare('PRAGMA table_info(entertainment_quotas_history)').all().some((c) => c.name === 'frequency') }; } finally { d.close(); } };
    // Migración real.
    const copias0 = backupCalls.length;
    const dev = await D.openDevice('mig-migra', migra);
    const copias = backupCalls.slice(copias0);
    D.use(dev);
    const despues = await contar(dev.svc.db);
    const nulos = (await dev.svc.db.getFirstAsync('SELECT COUNT(*) n FROM entertainment_quotas_history WHERE frequency IS NULL')).n;
    const filasQ = (await dev.svc.db.getFirstAsync('SELECT COUNT(*) n FROM entertainment_quotas_history')).n;
    const resumen = await dev.svc.db.getFirstAsync("SELECT payload FROM _migration_log WHERE version = 6 AND kind = 'summary'");
    const p6 = resumen ? JSON.parse(resumen.payload) : null;
    tabla('migración 6', [{
        caso: 'v5 con datos → v6',
        esperado: { uv5: 5, falla: { abre: false, uv: 5, col: false }, migra: { uv: 6, col: true }, copia: ['pre-migracion-v6'], conteosIguales: true, frecuenciasNulas: true },
        obtenido: {
            uv5, falla: { abre: fallo === null, ...leer(falla) }, migra: leer(migra), copia: copias,
            conteosIguales: !!p6 && igual(p6.before, p6.after) && despues.reduce((a, n) => a + n, 0) > 0,
            frecuenciasNulas: nulos === filasQ && filasQ > 0,
        },
    }]);
    // comparar-sync: la v5 de antes y la v6 de después, con los mismos datos, son idénticas.
    await dev.svc.db.closeAsync();
    const v5b = `${WORK}/mig/v5b/app_registro_v3.db`;
    mkdirSync(dirname(v5b), { recursive: true });
    copyFileSync(O.path, v5b);
    const cmp = compareSnapshots(snapshotDb(v5b), snapshotDb(migra));
    check('comparar-sync: v5 (sin la columna) y v6 (columna NULL) idénticas en las 15 tablas, mismo saldo', cmp.identical && cmp.balanceEqual, TABLES.filter((t) => !cmp.tables[t].same).join(','));
    // validar-respaldo con un respaldo v5 y uno v6 (backup.js real, que nunca migra).
    const backup = await import('../src/services/backup.js');
    const validar = async (path, etiqueta) => {
        __setDatabasePath(path);
        const bk = await quiet(() => backup.createBackup());
        const res = spawnSync(process.execPath, ['scripts/validar-respaldo.mjs', bk.json.path, '--db', bk.physical.path, '--out', `${WORK}/validado-${etiqueta}.sqlite`], { encoding: 'utf8' });
        const meta = JSON.parse(readFileSync(bk.json.path, 'utf8')).meta;
        return { ok: res.status === 0 && /Respaldo válido/.test(res.stdout), uv: meta.userVersion };
    };
    tabla('validar-respaldo', [{ caso: 'respaldos v5 y v6', esperado: [{ ok: true, uv: 5 }, { ok: true, uv: 6 }], obtenido: [await validar(v5b, 'v5'), await validar(migra, 'v6')] }]);
}

// =============================================================================================
// Servidor PGlite con las migraciones reales: todas (5) o sin la nueva (4).
async function servidor({ conNueva = true } = {}) {
    const pg = new PGlite();
    await pg.exec(readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8'));
    const files = readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort().filter((f) => conNueva || f !== MIGRACION_NUEVA);
    for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    const T = createPgliteTransport(pg);
    return { pg, T, files, aplicarNueva: () => pg.exec(readFileSync(`supabase/migrations/${MIGRACION_NUEVA}`, 'utf8')) };
}

seccion('8. Servidor: privilegios idénticos y verificar-fase7-4b.sql');
{
    const S = await servidor({ conNueva: false });
    check('la migración nueva existe y es la 5.ª del directorio', readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort().at(-1) === MIGRACION_NUEVA && S.files.length === 4);
    // Privilegios de la tabla (ACL explotada) y de cada columna (ACL propia + información derivada),
    // para anon, authenticated, PUBLIC y service_role.
    const ROLES = "('anon', 'authenticated', 'PUBLIC', 'service_role')";
    const privilegios = async (pg) => {
        const tabla = (await pg.query(`
            select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as rol, a.privilege_type as p, a.is_grantable as g
            from pg_class c, aclexplode(c.relacl) a
            where c.oid = 'public.entertainment_quotas_history'::regclass
              and (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) in ${ROLES}
            order by 1, 2`)).rows.map((r) => `${r.rol}:${r.p}:${r.g}`);
        const aclColumnas = (await pg.query(`
            select attname, coalesce(attacl::text, '') as acl from pg_attribute
            where attrelid = 'public.entertainment_quotas_history'::regclass and attnum > 0 and not attisdropped order by attname`)).rows;
        const columnas = {};
        for (const r of (await pg.query(`
            select column_name, grantee, privilege_type from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'entertainment_quotas_history' and grantee in ${ROLES}
            order by 1, 2, 3`)).rows) (columnas[r.column_name] ||= []).push(`${r.grantee}:${r.privilege_type}`);
        return { tabla, aclColumnas, columnas };
    };
    const antes = await privilegios(S.pg);
    await S.aplicarNueva();
    const despues = await privilegios(S.pg);
    const { frequency: colNueva, ...colViejas } = despues.columnas;
    tabla('privilegios de entertainment_quotas_history (anon, authenticated, PUBLIC, service_role)', [
        { caso: 'tabla: ACL igual antes y después', esperado: antes.tabla, obtenido: despues.tabla },
        { caso: 'columnas: sin ACL propia antes ni después (también frequency)', esperado: { antes: true, despues: true }, obtenido: { antes: antes.aclColumnas.every((r) => r.acl === ''), despues: despues.aclColumnas.every((r) => r.acl === '') && despues.aclColumnas.some((r) => r.attname === 'frequency') } },
        { caso: 'columnas existentes: privilegios iguales', esperado: antes.columnas, obtenido: colViejas },
        { caso: 'frequency: los mismos que quotas', esperado: antes.columnas.quotas, obtenido: colNueva },
        { caso: 'anon y PUBLIC sin nada; authenticated S/I/U', esperado: ['authenticated:INSERT:false', 'authenticated:SELECT:false', 'authenticated:UPDATE:false'], obtenido: despues.tabla.filter((x) => !x.startsWith('service_role')) },
    ]);
    // verificar-fase7-4b.sql: todo ok con la migración; sin ella, las filas de la columna fallan.
    const sql = readFileSync('supabase/verificar-fase7-4b.sql', 'utf8');
    const escritura = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"));
    const conMig = (await S.pg.query(sql)).rows;
    const S4 = await servidor({ conNueva: false });
    const sinMig = (await S4.pg.query(sql)).rows;
    tabla('verificar-fase7-4b.sql', [
        { caso: 'solo lectura (sin palabras de escritura fuera de comentarios y literales)', esperado: false, obtenido: escritura },
        { caso: 'con la migración: 9 filas, todas ok', esperado: { filas: 9, ok: 9 }, obtenido: { filas: conMig.length, ok: conMig.filter((r) => r.ok).length } },
        { caso: 'sin la migración: fallan las 4 de la columna, el resto ok', esperado: [1, 2, 3, 4], obtenido: sinMig.filter((r) => !r.ok).map((r) => r.orden) },
    ]);
}

// =============================================================================================
const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true };
const CFG_VIEJA = { ...vieja.config.DEFAULT_SYNC_CONFIG, enabled: true };

seccion('9. Push y pull de frequency por PGlite (5 migraciones), dos dispositivos');
{
    const S = await servidor();
    const uid = '00000000-0000-4000-8000-0000000074b9';
    await S.pg.query('insert into auth.users (id) values ($1)', [uid]);
    S.T.uid = uid;
    const A = await entorno(uid);
    let l = await A.crearCategoria({ type: 'reading', startDate: dia(-9), frequency: 2 });
    l = await A.editar(l, { frequency: '-3' });
    A.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const oa = await quiet(() => engine.syncOnce(CFG, S.T));
    const srv = (await S.pg.query('select start_date::text, end_date::text, frequency from public.entertainment_quotas_history where category_id = $1 order by start_date', [l.id])).rows;
    const B = await entorno(uid);
    B.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const ob = await quiet(() => engine.syncOnce(CFG, S.T));
    A.usar();
    await quiet(() => engine.syncOnce(CFG, S.T));
    const cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    tabla('frequency por la sync', [
        { caso: 'A sube', esperado: { estado: 'ok', bloqueadas: 0, servidor: [{ desde: 'hoy-9', hasta: 'hoy', f: 2 }, { desde: 'hoy+1', hasta: null, f: -3 }] }, obtenido: { estado: oa.status, bloqueadas: oa.push.blocked, servidor: srv.map((r) => ({ desde: rel(r.start_date), hasta: rel(r.end_date), f: r.frequency })) } },
        { caso: 'B baja', esperado: { estado: 'ok', periodos: [{ desde: 'hoy-9', hasta: 'hoy', lunes: 1, f: 2 }, { desde: 'hoy+1', hasta: null, lunes: 1, f: -3 }] }, obtenido: { estado: ob.status, periodos: await B.resumen(l.id) } },
    ]);
    check('A y B idénticos en las 15 tablas (comparar-sync)', cmp.identical, TABLES.filter((t) => !cmp.tables[t].same).join(','));
}

seccion('10. Compatibilidad a: la app 1.3.7 contra un servidor CON la columna');
{
    const S = await servidor();
    const uid = '00000000-0000-4000-8000-0000000074ba';
    await S.pg.query('insert into auth.users (id) values ($1)', [uid]);
    S.T.uid = uid;
    // La app nueva crea una lectura y cambia la frecuencia: períodos con frequency 2 y 3.
    const N = await entorno(uid);
    let l = await N.crearCategoria({ type: 'reading', startDate: dia(-9), frequency: 2 });
    l = await N.editar(l, { frequency: '3' });
    N.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    await quiet(() => engine.syncOnce(CFG, S.T));
    // La app vieja (otro dispositivo de la misma cuenta) baja todo y edita las cuotas con su lógica.
    const O = await dispositivoViejo(uid);
    O.usar();
    await quiet(() => vieja.engine.ensureInitialUpload(CFG_VIEJA));
    const p1 = await quiet(() => vieja.engine.syncOnce(CFG_VIEJA, S.T));
    const ob1 = await outboxDB(O.svc.db);
    const catO = (await O.svc.getEntertainmentCategories(uid)).categories.find((c) => c.id === l.id);
    const r = await quiet(() => O.svc.updateEntertainmentCategory(l.id, { name: catO.name, type: 'reading', startDate: catO.start_date, daysOfWeek: { ...todas(1), Monday: 0 }, frequency: 3, seriesCount: 3, description: null }));
    const p2 = await quiet(() => vieja.engine.syncOnce(CFG_VIEJA, S.T));
    const ob2 = await outboxDB(O.svc.db);
    const srv = (await S.pg.query('select id, start_date::text, frequency from public.entertainment_quotas_history where category_id = $1 order by created_at, start_date', [l.id])).rows;
    const deN = (await N.vivos(l.id)).map((p) => p.id);
    N.usar();
    const pn = await quiet(() => engine.syncOnce(CFG, S.T));
    tabla('compatibilidad a', [{
        caso: 'pull y push de la app vieja',
        esperado: { pull: 'ok', outboxTrasPull: { raw: 0, blocked: 0 }, edicion: true, push: 'ok', outboxTrasPush: { raw: 0, blocked: 0 }, frecuenciasDeN: [2, 3], filaNuevaDeO: null, nuevaVuelve: 'ok' },
        obtenido: {
            pull: p1.status, outboxTrasPull: { raw: ob1.raw, blocked: ob1.blocked || 0 }, edicion: !!r.success, push: p2.status, outboxTrasPush: { raw: ob2.raw, blocked: ob2.blocked || 0 },
            frecuenciasDeN: srv.filter((x) => deN.includes(x.id)).map((x) => x.frequency), filaNuevaDeO: (srv.find((x) => !deN.includes(x.id)) || { frequency: 'falta' }).frequency, nuevaVuelve: pn.status,
        },
    }]);
    check('fromRemote de la versión vieja ignora la columna desconocida (lectura del código)', !('frequency' in vieja.mapping.fromRemote('entertainment_quotas_history', { frequency: 3, quotas: {}, start_date: HOY })));
}

seccion('11. Compatibilidad b: la app nueva contra un servidor SIN la columna');
{
    const S = await servidor({ conNueva: false });
    const uid = '00000000-0000-4000-8000-0000000074bb';
    await S.pg.query('insert into auth.users (id) values ($1)', [uid]);
    S.T.uid = uid;
    const N = await entorno(uid);
    const l = await N.crearCategoria({ type: 'reading', startDate: dia(-9), frequency: 2 });
    N.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const o1 = await quiet(() => engine.syncOnce(CFG, S.T));
    const bloqueadas = await D.all(N.dev, 'SELECT table_name t, block_reason r FROM outbox WHERE blocked_at IS NOT NULL');
    const catEnServidor = (await S.pg.query('select count(*)::int n from public.entertainment_categories where id = $1', [l.id])).rows[0].n;
    // Se aplica el SQL y "Reintentar" (unblockAll) sube lo bloqueado.
    await S.aplicarNueva();
    N.usar();
    await quiet(() => engine.unblockAll());
    const o2 = await quiet(() => engine.syncOnce(CFG, S.T));
    const ob2 = await D.one(N.dev, 'SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    const srv = (await S.pg.query('select frequency from public.entertainment_quotas_history where category_id = $1', [l.id])).rows;
    tabla('compatibilidad b', [{
        caso: 'servidor sin la migración → SQL → Reintentar',
        esperado: { bloqueadas: ['entertainment_quotas_history'], motivo: true, categoriaSubio: 1, trasSql: 'ok', outbox: { raw: 0, blocked: 0 }, servidor: [2] },
        obtenido: {
            bloqueadas: [...new Set(bloqueadas.map((b) => b.t))], motivo: bloqueadas.every((b) => /frequency|42703/.test(String(b.r))), categoriaSubio: catEnServidor,
            trasSql: o2.status, outbox: { raw: ob2.raw, blocked: ob2.blocked || 0 }, servidor: srv.map((x) => x.frequency),
        },
    }]);
    check('primer ciclo contra el servidor viejo: termina y reporta bloqueadas (no se cuelga ni descarta nada)', o1.push && o1.push.blocked > 0, JSON.stringify({ estado: o1.status, push: o1.push }));
}

console.log(fallas === 0 ? `\nFASE 7.4b: ${total} OK.` : `\n${fallas} de ${total} prueba(s) fallaron.`);
process.exit(fallas === 0 ? 0 : 1);
