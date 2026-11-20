// Fase 7.4a — Historial como conteo, ciclo y correcciones (sin migración).
//
// Pruebas de los cambios A PROPÓSITO de la 7.4a, con tablas "entrada → resultado esperado"
// escritas desde las decisiones (claude/DISENO-ENTRETENIMIENTO.md, plan de la 7.4a), no desde lo
// que la app hace hoy:
//   1. Ciclo: E1, E2, E3 (reanudar al final del ciclo actual, también con offset negativo).
//   2. Grilla hacia adelante (video y lectura): una fila por capítulo en UNA transacción,
//      confirmación con más de 1 capítulo (Cancelar no escribe), último capítulo con cada botón.
//   3. Grilla hacia atrás: confirmación, borrado lógico de la fila más reciente por capítulo,
//      puntero = tocado, cerrada → Mirando.
//   4. R8 en los Registros: desmarcar una serie cerrada la vuelve a Mirando.
//   5. Reiniciar: sin ganar ni perder vistos.
//   6. R1: las 3 pantallas cuentan igual el total (pausadas y cerradas incluidas, borradas no).
//   7. R15: temporadas con 0 capítulos se saltan en video y en lectura; 7b. el hueco que deja una
//      temporada intermedia vacía del formulario también se salta (decisión del usuario, 7.4a).
//   8. O1: límite obligatorio ≥ 1; NULL/0 = sin límite; aviso antes del formulario; editar no se bloquea.
//   9. Outbox: cada fila de historial escrita o desmarcada encola su entrada.
//  10. Cabecera del Registro (ajuste b): se relee de la BD al marcar y desmarcar, sin salir.
//  11. Sync (ajuste a): una serie con interleave_offset negativo sube y baja por PGlite (migraciones
//      reales, RLS) sin bloquearse y llega idéntica.
//
// Código real: fachada src/services/db.js sobre node:sqlite, motor src/entertainment/ y las
// funciones de las PANTALLAS extraídas con scripts/lib/extraer-pantalla.mjs. Datos SOLO
// sintéticos en un temporal del sistema (nunca .local-data/). Nunca toca un proyecto remoto.
//
// Uso: node scripts/probar-fase7-4a.mjs
//
// extraer-pantalla.mjs (carga @babel/*) se importa ANTES que test-hooks.mjs (ver probar-fase7-2).
import { extraer, instanciar as instanciarPantalla } from './lib/extraer-pantalla.mjs';
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TZ = 'America/Guayaquil';

const { createDevices, createServer, engine, TABLES, quiet } = await import('./lib/sync-devices.mjs');
const { snapshotDb, compareSnapshots } = await import('./comparar-sync.mjs');
const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const mapping = await import('../src/sync/mapping.ts');
const utils = await import('../src/services/backlogUtils.js');
const motorCola = await import('../src/entertainment/queue.ts');
const motorDetalle = await import('../src/entertainment/seriesDetail.ts');
const motorCategoria = await import('../src/entertainment/category.ts');
const { getLocalDateString } = utils;

let fallas = 0, total = 0;
const check = (nombre, ok, detalle = '') => {
    total++;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}${!ok && detalle ? ` — ${detalle}` : ''}`);
    if (!ok) fallas++;
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Compara una tabla de casos: cada fila { caso, esperado, obtenido }.
const tabla = (titulo, filas) => {
    const malas = filas.filter((f) => !igual(f.esperado, f.obtenido));
    check(`${titulo} (${filas.length} casos)`, malas.length === 0,
        malas.map((f) => `${f.caso}: esperado ${JSON.stringify(f.esperado)} obtenido ${JSON.stringify(f.obtenido)}`).join(' | '));
};
const seccion = (t) => console.log(`\n== ${t} ==`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const instanciar = (ext, deps) => instanciarPantalla(ext, { ...utils, ...motorCola, ...motorDetalle, ...motorCategoria, ...deps });

const VARIANTES = {
    video: {
        type: 'video', registro: 'src/screens/ChapterRegistryScreen.js', detalle: 'src/screens/SeriesDetailScreen.js',
        unidadLimite: 'series', confirmar: 'Marcar vistos', final: '¡Serie Completada!', finalRegistro: '¡Completada!',
        mensajeMarcar: (n, a, b) => `¿Marcar ${n} capítulos como vistos (${a} → ${b})?`, etq: (s, e) => `T${s}C${e}`, historial: 'watch_history', ts: 'watched_at',
    },
    reading: {
        type: 'reading', registro: 'src/screens/ReadingRegistryScreen.js', detalle: 'src/screens/ReadingDetailScreen.js',
        unidadLimite: 'obras', confirmar: 'Marcar leídos', final: '¡Obra Completada!', finalRegistro: '¡Completada!',
        mensajeMarcar: (n, a, b) => `¿Marcar ${n} tomos como leídos (${a} → ${b})?`, etq: (s, e) => `P${s}T${e}`, historial: 'reading_history', ts: 'read_at',
    },
};
const CATEGORIAS = 'src/screens/SeriesAnimeScreen.js';

// Alert de React Native: registra cada alerta y pulsa un botón. `eleccion` es un texto (se pulsa
// en cada alerta que lo tenga) o una lista para alertas encadenadas: la alerta n-ésima pulsa el
// elemento n-ésimo (así ['Marcar', 'Cancelar'] confirma y luego cancela en el destino).
function crearAlert(eleccion = null) {
    const registro = [];
    let n = 0;
    return {
        registro,
        Alert: {
            alert: (titulo, mensaje, botones) => {
                registro.push({ titulo, mensaje, botones: botones ? botones.map((b) => b.text) : [] });
                if (!botones || !eleccion) return;
                const texto = Array.isArray(eleccion) ? eleccion[n++] : eleccion;
                const b = botones.find((x) => x.text === texto);
                if (b && b.onPress) b.onPress();
            },
        },
    };
}

// Envuelve la fachada: registra cada llamada y su promesa, para esperar TODAS las escrituras que
// disparó la pantalla (las pantallas no siempre hacen await de su efecto).
function espiar(db) {
    const pendientes = [];
    const llamadas = [];
    const proxy = new Proxy(db, {
        get(t, k) {
            const v = t[k];
            if (typeof v !== 'function') return v;
            return (...args) => {
                llamadas.push(k);
                const r = v.apply(t, args);
                if (r && typeof r.then === 'function') pendientes.push(r);
                return r;
            };
        },
    });
    return {
        db: proxy, llamadas,
        async asentar() {
            for (let i = 0; i < 5 || pendientes.length; i++) {
                while (pendientes.length) await pendientes.shift();
                await new Promise((r) => setImmediate(r));
            }
        },
    };
}

// =============================================================================================
// Entorno: BD sintética nueva, fachada real y "pantallas" extraídas
// =============================================================================================
const WORK = join(tmpdir(), 'registro-pruebas-fase7-4a').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const D = createDevices(WORK);
const UID = '00000000-0000-4000-8000-0000000074a1'; // uid SINTÉTICO
let nBD = 0;

const hoyMas = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const dia = (n) => getLocalDateString(hoyMas(n));
const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const todas = (q) => Object.fromEntries(DIAS.map((d) => [d, q]));
const etiqueta = (ep) => `${ep.seriesName}·T${ep.season}E${ep.episode}`;

async function entorno(uid = UID) {
    const dev = await D.newDevice(`bd-${++nBD}`);
    D.use(dev);
    const db = dev.svc;
    const r = await quiet(() => db.createLinkedUser(uid, 'prueba@ejemplo.test'));
    if (!r.success) throw new Error('createLinkedUser falló');
    const user = { id: uid };
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && res.error}`); return res; };
    const usar = () => D.use(dev);

    const categoria = async (id) => { usar(); return (ok(await db.getEntertainmentCategories(uid), 'getEntertainmentCategories')).categories.find((c) => c.id === id); };
    const crearCategoria = async ({ type = 'video', startDate = dia(0), quotas = todas(1), frequency = type === 'reading' ? 1 : 0, seriesCount = null } = {}) => {
        usar();
        const res = ok(await db.addEntertainmentCategory(uid, { name: `Cat ${type}`, type, startDate, daysOfWeek: quotas, frequency, seriesCount, description: null }), 'addEntertainmentCategory');
        return categoria(res.id);
    };
    const V = (cat) => VARIANTES[cat.type];

    // Lista del detalle (fetchSeries real).
    const lista = async (cat) => {
        usar();
        let l = null;
        const fetchSeries = instanciar(extraer(V(cat).detalle, 'fetchSeries'), { category: cat, db, setOriginalList: (x) => { l = x; }, console });
        await quiet(() => fetchSeries());
        return l;
    };
    const serie = async (cat, nombre) => (await lista(cat)).find((s) => s.name === nombre);

    // Pantalla de Registro (loadData real) en una pestaña. Devuelve una "pantalla" viva: su estado
    // (raw, items, cabecera) se actualiza cada vez que la propia pantalla vuelve a cargar.
    const registro = async (cat, { tab = 'pending', categoriaProp = cat, espia = null } = {}) => {
        usar();
        const v = V(cat);
        const p = { raw: null, items: null, cabecera: null, counts: null };
        const dbx = espia ? espia.db : db;
        const noop = () => {};
        const capturas = { setRawSeries: (x) => { p.raw = x; }, setItems: (x) => { p.items = x; }, setLoading: noop, setCurrentCategory: noop, setCounts: (x) => { p.counts = x; } };
        const cab = (x) => { p.cabecera = x ? { items: x.items, adelanto: x.adelantoItems } : null; };
        if (v.type === 'video') {
            const calculateGlobalBacklog = instanciar(extraer(v.registro, 'calculateGlobalBacklog'), { setHeaderBacklog: cab, currentCategory: categoriaProp });
            p.loadData = instanciar(extraer(v.registro, 'loadData'), { ...capturas, db: dbx, user, category: categoriaProp, tab, calculateGlobalBacklog });
        } else {
            p.loadData = instanciar(extraer(v.registro, 'loadData'), { ...capturas, db: dbx, user, category: categoriaProp, currentTab: tab, setBacklogInfo: cab, console });
        }
        await quiet(() => p.loadData());
        if (!p.items) throw new Error(`${v.registro}: loadData no produjo la lista`);
        return p;
    };
    const cola = async (cat) => (await registro(cat)).items;

    // "Guardar" del formulario de serie (handleSave real).
    const agregar = async (cat, { name, temporadas, status = 'Nueva', T = 1, E = 1, editar = null, categoriaProp = cat }) => {
        usar();
        const A = crearAlert();
        const originalList = await lista(cat);
        const handleSave = instanciar(extraer(V(cat).detalle, 'handleSave'), {
            name, description: '', status, seasons: temporadas.map((n, i) => ({ number: i + 1, episodes: String(n) })),
            currentSeason: T, currentEpisode: E, isEditing: !!editar, editingSeriesId: editar,
            originalList, category: categoriaProp, currentCategory: cat, db, Alert: A.Alert, setModalVisible: () => {}, fetchSeries: () => {}, resetForm: () => {},
        });
        await quiet(() => handleSave());
        return A.registro;
    };

    // Marcar visto el primer pendiente de una serie en el Registro (onMarkWatched real).
    const marcar = async (cat, nombre, eleccion = null, pantalla = null) => {
        usar();
        const v = V(cat);
        const espia = pantalla ? pantalla.espia : espiar(db);
        const p = pantalla || await registro(cat, { espia });
        const item = p.items.find((i) => i.seriesName === nombre);
        if (!item) throw new Error(`${nombre} no está en la cola`);
        const A = crearAlert(eleccion);
        const onMarkWatched = instanciar(extraer(v.registro, 'onMarkWatched'), { rawSeries: p.raw, items: p.items, db: espia.db, Alert: A.Alert, loadData: p.loadData });
        await quiet(async () => { await onMarkWatched(item); await espia.asentar(); });
        return A.registro;
    };
    const verEnOrden = async (cat, n) => {
        const vistos = [];
        for (let i = 0; i < n; i++) {
            const items = await cola(cat);
            vistos.push(etiqueta(items[0]));
            await marcar(cat, items[0].seriesName);
        }
        return vistos;
    };

    // Desmarcar en la pestaña de vistos del Registro (onUnmarkWatched real).
    const desmarcarRegistro = async (cat, nombre, s, e, pantalla = null) => {
        usar();
        const v = V(cat);
        const espia = pantalla ? pantalla.espia : espiar(db);
        const pv = await registro(cat, { tab: 'watched', espia, categoriaProp: pantalla ? pantalla.categoriaProp : cat });
        const pend = pantalla || await registro(cat);
        const item = pv.items.find((i) => i.seriesName === nombre && i.season === s && i.episode === e);
        if (!item) throw new Error(`${nombre} T${s}E${e} no está en vistos`);
        const onUnmarkWatched = instanciar(extraer(v.registro, 'onUnmarkWatched'), { rawSeries: pend.raw, db: espia.db, loadData: pantalla ? pantalla.loadData : pv.loadData });
        await quiet(async () => { await onUnmarkWatched(item); await espia.asentar(); });
    };

    // Grilla de progreso del detalle (updateToChapter real). Devuelve las alertas.
    const tocar = async (cat, nombre, s, e, eleccion = null) => {
        usar();
        const originalList = await lista(cat);
        const serieX = originalList.find((x) => x.name === nombre);
        const A = crearAlert(eleccion);
        const espia = espiar(db);
        const updateToChapter = instanciar(extraer(V(cat).detalle, 'updateToChapter'), {
            activeSeries: serieX, originalList, category: cat, db: espia.db, Alert: A.Alert, fetchSeries: () => {}, setActiveSeries: () => {},
        });
        await quiet(async () => { await updateToChapter(serieX.id, s, e); await espia.asentar(); });
        return A.registro;
    };

    const pausar = async (cat, nombre) => {
        usar();
        const originalList = await lista(cat);
        const s = originalList.find((x) => x.name === nombre);
        const espia = espiar(db);
        const handleTogglePauseSeries = instanciar(extraer(V(cat).detalle, 'handleTogglePauseSeries'), { originalList, db: espia.db, fetchSeries: () => {} });
        await quiet(async () => { await handleTogglePauseSeries(s); await espia.asentar(); });
    };

    const reiniciar = async (cat, nombre) => {
        usar();
        const s = await serie(cat, nombre);
        const A = crearAlert('Reiniciar');
        const espia = espiar(db);
        const handleRestart = instanciar(extraer(V(cat).detalle, 'handleRestart'), {
            activeSeries: s, db: espia.db, Alert: A.Alert, fetchSeries: () => {}, setProgressModalVisible: () => {},
        });
        await quiet(async () => { await handleRestart(); await espia.asentar(); });
        return A.registro;
    };

    // "+ Nueva Serie" (handleAddPress real): ¿abrió el formulario?
    const botonAgregar = async (cat, { categoriaProp = cat } = {}) => {
        usar();
        const originalList = await lista(cat);
        const A = crearAlert();
        let abrio = false, reseteo = false;
        const handleAddPress = instanciar(extraer(V(cat).detalle, 'handleAddPress'), {
            originalList, category: categoriaProp, currentCategory: cat, Alert: A.Alert,
            resetForm: () => { reseteo = true; }, setModalVisible: (x) => { if (x) abrio = true; },
        });
        handleAddPress();
        return { abrio, reseteo, alertas: A.registro.map((a) => ({ titulo: a.titulo, mensaje: a.mensaje })) };
    };

    // Historial de una serie: filas vivas y borradas.
    const historial = async (cat, s) => {
        usar();
        const v = V(cat);
        const filas = await D.all(dev, `SELECT id, season_number s, episode_number e, ${v.ts} ts, deleted_at FROM ${v.historial} WHERE series_id = ? ORDER BY ${v.ts}, season_number, episode_number`, [s.id]);
        return { vivas: filas.filter((f) => !f.deleted_at), borradas: filas.filter((f) => f.deleted_at), todas: filas };
    };
    const estado = async (cat, nombre) => {
        const s = await serie(cat, nombre);
        return { status: s.status, T: s.current_season, E: s.current_episode, vistos: motorCola.watchedCount(s) };
    };

    return { dev, db, user, uid, usar, ok, crearCategoria, categoria, lista, serie, registro, cola, agregar, marcar, verEnOrden, desmarcarRegistro, tocar, pausar, reiniciar, botonAgregar, historial, estado };
}

// =============================================================================================
// 1. CICLO (decisión 5): E1, E2, E3
// =============================================================================================
seccion('1. Ciclo: serie nueva y reanudar (E1, E2, E3)');
{
    // E1: A = B = 2, C = 1 → D entra con p = 1, al final de la vuelta actual.
    let E = await entorno();
    let cat = await E.crearCategoria();
    for (const n of ['A', 'B', 'C']) await E.agregar(cat, { name: n, temporadas: [10] });
    const vistosE1 = await E.verEnOrden(cat, 5);
    await E.agregar(cat, { name: 'D', temporadas: [10] });
    let d = await E.serie(cat, 'D');
    const e1 = { vistos: vistosE1, D: { sortOrder: d.sort_order, offset: d.interleave_offset }, cola6: (await E.cola(cat)).slice(0, 6).map(etiqueta) };

    // E2: A = B = C = 2 → D entra en la vuelta 2, al final.
    E = await entorno();
    cat = await E.crearCategoria();
    for (const n of ['A', 'B', 'C']) await E.agregar(cat, { name: n, temporadas: [10] });
    await E.verEnOrden(cat, 6);
    await E.agregar(cat, { name: 'D', temporadas: [10] });
    d = await E.serie(cat, 'D');
    const e2 = { D: { sortOrder: d.sort_order, offset: d.interleave_offset }, cola6: (await E.cola(cat)).slice(0, 6).map(etiqueta) };

    // Serie nueva sin nada en la cola (la única otra está terminada) → offset 0.
    E = await entorno();
    cat = await E.crearCategoria();
    await E.agregar(cat, { name: 'T', temporadas: [1] });
    await E.tocar(cat, 'T', 1, 1, 'Terminado');
    await E.agregar(cat, { name: 'N', temporadas: [3] });
    const sinCola = { offset: (await E.serie(cat, 'N')).interleave_offset, cola: (await E.cola(cat)).map(etiqueta) };

    tabla('E1/E2: la serie nueva entra al final de la vuelta actual', [
        { caso: 'E1', esperado: { vistos: ['A·T1E1', 'B·T1E1', 'C·T1E1', 'A·T1E2', 'B·T1E2'], D: { sortOrder: 4, offset: 1 }, cola6: ['C·T1E2', 'D·T1E1', 'A·T1E3', 'B·T1E3', 'C·T1E3', 'D·T1E2'] }, obtenido: e1 },
        { caso: 'E2', esperado: { D: { sortOrder: 4, offset: 2 }, cola6: ['A·T1E3', 'B·T1E3', 'C·T1E3', 'D·T1E1', 'A·T1E4', 'B·T1E4'] }, obtenido: e2 },
        { caso: 'sin cola', esperado: { offset: 0, cola: ['N·T1E1', 'N·T1E2', 'N·T1E3'] }, obtenido: sinCola },
    ]);

    // E3 (opción A): reanudar = final de la vuelta actual con su propio progreso, sort_order MAX + 1.
    E = await entorno();
    cat = await E.crearCategoria();
    for (const n of ['A', 'B', 'C', 'D']) await E.agregar(cat, { name: n, temporadas: [10] });
    await E.verEnOrden(cat, 4);
    await E.pausar(cat, 'B');
    const enPausa = await E.verEnOrden(cat, 3);
    await E.pausar(cat, 'B'); // reanudar
    let b = await E.serie(cat, 'B');
    const e3 = {
        enPausa, B: { status: b.status, offset: b.interleave_offset, sortOrder: b.sort_order },
        viendo: motorDetalle.filterSeriesByTab(await E.lista(cat), 'Viendo').map((s) => s.name),
        cola6: (await E.cola(cat)).slice(0, 6).map(etiqueta),
    };

    // E3 a mitad de vuelta: A = 2, B = 1 (en la cola), C = 1 pausada → vuelve en la vuelta 1, al final.
    E = await entorno();
    cat = await E.crearCategoria();
    for (const n of ['A', 'B', 'C']) await E.agregar(cat, { name: n, temporadas: [10] });
    await E.verEnOrden(cat, 3);
    await E.pausar(cat, 'C');
    await E.verEnOrden(cat, 1);
    await E.pausar(cat, 'C');
    const c = await E.serie(cat, 'C');
    const e3b = { C: { offset: c.interleave_offset, sortOrder: c.sort_order }, cola5: (await E.cola(cat)).slice(0, 5).map(etiqueta) };

    // E3 con offset negativo: B lleva 10 vistos (grilla), A solo 2 → al reanudar, offset 2 − 10 = −8.
    E = await entorno();
    cat = await E.crearCategoria();
    for (const n of ['A', 'B']) await E.agregar(cat, { name: n, temporadas: [20] });
    await E.tocar(cat, 'B', 1, 10, 'Marcar');
    await E.tocar(cat, 'A', 1, 2, 'Marcar');
    await E.pausar(cat, 'B');
    await E.pausar(cat, 'B');
    b = await E.serie(cat, 'B');
    const e3c = { B: { offset: b.interleave_offset, sortOrder: b.sort_order, vistos: motorCola.watchedCount(b) }, cola4: (await E.cola(cat)).slice(0, 4).map(etiqueta) };

    // Reanudar sin otras series en la cola: el offset no cambia.
    E = await entorno();
    cat = await E.crearCategoria();
    await E.agregar(cat, { name: 'S', temporadas: [5] });
    await E.verEnOrden(cat, 2);
    await E.pausar(cat, 'S');
    await E.pausar(cat, 'S');
    const s = await E.serie(cat, 'S');
    const e3d = { offset: s.interleave_offset, sortOrder: s.sort_order, status: s.status };

    tabla('E3: reanudar entra al final de la vuelta actual (sort_order MAX + 1, baja al final de "Viendo")', [
        { caso: 'E3', esperado: { enPausa: ['A·T1E2', 'C·T1E2', 'D·T1E2'], B: { status: 'Mirando', offset: 1, sortOrder: 5 }, viendo: ['A', 'C', 'D', 'B'], cola6: ['A·T1E3', 'C·T1E3', 'D·T1E3', 'B·T1E2', 'A·T1E4', 'C·T1E4'] }, obtenido: e3 },
        { caso: 'a mitad de vuelta', esperado: { C: { offset: 0, sortOrder: 4 }, cola5: ['B·T1E2', 'C·T1E2', 'A·T1E3', 'B·T1E3', 'C·T1E3'] }, obtenido: e3b },
        { caso: 'offset negativo', esperado: { B: { offset: -8, sortOrder: 3, vistos: 10 }, cola4: ['A·T1E3', 'B·T1E11', 'A·T1E4', 'B·T1E12'] }, obtenido: e3c },
        { caso: 'sin otras en la cola', esperado: { offset: 0, sortOrder: 2, status: 'Mirando' }, obtenido: e3d },
    ]);
}

// =============================================================================================
// 2–3. GRILLA (decisión 2, ajuste c): hacia adelante y hacia atrás, video y lectura
// =============================================================================================
for (const tipo of ['video', 'reading']) {
    const v = VARIANTES[tipo];
    seccion(`2. Grilla hacia adelante (${tipo})`);
    const E = await entorno();
    const cat = await E.crearCategoria({ type: tipo });
    await E.agregar(cat, { name: 'G', temporadas: [3, 3] });
    const g = await E.serie(cat, 'G');
    const outbox = async () => (await D.one(E.dev, 'SELECT COUNT(*) n FROM outbox')).n;
    const titulos = (al) => al.map((a) => a.titulo);
    const filas = [];

    // 1 capítulo: sin confirmación.
    let al = await E.tocar(cat, 'G', 1, 1);
    filas.push({ caso: '1 capítulo (T1C1)', esperado: { alertas: [], estado: { status: 'Mirando', T: 1, E: 2, vistos: 1 } }, obtenido: { alertas: titulos(al), estado: await E.estado(cat, 'G') } });

    // Varios: confirmación; Cancelar no escribe nada.
    let ob0 = await outbox();
    al = await E.tocar(cat, 'G', 2, 1, 'Cancelar');
    filas.push({
        caso: '3 capítulos, Cancelar',
        esperado: { alertas: [{ titulo: v.confirmar, mensaje: v.mensajeMarcar(3, v.etq(1, 2), v.etq(2, 1)), botones: ['Cancelar', 'Marcar'] }], estado: { status: 'Mirando', T: 1, E: 2, vistos: 1 }, outboxNuevas: 0 },
        obtenido: { alertas: al, estado: await E.estado(cat, 'G'), outboxNuevas: (await outbox()) - ob0 },
    });
    al = await E.tocar(cat, 'G', 2, 1, 'Marcar');
    const h = await E.historial(cat, g);
    filas.push({
        caso: '3 capítulos, Marcar',
        esperado: { alertas: [v.confirmar], estado: { status: 'Mirando', T: 2, E: 2, vistos: 4 }, filas: ['1-1', '1-2', '1-3', '2-1'], mismoInstante: true },
        obtenido: { alertas: titulos(al), estado: await E.estado(cat, 'G'), filas: h.vivas.map((f) => `${f.s}-${f.e}`), mismoInstante: new Set(h.vivas.slice(1).map((f) => f.ts)).size === 1 },
    });

    // Último capítulo: confirmación + destino; Cancelar en el destino no escribe nada.
    ob0 = await outbox();
    al = await E.tocar(cat, 'G', 2, 3, ['Marcar', 'Cancelar']);
    filas.push({
        caso: 'hasta el último, Cancelar en el destino',
        esperado: { alertas: [v.confirmar, v.final], botonesFinal: ['En espera', 'Terminado', 'Cancelar'], estado: { status: 'Mirando', T: 2, E: 2, vistos: 4 }, outboxNuevas: 0 },
        obtenido: { alertas: titulos(al), botonesFinal: al[1] ? al[1].botones : null, estado: await E.estado(cat, 'G'), outboxNuevas: (await outbox()) - ob0 },
    });
    al = await E.tocar(cat, 'G', 2, 3, ['Marcar', 'Terminado']);
    filas.push({ caso: 'hasta el último, Terminado', esperado: { alertas: [v.confirmar, v.final], estado: { status: 'Terminado', T: 2, E: 3, vistos: 6 } }, obtenido: { alertas: titulos(al), estado: await E.estado(cat, 'G') } });

    // Último capítulo solo (1): sin confirmación, directo al destino.
    await E.agregar(cat, { name: 'H', temporadas: [2] });
    await E.tocar(cat, 'H', 1, 1);
    al = await E.tocar(cat, 'H', 1, 2, 'En espera');
    filas.push({ caso: 'último solo, En espera', esperado: { alertas: [v.final], estado: { status: 'En espera', T: 1, E: 2, vistos: 2 } }, obtenido: { alertas: titulos(al), estado: await E.estado(cat, 'H') } });
    await E.agregar(cat, { name: 'K', temporadas: [1] });
    ob0 = await outbox();
    al = await E.tocar(cat, 'K', 1, 1, 'Cancelar');
    filas.push({ caso: 'último solo, Cancelar', esperado: { alertas: [v.final], estado: { status: 'Nueva', T: 1, E: 1, vistos: 0 }, outboxNuevas: 0 }, obtenido: { alertas: titulos(al), estado: await E.estado(cat, 'K'), outboxNuevas: (await outbox()) - ob0 } });
    tabla(`grilla hacia adelante (${tipo})`, filas);

    // UNA transacción: si falla una fila, no queda ninguna ni cambia el puntero.
    await E.agregar(cat, { name: 'X', temporadas: [3] });
    const x = await E.serie(cat, 'X');
    ob0 = await outbox();
    E.usar();
    const res = await quiet(() => E.db.markEpisodesWatched(x.id, tipo, [{ season: 1, episode: 1 }, { season: null, episode: 2 }], { season: 1, episode: 3, status: 'Mirando' }, Date.now()));
    const hx = await E.historial(cat, x);
    check(`una sola transacción (${tipo}): una fila inválida → 0 filas, puntero y outbox intactos`,
        res.success === false && hx.todas.length === 0 && igual(await E.estado(cat, 'X'), { status: 'Nueva', T: 1, E: 1, vistos: 0 }) && (await outbox()) === ob0);

    seccion(`3. Grilla hacia atrás (${tipo})`);
    const atras = [];
    const E2 = await entorno();
    const cat2 = await E2.crearCategoria({ type: tipo });
    await E2.agregar(cat2, { name: 'G', temporadas: [3, 3] });
    const g2 = await E2.serie(cat2, 'G');
    await E2.tocar(cat2, 'G', 2, 2, 'Marcar'); // 5 vistos, puntero T2C3
    al = await E2.tocar(cat2, 'G', 1, 2, 'Cancelar');
    atras.push({
        caso: 'abierta, Cancelar',
        esperado: { alertas: [{ titulo: 'Desmarcar', mensaje: `¿Desmarcar desde ${v.etq(1, 2)}?`, botones: ['Cancelar', 'Desmarcar'] }], estado: { status: 'Mirando', T: 2, E: 3, vistos: 5 } },
        obtenido: { alertas: al, estado: await E2.estado(cat2, 'G') },
    });
    al = await E2.tocar(cat2, 'G', 1, 2, 'Desmarcar');
    let h2 = await E2.historial(cat2, g2);
    atras.push({
        caso: 'abierta, Desmarcar desde T1C2',
        esperado: { estado: { status: 'Mirando', T: 1, E: 2, vistos: 1 }, vivas: ['1-1'], borradas: 4 },
        obtenido: { estado: await E2.estado(cat2, 'G'), vivas: h2.vivas.map((f) => `${f.s}-${f.e}`), borradas: h2.borradas.length },
    });
    await E2.agregar(cat2, { name: 'C', temporadas: [2, 2] });
    await E2.tocar(cat2, 'C', 2, 2, ['Marcar', 'Terminado']);
    await E2.tocar(cat2, 'C', 2, 1, 'Desmarcar');
    atras.push({ caso: 'Terminado, Desmarcar desde T2C1', esperado: { status: 'Mirando', T: 2, E: 1, vistos: 2 }, obtenido: await E2.estado(cat2, 'C') });
    await E2.agregar(cat2, { name: 'W', temporadas: [2] });
    await E2.tocar(cat2, 'W', 1, 2, ['Marcar', 'En espera']);
    await E2.tocar(cat2, 'W', 1, 2, 'Desmarcar');
    atras.push({ caso: 'En espera, Desmarcar el último', esperado: { status: 'Mirando', T: 1, E: 2, vistos: 1 }, obtenido: await E2.estado(cat2, 'W') });

    // Visto dos veces: se borra la fila MÁS RECIENTE de ese capítulo.
    await E2.agregar(cat2, { name: 'R', temporadas: [2] });
    const r = await E2.serie(cat2, 'R');
    await E2.tocar(cat2, 'R', 1, 2, ['Marcar', 'Terminado']);
    await dormir(5);
    await E2.reiniciar(cat2, 'R');
    await E2.tocar(cat2, 'R', 1, 1);
    const antes = await E2.estado(cat2, 'R');
    await E2.tocar(cat2, 'R', 1, 1, 'Desmarcar');
    h2 = await E2.historial(cat2, r);
    const c11 = h2.todas.filter((f) => f.s === 1 && f.e === 1);
    const vivaC11 = c11.filter((f) => !f.deleted_at);
    atras.push({
        caso: 'visto dos veces: borra la más reciente',
        esperado: { antes: { status: 'Mirando', T: 1, E: 2, vistos: 3 }, despues: { status: 'Mirando', T: 1, E: 1, vistos: 2 }, filasC1: 2, vivaEsLaVieja: true },
        obtenido: { antes, despues: await E2.estado(cat2, 'R'), filasC1: c11.length, vivaEsLaVieja: vivaC11.length === 1 && vivaC11[0].ts === Math.min(...c11.map((f) => f.ts)) && c11.some((f) => f.deleted_at && f.ts > vivaC11[0].ts) },
    });
    tabla(`grilla hacia atrás (${tipo})`, atras);
}

// =============================================================================================
// 4. R8 EN LOS REGISTROS; 5. REINICIAR
// =============================================================================================
for (const tipo of ['video', 'reading']) {
    seccion(`4. R8: desmarcar en el Registro (${tipo})`);
    const E = await entorno();
    const cat = await E.crearCategoria({ type: tipo });
    const filas = [];
    for (const [nombre, destino] of [['S', 'Terminado'], ['W', 'En espera']]) {
        await E.agregar(cat, { name: nombre, temporadas: [2] });
        await E.marcar(cat, nombre);
        await E.marcar(cat, nombre, destino);
        const cerrada = await E.estado(cat, nombre);
        await E.desmarcarRegistro(cat, nombre, 1, 2);
        filas.push({
            caso: `${destino} → desmarcar T1E2`,
            esperado: { cerrada: { status: destino, T: 1, E: 2, vistos: 2 }, despues: { status: 'Mirando', T: 1, E: 2, vistos: 1 }, enCola: true },
            obtenido: { cerrada, despues: await E.estado(cat, nombre), enCola: (await E.cola(cat)).some((i) => i.seriesName === nombre) },
        });
    }
    await E.agregar(cat, { name: 'M', temporadas: [3] });
    await E.marcar(cat, 'M');
    await E.desmarcarRegistro(cat, 'M', 1, 1);
    filas.push({ caso: 'Mirando → sigue Mirando', esperado: { status: 'Mirando', T: 1, E: 1, vistos: 0 }, obtenido: await E.estado(cat, 'M') });
    tabla(`R8 en el Registro (${tipo})`, filas);
}

seccion('5. Reiniciar: sin ganar ni perder vistos (decisión 4)');
{
    const E = await entorno();
    const cat = await E.crearCategoria();
    await E.agregar(cat, { name: 'R', temporadas: [3] });
    await E.tocar(cat, 'R', 1, 3, ['Marcar', 'Terminado']);
    const antes = await E.serie(cat, 'R');
    const al = await E.reiniciar(cat, 'R');
    const despues = await E.serie(cat, 'R');
    await E.verEnOrden(cat, 1);
    tabla('reiniciar', [{
        caso: 'Terminado 1×3',
        esperado: { mensaje: '¿Empezar de cero? (3 vistos)', despues: { status: 'Mirando', T: 1, E: 1, vistos: 3, offset: antes.interleave_offset }, trasVer1: 4 },
        obtenido: { mensaje: al[0] && al[0].mensaje, despues: { status: despues.status, T: despues.current_season, E: despues.current_episode, vistos: motorCola.watchedCount(despues), offset: despues.interleave_offset }, trasVer1: (await E.estado(cat, 'R')).vistos },
    }]);
}

// =============================================================================================
// 6. R1: el mismo total en las 3 pantallas; 10. CABECERA DEL REGISTRO (ajuste b)
// =============================================================================================
seccion('6. R1: total visto igual en Registro, detalle y lista de categorías');
{
    const E = await entorno();
    const cat = await E.crearCategoria({ startDate: dia(-9) }); // meta 10
    await E.agregar(cat, { name: 'A', temporadas: [5] });
    await E.agregar(cat, { name: 'B', temporadas: [5] });
    await E.agregar(cat, { name: 'C', temporadas: [5] });
    await E.agregar(cat, { name: 'D', temporadas: [2] });
    await E.tocar(cat, 'A', 1, 2, 'Marcar');
    await E.tocar(cat, 'B', 1, 3, 'Marcar');
    await E.tocar(cat, 'C', 1, 1);
    await E.tocar(cat, 'D', 1, 2, ['Marcar', 'Terminado']);
    await E.pausar(cat, 'B');
    E.usar();
    E.ok(await E.db.deleteSeries((await E.serie(cat, 'C')).id), 'deleteSeries');
    // La categoría que pasa App.js puede estar vieja: el Registro no debe usar su totalWatched.
    const reg = await E.registro(cat, { categoriaProp: { ...cat, totalWatched: 999 } });
    tabla('R1 (A 2 + B 3 pausada + D 2 terminada; C borrada no cuenta)', [{
        caso: 'tres pantallas',
        esperado: { registroBD: 7, detalle: 7, listaCategorias: 7, cabeceraRegistro: { items: 3, adelanto: 0 } },
        obtenido: {
            registroBD: (E.ok(await E.db.getCategoryWatchedTotal(cat.id), 'getCategoryWatchedTotal')).total,
            detalle: motorDetalle.seriesWatchedTotal(await E.lista(cat)),
            listaCategorias: (await E.categoria(cat.id)).totalWatched,
            cabeceraRegistro: reg.cabecera,
        },
    }]);
}

for (const tipo of ['video', 'reading']) {
    seccion(`10. Cabecera del Registro tras marcar y desmarcar, sin salir (${tipo})`);
    const E = await entorno();
    const cat = await E.crearCategoria({ type: tipo }); // meta de hoy: 1
    await E.agregar(cat, { name: 'A', temporadas: [5] });
    const categoriaProp = { ...cat, totalWatched: 999 }; // vieja, como la de App.js
    E.usar();
    const espia = espiar(E.db);
    const pantalla = await E.registro(cat, { categoriaProp, espia });
    pantalla.espia = espia;
    pantalla.categoriaProp = categoriaProp;
    const pasos = [{ paso: 'al abrir', cabecera: pantalla.cabecera }];
    await E.marcar(cat, 'A', null, pantalla);
    pasos.push({ paso: 'marcar 1', cabecera: pantalla.cabecera });
    await E.marcar(cat, 'A', null, pantalla);
    pasos.push({ paso: 'marcar 2', cabecera: pantalla.cabecera });
    await E.desmarcarRegistro(cat, 'A', 1, 2, pantalla);
    pasos.push({ paso: 'desmarcar 1', cabecera: pantalla.cabecera });
    await E.desmarcarRegistro(cat, 'A', 1, 1, pantalla);
    pasos.push({ paso: 'desmarcar 2', cabecera: pantalla.cabecera });
    tabla(`cabecera del Registro (${tipo})`, [{
        caso: 'misma pantalla',
        esperado: [
            { paso: 'al abrir', cabecera: { items: 1, adelanto: 0 } }, { paso: 'marcar 1', cabecera: { items: 0, adelanto: 0 } },
            { paso: 'marcar 2', cabecera: { items: 0, adelanto: 1 } }, { paso: 'desmarcar 1', cabecera: { items: 0, adelanto: 0 } },
            { paso: 'desmarcar 2', cabecera: { items: 1, adelanto: 0 } },
        ],
        obtenido: pasos,
    }]);
    check(`cabecera (${tipo}): cada recarga relee el total de la BD (getCategoryWatchedTotal)`,
        espia.llamadas.filter((k) => k === 'getCategoryWatchedTotal').length >= 4, `llamadas ${espia.llamadas.filter((k) => k === 'getCategoryWatchedTotal').length}`);
}

// =============================================================================================
// 7. R15: temporadas con 0 capítulos
// =============================================================================================
seccion('7. R15: una temporada con 0 capítulos se salta (video y lectura)');
{
    const filas = [];
    const colas = {};
    for (const tipo of ['video', 'reading']) {
        const v = VARIANTES[tipo];
        const E = await entorno();
        const cat = await E.crearCategoria({ type: tipo });
        // Una fila de temporada con episode_count 0 GUARDADA (datos de antes o de otro dispositivo):
        // el formulario actual no la guarda (validateSeriesForm descarta las temporadas sin
        // capítulos), así que se crea con la fachada, como lo haría una fila que llega por sync.
        const conTemporadas = async (name, caps) => {
            E.usar();
            E.ok(await E.db.addSeriesWithSeasons({ category_id: cat.id, name, description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: caps.length },
                caps.map((n, i) => ({ season_number: i + 1, episode_count: n }))), 'addSeriesWithSeasons');
        };
        await conTemporadas('Z', [2, 0, 2]);
        colas[tipo] = (await E.cola(cat)).map(etiqueta);
        await E.verEnOrden(cat, 2);
        const trasT1 = await E.estado(cat, 'Z');
        await conTemporadas('Y', [2, 0, 2]);
        const al = await E.tocar(cat, 'Y', 3, 1, 'Marcar');
        const y = await E.estado(cat, 'Y');
        await conTemporadas('F', [2, 0]);
        await E.marcar(cat, 'F');
        const alF = await E.marcar(cat, 'F', 'Terminado');
        filas.push({
            caso: tipo,
            esperado: {
                cola: ['Z·T1E1', 'Z·T1E2', 'Z·T3E1', 'Z·T3E2'], trasT1: { status: 'Mirando', T: 3, E: 1, vistos: 2 },
                grilla: { mensaje: v.mensajeMarcar(3, v.etq(1, 1), v.etq(3, 1)), estado: { status: 'Mirando', T: 3, E: 2, vistos: 3 } },
                finalAntesDeLaVacia: { alerta: v.finalRegistro, estado: { status: 'Terminado', T: 1, E: 2, vistos: 2 } },
            },
            obtenido: {
                cola: colas[tipo], trasT1, grilla: { mensaje: al[0] && al[0].mensaje, estado: y },
                finalAntesDeLaVacia: { alerta: alF[0] && alF[0].titulo, estado: await E.estado(cat, 'F') },
            },
        });
    }
    tabla('R15', filas);
    // Nivel puro: episode_count nulo también se salta; video y lectura usan la misma cola.
    const s = { s_id: 'x', s_name: 'P', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 3, seasons: [{ season_number: 1, episode_count: 1 }, { season_number: 2, episode_count: null }, { season_number: 3, episode_count: 1 }] };
    check('R15 nivel puro: episode_count nulo se salta (P·T1E1, P·T3E1)', igual(motorCola.episodesForSeries(s).map(etiqueta), ['P·T1E1', 'P·T3E1']));
}

seccion('7b. Hueco: una temporada intermedia vacía en el formulario (video y lectura)');
{
    // El formulario descarta la temporada vacía y conserva la numeración: se guardan T1 y T3 con
    // total_seasons 2. Decisión del usuario (7.4a): la que falta se salta y la serie termina en la
    // de número más alto (antes: la T2 que falta contaba como 999 capítulos y la T3 nunca llegaba).
    const filas = [];
    for (const tipo of ['video', 'reading']) {
        const v = VARIANTES[tipo];
        const E = await entorno();
        const cat = await E.crearCategoria({ type: tipo });
        await E.agregar(cat, { name: 'H', temporadas: [2, 0, 2] });
        const h = await E.serie(cat, 'H');
        const guardado = { temporadas: h.seasons.map((t) => t.season_number), total: h.total_seasons };
        const cola = (await E.cola(cat)).map(etiqueta);
        await E.verEnOrden(cat, 2);
        const trasT1 = await E.estado(cat, 'H');
        await E.marcar(cat, 'H');
        const alFinal = await E.marcar(cat, 'H', 'Terminado');
        const finalH = await E.estado(cat, 'H');
        await E.agregar(cat, { name: 'G', temporadas: [2, 0, 2] });
        const al = await E.tocar(cat, 'G', 3, 1, 'Marcar');
        const g = await E.estado(cat, 'G');
        const alUltimo = await E.tocar(cat, 'G', 3, 2, 'Terminado');
        filas.push({
            caso: tipo,
            esperado: {
                guardado: { temporadas: [1, 3], total: 2 }, cola: ['H·T1E1', 'H·T1E2', 'H·T3E1', 'H·T3E2'],
                trasT1: { status: 'Mirando', T: 3, E: 1, vistos: 2 },
                final: { alerta: v.finalRegistro, estado: { status: 'Terminado', T: 3, E: 2, vistos: 4 } },
                grilla: { mensaje: v.mensajeMarcar(3, v.etq(1, 1), v.etq(3, 1)), estado: { status: 'Mirando', T: 3, E: 2, vistos: 3 } },
                grillaUltimo: { alertas: [v.final], estado: { status: 'Terminado', T: 3, E: 2, vistos: 4 } },
            },
            obtenido: {
                guardado, cola, trasT1,
                final: { alerta: alFinal[0] && alFinal[0].titulo, estado: finalH },
                grilla: { mensaje: al[0] && al[0].mensaje, estado: g },
                grillaUltimo: { alertas: alUltimo.map((a) => a.titulo), estado: await E.estado(cat, 'G') },
            },
        });
    }
    tabla('hueco', filas);
    const base = { s_id: 'x', s_name: 'P', status: 'Nueva', current_season: 1, current_episode: 1 };
    const sinFilas = motorCola.episodesForSeries({ ...base, total_seasons: 1, seasons: [] });
    tabla('hueco (nivel puro)', [
        { caso: 'sin filas de temporadas: 999 por temporada como antes (tope 500)', esperado: { n: 500, primero: 'P·T1E1' }, obtenido: { n: sinFilas.length, primero: sinFilas[0] && etiqueta(sinFilas[0]) } },
        { caso: 'total_seasons 3 con filas 1..2: termina en la 2', esperado: ['P·T1E1', 'P·T2E1'], obtenido: motorCola.episodesForSeries({ ...base, total_seasons: 3, seasons: [{ season_number: 1, episode_count: 1 }, { season_number: 2, episode_count: 1 }] }).map(etiqueta) },
        { caso: 'filas 1 y 3 con total_seasons 2: llega a la 3', esperado: ['P·T1E1', 'P·T3E1'], obtenido: motorCola.episodesForSeries({ ...base, total_seasons: 2, seasons: [{ season_number: 1, episode_count: 1 }, { season_number: 3, episode_count: 1 }] }).map(etiqueta) },
    ]);
}

// =============================================================================================
// 8. O1: límite de series activas
// =============================================================================================
seccion('8. O1: límite obligatorio ≥ 1, aviso antes del formulario, editar no se bloquea');
for (const tipo of ['video', 'reading']) {
    const v = VARIANTES[tipo];
    const E = await entorno();
    const filas = [];
    const cat = await E.crearCategoria({ type: tipo, seriesCount: 2 });
    await E.agregar(cat, { name: 'A', temporadas: [2] });
    await E.agregar(cat, { name: 'T', temporadas: [1] });
    await E.tocar(cat, 'T', 1, 1, 'Terminado'); // terminada: no cuenta
    filas.push({ caso: 'límite 2, 1 activa + 1 terminada', esperado: { abrio: true, reseteo: true, alertas: [] }, obtenido: await E.botonAgregar(cat) });
    await E.agregar(cat, { name: 'B', temporadas: [2] });
    const aviso = { titulo: 'Límite Alcanzado', mensaje: `Máximo 2 ${v.unidadLimite} activas.` };
    filas.push({ caso: 'límite 2, 2 activas', esperado: { abrio: false, reseteo: false, alertas: [aviso] }, obtenido: await E.botonAgregar(cat) });
    filas.push({ caso: 'límite 2 con la categoría de App.js vieja (sin límite)', esperado: { abrio: false, reseteo: false, alertas: [aviso] }, obtenido: await E.botonAgregar(cat, { categoriaProp: { ...cat, series_count: null } }) });
    // El guardado sigue protegido (doble seguridad) y editar nunca se bloquea.
    const alNueva = await E.agregar(cat, { name: 'C', temporadas: [2] });
    const a = await E.serie(cat, 'A');
    const alEditar = await E.agregar(cat, { name: 'A editada', temporadas: [2, 2], editar: a.id });
    filas.push({
        caso: 'guardar al límite / editar al límite',
        esperado: { nueva: [aviso], guardadas: 3, editar: [], editada: 'A editada' },
        obtenido: { nueva: alNueva.map((x) => ({ titulo: x.titulo, mensaje: x.mensaje })), guardadas: (await E.lista(cat)).length, editar: alEditar.map((x) => x.titulo), editada: (await E.lista(cat)).find((s) => s.id === a.id).name },
    });
    for (const limite of [null, 0]) {
        const c = await E.crearCategoria({ type: tipo, seriesCount: limite });
        for (const n of ['A', 'B', 'C']) await E.agregar(c, { name: n, temporadas: [2] });
        filas.push({ caso: `límite ${limite} (sin límite) con 3 activas`, esperado: { abrio: true, guardadas: 3 }, obtenido: { abrio: (await E.botonAgregar(c)).abrio, guardadas: (await E.lista(c)).length } });
    }
    tabla(`O1 detalle (${tipo})`, filas);
}
{
    // Formulario de categoría (SeriesAnimeScreen, handleSave real), video y lectura.
    const E = await entorno();
    const filas = [];
    const MSG = 'El límite de series activas es obligatorio (mínimo 1).';
    const guardar = async ({ type, seriesCount, name = 'F', editar = null }) => {
        E.usar();
        let id = editar;
        const A = crearAlert();
        const db = Object.create(E.db);
        db.addEntertainmentCategory = async (u, data) => { const res = await E.db.addEntertainmentCategory(u, data); id = res.id; return res; };
        const handleSave = instanciar(extraer(CATEGORIAS, 'handleSave'), {
            name, type, startDate: dia(0), selectedDays: todas(1), frequency: type === 'reading' ? '1' : '', seriesCount,
            description: '', isEditing: !!editar, editingId: editar, db, user: E.user, Alert: A.Alert, setModalVisible: () => {}, fetchCategories: () => {},
        });
        await quiet(() => handleSave());
        const error = A.registro.find((x) => x.titulo === 'Error');
        return error ? { rechazado: error.mensaje } : { guardado: (await E.categoria(id)).series_count };
    };
    for (const type of ['video', 'reading']) {
        for (const [texto, esperado] of [['', { rechazado: MSG }], ['0', { rechazado: MSG }], ['-1', { rechazado: MSG }], ['1.5', { rechazado: MSG }], ['abc', { rechazado: MSG }], [' ', { rechazado: MSG }], ['1', { guardado: 1 }], ['7', { guardado: 7 }]]) {
            filas.push({ caso: `${type} "${texto}"`, esperado, obtenido: await guardar({ type, seriesCount: texto }) });
        }
        filas.push({ caso: `${type} sin nombre`, esperado: { rechazado: 'Por favor ingresa un nombre para la categoría.' }, obtenido: await guardar({ type, seriesCount: '2', name: '' }) });
        // Editar una categoría vieja con 0: se exige el valor y, si se rechaza, no cambia nada.
        const vieja = await E.crearCategoria({ type, seriesCount: 0 });
        filas.push({ caso: `${type} editar una vieja con 0 → "0"`, esperado: { rechazado: MSG, sigue: 0 }, obtenido: { ...(await guardar({ type, seriesCount: '0', editar: vieja.id })), sigue: (await E.categoria(vieja.id)).series_count } });
        filas.push({ caso: `${type} editar una vieja con 0 → "3"`, esperado: { guardado: 3 }, obtenido: await guardar({ type, seriesCount: '3', editar: vieja.id }) });
    }
    tabla('O1 formulario de categoría (handleSave real)', filas);
    // Al reabrir: NULL y 0 se muestran vacíos (hay que completarlos); 3 se muestra "3".
    const reabrir = [];
    for (const [limite, esperado] of [[null, ''], [0, ''], [3, '3']]) {
        let mostrado = null;
        const noop = () => {};
        const openModal = instanciar(extraer(CATEGORIAS, 'openModal'), {
            setIsEditing: noop, setEditingId: noop, setName: noop, setType: noop, setStartDate: noop, getLocalDateString, console,
            setSelectedDays: noop, setFrequency: noop, setSeriesCount: (x) => { mostrado = x; }, setDescription: noop, setModalVisible: noop,
        });
        openModal(await E.crearCategoria({ seriesCount: limite }));
        reabrir.push({ caso: `series_count ${limite}`, esperado, obtenido: mostrado });
    }
    tabla('O1 reabrir el formulario', reabrir);
    // Nivel puro.
    tabla('O1 validateCategoryForm / activeLimit (puro)', [
        { caso: 'nombre vacío', esperado: { error: 'nombre' }, obtenido: motorCategoria.validateCategoryForm({ name: '  ', seriesCount: '2' }) },
        { caso: '"12"', esperado: { seriesCount: 12 }, obtenido: motorCategoria.validateCategoryForm({ name: 'x', seriesCount: '12' }) },
        { caso: '"0"', esperado: { error: 'limite' }, obtenido: motorCategoria.validateCategoryForm({ name: 'x', seriesCount: '0' }) },
        { caso: 'activeLimit null/0/2', esperado: [null, null, 2], obtenido: [null, 0, 2].map((n) => motorDetalle.activeLimit({ series_count: n })) },
    ]);
}

// =============================================================================================
// 9. OUTBOX: cada fila de historial encola su entrada
// =============================================================================================
seccion('9. Outbox por fila de historial');
for (const tipo of ['video', 'reading']) {
    const v = VARIANTES[tipo];
    const E = await entorno();
    const cat = await E.crearCategoria({ type: tipo });
    await E.agregar(cat, { name: 'O', temporadas: [5] });
    const o = await E.serie(cat, 'O');
    await D.sql(E.dev, 'DELETE FROM outbox'); // BD de prueba: se parte de una outbox vacía
    await E.tocar(cat, 'O', 1, 3, 'Marcar');
    const ob1 = await D.all(E.dev, 'SELECT table_name t, row_id r FROM outbox');
    const h1 = await E.historial(cat, o);
    await D.sql(E.dev, 'DELETE FROM outbox');
    await E.tocar(cat, 'O', 1, 2, 'Desmarcar');
    const ob2 = await D.all(E.dev, 'SELECT table_name t, row_id r FROM outbox');
    const h2 = await E.historial(cat, o);
    const ids = (lista, t) => lista.filter((x) => x.t === t).map((x) => x.r).sort();
    tabla(`outbox (${tipo})`, [
        { caso: 'marcar 3', esperado: { historial: h1.vivas.map((f) => f.id).sort(), series: [o.id] }, obtenido: { historial: ids(ob1, v.historial), series: ids(ob1, 'series') } },
        { caso: 'desmarcar 2', esperado: { historial: h2.borradas.map((f) => f.id).sort(), nBorradas: 2, series: [o.id] }, obtenido: { historial: ids(ob2, v.historial), nBorradas: h2.borradas.length, series: ids(ob2, 'series') } },
    ]);
}

// =============================================================================================
// 11. SYNC (ajuste a): interleave_offset negativo por PGlite
// =============================================================================================
seccion('11. Sync: serie con interleave_offset negativo (PGlite, migraciones reales, RLS)');
{
    const SYNC_UID = '00000000-0000-4000-8000-0000000074a2'; // uid SINTÉTICO
    const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true };
    const { pg, T, newAuthUser } = await createServer();
    await newAuthUser(SYNC_UID);
    T.uid = SYNC_UID;
    // Sin restricciones en el servidor ni en el mapeo (verificado antes de escribir el caso).
    const restricciones = (await pg.query(`select count(*)::int n from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname = 'series' and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%interleave_offset%'`)).rows[0].n;
    const ida = mapping.toRemote('series', { id: 'x', user_id: SYNC_UID, interleave_offset: -8, sort_order: 3, last_watched_at: 0 });
    check('sin CHECK sobre interleave_offset en Postgres y el mapeo conserva −8 (toRemote → fromRemote)',
        restricciones === 0 && ida.interleave_offset === -8 && mapping.fromRemote('series', ida).interleave_offset === -8);

    const A = await entorno(SYNC_UID);
    const cat = await A.crearCategoria();
    for (const n of ['A', 'B']) await A.agregar(cat, { name: n, temporadas: [20] });
    await A.tocar(cat, 'B', 1, 10, 'Marcar');
    await A.tocar(cat, 'A', 1, 2, 'Marcar');
    await A.pausar(cat, 'B');
    await A.pausar(cat, 'B');
    const bA = await A.serie(cat, 'B');
    const colaA = (await A.cola(cat)).slice(0, 4).map(etiqueta);
    A.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const oa = await quiet(() => engine.syncOnce(CFG, T));
    const obA = await D.one(A.dev, 'SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    const srv = (await pg.query('select interleave_offset, sort_order, status from public.series where id = $1', [bA.id])).rows[0];
    check('A sube: ciclo ok, 0 bloqueadas, outbox vacía, el servidor guarda −8',
        bA.interleave_offset === -8 && oa.status === 'ok' && oa.push.blocked === 0 && obA.raw === 0 && srv && srv.interleave_offset === -8 && srv.sort_order === bA.sort_order,
        `estado ${oa.status}, bloqueadas ${oa.push && oa.push.blocked}, outbox ${obA.raw}, servidor ${srv && srv.interleave_offset}`);

    const B = await entorno(SYNC_UID); // dispositivo vacío de la misma cuenta
    B.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const ob = await quiet(() => engine.syncOnce(CFG, T));
    A.usar();
    await quiet(() => engine.syncOnce(CFG, T)); // vuelta en A (adopta lo que haya subido B)
    const bB = await D.one(B.dev, 'SELECT interleave_offset, sort_order, status FROM series WHERE id = ?', [bA.id]);
    const catB = await B.categoria(cat.id);
    const colaB = (await B.cola(catB)).slice(0, 4).map(etiqueta);
    const cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    check('B baja: ciclo ok, la serie llega con −8 y la misma cola que en A',
        ob.status === 'ok' && ob.push.blocked === 0 && bB && bB.interleave_offset === -8 && igual(colaB, colaA) && igual(colaA, ['A·T1E3', 'B·T1E11', 'A·T1E4', 'B·T1E12']),
        `estado ${ob.status}, offset ${bB && bB.interleave_offset}, cola ${JSON.stringify(colaB)}`);
    check('A y B idénticos en las 15 tablas (comparar-sync)', cmp.identical, TABLES.filter((t) => !cmp.tables[t].same).join(','));
}

console.log(fallas === 0 ? `\nFASE 7.4a: ${total} OK.` : `\n${fallas} de ${total} prueba(s) fallaron.`);
process.exit(fallas === 0 ? 0 : 1);
