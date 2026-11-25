// Pruebas de la Fase 7.5: vínculo Pendiente ↔ Series/Lectura y subtipo de lectura.
//
// Tablas esperadas escritas desde las decisiones (claude/DISENO-ENTRETENIMIENTO.md, D1–D9 del plan
// aprobado y sus condiciones), con la fachada real (src/services/db.js) sobre BD node:sqlite
// SINTÉTICAS en un temporal del sistema, funciones reales de las pantallas (extraídas con
// scripts/lib/extraer-pantalla.mjs; hojas por scripts/lib/hojas-stub.mjs), el esquema real de
// supabase/migrations/ en PGlite (con el stub de auth) y, para la migración y la compatibilidad,
// el código real de la app 1.3.9 (6a1722f, cargado con `git show`). Nunca toca un proyecto remoto
// ni datos reales; no imprime filas.
//
// Secciones:
//   1. motor puro (src/entertainment/link.ts)
//   2. alta vinculada: "De Pendiente" y "Nuevo título" (handleSave real), una transacción, outbox,
//      nombre editado (D4), títulos no disponibles
//   3. reflejo de estado en cada camino que escribe series.status
//   4. comprobación estática del punto único (+ control negativo)
//   5. etiqueta y selector (filtro y los 3 órdenes)
//   6. borrado en los dos sentidos y de la categoría (D5 corregida: los títulos vuelven a Pendiente),
//      sin recursión, textos de las hojas; borrar una categoría igual que en c2c42c2 en todo lo demás
//   7. edición del título y del nombre (D4)
//   8. subtipo (D7) y botón de estado (D6)
//   9. migración 7 sobre una BD v6 de la 1.3.9; series sin vínculo como en la 1.3.9
//  10. Supabase: migración 6, privilegios, verificar-fase7-5.sql y auditar-fase6.sql
//  11. sync entre 2 dispositivos: vínculo, subtipo, reconciliación (D2)
//   6b. formulario: la elección de "Agregar" no se arrastra al editar ni tras cerrar o guardar
//  12. carreras del pull (seasons → series hoy; backlog → series sin FK local; título que todavía
//      no llegó: el detalle y Pendiente cargan, sin efectos sobre el título, borrado en una copia)
//  16. unblockAll: qué libera y qué no (constante PARENT_BLOCKED compartida con el motor)
//  17. borrar una categoría: todo lo demás igual que en c2c42c2 (categoría, pausas, ritmo, series sin
//      vínculo con temporadas e historial; sin vinculados, mismas filas y misma outbox)
//  18. reconciliación de la D5 corregida: dos dispositivos (borrar la categoría y editar el título sin
//      red) y un Mirando sin ninguna serie vinculada (anterior a la 7.5) que no se toca
//  13. 23503: backlog_id NULL no es un padre que falta; un padre que falta se encola
//  14. compatibilidad a (1.3.9 contra el servidor nuevo) y b (1.4.0 contra el servidor viejo)
//
// Uso: node scripts/probar-fase7-5.mjs
import { extraer, instanciar as instanciarPantalla } from './lib/extraer-pantalla.mjs'; // antes que test-hooks
import { hojasDesdeAlert } from './lib/hojas-stub.mjs';
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { cargarAppVieja } from './lib/app-vieja.mjs';

const traverse = traverseModule.default || traverseModule;
process.env.TZ = 'America/Guayaquil';

const { createDevices, engine, TABLES, quiet } = await import('./lib/sync-devices.mjs');
const { createPgliteTransport } = await import('./lib/pglite-transport.mjs');
const { snapshotDb, compareSnapshots } = await import('./comparar-sync.mjs');
const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const { setOutboxCommitListener } = await import('../src/data/db/connection.ts');
const { __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { backupCalls } = await import('./lib/backup-stub.mjs');
const { LATEST_VERSION } = await import('../src/services/migrations.js');
const { toRemote } = await import('../src/sync/mapping.ts');
const utils = await import('../src/services/backlogUtils.js');
const motorCola = await import('../src/entertainment/queue.ts');
const motorDetalle = await import('../src/entertainment/seriesDetail.ts');
const motorCategoria = await import('../src/entertainment/category.ts');
const link = await import('../src/entertainment/link.ts');

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
const instanciar = (ext, deps) => instanciarPantalla(ext, { ...utils, ...motorCola, ...motorDetalle, ...motorCategoria, ...link, link: null, newType: null, newStartYear: '', ...deps });
// Construye una función de la pantalla con sus dependencias; las que son otras funciones de la
// MISMA pantalla (p. ej. resetForm → clearLinkChoice) se extraen y construyen igual.
const construir = (archivo, nombre, deps, pila = []) => {
    const ext = extraer(archivo, nombre);
    const d = { ...deps };
    const base = { ...utils, ...motorCola, ...motorDetalle, ...motorCategoria, ...link };
    for (const l of ext.libres) {
        if (Object.hasOwn(d, l) || Object.hasOwn(base, l) || pila.includes(l)) continue;
        d[l] = construir(archivo, l, deps, [...pila, nombre]);
    }
    return instanciar(ext, d);
};
const vaciar = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const PANT = {
    detalle: 'src/screens/SeriesDetailScreen.js',
    detalleLectura: 'src/screens/ReadingDetailScreen.js',
    pendiente: 'src/screens/BacklogScreen.js',
    categorias: 'src/screens/SeriesAnimeScreen.js',
};
const REF_VIEJA = '6a1722f'; // app 1.3.9 (cierre de la dirección visual)
const MIGRACION_NUEVA = '20261122000100_vinculo_pendiente.sql';
const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true };

const WORK = join(tmpdir(), 'registro-pruebas-fase7-5').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const D = createDevices(`${WORK}/disp`);
let nBD = 0;
const UID = '00000000-0000-4000-8000-000000007501'; // uid SINTÉTICO

const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const todas = (q) => Object.fromEntries(DIAS.map((d) => [d, q]));
const dia = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return utils.getLocalDateString(d); };

// Alert de React Native, para hojas-stub: registra y pulsa el botón elegido (texto o lista por orden).
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

// Entorno: un dispositivo con la app nueva, cuenta vinculada a `uid` y ayudas sobre la fachada real.
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
    const crearCategoria = async ({ type = 'video', seriesCount = 9, name = `Cat ${type}` } = {}) => {
        usar();
        const res = ok(await db.addEntertainmentCategory(uid, { name, type, startDate: dia(-9), daysOfWeek: todas(1), frequency: type === 'reading' ? 1 : 0, seriesCount, description: null }), 'addEntertainmentCategory');
        return categoria(res.id);
    };
    const lista = async (cat) => {
        usar();
        const series = (ok(await db.getSeriesByCategory(cat.id), 'getSeriesByCategory')).series;
        return Promise.all(series.map(async (s) => ({ ...s, seasons: (ok(await db.getSeasonsBySeries(s.id), 'getSeasonsBySeries')).seasons })));
    };
    const serie = async (cat, name) => (await lista(cat)).find((s) => s.name === name);
    const titulos = async (type, extra = {}) => { usar(); return (ok(await db.getBacklogItems(uid, type, 'Total', 'created_at', 'ASC', 'Todos', extra.subtype || 'Todos'), 'getBacklogItems')).data; };
    const titulo = async (type, title) => (await titulos(type)).find((b) => b.title === title);
    const nuevoTitulo = async (type, title, extra = {}) => {
        usar();
        ok(await db.addBacklogItem(uid, { type, title, ...extra }), 'addBacklogItem');
        await pausa(3); // created_at distintos (orden "Registro")
        return titulo(type, title);
    };
    // "Guardar" del formulario de serie u obra (handleSave real de la pantalla de detalle).
    const guardar = async (cat, { name, temporadas = [2], status = 'Nueva', linkEstado = null, newType = null, newStartYear = '', editar = null }) => {
        usar();
        const A = crearAlert();
        const originalList = await lista(cat);
        const archivo = cat.type === 'reading' ? PANT.detalleLectura : PANT.detalle;
        const handleSave = instanciar(extraer(archivo, 'handleSave'), {
            name, description: '', status, seasons: temporadas.map((n, i) => ({ number: i + 1, episodes: String(n) })),
            currentSeason: 1, currentEpisode: 1, isEditing: !!editar, editingSeriesId: editar,
            originalList, category: cat, currentCategory: cat, db, ...hojasDesdeAlert(A.Alert),
            setModalVisible: () => {}, fetchSeries: () => {}, resetForm: () => {},
            link: linkEstado, newType, newStartYear,
        });
        await quiet(() => handleSave());
        return A.registro;
    };
    const outbox = async () => { usar(); return db.db.getAllAsync('SELECT table_name t, row_id r, COUNT(*) n FROM outbox GROUP BY table_name, row_id ORDER BY table_name, row_id'); };
    const limpiarOutbox = async () => { usar(); await db.db.runAsync('DELETE FROM outbox'); };
    // Resumen de la outbox: filas por tabla y si alguna fila tiene más de una entrada.
    const resumenOutbox = async () => {
        const filas = await outbox();
        const porTabla = {};
        for (const f of filas) porTabla[f.t] = (porTabla[f.t] || 0) + 1;
        return { porTabla, unaPorFila: filas.every((f) => f.n === 1) };
    };
    const contar = async (t, where = '1=1', p = []) => { usar(); return (await db.db.getFirstAsync(`SELECT COUNT(*) n FROM ${t} WHERE ${where}`, p)).n; };
    return { dev, db, user, uid, usar, ok, categoria, crearCategoria, lista, serie, titulos, titulo, nuevoTitulo, guardar, outbox, limpiarOutbox, resumenOutbox, contar };
}

// =============================================================================================
seccion('1. Motor puro (src/entertainment/link.ts)');
{
    tabla('backlogStatusFor', [
        { caso: 'sin series vivas', esperado: null, obtenido: link.backlogStatusFor([]) },
        { caso: 'Nueva', esperado: 'Mirando', obtenido: link.backlogStatusFor(['Nueva']) },
        { caso: 'Pausado', esperado: 'Mirando', obtenido: link.backlogStatusFor(['Pausado']) },
        { caso: 'En espera', esperado: 'Mirando', obtenido: link.backlogStatusFor(['En espera']) },
        { caso: 'Terminado', esperado: 'Terminado', obtenido: link.backlogStatusFor(['Terminado']) },
        { caso: 'dos series: Terminado + Mirando', esperado: 'Mirando', obtenido: link.backlogStatusFor(['Terminado', 'Mirando']) },
        { caso: 'dos series: las dos Terminado', esperado: 'Terminado', obtenido: link.backlogStatusFor(['Terminado', 'Terminado']) },
    ]);
    tabla('linkLabel e isCompatible', [
        { caso: 'etiqueta completa', esperado: 'En Animes · Pausado', obtenido: link.linkLabel({ seriesStatus: 'Pausado', categoryName: 'Animes' }) },
        { caso: 'sin categoría', esperado: 'Pausado', obtenido: link.linkLabel({ seriesStatus: 'Pausado', categoryName: null }) },
        { caso: 'video ↔ serie y anime; no lectura ni película', esperado: [true, true, false, false], obtenido: ['series', 'anime', 'reading', 'movie'].map((t) => link.isCompatible(t, 'video')) },
        { caso: 'lectura ↔ lectura', esperado: [false, false, true, false], obtenido: ['series', 'anime', 'reading', 'movie'].map((t) => link.isCompatible(t, 'reading')) },
    ]);
    const L = [
        { id: 'a', title: 'Zeta', type: 'series', status: 'Pendiente', start_year: 2010, created_at: '2026-11-01T10:00:00.000Z' },
        { id: 'b', title: 'alfa', type: 'anime', status: 'Pendiente', start_year: null, created_at: '2026-11-03T10:00:00.000Z' },
        { id: 'c', title: 'Beta', type: 'series', status: 'Pendiente', start_year: 2005, created_at: '2026-11-02T10:00:00.000Z' },
        { id: 'd', title: 'Ética', type: 'series', status: 'Pendiente', start_year: 2010, created_at: '2026-11-02T10:00:00.000Z' },
        { id: 'e', title: 'Libro', type: 'reading', status: 'Pendiente', start_year: 2001, created_at: '2026-11-04T10:00:00.000Z' },
        { id: 'f', title: 'Vista', type: 'series', status: 'Terminado', start_year: 2000, created_at: '2026-11-04T10:00:00.000Z' },
        { id: 'g', title: 'Ligada', type: 'series', status: 'Pendiente', start_year: 2000, created_at: '2026-11-04T10:00:00.000Z', linked_series_id: 'x' },
        { id: 'h', title: 'Peli', type: 'movie', status: 'Pendiente', start_year: 2000, created_at: '2026-11-04T10:00:00.000Z' },
    ];
    const cand = link.selectorCandidates(L, 'video');
    tabla('selectorCandidates y sortCandidates', [
        { caso: 'video: Pendiente, serie/anime, sin vínculo', esperado: ['a', 'b', 'c', 'd'], obtenido: cand.map((x) => x.id) },
        { caso: 'lectura', esperado: ['e'], obtenido: link.selectorCandidates(L, 'reading').map((x) => x.id) },
        { caso: 'año ascendente, sin año al final, empate por título (sin acentos)', esperado: ['c', 'd', 'a', 'b'], obtenido: link.sortCandidates(cand, 'year').map((x) => x.id) },
        { caso: 'registro: el más nuevo primero, empate por título', esperado: ['b', 'c', 'd', 'a'], obtenido: link.sortCandidates(cand, 'created').map((x) => x.id) },
        { caso: 'nombre A–Z sin mayúsculas ni acentos', esperado: ['b', 'c', 'd', 'a'], obtenido: link.sortCandidates(cand, 'title').map((x) => x.id) },
    ]);
    tabla('acciones manuales (D6)', [
        { caso: 'película: los tres', esperado: ['Pendiente', 'Mirando', 'Terminado'], obtenido: link.allowedManualStatuses({ type: 'movie', status: 'Pendiente' }) },
        { caso: 'serie sin vínculo', esperado: ['Pendiente', 'Terminado'], obtenido: link.allowedManualStatuses({ type: 'series', status: 'Pendiente' }) },
        { caso: 'vinculado', esperado: [], obtenido: link.allowedManualStatuses({ type: 'anime', status: 'Mirando', linked_series_id: 'x' }) },
        { caso: 'botón: película rota', esperado: ['Mirando', 'Terminado', 'Pendiente'], obtenido: ['Pendiente', 'Mirando', 'Terminado'].map((s) => link.nextManualStatus({ type: 'movie', status: s })) },
        { caso: 'botón: sin vínculo (desde Mirando → Terminado)', esperado: ['Terminado', 'Terminado', 'Pendiente'], obtenido: ['Pendiente', 'Mirando', 'Terminado'].map((s) => link.nextManualStatus({ type: 'reading', status: s })) },
        { caso: 'botón: vinculado', esperado: null, obtenido: link.nextManualStatus({ type: 'series', status: 'Mirando', linked_series_id: 'x' }) },
    ]);
    tabla('validaciones', [
        { caso: 'Pendiente: sin título', esperado: { error: 'titulo' }, obtenido: link.validateBacklogForm({ type: 'series', title: '  ' }) },
        { caso: 'Pendiente: lectura sin subtipo', esperado: { error: 'subtipo' }, obtenido: link.validateBacklogForm({ type: 'reading', title: 'x', subtype: null }) },
        { caso: 'Pendiente: lectura con subtipo', esperado: { ok: true }, obtenido: link.validateBacklogForm({ type: 'reading', title: 'x', subtype: 'manga' }) },
        { caso: 'nuevo título: video sin tipo', esperado: { error: 'tipo' }, obtenido: link.validateNewTitle({ categoryType: 'video', title: 'x', type: null }) },
        { caso: 'nuevo título: año de 3 cifras', esperado: { error: 'anio' }, obtenido: link.validateNewTitle({ categoryType: 'video', title: 'x', type: 'anime', startYear: '199' }) },
        { caso: 'nuevo título: video', esperado: { newTitle: { type: 'anime', subtype: null, start_year: 1999 } }, obtenido: link.validateNewTitle({ categoryType: 'video', title: 'x', type: 'anime', startYear: '1999' }) },
        { caso: 'nuevo título: lectura sin subtipo', esperado: { error: 'subtipo' }, obtenido: link.validateNewTitle({ categoryType: 'reading', title: 'x', subtype: 'novela' }) },
        { caso: 'nuevo título: lectura', esperado: { newTitle: { type: 'reading', subtype: 'comic', start_year: null } }, obtenido: link.validateNewTitle({ categoryType: 'reading', title: 'x', subtype: 'comic', startYear: '' }) },
        { caso: 'checkSubtype: película con subtipo / lectura NULL', esperado: [false, true], obtenido: [link.checkSubtype('movie', 'book'), link.checkSubtype('reading', null)] },
    ]);
    check('el motor del vínculo es puro (sin React, SQLite, hojas, db ni reloj)', !/from 'react|expo-sqlite|useSheet|services\/db|new Date\(|Date\.now/.test(readFileSync('src/entertainment/link.ts', 'utf8')));
}

// =============================================================================================
seccion('2. Alta vinculada: "De Pendiente" y "Nuevo título" (handleSave real)');
{
    const E = await entorno();
    const cat = await E.crearCategoria({ type: 'video' });
    const t1 = await E.nuevoTitulo('series', 'Título A', { start_year: 2015 });
    await E.limpiarOutbox();
    const alertas1 = await E.guardar(cat, { name: 'Título A', temporadas: [2, 3], linkEstado: { mode: 'pendiente', backlogId: t1.id, title: t1.title } });
    const s1 = await E.serie(cat, 'Título A');
    const tt1 = await E.titulo('series', 'Título A');
    const ob1 = await E.resumenOutbox();
    // Nombre editado en el formulario (condición 6): el título se actualiza en la misma transacción.
    const t2 = await E.nuevoTitulo('anime', 'Original');
    await E.limpiarOutbox();
    await E.guardar(cat, { name: 'Editado en el formulario', linkEstado: { mode: 'pendiente', backlogId: t2.id, title: t2.title } });
    const s2 = await E.serie(cat, 'Editado en el formulario');
    const tt2 = (await E.titulos('anime')).find((b) => b.id === t2.id);
    const ob2 = await E.resumenOutbox();
    // Nuevo título (video).
    await E.limpiarOutbox();
    const alertas3 = await E.guardar(cat, { name: 'Nueva serie', linkEstado: { mode: 'nuevo' }, newType: 'anime', newStartYear: '2024' });
    const s3 = await E.serie(cat, 'Nueva serie');
    const tt3 = await E.titulo('anime', 'Nueva serie');
    const ob3 = await E.resumenOutbox();
    tabla('alta vinculada', [
        {
            caso: 'De Pendiente: serie vinculada, título en Mirando, una entrada de outbox por fila',
            esperado: { alertas: [], vinculo: true, estadoTitulo: 'Mirando', etiqueta: 'En Cat video · Nueva', outbox: { porTabla: { backlog: 1, seasons: 2, series: 1 }, unaPorFila: true } },
            obtenido: { alertas: alertas1.map((a) => a.titulo), vinculo: s1.backlog_id === t1.id, estadoTitulo: tt1.status, etiqueta: link.linkLabel({ seriesStatus: tt1.linked_series_status, categoryName: tt1.linked_category_name }), outbox: ob1 },
        },
        {
            caso: 'De Pendiente con el nombre editado: el título cambia igual (D4)',
            esperado: { vinculo: true, tituloPendiente: 'Editado en el formulario', estado: 'Mirando', outbox: { porTabla: { backlog: 1, seasons: 1, series: 1 }, unaPorFila: true } },
            obtenido: { vinculo: s2.backlog_id === t2.id, tituloPendiente: tt2.title, estado: tt2.status, outbox: ob2 },
        },
        {
            caso: 'Nuevo título: nace en Pendiente vinculado, en Mirando, con valores por defecto',
            esperado: { alertas: [], vinculo: true, titulo: { type: 'anime', status: 'Mirando', start_year: 2024, format: '24 min', franchise: 'Otros', subtype: null }, outbox: { porTabla: { backlog: 1, seasons: 1, series: 1 }, unaPorFila: true } },
            obtenido: { alertas: alertas3.map((a) => a.titulo), vinculo: !!tt3 && s3.backlog_id === tt3.id, titulo: tt3 && { type: tt3.type, status: tt3.status, start_year: tt3.start_year, format: tt3.format, franchise: tt3.franchise, subtype: tt3.subtype }, outbox: ob3 },
        },
    ]);
    // Validaciones del "Nuevo título" en la pantalla (textos) y en lectura con subtipo.
    const L = await E.crearCategoria({ type: 'reading' });
    const errTipo = await E.guardar(cat, { name: 'Sin tipo', linkEstado: { mode: 'nuevo' }, newType: null });
    const errAnio = await E.guardar(cat, { name: 'Año malo', linkEstado: { mode: 'nuevo' }, newType: 'series', newStartYear: '20' });
    const errSub = await E.guardar(L, { name: 'Sin subtipo', linkEstado: { mode: 'nuevo' }, newType: null });
    await E.guardar(L, { name: 'Manga nuevo', linkEstado: { mode: 'nuevo' }, newType: 'manga' });
    const manga = await E.titulo('reading', 'Manga nuevo');
    tabla('Nuevo título: validaciones y lectura', [
        { caso: 'video sin tipo', esperado: ['Elige si es serie o anime.'], obtenido: errTipo.map((a) => a.mensaje) },
        { caso: 'año de 2 cifras', esperado: ['El año de inicio debe tener 4 cifras.'], obtenido: errAnio.map((a) => a.mensaje) },
        { caso: 'lectura sin subtipo', esperado: ['Elige el subtipo: libro, cómic o manga.'], obtenido: errSub.map((a) => a.mensaje) },
        { caso: 'no se guardó nada al fallar', esperado: [undefined, undefined, undefined], obtenido: [await E.serie(cat, 'Sin tipo'), await E.serie(cat, 'Año malo'), await E.serie(L, 'Sin subtipo')] },
        { caso: 'lectura: título con subtipo manga, vinculado, en Mirando', esperado: { subtype: 'manga', status: 'Mirando', vinculado: true }, obtenido: manga && { subtype: manga.subtype, status: manga.status, vinculado: link.isLinked(manga) } },
    ]);
    // Una sola transacción: con un fallo antes de confirmar no queda nada (ni serie ni título ni outbox).
    const antes = { backlog: await E.contar('backlog'), series: await E.contar('series'), seasons: await E.contar('seasons'), outbox: await E.contar('outbox') };
    DEV_FLAGS.DEV_FAIL_TX = true;
    const fallo = await quiet(() => E.db.addSeriesWithSeasons({ category_id: cat.id, name: 'Rollback', description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 2 }], { newTitle: { type: 'series', subtype: null, start_year: null } }));
    DEV_FLAGS.DEV_FAIL_TX = false;
    const despues = { backlog: await E.contar('backlog'), series: await E.contar('series'), seasons: await E.contar('seasons'), outbox: await E.contar('outbox') };
    check('alta con "Nuevo título": una transacción (un fallo antes de confirmar no deja nada)', fallo.success === false && igual(antes, despues), JSON.stringify({ antes, despues }));
    // Títulos no disponibles: el repositorio rechaza sin escribir nada.
    const terminado = await E.nuevoTitulo('series', 'Ya visto');
    E.ok(await E.db.updateBacklogStatus(terminado.id, 'Terminado'), 'updateBacklogStatus');
    const lectura = await E.nuevoTitulo('reading', 'Un libro', { subtype: 'book' });
    const intento = async (backlogId) => {
        const r = await quiet(() => E.db.addSeriesWithSeasons({ category_id: cat.id, name: 'Intento', description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 1 }], { backlogId }));
        return r.success ? 'guardó' : r.error;
    };
    const msg = 'El título ya no está disponible en Pendiente';
    tabla('títulos no disponibles', [
        { caso: 'en Terminado / de lectura en una categoría de video / ya vinculado', esperado: [msg, msg, msg], obtenido: [await intento(terminado.id), await intento(lectura.id), await intento(t1.id)] },
        { caso: 'no se creó ninguna serie', esperado: undefined, obtenido: await E.serie(cat, 'Intento') },
    ]);
}

// =============================================================================================
seccion('3. Reflejo de estado en cada camino que escribe series.status');
{
    const E = await entorno();
    const cat = await E.crearCategoria({ type: 'video' });
    await E.guardar(cat, { name: 'R', temporadas: [2], linkEstado: { mode: 'nuevo' }, newType: 'series' });
    const id = (await E.serie(cat, 'R')).id;
    const estado = async () => { const t = await E.titulo('series', 'R'); return { titulo: t.status, serie: t.linked_series_status }; };
    const pasos = [];
    const paso = async (camino, fn) => { await E.limpiarOutbox(); E.usar(); E.ok(await quiet(fn), camino); const ob = await E.resumenOutbox(); pasos.push({ camino, ...(await estado()), backlogEnOutbox: ob.porTabla.backlog || 0 }); };
    pasos.push({ camino: 'alta (Nuevo título)', ...(await estado()), backlogEnOutbox: 1 });
    await paso('grilla hasta el final → Terminado (markEpisodesWatched)', () => E.db.markEpisodesWatched(id, 'video', [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], { season: 1, episode: 2, status: 'Terminado' }, Date.now()));
    await paso('grilla hacia atrás, R8 (unmarkEpisodes)', () => E.db.unmarkEpisodes(id, 'video', [{ season: 1, episode: 2 }], { season: 1, episode: 2, status: 'Mirando' }));
    await paso('¡Completada! → En espera (Registro: updateSeriesProgress)', () => E.db.updateSeriesProgress(id, 1, 2, 'En espera'));
    await paso('¡Completada! → Terminado (Registro: updateSeriesProgress)', () => E.db.updateSeriesProgress(id, 1, 2, 'Terminado'));
    await paso('desmarcar en el Registro, R8 (updateSeriesProgress)', () => E.db.updateSeriesProgress(id, 1, 2, 'Mirando', null, 0));
    await paso('reiniciar (restartSeries)', () => E.db.restartSeries(id, 2));
    await paso('formulario: estado Terminado (updateSeriesWithSeasons)', () => E.db.updateSeriesWithSeasons(id, { name: 'R', description: '', total_seasons: 1, status: 'Terminado' }, [{ season_number: 1, episode_count: 2 }]));
    await paso('formulario: estado Mirando', () => E.db.updateSeriesWithSeasons(id, { name: 'R', description: '', total_seasons: 1, status: 'Mirando' }, [{ season_number: 1, episode_count: 2 }]));
    await paso('flechas (updateSeriesSortOrder): sin estado, sin escribir el título', () => E.db.updateSeriesSortOrder(id, 7));
    // Pausar y reanudar con la función real de la pantalla.
    const pausarPantalla = async () => {
        const originalList = await E.lista(cat);
        const s = originalList.find((x) => x.id === id);
        const fn = instanciar(extraer(PANT.detalle, 'handleTogglePauseSeries'), { originalList, db: E.db, fetchSeries: () => {} });
        await quiet(() => fn(s));
        return { success: true };
    };
    await paso('pausar (handleTogglePauseSeries de la pantalla)', pausarPantalla);
    const etiquetaPausa = await E.titulo('series', 'R');
    await paso('reanudar (handleTogglePauseSeries de la pantalla)', pausarPantalla);
    tabla('estado del título por camino', [{
        caso: 'cada camino del inventario',
        esperado: [
            { camino: 'alta (Nuevo título)', titulo: 'Mirando', serie: 'Nueva', backlogEnOutbox: 1 },
            { camino: 'grilla hasta el final → Terminado (markEpisodesWatched)', titulo: 'Terminado', serie: 'Terminado', backlogEnOutbox: 1 },
            { camino: 'grilla hacia atrás, R8 (unmarkEpisodes)', titulo: 'Mirando', serie: 'Mirando', backlogEnOutbox: 1 },
            { camino: '¡Completada! → En espera (Registro: updateSeriesProgress)', titulo: 'Mirando', serie: 'En espera', backlogEnOutbox: 0 },
            { camino: '¡Completada! → Terminado (Registro: updateSeriesProgress)', titulo: 'Terminado', serie: 'Terminado', backlogEnOutbox: 1 },
            { camino: 'desmarcar en el Registro, R8 (updateSeriesProgress)', titulo: 'Mirando', serie: 'Mirando', backlogEnOutbox: 1 },
            { camino: 'reiniciar (restartSeries)', titulo: 'Mirando', serie: 'Mirando', backlogEnOutbox: 0 },
            { camino: 'formulario: estado Terminado (updateSeriesWithSeasons)', titulo: 'Terminado', serie: 'Terminado', backlogEnOutbox: 1 },
            { camino: 'formulario: estado Mirando', titulo: 'Mirando', serie: 'Mirando', backlogEnOutbox: 1 },
            { camino: 'flechas (updateSeriesSortOrder): sin estado, sin escribir el título', titulo: 'Mirando', serie: 'Mirando', backlogEnOutbox: 0 },
            { camino: 'pausar (handleTogglePauseSeries de la pantalla)', titulo: 'Mirando', serie: 'Pausado', backlogEnOutbox: 0 },
            { camino: 'reanudar (handleTogglePauseSeries de la pantalla)', titulo: 'Mirando', serie: 'Mirando', backlogEnOutbox: 0 },
        ],
        obtenido: pasos,
    }]);
    check('etiqueta del título con la serie en pausa', link.linkLabel({ seriesStatus: etiquetaPausa.linked_series_status, categoryName: etiquetaPausa.linked_category_name }) === 'En Cat video · Pausado');
}

// =============================================================================================
seccion('4. Comprobación estática: punto único de escritura (series y status/título/borrado de backlog)');
{
    const archivos = [];
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(js|ts|tsx)$/.test(e.name)) archivos.push(p); } };
    walk('src');
    archivos.push('App.js');
    const REGLAS = {
        series: { insertRow: ['insertSeriesRow'], updateRow: ['updateSeriesRow'], reviveRow: [], softDelete: ['deleteSeriesRows'], softDeleteWhere: [] },
        // Fase 7.5b1: rewriteTitles (src/data/repositories/tags.ts) reescribe SOLO backlog.tags al
        // renombrar o borrar una etiqueta (objeto literal; esta misma regla comprueba que no toca
        // status ni title).
        backlog: { insertRow: ['addBacklogItem', 'insertLinkedBacklogTitle'], updateRow: ['writeBacklogStatus', 'updateBacklogStatus', 'setLinkedBacklogTitle', 'updateBacklogItem', 'rewriteTitles'], reviveRow: [], softDelete: ['softDeleteLinkedTitle'], softDeleteWhere: [] },
    };
    const CON_STATUS = ['writeBacklogStatus', 'updateBacklogStatus'];
    // Corrección de la 7.5: quién puede llamar a las escrituras internas. El estado de un título
    // vinculado solo lo escribe writeBacklogStatus, y solo desde el reflejo, la liberación (D5) y la
    // reconciliación; el borrado de filas de series solo desde las tres cascadas.
    const LLAMADAS = {
        writeBacklogStatus: ['reflectLinkedBacklogStatus', 'releaseLinkedTitles', 'reconcileLinkedTitles'],
        deleteSeriesRows: ['deleteSeriesCascade', 'deleteTitleCascade', 'deleteCategorySeries'],
    };
    const CON_TITLE = ['setLinkedBacklogTitle', 'updateBacklogItem'];
    // Devuelve las violaciones de un código fuente.
    const revisar = (codigo, archivo) => {
        const malas = [];
        const ast = parse(codigo, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
        traverse(ast, {
            CallExpression(p) {
                const callee = p.node.callee;
                const nombre = callee.type === 'Identifier' ? callee.name : null;
                const arg = p.node.arguments[0];
                const fn = p.getFunctionParent();
                let dueño = null;
                if (fn) {
                    if (fn.node.id) dueño = fn.node.id.name;
                    else if (fn.parentPath && fn.parentPath.node.type === 'VariableDeclarator') dueño = fn.parentPath.node.id.name;
                }
                if (nombre && LLAMADAS[nombre] && !LLAMADAS[nombre].includes(dueño)) { malas.push(`${archivo}:${p.node.loc.start.line} ${nombre}() en ${dueño}`); return; }
                if (!nombre || !arg || arg.type !== 'StringLiteral' || !REGLAS[arg.value] || !REGLAS[arg.value][nombre]) return;
                if (!REGLAS[arg.value][nombre].includes(dueño)) { malas.push(`${archivo}:${p.node.loc.start.line} ${nombre}('${arg.value}') en ${dueño}`); return; }
                if (arg.value === 'backlog' && nombre === 'updateRow') {
                    const vals = p.node.arguments[2];
                    const claves = vals && vals.type === 'ObjectExpression' ? vals.properties.map((q) => q.key && (q.key.name || q.key.value)) : ['?'];
                    if (claves.includes('status') && !CON_STATUS.includes(dueño)) malas.push(`${archivo}:${p.node.loc.start.line} status de backlog en ${dueño}`);
                    if (claves.includes('title') && !CON_TITLE.includes(dueño)) malas.push(`${archivo}:${p.node.loc.start.line} title de backlog en ${dueño}`);
                    if (claves.includes('?')) malas.push(`${archivo}:${p.node.loc.start.line} updateRow('backlog') con valores no literales en ${dueño}`);
                }
            },
            'StringLiteral|TemplateLiteral'(p) {
                const texto = p.node.type === 'StringLiteral' ? p.node.value : p.node.quasis.map((q) => q.value.raw).join(' ');
                if (/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(series|backlog)\b/i.test(texto)) malas.push(`${archivo}:${p.node.loc.start.line} SQL de escritura sobre series/backlog`);
            },
        });
        return malas;
    };
    const fuera = archivos.filter((f) => !/\/data\/db\/migration\d*\.ts$/.test(f));
    const violaciones = fuera.flatMap((f) => revisar(readFileSync(f, 'utf8'), f));
    check(`ninguna escritura de series (ni del status/título/borrado de backlog) fuera del punto único (${fuera.length} archivos)`, violaciones.length === 0, violaciones.join(' | '));
    // Control negativo: el revisor tiene que ver cada tipo de violación.
    const malo = `
        async function cualquiera(id) { await updateRow('series', id, { status: 'Terminado' }); }
        async function otra(id) { await softDeleteWhere('series', 'id = ?', [id]); await softDelete('backlog', id); }
        async function updateBacklogStatus(id) { await updateRow('backlog', id, { title: 'x' }); }
        const z = async (id) => db.runAsync('UPDATE backlog SET status = ? WHERE id = ?', ['x', id]);
        async function deleteEntertainmentCategory(id) { await writeBacklogStatus(id, 'Pendiente'); await deleteSeriesRows(id); }
        async function reflectLinkedBacklogStatus(id) { await updateRow('backlog', id, { status: 'Mirando' }); }`;
    const negativas = revisar(malo, 'control');
    check('control negativo: el revisor detecta las 8 violaciones sembradas', negativas.length === 8, negativas.join(' | '));
}

// =============================================================================================
seccion('5. Etiqueta y selector "De Pendiente" (filtro y los tres órdenes)');
{
    const E = await entorno();
    const cat = await E.crearCategoria({ type: 'video' });
    const p1 = await E.nuevoTitulo('series', 'Serie 2010', { start_year: 2010 });
    const p2 = await E.nuevoTitulo('anime', 'anime sin año');
    const p3 = await E.nuevoTitulo('reading', 'Libro pendiente', { subtype: 'book' });
    await E.nuevoTitulo('movie', 'Película');
    const p5 = await E.nuevoTitulo('series', 'Serie vista');
    E.ok(await E.db.updateBacklogStatus(p5.id, 'Terminado'), 'updateBacklogStatus');
    const p6 = await E.nuevoTitulo('series', 'Serie ligada', { start_year: 1999 });
    await E.guardar(cat, { name: 'Serie ligada', linkEstado: { mode: 'pendiente', backlogId: p6.id, title: p6.title } });
    const p7 = await E.nuevoTitulo('anime', 'Anime borrado');
    E.ok(await E.db.deleteBacklogItem(p7.id), 'deleteBacklogItem');
    const p8 = await E.nuevoTitulo('series', 'Ábaco', { start_year: 2010 });
    E.usar();
    const video = (E.ok(await E.db.getBacklogCandidates(E.uid, 'video'), 'getBacklogCandidates')).data;
    const lectura = (E.ok(await E.db.getBacklogCandidates(E.uid, 'reading'), 'getBacklogCandidates')).data;
    const nombres = (l) => l.map((x) => x.title);
    tabla('selector', [
        { caso: 'video: vivos, en Pendiente, serie/anime, sin serie vinculada', esperado: ['Serie 2010', 'anime sin año', 'Ábaco'].sort(), obtenido: nombres(video).sort() },
        { caso: 'lectura: solo lectura', esperado: ['Libro pendiente'], obtenido: nombres(lectura) },
        { caso: 'orden Año (sin año al final)', esperado: ['Ábaco', 'Serie 2010', 'anime sin año'], obtenido: nombres(link.sortCandidates(video, 'year')) },
        { caso: 'orden Registro (el más nuevo primero)', esperado: ['Ábaco', 'anime sin año', 'Serie 2010'], obtenido: nombres(link.sortCandidates(video, 'created')) },
        { caso: 'orden Nombre', esperado: ['Ábaco', 'anime sin año', 'Serie 2010'], obtenido: nombres(link.sortCandidates(video, 'title')) },
    ]);
    const ligado = await E.titulo('series', 'Serie ligada');
    const suelto = await E.titulo('series', 'Serie 2010');
    tabla('etiqueta en Pendiente', [
        { caso: 'vinculado', esperado: { vinculado: true, etiqueta: 'En Cat video · Nueva', estado: 'Mirando' }, obtenido: { vinculado: link.isLinked(ligado), etiqueta: link.linkLabel({ seriesStatus: ligado.linked_series_status, categoryName: ligado.linked_category_name }), estado: ligado.status } },
        { caso: 'sin vínculo', esperado: { vinculado: false, serie: null }, obtenido: { vinculado: link.isLinked(suelto), serie: suelto.linked_series_id } },
    ]);
    check('los ids de p1 y p3 siguen vivos (el selector no escribe)', !!(await E.titulo('series', 'Serie 2010')) && !!(await E.titulo('reading', 'Libro pendiente')) && p1.id && p3.id && p2.id && p8.id);
}

// =============================================================================================
seccion('6. Borrado en los dos sentidos y de la categoría (D5), sin recursión; textos de las hojas');
{
    const E = await entorno();
    const cat = await E.crearCategoria({ type: 'video' });
    // Desde el detalle: la serie vinculada (con temporadas e historial) y su título.
    await E.guardar(cat, { name: 'Borrar desde detalle', temporadas: [2, 2], linkEstado: { mode: 'nuevo' }, newType: 'series' });
    let s = await E.serie(cat, 'Borrar desde detalle');
    E.ok(await E.db.markEpisodesWatched(s.id, 'video', [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], { season: 2, episode: 1, status: 'Mirando' }, Date.now()), 'markEpisodesWatched');
    const tA = await E.titulo('series', 'Borrar desde detalle');
    await E.limpiarOutbox();
    E.ok(await E.db.deleteSeries(s.id), 'deleteSeries');
    const obA = await E.resumenOutbox();
    const vivosA = { titulo: await E.contar('backlog', 'id = ? AND deleted_at IS NULL', [tA.id]), serie: await E.contar('series', 'id = ? AND deleted_at IS NULL', [s.id]), temporadas: await E.contar('seasons', 'series_id = ? AND deleted_at IS NULL', [s.id]), historial: await E.contar('watch_history', 'series_id = ? AND deleted_at IS NULL', [s.id]) };
    // Desde Pendiente: el título y su serie (sin recursión: cada fila una sola entrada).
    await E.guardar(cat, { name: 'Borrar desde Pendiente', temporadas: [3], linkEstado: { mode: 'nuevo' }, newType: 'anime' });
    s = await E.serie(cat, 'Borrar desde Pendiente');
    E.ok(await E.db.markEpisodesWatched(s.id, 'video', [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 }], { season: 1, episode: 3, status: 'Terminado' }, Date.now()), 'markEpisodesWatched');
    const tB = await E.titulo('anime', 'Borrar desde Pendiente');
    await E.limpiarOutbox();
    const rB = await E.db.deleteBacklogItem(tB.id);
    const obB = await E.resumenOutbox();
    const vivosB = { titulo: await E.contar('backlog', 'id = ? AND deleted_at IS NULL', [tB.id]), serie: await E.contar('series', 'id = ? AND deleted_at IS NULL', [s.id]), temporadas: await E.contar('seasons', 'series_id = ? AND deleted_at IS NULL', [s.id]), historial: await E.contar('watch_history', 'series_id = ? AND deleted_at IS NULL', [s.id]) };
    // Sin vínculo: borrar el título de Pendiente solo borra el título.
    const suelto = await E.nuevoTitulo('series', 'Suelto');
    await E.limpiarOutbox();
    E.ok(await E.db.deleteBacklogItem(suelto.id), 'deleteBacklogItem');
    const obC = await E.resumenOutbox();
    tabla('borrado', [
        { caso: 'desde el detalle', esperado: { outbox: { porTabla: { backlog: 1, seasons: 2, series: 1, watch_history: 2 }, unaPorFila: true }, vivos: { titulo: 0, serie: 0, temporadas: 0, historial: 0 } }, obtenido: { outbox: obA, vivos: vivosA } },
        { caso: 'desde Pendiente (deleteBacklogItem → deleteTitleCascade, sin recursión)', esperado: { ok: true, outbox: { porTabla: { backlog: 1, seasons: 1, series: 1, watch_history: 3 }, unaPorFila: true }, vivos: { titulo: 0, serie: 0, temporadas: 0, historial: 0 } }, obtenido: { ok: rB.success, outbox: obB, vivos: vivosB } },
        { caso: 'título sin vínculo', esperado: { porTabla: { backlog: 1 }, unaPorFila: true }, obtenido: obC },
    ]);
    // Categoría (D5 corregida): borra sus series vinculadas con su progreso; sus títulos vuelven a
    // Pendiente sin vínculo (también uno que estaba en Terminado) y vuelven al selector.
    const cat2 = await E.crearCategoria({ type: 'video', name: 'Para borrar' });
    await E.guardar(cat2, { name: 'Ligada 1', temporadas: [2], linkEstado: { mode: 'nuevo' }, newType: 'series' });
    await E.guardar(cat2, { name: 'Ligada 2', temporadas: [2], linkEstado: { mode: 'nuevo' }, newType: 'anime' });
    await E.guardar(cat2, { name: 'Sin vínculo', temporadas: [2], linkEstado: null });
    const l2 = await E.serie(cat2, 'Ligada 2');
    E.ok(await E.db.markEpisodesWatched(l2.id, 'video', [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], { season: 1, episode: 2, status: 'Terminado' }, Date.now()), 'markEpisodesWatched');
    const l1 = await E.serie(cat2, 'Ligada 1');
    E.ok(await E.db.markEpisodesWatched(l1.id, 'video', [{ season: 1, episode: 1 }], { season: 1, episode: 2, status: 'Mirando' }, Date.now()), 'markEpisodesWatched');
    const ajeno = await E.nuevoTitulo('series', 'Ajeno');
    // Textos de la hoja de la categoría (handleDelete real de SeriesAnimeScreen): 0, 1 y 2 vinculados.
    const hojaCategoria = async (c) => {
        const A = crearAlert(); // sin elegir: cancela
        const fn = instanciar(extraer(PANT.categorias, 'handleDelete'), { db: E.db, ...hojasDesdeAlert(A.Alert), fetchCategories: () => {} });
        E.usar();
        await quiet(() => fn(c.id, c.type));
        await vaciar();
        return A.registro[0] && A.registro[0].mensaje;
    };
    const cat1 = await E.crearCategoria({ type: 'video', name: 'Una' });
    await E.guardar(cat1, { name: 'Única', linkEstado: { mode: 'nuevo' }, newType: 'series' });
    const cat0 = await E.crearCategoria({ type: 'video', name: 'Cero' });
    const lec1 = await E.crearCategoria({ type: 'reading', name: 'Lectura una' });
    await E.guardar(lec1, { name: 'Obra única', linkEstado: { mode: 'nuevo' }, newType: 'book' });
    const lec2 = await E.crearCategoria({ type: 'reading', name: 'Lectura dos' });
    await E.guardar(lec2, { name: 'Obra A', linkEstado: { mode: 'nuevo' }, newType: 'book' });
    await E.guardar(lec2, { name: 'Obra B', linkEstado: { mode: 'nuevo' }, newType: 'manga' });
    const base = '¿Estás seguro de que quieres eliminar esta categoría?';
    tabla('texto de la hoja al borrar una categoría (D5 corregida)', [
        { caso: '0 vinculados (texto de siempre)', esperado: base, obtenido: await hojaCategoria(cat0) },
        { caso: 'video, 1 vinculada', esperado: `${base} Se borrará su serie vinculada con todo su progreso y su título volverá a Pendiente, sin vínculo.`, obtenido: await hojaCategoria(cat1) },
        { caso: 'video, 2 vinculadas', esperado: `${base} Se borrarán sus 2 series vinculadas con todo su progreso y sus títulos volverán a Pendiente, sin vínculo.`, obtenido: await hojaCategoria(cat2) },
        { caso: 'lectura, 1 vinculada', esperado: `${base} Se borrará su obra vinculada con todo su progreso y su título volverá a Pendiente, sin vínculo.`, obtenido: await hojaCategoria(lec1) },
        { caso: 'lectura, 2 vinculadas', esperado: `${base} Se borrarán sus 2 obras vinculadas con todo su progreso y sus títulos volverán a Pendiente, sin vínculo.`, obtenido: await hojaCategoria(lec2) },
    ]);
    const vinc = (await E.lista(cat2)).filter((x) => x.backlog_id);
    const ids = vinc.map((x) => x.backlog_id);
    const seriesIds = (await E.lista(cat2)).map((x) => x.id);
    const enSerie = (t) => `series_id IN (${seriesIds.map(() => '?').join(',')})` + (t ? ' AND deleted_at IS NULL' : '');
    const progresoAntes = await E.contar('watch_history', enSerie(true), seriesIds);
    await E.limpiarOutbox();
    E.ok(await E.db.deleteEntertainmentCategory(cat2.id), 'deleteEntertainmentCategory');
    const obCat = await E.resumenOutbox();
    const titulosTras = (await E.titulos('series')).concat(await E.titulos('anime')).filter((b) => ids.includes(b.id));
    E.usar();
    const candidatosTras = (E.ok(await E.db.getBacklogCandidates(E.uid, 'video'), 'getBacklogCandidates')).data.map((b) => b.id);
    tabla('borrar la categoría (D5 corregida)', [{
        caso: 'series y progreso borrados; los 2 títulos vuelven a Pendiente sin vínculo y al selector; el ajeno intacto',
        esperado: {
            progresoAntes: 3, seriesVivas: 0, temporadasVivas: 0, historialVivo: 0,
            titulos: [{ vivo: true, estado: 'Pendiente', vinculado: false, candidato: true }, { vivo: true, estado: 'Pendiente', vinculado: false, candidato: true }],
            ajenoVivo: 1,
            outbox: { porTabla: { backlog: 2, entertainment_categories: 1, entertainment_quotas_history: 1, seasons: 3, series: 3, watch_history: 3 }, unaPorFila: true },
        },
        obtenido: {
            progresoAntes, seriesVivas: await E.contar('series', 'category_id = ? AND deleted_at IS NULL', [cat2.id]),
            temporadasVivas: await E.contar('seasons', enSerie(true), seriesIds), historialVivo: await E.contar('watch_history', enSerie(true), seriesIds),
            titulos: titulosTras.map((b) => ({ vivo: !b.deleted_at, estado: b.status, vinculado: link.isLinked(b), candidato: candidatosTras.includes(b.id) })),
            ajenoVivo: await E.contar('backlog', 'id = ? AND deleted_at IS NULL', [ajeno.id]),
            outbox: obCat,
        },
    }]);
    // Textos de borrado en el detalle y en Pendiente (vinculado / sin vínculo; serie / obra).
    const L = await E.crearCategoria({ type: 'reading' });
    await E.guardar(L, { name: 'Obra ligada', linkEstado: { mode: 'nuevo' }, newType: 'book' });
    await E.guardar(L, { name: 'Obra suelta', linkEstado: null });
    await E.guardar(cat, { name: 'Serie ligada', linkEstado: { mode: 'nuevo' }, newType: 'series' });
    await E.guardar(cat, { name: 'Serie suelta', linkEstado: null });
    const hojaDetalle = async (c, nombre) => {
        const A = crearAlert();
        const originalList = await E.lista(c);
        const fn = instanciar(extraer(c.type === 'reading' ? PANT.detalleLectura : PANT.detalle, 'handleDelete'), { originalList, db: E.db, ...hojasDesdeAlert(A.Alert), fetchSeries: () => {} });
        await quiet(() => fn(originalList.find((x) => x.name === nombre).id));
        await vaciar();
        return A.registro[0] && `${A.registro[0].titulo} | ${A.registro[0].mensaje}`;
    };
    const hojaPendiente = async (item) => {
        const A = crearAlert();
        const fn = instanciar(extraer(PANT.pendiente, 'handleDeleteItem'), { db: E.db, ...hojasDesdeAlert(A.Alert), loadItems: () => {} });
        await quiet(() => fn(item));
        await vaciar();
        return A.registro[0] && A.registro[0].mensaje;
    };
    tabla('textos de borrado', [
        { caso: 'detalle: serie vinculada', esperado: 'Eliminar Serie | Se borrarán la serie y su título en Pendiente. Se pierde el progreso.', obtenido: await hojaDetalle(cat, 'Serie ligada') },
        { caso: 'detalle: serie sin vínculo (texto de siempre)', esperado: 'Eliminar Serie | ¿Estás seguro?', obtenido: await hojaDetalle(cat, 'Serie suelta') },
        { caso: 'detalle: obra vinculada', esperado: 'Eliminar Obra | Se borrarán la obra y su título en Pendiente. Se pierde el progreso.', obtenido: await hojaDetalle(L, 'Obra ligada') },
        { caso: 'detalle: obra sin vínculo', esperado: 'Eliminar Obra | ¿Estás seguro?', obtenido: await hojaDetalle(L, 'Obra suelta') },
        { caso: 'Pendiente: serie vinculada', esperado: 'Se borrarán el título y su serie en «Cat video», con todo su progreso.', obtenido: await hojaPendiente(await E.titulo('series', 'Serie ligada')) },
        { caso: 'Pendiente: obra vinculada', esperado: 'Se borrarán el título y su obra en «Cat reading», con todo su progreso.', obtenido: await hojaPendiente(await E.titulo('reading', 'Obra ligada')) },
        { caso: 'Pendiente: sin vínculo (texto de siempre)', esperado: '¿Estás seguro de que quieres eliminar este elemento?', obtenido: await hojaPendiente(await E.titulo('series', 'Ajeno')) },
    ]);
}

// =============================================================================================
seccion('6b. Formulario: la elección de "Agregar" no se arrastra al editar, al cerrar ni tras guardar');
{
    for (const tipo of ['video', 'reading']) {
        const E = await entorno();
        const cat = await E.crearCategoria({ type: tipo });
        const archivo = tipo === 'reading' ? PANT.detalleLectura : PANT.detalle;
        // Otra serie sin vínculo y otra vinculada (título vivo), para editarlas.
        await E.guardar(cat, { name: 'Otra suelta', linkEstado: null });
        await E.guardar(cat, { name: 'Otra ligada', linkEstado: { mode: 'nuevo' }, newType: tipo === 'reading' ? 'book' : 'series' });
        const candidato = await E.nuevoTitulo(tipo === 'reading' ? 'reading' : 'series', 'Candidato', tipo === 'reading' ? { subtype: 'comic' } : {});
        // Estado del formulario: los setters escriben en S; cada paso reconstruye las funciones con S.
        const S = { link: null, newType: null, newStartYear: '', isEditing: false, editingSeriesId: null, modalVisible: false, pickerVisible: false, candidates: [] };
        const setters = {
            setLink: (v) => { S.link = v; }, setNewType: (v) => { S.newType = v; }, setNewStartYear: (v) => { S.newStartYear = v; },
            setIsEditing: (v) => { S.isEditing = v; }, setEditingSeriesId: (v) => { S.editingSeriesId = v; }, setModalVisible: (v) => { S.modalVisible = v; },
            setPickerVisible: (v) => { S.pickerVisible = v; }, setCandidates: (v) => { S.candidates = v; },
            setName: () => {}, setDescription: () => {}, setStatus: () => {}, setSeasons: () => {}, setCurrentSeason: () => {}, setCurrentEpisode: () => {},
        };
        const fn = async (nombre, eleccion = null) => {
            const A = crearAlert(eleccion);
            const originalList = await E.lista(cat);
            E.usar();
            return construir(archivo, nombre, {
                ...setters, link: S.link, newType: S.newType, newStartYear: S.newStartYear, isEditing: S.isEditing, editingSeriesId: S.editingSeriesId,
                originalList, category: cat, currentCategory: cat, db: E.db, user: E.user, ...hojasDesdeAlert(A.Alert),
                fetchSeries: () => {}, name: 'Nueva desde el formulario', description: '', status: 'Nueva',
                seasons: [{ number: 1, episodes: '2' }], currentSeason: 1, currentEpisode: 1,
            });
        };
        const vista = async () => (await fn('formLinkView'))();
        const serieDe = async (nombre) => (await E.lista(cat)).find((x) => x.name === nombre);
        const filas = [];
        // a) "Nuevo título" → cancelar (botón o Atrás: closeForm) → editar otra serie.
        await quiet(async () => (await fn('handleAddPress', 'Nuevo título'))());
        const vNuevo = await vista();
        (await fn('closeForm'))();
        const trasCerrar = { link: S.link, newType: S.newType, modal: S.modalVisible };
        (await fn('handleEdit'))(await serieDe('Otra suelta'));
        filas.push({ caso: `${tipo}: Nuevo título → cancelar → editar una sin vínculo`, esperado: { alAbrir: { chip: false, texto: null, tipos: true }, trasCerrar: { link: null, newType: null, modal: false }, alEditar: { chip: false, texto: null, tipos: false } }, obtenido: { alAbrir: vNuevo, trasCerrar, alEditar: await vista() } });
        // b) "De Pendiente" → elegir → cancelar → editar la vinculada: nunca "De Pendiente".
        S.isEditing = false; S.editingSeriesId = null;
        await quiet(async () => (await fn('handleAddPress', 'De Pendiente'))());
        const cand = S.candidates.find((c) => c.id === candidato.id);
        (await fn('handlePickCandidate'))(cand);
        const vPend = await vista();
        (await fn('closeForm'))();
        (await fn('handleEdit'))(await serieDe('Otra ligada'));
        filas.push({ caso: `${tipo}: De Pendiente → cancelar → editar una vinculada`, esperado: { alElegir: { chip: true, texto: 'De Pendiente: Candidato', tipos: false }, link: null, alEditar: { chip: true, texto: 'El nombre se cambia también en Pendiente', tipos: false } }, obtenido: { alElegir: vPend, link: S.link, alEditar: await vista() } });
        // c) "Nuevo título" y, sin cerrar, editar: handleEdit limpia.
        S.isEditing = false; S.editingSeriesId = null;
        await quiet(async () => (await fn('handleAddPress', 'Nuevo título'))());
        (await fn('handleEdit'))(await serieDe('Otra suelta'));
        filas.push({ caso: `${tipo}: Nuevo título → editar sin cerrar`, esperado: { link: null, alEditar: { chip: false, texto: null, tipos: false } }, obtenido: { link: S.link, alEditar: await vista() } });
        // d) Guardar limpia (resetForm real).
        S.isEditing = false; S.editingSeriesId = null;
        await quiet(async () => (await fn('handleAddPress', 'Nuevo título'))());
        S.newType = tipo === 'reading' ? 'manga' : 'anime';
        await quiet(async () => (await fn('handleSave'))());
        filas.push({ caso: `${tipo}: guardar un Nuevo título limpia la elección`, esperado: { guardada: true, link: null, newType: null, modal: false }, obtenido: { guardada: !!(await serieDe('Nueva desde el formulario')), link: S.link, newType: S.newType, modal: S.modalVisible } });
        tabla(`formulario sin arrastre (${tipo})`, filas);
        // Botón Cancelar y Atrás del formulario usan closeForm. Desde la 1.4.3 el formulario es una
        // HojaConTeclado: Atrás llega por su onClose (App.js → hojasAbiertas), ya no por onRequestClose.
        const src = readFileSync(archivo, 'utf8');
        const ini = src.indexOf('{/* Formulario de alta/edición');
        const formulario = src.slice(ini, src.indexOf('</HojaConTeclado>', ini));
        check(`${tipo}: el formulario cierra con closeForm (Atrás y el botón Cancelar)`, ini >= 0 && /<HojaConTeclado[^>]*onClose=\{closeForm\}/.test(formulario) && /onPress=\{closeForm\}/.test(formulario) && !/onPress=\{\(\) => setModalVisible\(false\)\}/.test(formulario));
    }
}

// =============================================================================================
seccion('7. Edición del título y del nombre (D4)');
{
    const E = await entorno();
    const cat = await E.crearCategoria({ type: 'video' });
    await E.guardar(cat, { name: 'Nombre 1', linkEstado: { mode: 'nuevo' }, newType: 'series' });
    const s = await E.serie(cat, 'Nombre 1');
    await E.limpiarOutbox();
    E.ok(await E.db.updateSeriesWithSeasons(s.id, { name: 'Nombre 2', description: '', total_seasons: 1 }, [{ season_number: 1, episode_count: 2 }]), 'updateSeriesWithSeasons');
    const ob1 = await E.resumenOutbox();
    const t = (await E.titulos('series')).find((b) => b.id === s.backlog_id);
    await E.limpiarOutbox();
    E.ok(await E.db.updateBacklogItem(t.id, { title: 'Nombre 3', format: '40 min', franchise: 'Otros' }), 'updateBacklogItem');
    const ob2 = await E.resumenOutbox();
    const s3 = (await E.lista(cat)).find((x) => x.id === s.id);
    await E.limpiarOutbox();
    E.ok(await E.db.updateBacklogItem(t.id, { title: 'Nombre 3', format: '24 min', start_year: 2001, franchise: 'Otros' }), 'updateBacklogItem');
    const ob3 = await E.resumenOutbox();
    tabla('D4', [
        { caso: 'nombre de la serie → título de Pendiente, misma transacción', esperado: { titulo: 'Nombre 2', outbox: { porTabla: { backlog: 1, series: 1 }, unaPorFila: true } }, obtenido: { titulo: t.title, outbox: ob1 } },
        { caso: 'título de Pendiente → nombre de la serie', esperado: { nombre: 'Nombre 3', outbox: { porTabla: { backlog: 1, series: 1 }, unaPorFila: true } }, obtenido: { nombre: s3.name, outbox: ob2 } },
        { caso: 'otros campos del título: no tocan la serie', esperado: { porTabla: { backlog: 1 }, unaPorFila: true }, obtenido: ob3 },
    ]);
}

// =============================================================================================
seccion('8. Subtipo (D7) y botón de estado (D6)');
{
    const E = await entorno();
    E.usar();
    const intento = async (data) => { const r = await quiet(() => E.db.addBacklogItem(E.uid, data)); return r.success ? 'guardó' : 'rechazó'; };
    await E.nuevoTitulo('reading', 'L1', { subtype: 'book' });
    await E.nuevoTitulo('reading', 'L2', { subtype: 'comic' });
    await E.nuevoTitulo('reading', 'L3', { subtype: 'manga' });
    await E.nuevoTitulo('reading', 'L4 vieja');
    const conteos = (E.ok(await E.db.getBacklogCounts(E.uid, 'reading', 'Todos', 'manga'), 'getBacklogCounts')).counts;
    tabla('subtipo', [
        { caso: 'valores válidos / inválido / en película', esperado: ['rechazó', 'rechazó'], obtenido: [await intento({ type: 'reading', title: 'X', subtype: 'novela' }), await intento({ type: 'movie', title: 'Y', subtype: 'book' })] },
        { caso: 'filtro Cómic', esperado: ['L2'], obtenido: (await E.titulos('reading', { subtype: 'comic' })).map((b) => b.title) },
        { caso: 'conteos con filtro Manga', esperado: { Pendiente: 1, Mirando: 0, Terminado: 0, Total: 1 }, obtenido: conteos },
        { caso: 'lectura vieja sin subtipo: se lista en Todos', esperado: null, obtenido: (await E.titulo('reading', 'L4 vieja')).subtype },
        { caso: 'editar el subtipo', esperado: 'comic', obtenido: (E.ok(await E.db.updateBacklogItem((await E.titulo('reading', 'L4 vieja')).id, { title: 'L4 vieja', subtype: 'comic', franchise: 'Otros' }), 'updateBacklogItem'), (await E.titulo('reading', 'L4 vieja')).subtype) },
    ]);
    // Botón de estado (handleUpdateStatus real de BacklogScreen).
    const boton = async (item, eleccion = null) => {
        const A = crearAlert(eleccion);
        const fn = instanciar(extraer(PANT.pendiente, 'handleUpdateStatus'), { db: E.db, loadItems: () => {}, ...hojasDesdeAlert(A.Alert) });
        await quiet(() => fn(item));
        return A.registro.map((a) => `${a.titulo} | ${a.mensaje}`);
    };
    await E.nuevoTitulo('movie', 'Peli');
    await E.nuevoTitulo('anime', 'Anime suelto');
    const ciclo = async (type, title, eleccion = null) => { const out = [(await E.titulo(type, title)).status]; for (let i = 0; i < 3; i++) { await boton(await E.titulo(type, title), eleccion); out.push((await E.titulo(type, title)).status); } return out; };
    const cat = await E.crearCategoria({ type: 'video' });
    await E.guardar(cat, { name: 'Anime ligado', linkEstado: { mode: 'nuevo' }, newType: 'anime' });
    const L = await E.crearCategoria({ type: 'reading' });
    await E.guardar(L, { name: 'Obra ligada', linkEstado: { mode: 'nuevo' }, newType: 'manga' });
    const ligado = await E.titulo('anime', 'Anime ligado');
    const obra = await E.titulo('reading', 'Obra ligada');
    const sueltoId = (await E.titulo('anime', 'Anime suelto')).id;
    tabla('botón de estado (D6)', [
        { caso: 'película: rota como siempre', esperado: ['Pendiente', 'Mirando', 'Terminado', 'Pendiente'], obtenido: await ciclo('movie', 'Peli') },
        { caso: 'anime sin vínculo: Pendiente ↔ Terminado (confirmando con "Terminado")', esperado: ['Pendiente', 'Terminado', 'Pendiente', 'Terminado'], obtenido: await ciclo('anime', 'Anime suelto', 'Terminado') },
        { caso: 'vinculado (serie): no cambia y avisa', esperado: { avisos: ['Vinculado | El estado lo cambia la serie en «Cat video».'], estado: 'Mirando' }, obtenido: { avisos: await boton(ligado), estado: (await E.titulo('anime', 'Anime ligado')).status } },
        { caso: 'vinculado (obra)', esperado: ['Vinculado | El estado lo cambia la obra en «Cat reading».'], obtenido: await boton(obra) },
        { caso: 'el repositorio también lo protege', esperado: [false, false], obtenido: [(await quiet(() => E.db.updateBacklogStatus(ligado.id, 'Terminado'))).success, (await quiet(() => E.db.updateBacklogStatus(sueltoId, 'Mirando'))).success] },
    ]);
    // D6 (corrección): la hoja "Marcar como Terminado" antes de pasar a Terminado un título sin vínculo.
    const l = await E.nuevoTitulo('reading', 'Libro por terminar', { subtype: 'book' });
    const conCancelar = await boton(l, 'Cancelar');
    const trasCancelar = (await E.titulo('reading', 'Libro por terminar')).status;
    const conTerminado = await boton(await E.titulo('reading', 'Libro por terminar'), 'Terminado');
    const trasTerminado = (await E.titulo('reading', 'Libro por terminar')).status;
    const deVuelta = await boton(await E.titulo('reading', 'Libro por terminar'));
    const trasVuelta = (await E.titulo('reading', 'Libro por terminar')).status;
    const peli = await E.nuevoTitulo('movie', 'Peli 2');
    const hojasPeli = [];
    for (let i = 0; i < 2; i++) hojasPeli.push(...(await boton(await E.titulo('movie', 'Peli 2'))));
    const hoja = 'Marcar como Terminado | ¿Marcar «Libro por terminar» como Terminado?';
    tabla('hoja "Marcar como Terminado" (D6)', [
        { caso: 'Cancelar: muestra la hoja y no cambia', esperado: { hojas: [hoja], estado: 'Pendiente' }, obtenido: { hojas: conCancelar, estado: trasCancelar } },
        { caso: 'Terminado: muestra la hoja y cambia', esperado: { hojas: [hoja], estado: 'Terminado' }, obtenido: { hojas: conTerminado, estado: trasTerminado } },
        { caso: 'de Terminado a Pendiente: sin hoja', esperado: { hojas: [], estado: 'Pendiente' }, obtenido: { hojas: deVuelta, estado: trasVuelta } },
        { caso: 'película (Pendiente → Mirando → Terminado): sin hoja', esperado: { hojas: [], estado: 'Terminado' }, obtenido: { hojas: hojasPeli, estado: (await E.titulo('movie', 'Peli 2')).status } },
        { caso: 'motor puro: needsFinishConfirm', esperado: [true, false, false, false, true], obtenido: [
            link.needsFinishConfirm({ type: 'series', status: 'Pendiente' }), link.needsFinishConfirm({ type: 'series', status: 'Terminado' }),
            link.needsFinishConfirm({ type: 'movie', status: 'Mirando' }), link.needsFinishConfirm({ type: 'anime', status: 'Mirando', linked_series_id: 'x' }),
            link.needsFinishConfirm({ type: 'reading', status: 'Mirando' }),
        ] },
    ]);
    check('la película se creó (control)', !!peli);
}

// =============================================================================================
const vieja = await cargarAppVieja(REF_VIEJA, WORK);

seccion(`9. Migración 7 sobre una BD v6 de la app 1.3.9 (${REF_VIEJA}); series sin vínculo como en la 1.3.9`);
{
    check(`app 1.3.9 cargada de ${REF_VIEJA} (${vieja.archivos} archivos de src/)`, vieja.archivos > 50 && vieja.migrations.LATEST_VERSION === 6);
    const O = await vieja.dispositivo(UID, __setDatabasePath);
    O.usar();
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && res.error}`); return res; };
    const add = ok(await quiet(() => O.svc.addEntertainmentCategory(UID, { name: 'Vieja', type: 'video', startDate: dia(-9), daysOfWeek: todas(1), frequency: 0, seriesCount: 5, description: null })), 'addEntertainmentCategory');
    ok(await quiet(() => O.svc.addSeriesWithSeasons({ category_id: add.id, name: 'Heredada', description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 3 }])), 'addSeriesWithSeasons');
    ok(await quiet(() => O.svc.addSeriesWithSeasons({ category_id: add.id, name: 'Heredada 2', description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 2 }])), 'addSeriesWithSeasons');
    ok(await quiet(() => O.svc.addBacklogItem(UID, { type: 'reading', title: 'Lectura vieja' })), 'addBacklogItem');
    const colaVieja = (await O.svc.getFullWatchlist(UID, add.id)).data.map((s) => ({ id: s.s_id, name: s.s_name, status: s.status, watched: s.watched_count, sort: s.sort_order }));
    const uv6 = (await O.svc.db.getFirstAsync('PRAGMA user_version')).user_version;
    await O.svc.db.closeAsync();
    const falla = `${WORK}/mig/falla/app_registro_v3.db`, migra = `${WORK}/mig/migra/app_registro_v3.db`, v6b = `${WORK}/mig/v6b/app_registro_v3.db`;
    for (const p of [falla, migra, v6b]) { mkdirSync(dirname(p), { recursive: true }); copyFileSync(O.path, p); }
    const { DatabaseSync } = await import('node:sqlite');
    const leer = (p) => { const d = new DatabaseSync(p, { readOnly: true }); try { return { uv: d.prepare('PRAGMA user_version').get().user_version, cols: d.prepare('PRAGMA table_info(series)').all().some((c) => c.name === 'backlog_id') && d.prepare('PRAGMA table_info(backlog)').all().some((c) => c.name === 'subtype') }; } finally { d.close(); } };
    DEV_FLAGS.DEV_FAIL_MIGRATION = true;
    let abrio = true;
    try { await D.openDevice('mig-falla', falla); } catch { abrio = false; }
    DEV_FLAGS.DEV_FAIL_MIGRATION = false;
    const copias0 = backupCalls.length;
    const dev = await D.openDevice('mig-migra', migra);
    const copias = backupCalls.slice(copias0);
    D.use(dev);
    const resumen = await dev.svc.db.getFirstAsync("SELECT payload FROM _migration_log WHERE version = 7 AND kind = 'summary'");
    const p7 = resumen ? JSON.parse(resumen.payload) : null;
    const nulos = (await dev.svc.db.getFirstAsync('SELECT (SELECT COUNT(*) FROM series WHERE backlog_id IS NOT NULL) + (SELECT COUNT(*) FROM backlog WHERE subtype IS NOT NULL) AS n')).n;
    const fkLocal = (await dev.svc.db.getAllAsync('PRAGMA foreign_key_list(series)')).some((f) => f.from === 'backlog_id');
    tabla('migración 7', [{
        caso: 'v6 con datos → v7',
        // Desde la 7.5b1 la apertura sigue hasta LATEST_VERSION (8): copias v7 y v8 (como probar-fase7-4b en la 7.5).
        esperado: { uv6: 6, falla: { abre: false, uv: 6, cols: false }, migra: { uv: LATEST_VERSION, cols: true }, copia: Array.from({ length: LATEST_VERSION - 6 }, (_, i) => `pre-migracion-v${7 + i}`), conteosIguales: true, valoresNulos: 0, fkLocalBacklogId: false, latest: LATEST_VERSION },
        obtenido: { uv6, falla: { abre: abrio, ...leer(falla) }, migra: leer(migra), copia: copias, conteosIguales: !!p7 && igual(p7.before, p7.after), valoresNulos: nulos, fkLocalBacklogId: fkLocal, latest: LATEST_VERSION },
    }]);
    // Series sin vínculo (heredadas): misma cola que en la 1.3.9 y siguen funcionando sin tocar Pendiente.
    const colaNueva = (dev.svc ? (await dev.svc.getFullWatchlist(UID, add.id)).data : []).map((s) => ({ id: s.s_id, name: s.s_name, status: s.status, watched: s.watched_count, sort: s.sort_order }));
    const her = (await dev.svc.getSeriesByCategory(add.id)).series.find((s) => s.name === 'Heredada');
    const backlogAntes = (await dev.svc.db.getFirstAsync('SELECT COUNT(*) n FROM backlog')).n;
    await dev.svc.db.runAsync('DELETE FROM outbox');
    const pasos = [
        await dev.svc.markEpisodesWatched(her.id, 'video', [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 }], { season: 1, episode: 3, status: 'Terminado' }, Date.now()),
        await dev.svc.unmarkEpisodes(her.id, 'video', [{ season: 1, episode: 3 }], { season: 1, episode: 3, status: 'Mirando' }),
        await dev.svc.updateSeriesProgress(her.id, 1, 3, 'Pausado'),
        await dev.svc.restartSeries(her.id, 2),
        await dev.svc.deleteSeries(her.id),
    ];
    const backlogOutbox = (await dev.svc.db.getFirstAsync("SELECT COUNT(*) n FROM outbox WHERE table_name = 'backlog'")).n;
    const lecturaVieja = (await dev.svc.getBacklogItems(UID, 'reading', 'Total')).data[0];
    tabla('series sin vínculo (heredadas)', [
        { caso: 'misma cola que la 1.3.9 tras migrar', esperado: colaVieja, obtenido: colaNueva },
        { caso: 'marcar, desmarcar, pausar, reiniciar y borrar: funcionan sin tocar Pendiente', esperado: { ok: [true, true, true, true, true], backlogFilas: backlogAntes, backlogEnOutbox: 0 }, obtenido: { ok: pasos.map((r) => r.success), backlogFilas: (await dev.svc.db.getFirstAsync('SELECT COUNT(*) n FROM backlog')).n, backlogEnOutbox: backlogOutbox } },
        { caso: 'la lectura vieja queda sin subtipo y sin vínculo', esperado: { subtype: null, vinculada: false }, obtenido: { subtype: lecturaVieja.subtype, vinculada: link.isLinked(lecturaVieja) } },
    ]);
    await dev.svc.db.closeAsync();
    // comparar-sync v6 (sin las columnas) frente a v7 recién migrada (columnas NULL): idénticas.
    const migra2 = `${WORK}/mig/migra2/app_registro_v3.db`;
    mkdirSync(dirname(migra2), { recursive: true });
    copyFileSync(v6b, migra2);
    const dev2 = await D.openDevice('mig-migra2', migra2);
    await dev2.svc.db.closeAsync();
    const cmp = compareSnapshots(snapshotDb(v6b), snapshotDb(migra2));
    check('comparar-sync: v6 (sin las columnas) y v7 (columnas NULL) idénticas en las 15 tablas, mismo saldo', cmp.identical && cmp.balanceEqual, TABLES.filter((t) => !cmp.tables[t].same).join(','));
    const backup = await import('../src/services/backup.js');
    const validar = async (path, etiqueta) => {
        __setDatabasePath(path);
        const bk = await quiet(() => backup.createBackup());
        const res = spawnSync(process.execPath, ['scripts/validar-respaldo.mjs', bk.json.path, '--db', bk.physical.path, '--out', `${WORK}/validado-${etiqueta}.sqlite`], { encoding: 'utf8' });
        const meta = JSON.parse(readFileSync(bk.json.path, 'utf8')).meta;
        return { ok: res.status === 0 && /Respaldo válido/.test(res.stdout), uv: meta.userVersion };
    };
    tabla('validar-respaldo', [{ caso: `respaldos v6 y v${LATEST_VERSION}`, esperado: [{ ok: true, uv: 6 }, { ok: true, uv: LATEST_VERSION }], obtenido: [await validar(v6b, 'v6'), await validar(migra2, 'v7')] }]);
}

// =============================================================================================
// Servidor PGlite con las migraciones reales: todas o sin la nueva.
async function servidor({ conNueva = true } = {}) {
    const pg = new PGlite();
    await pg.exec(readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8'));
    const files = readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort().filter((f) => conNueva || f !== MIGRACION_NUEVA);
    for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    const T = createPgliteTransport(pg);
    return { pg, T, files, aplicarNueva: () => pg.exec(readFileSync(`supabase/migrations/${MIGRACION_NUEVA}`, 'utf8')) };
}
const nuevoUsuario = async (S, uid) => { await S.pg.query('insert into auth.users (id) values ($1)', [uid]); S.T.uid = uid; };

seccion('10. Supabase: migración 6, privilegios, verificar-fase7-5.sql y auditar-fase6.sql (PGlite)');
{
    const S = await servidor({ conNueva: false });
    const todasM = readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort();
    // Desde la 7.5b1 ya no es la última (le sigue 20261124000100_etiquetas.sql): el servidor viejo es "todas menos ella".
    check('la migración nueva está en el directorio (6.ª) y el servidor viejo tiene todas menos ella', todasM[5] === MIGRACION_NUEVA && S.files.length === todasM.length - 1 && !S.files.includes(MIGRACION_NUEVA));
    const sqlMig = readFileSync(`supabase/migrations/${MIGRACION_NUEVA}`, 'utf8').replace(/--.*$/gm, '');
    // Fuera de las líneas de grant/revoke (que nombran privilegios como "update").
    const sinGrants = sqlMig.split('\n').filter((l) => !/^\s*(grant|revoke)\b/i.test(l)).join('\n');
    check('la migración solo agrega (sin drop, delete, update, truncate, create table ni alter column/rename)', !/\b(drop|delete|update|truncate|create\s+table|alter\s+column|rename)\b/i.test(sinGrants) && /\bbegin\b/i.test(sqlMig) && /\bcommit\b/i.test(sqlMig));
    const ROLES = "('anon', 'authenticated', 'PUBLIC', 'service_role')";
    const privilegios = async (pg, t) => {
        const tablaP = (await pg.query(`
            select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as rol, a.privilege_type as p, a.is_grantable as g
            from pg_class c, aclexplode(c.relacl) a
            where c.oid = 'public.${t}'::regclass and (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) in ${ROLES}
            order by 1, 2`)).rows.map((r) => `${r.rol}:${r.p}:${r.g}`);
        const acl = (await pg.query(`select attname, coalesce(attacl::text, '') as acl from pg_attribute where attrelid = 'public.${t}'::regclass and attnum > 0 and not attisdropped order by attname`)).rows;
        const columnas = {};
        for (const r of (await pg.query(`select column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = '${t}' and grantee in ${ROLES} order by 1, 2, 3`)).rows) (columnas[r.column_name] ||= []).push(`${r.grantee}:${r.privilege_type}`);
        return { tabla: tablaP, acl, columnas };
    };
    // Filas existentes con tombstones (las 4 de prueba de backlog son type movie/series en Poguis):
    // el CHECK y la FK no las afectan.
    const uid = '00000000-0000-4000-8000-000000007510';
    await S.pg.query('insert into auth.users (id) values ($1)', [uid]);
    await S.pg.query(`insert into public.backlog (id, user_id, type, title, status, created_at, updated_at, deleted_at)
        values (gen_random_uuid(), $1, 'movie', '[prueba]', 'Pendiente', now(), now(), now()), (gen_random_uuid(), $1, 'reading', 'Lectura', 'Pendiente', now(), now(), null)`, [uid]);
    const antes = { backlog: await privilegios(S.pg, 'backlog'), series: await privilegios(S.pg, 'series') };
    let errMig = null;
    try { await S.aplicarNueva(); } catch (e) { errMig = e.message; }
    const despues = { backlog: await privilegios(S.pg, 'backlog'), series: await privilegios(S.pg, 'series') };
    const sinNuevas = (cols, nueva) => Object.fromEntries(Object.entries(cols).filter(([c]) => c !== nueva));
    tabla('privilegios de backlog y series (anon, authenticated, PUBLIC, service_role)', [
        { caso: 'la migración aplica sobre filas existentes y tombstones', esperado: null, obtenido: errMig },
        { caso: 'tablas: ACL igual antes y después', esperado: [antes.backlog.tabla, antes.series.tabla], obtenido: [despues.backlog.tabla, despues.series.tabla] },
        { caso: 'columnas: sin ACL propia (también las nuevas)', esperado: [true, true], obtenido: [despues.backlog.acl.every((r) => r.acl === '') && despues.backlog.acl.some((r) => r.attname === 'subtype'), despues.series.acl.every((r) => r.acl === '') && despues.series.acl.some((r) => r.attname === 'backlog_id')] },
        { caso: 'columnas existentes: privilegios iguales', esperado: [antes.backlog.columnas, antes.series.columnas], obtenido: [sinNuevas(despues.backlog.columnas, 'subtype'), sinNuevas(despues.series.columnas, 'backlog_id')] },
        { caso: 'columnas nuevas: los mismos que title / name', esperado: [antes.backlog.columnas.title, antes.series.columnas.name], obtenido: [despues.backlog.columnas.subtype, despues.series.columnas.backlog_id] },
        { caso: 'anon y PUBLIC sin nada; authenticated S/I/U', esperado: ['authenticated:INSERT:false', 'authenticated:SELECT:false', 'authenticated:UPDATE:false'], obtenido: despues.backlog.tabla.filter((x) => !x.startsWith('service_role')) },
    ]);
    // CHECK y FK reales.
    const intento = async (sql, p) => { try { await S.pg.query(sql, p); return 'ok'; } catch (e) { return e.code; } };
    const bId = (await S.pg.query("select id from public.backlog where title = 'Lectura'")).rows[0].id;
    tabla('CHECK del subtipo y FK del vínculo', [
        { caso: 'lectura con subtipo manga / novela / película con subtipo', esperado: ['ok', '23514', '23514'], obtenido: [
            await intento("update public.backlog set subtype = 'manga' where id = $1", [bId]),
            await intento("update public.backlog set subtype = 'novela' where id = $1", [bId]),
            await intento("update public.backlog set subtype = 'book' where title = '[prueba]'", []),
        ] },
        { caso: 'serie con backlog_id inexistente → 23503 (series_backlog_fkey)', esperado: '23503', obtenido: await (async () => {
            const cat = (await S.pg.query("insert into public.entertainment_categories (id, user_id, name, type, created_at, updated_at) values (gen_random_uuid(), $1, 'c', 'video', now(), now()) returning id", [uid])).rows[0].id;
            return intento("insert into public.series (id, user_id, category_id, name, backlog_id, created_at, updated_at) values (gen_random_uuid(), $1, $2, 's', gen_random_uuid(), now(), now())", [uid, cat]);
        })() },
    ]);
    const sql = readFileSync('supabase/verificar-fase7-5.sql', 'utf8');
    const escritura = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"));
    const conMig = (await S.pg.query(sql)).rows;
    const S5 = await servidor({ conNueva: false });
    const sinMig = (await S5.pg.query(sql)).rows;
    tabla('verificar-fase7-5.sql', [
        { caso: 'solo lectura (un SELECT, sin escritura fuera de comentarios y literales)', esperado: false, obtenido: escritura },
        { caso: 'con la migración: 15 filas, todas ok', esperado: { filas: 15, ok: 15 }, obtenido: { filas: conMig.length, ok: conMig.filter((r) => r.ok).length } },
        { caso: 'sin la migración: fallan las 9 del esquema nuevo, el resto ok', esperado: [1, 2, 3, 4, 5, 6, 7, 8, 9], obtenido: sinMig.filter((r) => !r.ok).map((r) => r.orden) },
    ]);
    // auditar-fase6.sql: 18/18 estrictos con la migración; valores informativos que cambian.
    const AUD = readFileSync('supabase/auditar-fase6.sql', 'utf8');
    const auditar = async (conNueva) => {
        const X = await servidor({ conNueva });
        const u = '00000000-0000-4000-8000-000000007511';
        await X.pg.query('insert into auth.users (id) values ($1)', [u]);
        await X.pg.query("insert into auth.identities (user_id, provider) values ($1, 'google')", [u]);
        await X.pg.exec('begin transaction read only');
        try { return (await X.pg.query(AUD)).rows; } finally { await X.pg.exec('rollback'); }
    };
    const a5 = await auditar(false), a6 = await auditar(true);
    const kind = (r) => (r.esperado === null ? 'I' : r.chequeo.startsWith('(solo Supabase)') ? 'S' : 'E');
    const estrictos = a6.filter((r) => kind(r) === 'E');
    const cambian = a6.filter((r) => { const v = a5.find((x) => x.orden === r.orden); return v && v.valor !== r.valor; }).map((r) => `#${r.orden} ${kind(r)}`);
    // 18 estrictos: 16 evaluables en PGlite + #2 y #19 "solo Supabase" (como probar-fase6).
    const soloSupabase = a6.filter((r) => kind(r) === 'S').map((r) => r.orden);
    check(`auditar-fase6.sql con la migración: ${estrictos.filter((r) => r.ok === true).length}/${estrictos.length} estrictos ok (+ ${soloSupabase.length} solo Supabase: ${soloSupabase.map((n) => '#' + n).join(', ')})`, estrictos.length === 16 && soloSupabase.length === 2 && estrictos.every((r) => r.ok === true), estrictos.filter((r) => r.ok !== true).map((r) => `#${r.orden}`).join(','));
    console.log(`     valores de auditar-fase6 que cambian con la migración: ${cambian.length ? cambian.join(', ') : 'ninguno'}`);
}

// =============================================================================================
seccion('11. Sync entre 2 dispositivos: vínculo, subtipo y reconciliación (D2)');
{
    const S = await servidor();
    const uid = '00000000-0000-4000-8000-000000007520';
    await nuevoUsuario(S, uid);
    const A = await entorno(uid);
    const cat = await A.crearCategoria({ type: 'video' });
    const L = await A.crearCategoria({ type: 'reading' });
    await A.guardar(cat, { name: 'Compartida', temporadas: [2], linkEstado: { mode: 'nuevo' }, newType: 'series' });
    await A.guardar(L, { name: 'Manga compartido', linkEstado: { mode: 'nuevo' }, newType: 'manga' });
    A.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const oa = await quiet(() => engine.syncOnce(CFG, S.T));
    const B = await entorno(uid);
    B.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const ob = await quiet(() => engine.syncOnce(CFG, S.T));
    A.usar();
    await quiet(() => engine.syncOnce(CFG, S.T));
    const tB = await B.titulo('series', 'Compartida');
    const mB = await B.titulo('reading', 'Manga compartido');
    const srv = (await S.pg.query("select count(*)::int n from public.series s join public.backlog b on b.id = s.backlog_id where s.name = 'Compartida' and b.title = 'Compartida'")).rows[0].n;
    let cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    tabla('vínculo y subtipo por la sync', [{
        caso: 'A sube, B baja',
        esperado: { a: 'ok', b: 'ok', servidor: 1, enB: { vinculado: true, estado: 'Mirando', etiqueta: 'En Cat video · Nueva', subtipo: 'manga' }, identicos: true },
        obtenido: { a: oa.status, b: ob.status, servidor: srv, enB: { vinculado: link.isLinked(tB), estado: tB.status, etiqueta: link.linkLabel({ seriesStatus: tB.linked_series_status, categoryName: tB.linked_category_name }), subtipo: mB.subtype }, identicos: cmp.identical },
    }]);
    // Reconciliación: B edita el título sin red (sube la fila entera con el estado viejo) mientras A
    // termina la serie; tras la sync de B, el título queda en Terminado en los dos y en el servidor.
    B.usar();
    B.ok(await B.db.updateBacklogItem(tB.id, { title: 'Compartida', format: '40 min', franchise: 'Otros' }), 'updateBacklogItem');
    const sA = await A.serie(cat, 'Compartida');
    A.usar();
    A.ok(await A.db.markEpisodesWatched(sA.id, 'video', [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], { season: 1, episode: 2, status: 'Terminado' }, Date.now()), 'markEpisodesWatched');
    await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar();
    engine.takeLocalDataChanged();
    let avisos = 0;
    setOutboxCommitListener(() => { avisos++; });
    const ob2 = await quiet(() => engine.syncOnce(CFG, S.T));
    setOutboxCommitListener(null);
    const cambio = engine.takeLocalDataChanged();
    const srvT = (await S.pg.query('select status, format from public.backlog where id = $1', [tB.id])).rows[0];
    A.usar();
    await quiet(() => engine.syncOnce(CFG, S.T));
    cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    const tA = await A.titulo('series', 'Compartida');
    // Segunda vuelta: nada que escribir en ningún lado.
    A.usar();
    const a3 = await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar();
    const b3 = await quiet(() => engine.syncOnce(CFG, S.T));
    tabla('reconciliación tras la sync (D2)', [{
        caso: 'edición concurrente del título y de la serie',
        esperado: { reconciliados: 1, subidoEnElMismoCiclo: true, avisosOutbox: 0, cambioLocal: true, servidor: { status: 'Terminado', format: '40 min' }, enA: 'Terminado', identicos: true, segunda: [0, 0, 0, 0, 0, 0] },
        obtenido: {
            reconciliados: ob2.reconciledTitles, subidoEnElMismoCiclo: ob2.status === 'ok' && (await B.contar('outbox')) === 0, avisosOutbox: avisos, cambioLocal: cambio,
            servidor: srvT, enA: tA.status, identicos: cmp.identical,
            segunda: [a3.remoteWrites, a3.localWrites, a3.reconciledTitles, b3.remoteWrites, b3.localWrites, b3.reconciledTitles],
        },
    }]);
    // Condición 3c: dos series vivas vinculadas al mismo título (dos dispositivos sin red) → regla
    // de backlogStatusFor; un título vivo sin series vivas → no se toca y se comporta como sin vínculo.
    const C = await entorno(uid);
    C.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    await quiet(() => engine.syncOnce(CFG, S.T));
    const titulo2 = await C.nuevoTitulo('anime', 'Doble');
    C.usar();
    await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar();
    await quiet(() => engine.syncOnce(CFG, S.T));
    const catB = await B.categoria(cat.id);
    const catC = await C.categoria(cat.id);
    await B.guardar(catB, { name: 'Doble B', linkEstado: { mode: 'pendiente', backlogId: titulo2.id, title: 'Doble' } });
    await C.guardar(catC, { name: 'Doble', linkEstado: { mode: 'pendiente', backlogId: titulo2.id, title: 'Doble' } });
    for (const X of [B, C, B]) { X.usar(); await quiet(() => engine.syncOnce(CFG, S.T)); }
    const vivas = await B.contar('series', 'backlog_id = ? AND deleted_at IS NULL', [titulo2.id]);
    const sBb = await B.serie(catB, 'Doble B');
    const sBc = await B.serie(catB, 'Doble');
    B.usar();
    B.ok(await B.db.updateSeriesProgress(sBb.id, 1, 2, 'Terminado'), 'updateSeriesProgress');
    const unaTerminada = (await B.titulo('anime', 'Doble')).status;
    B.ok(await B.db.updateSeriesProgress(sBc.id, 1, 2, 'Terminado'), 'updateSeriesProgress');
    const lasDos = (await B.titulo('anime', 'Doble')).status;
    // Sin series vivas: la serie se borra "por fuera" (como lo haría la 1.3.9, que no conoce el vínculo).
    await B.db.db.runAsync("UPDATE series SET deleted_at = ? WHERE backlog_id = ?", [new Date().toISOString(), titulo2.id]);
    const antesR = (await B.titulo('anime', 'Doble')).status;
    B.usar();
    const { reconcileLinkedTitles } = await import('../src/data/repositories/series.ts');
    const { mutate } = await import('../src/data/db/connection.ts');
    const nR = await mutate(() => reconcileLinkedTitles(uid));
    const huerfano = await B.titulo('anime', 'Doble');
    tabla('condición 3c', [
        { caso: 'dos series vivas vinculadas al mismo título', esperado: { vivas: 2, unaTerminada: 'Mirando', lasDosTerminadas: 'Terminado' }, obtenido: { vivas, unaTerminada, lasDosTerminadas: lasDos } },
        { caso: 'título vivo sin series vivas: no se toca y se comporta como sin vínculo', esperado: { reconciliados: 0, estado: antesR, vinculado: false, boton: 'Pendiente' }, obtenido: { reconciliados: nR, estado: huerfano.status, vinculado: link.isLinked(huerfano), boton: link.nextManualStatus(huerfano) } },
    ]);
}

// =============================================================================================
seccion('12. Carreras del pull: una hija que llega antes que su padre en el mismo ciclo');
{
    const pullHasta = async (dev, hasta, S, uid) => {
        D.use(dev);
        for (const t of TABLES) { await quiet(() => engine.pullTable(CFG, S.T, t, uid)); if (t === hasta) break; }
    };
    // (a) Hoy: seasons → series (FK local diferida de la migración 2).
    {
        const S = await servidor();
        const uid = '00000000-0000-4000-8000-000000007530';
        await nuevoUsuario(S, uid);
        const A = await entorno(uid);
        A.usar(); await quiet(() => engine.ensureInitialUpload(CFG)); await quiet(() => engine.syncOnce(CFG, S.T));
        const B = await entorno(uid);
        B.usar(); await quiet(() => engine.ensureInitialUpload(CFG)); await quiet(() => engine.syncOnce(CFG, S.T));
        await pullHasta(A.dev, 'series', S, uid); // A ya bajó series (todavía sin la nueva)
        const catB = await B.crearCategoria({ type: 'video' });
        await B.guardar(catB, { name: 'Carrera', temporadas: [2], linkEstado: null });
        B.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
        A.usar();
        const metaAntes = (await A.db.db.getFirstAsync("SELECT value FROM sync_meta WHERE key = 'last_error'")) || { value: null };
        let error = null;
        try { await quiet(() => engine.pullTable(CFG, S.T, 'seasons', uid)); } catch (e) { error = e.message; }
        const bloqueadas = await A.contar('outbox', 'blocked_at IS NOT NULL');
        const metaDespues = (await A.db.db.getFirstAsync("SELECT value FROM sync_meta WHERE key = 'last_error'")) || { value: null };
        A.usar();
        const sigue = await quiet(() => engine.syncOnce(CFG, S.T));
        const cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
        tabla('(a) hoy, seasons → series', [{
            caso: 'la página de seasons falla al confirmar; el ciclo siguiente lo corrige',
            esperado: { falla: true, filasBloqueadas: 0, lastErrorSinCambio: true, cicloSiguiente: 'ok', identicos: true },
            obtenido: { falla: /FOREIGN KEY/i.test(String(error)), filasBloqueadas: bloqueadas, lastErrorSinCambio: metaAntes.value === metaDespues.value, cicloSiguiente: sigue.status, identicos: cmp.identical },
        }]);
    }
    // (b) Fase 7.5: backlog → series, sin REFERENCES local en backlog_id.
    {
        const S = await servidor();
        const uid = '00000000-0000-4000-8000-000000007531';
        await nuevoUsuario(S, uid);
        const A = await entorno(uid);
        A.usar(); await quiet(() => engine.ensureInitialUpload(CFG)); await quiet(() => engine.syncOnce(CFG, S.T));
        const B = await entorno(uid);
        B.usar(); await quiet(() => engine.ensureInitialUpload(CFG)); await quiet(() => engine.syncOnce(CFG, S.T));
        const catB = await B.crearCategoria({ type: 'video' });
        B.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
        await pullHasta(A.dev, 'backlog', S, uid); // A ya bajó backlog (todavía sin el título)
        // A2: otro dispositivo en la misma situación (sincronizado ANTES de que B suba el título), para
        // borrar la serie en una copia aparte.
        const A2 = await entorno(uid);
        A2.usar(); await quiet(() => engine.ensureInitialUpload(CFG)); await quiet(() => engine.syncOnce(CFG, S.T));
        await B.guardar(catB, { name: 'Carrera vinculada', temporadas: [2], linkEstado: { mode: 'nuevo' }, newType: 'series' });
        B.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
        A.usar();
        let error = null, r = null;
        try { r = await quiet(() => engine.pullTable(CFG, S.T, 'series', uid)); } catch (e) { error = e.message; }
        const serieA = await A.contar('series', "name = 'Carrera vinculada' AND deleted_at IS NULL");
        const tituloA = await A.contar('backlog', "title = 'Carrera vinculada'");
        // Estado "serie con backlog_id cuyo título todavía no está en el celular".
        const catA = await A.categoria(catB.id);
        A.usar();
        const det = await A.db.getSeriesByCategory(catB.id);
        const sA = det.success ? det.series.find((x) => x.name === 'Carrera vinculada') : null;
        const pend = await A.db.getBacklogItems(uid, 'series', 'Total');
        const { reflectLinkedBacklogStatus } = await import('../src/data/repositories/series.ts');
        const { mutate } = await import('../src/data/db/connection.ts');
        const backlogOutboxAntes = await A.contar('outbox', "table_name = 'backlog'");
        const reflejo = await mutate(() => reflectLinkedBacklogStatus(sA && sA.backlog_id));
        const backlogOutboxDespues = await A.contar('outbox', "table_name = 'backlog'");
        const hoja = await (async () => {
            const Al = crearAlert();
            const originalList = await A.lista(catA);
            const f = instanciar(extraer(PANT.detalle, 'handleDelete'), { originalList, db: A.db, ...hojasDesdeAlert(Al.Alert), fetchSeries: () => {} });
            await quiet(() => f(sA.id));
            await vaciar();
            return Al.registro[0] && Al.registro[0].mensaje;
        })();
        const vistaEdicion = (construir(PANT.detalle, 'formLinkView', { isEditing: true, editingSeriesId: sA && sA.id, originalList: await A.lista(catA), link: { mode: 'pendiente', title: 'no debe verse' } }))();
        tabla('(b) título que todavía no llegó al celular', [{
            caso: 'el detalle y Pendiente cargan; la serie se ve sin vínculo; nada toca el título que falta',
            esperado: { detalle: true, conBacklogId: true, linkedTitleAlive: false, pendiente: true, tituloEnPendiente: false, reflejo: false, backlogEnOutbox: 0, textoBorrado: '¿Estás seguro?', formulario: { chip: false, texto: null, tipos: false } },
            obtenido: {
                detalle: det.success, conBacklogId: !!(sA && sA.backlog_id), linkedTitleAlive: !!(sA && sA.linked_title_alive), pendiente: pend.success,
                tituloEnPendiente: pend.success && pend.data.some((b) => b.title === 'Carrera vinculada'), reflejo, backlogEnOutbox: backlogOutboxDespues - backlogOutboxAntes,
                textoBorrado: hoja, formulario: vistaEdicion,
            },
        }]);
        // Copia aparte (A2): borrar la serie en ese estado no toca el título que falta; cuando el
        // título llega queda vivo y se comporta como sin vínculo (límite conocido; no se pierde nada).
        A2.usar();
        await quiet(() => engine.pullTable(CFG, S.T, 'series', uid));
        const s2 = (await A2.lista(await A2.categoria(catB.id))).find((x) => x.name === 'Carrera vinculada');
        const backlogFilasA2 = await A2.contar('backlog');
        await A2.limpiarOutbox();
        const borrado = await A2.db.deleteSeries(s2.id);
        const obBorrado = await A2.resumenOutbox();
        const backlogFilasA2Despues = await A2.contar('backlog');
        A2.usar();
        const sync2 = await quiet(() => engine.syncOnce(CFG, S.T));
        const tA2 = await A2.titulo('series', 'Carrera vinculada');
        tabla('(b) borrar la serie mientras su título no llegó (copia aparte)', [{
            caso: 'el borrado no toca el título; luego el título llega vivo y se comporta como sin vínculo',
            esperado: { borrado: true, backlogEnOutbox: 0, backlogFilas: backlogFilasA2, ciclo: 'ok', tituloVivo: true, vinculado: false, estado: 'Pendiente', reconciliados: 1, boton: 'Terminado' },
            obtenido: { borrado: borrado.success, backlogEnOutbox: obBorrado.porTabla.backlog || 0, backlogFilas: backlogFilasA2Despues, ciclo: sync2.status, tituloVivo: !!tA2, vinculado: !!tA2 && link.isLinked(tA2), estado: tA2 && tA2.status, reconciliados: sync2.reconciledTitles, boton: tA2 && link.nextManualStatus(tA2) },
        }]);
        A.usar();
        const sigue = await quiet(() => engine.syncOnce(CFG, S.T));
        const t = await A.titulo('series', 'Carrera vinculada');
        // A2 ya borró la serie y subió el borrado: el ciclo siguiente de A trae el título y el
        // tombstone; A, A2 y B terminan idénticos.
        B.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
        A2.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
        const cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
        const cmp2 = compareSnapshots(snapshotDb(A2.dev.path), snapshotDb(B.dev.path));
        tabla('(b) 7.5, backlog → series sin FK local', [{
            caso: 'la serie entra aunque su título todavía no; el ciclo siguiente trae el título',
            esperado: { error: null, aplicada: 1, serieLocal: 1, tituloLocalAntes: 0, filasBloqueadas: 0, cicloSiguiente: 'ok', tituloLlego: true, identicos: [true, true] },
            obtenido: { error, aplicada: r && r.applied, serieLocal: serieA, tituloLocalAntes: tituloA, filasBloqueadas: await A.contar('outbox', 'blocked_at IS NOT NULL'), cicloSiguiente: sigue.status, tituloLlego: !!t, identicos: [cmp.identical, cmp2.identical] },
        }]);
    }
}

// =============================================================================================
seccion('13. 23503: backlog_id NULL no es un padre que falta; un padre que falta se encola');
{
    // (i) Mensaje sin el nombre de la FK (se prueban todas): la serie sin vínculo cuya categoría no
    // estaba en el servidor → se encola la categoría, nunca "missing" por backlog_id NULL.
    {
        const S = await servidor();
        const uid = '00000000-0000-4000-8000-000000007540';
        await nuevoUsuario(S, uid);
        const A = await entorno(uid);
        const cat = await A.crearCategoria({ type: 'video' });
        await A.guardar(cat, { name: 'Sin vínculo', linkEstado: null });
        A.usar();
        await quiet(() => engine.ensureInitialUpload(CFG));
        await A.db.db.runAsync("DELETE FROM outbox WHERE table_name IN ('entertainment_categories', 'entertainment_quotas_history')");
        const T2 = { ...S.T, upsert: async (table, rows) => {
            const r = await S.T.upsert(table, rows);
            if (r.error && r.error.code === '23503') r.error = { ...r.error, message: 'insert or update violates foreign key constraint' };
            return r;
        } };
        const o = await quiet(() => engine.syncOnce(CFG, T2));
        const srv = (await S.pg.query("select (select count(*)::int from public.entertainment_categories where id = $1) c, (select count(*)::int from public.series where name = 'Sin vínculo') s", [cat.id])).rows[0];
        tabla('(i) mensaje sin nombre de FK, backlog_id NULL', [{
            caso: 'se encola la categoría y todo sube',
            esperado: { estado: 'ok', padresEncolados: true, bloqueadas: 0, servidor: { c: 1, s: 1 } },
            obtenido: { estado: o.status, padresEncolados: o.push.parentsEnqueued > 0, bloqueadas: await A.contar('outbox', 'blocked_at IS NOT NULL'), servidor: srv },
        }]);
    }
    // (ii) Serie vinculada cuyo título no estaba en el servidor → series_backlog_fkey → se encola el título.
    {
        const S = await servidor();
        const uid = '00000000-0000-4000-8000-000000007541';
        await nuevoUsuario(S, uid);
        const A = await entorno(uid);
        const cat = await A.crearCategoria({ type: 'video' });
        await A.guardar(cat, { name: 'Con vínculo', linkEstado: { mode: 'nuevo' }, newType: 'anime' });
        A.usar();
        await quiet(() => engine.ensureInitialUpload(CFG));
        await A.db.db.runAsync("DELETE FROM outbox WHERE table_name = 'backlog'");
        const o = await quiet(() => engine.syncOnce(CFG, S.T));
        const srv = (await S.pg.query("select count(*)::int n from public.series s join public.backlog b on b.id = s.backlog_id where s.name = 'Con vínculo'")).rows[0].n;
        tabla('(ii) padre que falta de verdad (series_backlog_fkey)', [{
            caso: 'se encola el título y sube con la serie',
            esperado: { estado: 'ok', padresEncolados: true, bloqueadas: 0, servidor: 1 },
            obtenido: { estado: o.status, padresEncolados: o.push.parentsEnqueued > 0, bloqueadas: await A.contar('outbox', 'blocked_at IS NOT NULL'), servidor: srv },
        }]);
    }
}

// =============================================================================================
const CFG_VIEJA = { ...vieja.config.DEFAULT_SYNC_CONFIG, enabled: true };

seccion(`14. Compatibilidad a: la app 1.3.9 (${REF_VIEJA}) contra el servidor CON las columnas`);
{
    const S = await servidor();
    const uid = '00000000-0000-4000-8000-000000007550';
    await nuevoUsuario(S, uid);
    const N = await entorno(uid);
    const cat = await N.crearCategoria({ type: 'video' });
    await N.guardar(cat, { name: 'Vinculada N', temporadas: [2], linkEstado: { mode: 'nuevo' }, newType: 'series' });
    await N.nuevoTitulo('reading', 'Manga N', { subtype: 'manga' });
    N.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    await quiet(() => engine.syncOnce(CFG, S.T));
    const O = await vieja.dispositivo(uid, __setDatabasePath);
    O.usar();
    await quiet(() => vieja.engine.ensureInitialUpload(CFG_VIEJA));
    const p1 = await quiet(() => vieja.engine.syncOnce(CFG_VIEJA, S.T));
    const ob1 = await O.svc.db.getFirstAsync('SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    // La 1.3.9 edita la serie (la termina, sin saber del vínculo) y el título de lectura.
    const sO = (await O.svc.getSeriesByCategory(cat.id)).series.find((s) => s.name === 'Vinculada N');
    const mO = (await O.svc.getBacklogItems(uid, 'reading', 'Total')).data.find((b) => b.title === 'Manga N');
    const e1 = await quiet(() => O.svc.updateSeriesProgress(sO.id, 1, 2, 'Terminado'));
    const e2 = await quiet(() => O.svc.updateBacklogItem(mO.id, { title: 'Manga N editado', franchise: 'Otros' }));
    const p2 = await quiet(() => vieja.engine.syncOnce(CFG_VIEJA, S.T));
    const ob2 = await O.svc.db.getFirstAsync('SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    const srv = (await S.pg.query("select (select backlog_id is not null from public.series where id = $1) vinculo, (select subtype from public.backlog where id = $2) subtipo, (select title from public.backlog where id = $2) titulo", [sO.id, mO.id])).rows[0];
    // La app nueva baja los cambios de la 1.3.9 y reconcilia el título de la serie terminada.
    N.usar();
    const pn = await quiet(() => engine.syncOnce(CFG, S.T));
    const tN = await N.titulo('series', 'Vinculada N');
    const srvT = (await S.pg.query("select status from public.backlog where title = 'Vinculada N'")).rows[0].status;
    tabla('compatibilidad a', [{
        caso: 'pull y push de la 1.3.9; la nueva reconcilia',
        esperado: { pull: 'ok', outboxTrasPull: { raw: 0, blocked: 0 }, ediciones: [true, true], push: 'ok', outboxTrasPush: { raw: 0, blocked: 0 }, servidor: { vinculo: true, subtipo: 'manga', titulo: 'Manga N editado' }, nueva: 'ok', reconciliados: 1, estadoTitulo: ['Terminado', 'Terminado'] },
        obtenido: {
            pull: p1.status, outboxTrasPull: { raw: ob1.raw, blocked: ob1.blocked || 0 }, ediciones: [!!e1.success, !!e2.success], push: p2.status, outboxTrasPush: { raw: ob2.raw, blocked: ob2.blocked || 0 },
            servidor: srv, nueva: pn.status, reconciliados: pn.reconciledTitles, estadoTitulo: [tN.status, srvT],
        },
    }]);
    check('fromRemote de la 1.3.9 ignora las columnas desconocidas (lectura del código)', !('backlog_id' in vieja.mapping.fromRemote('series', { backlog_id: 'x', name: 'n' })) && !('subtype' in vieja.mapping.fromRemote('backlog', { subtype: 'book', title: 't' })));
}

seccion('15. Compatibilidad b: la app 1.4.0 contra un servidor SIN las columnas');
{
    const S = await servidor({ conNueva: false });
    const uid = '00000000-0000-4000-8000-000000007560';
    await nuevoUsuario(S, uid);
    const N = await entorno(uid);
    const cat = await N.crearCategoria({ type: 'video' });
    await N.guardar(cat, { name: 'Bloqueada', temporadas: [2], linkEstado: { mode: 'nuevo' }, newType: 'series' });
    await N.nuevoTitulo('reading', 'Lectura b', { subtype: 'book' });
    N.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const o1 = await quiet(() => engine.syncOnce(CFG, S.T));
    const bloqueadas = await D.all(N.dev, 'SELECT DISTINCT table_name t, block_reason r FROM outbox WHERE blocked_at IS NOT NULL');
    const cursores = await D.one(N.dev, 'SELECT COUNT(*) n FROM sync_state');
    // fromRemote/applyRemoteRows nunca escriben NULL encima de un backlog_id o subtype local: una fila
    // del servidor sin esas columnas (y sin cambios pendientes en local) actualiza solo lo que trae.
    const sN = await N.serie(cat, 'Bloqueada');
    const lN = await N.titulo('reading', 'Lectura b');
    await N.db.db.runAsync('DELETE FROM outbox WHERE row_id IN (?, ?)', [sN.id, lN.id]);
    const remotaSerie = { ...toRemote('series', (await D.one(N.dev, 'SELECT * FROM series WHERE id = ?', [sN.id]))), name: 'Renombrada en otro lado', server_updated_at: new Date().toISOString() };
    delete remotaSerie.backlog_id;
    const remotoTitulo = { ...toRemote('backlog', (await D.one(N.dev, 'SELECT * FROM backlog WHERE id = ?', [lN.id]))), title: 'Lectura b otra', server_updated_at: new Date().toISOString() };
    delete remotoTitulo.subtype;
    const res = { received: 0, applied: 0, skippedPending: 0, skippedSame: 0, merged: 0, conflicts: 0 };
    D.use(N.dev);
    await engine.applyRemoteRows('series', [remotaSerie], uid, res);
    await engine.applyRemoteRows('backlog', [remotoTitulo], uid, res);
    const tras = { serie: await D.one(N.dev, 'SELECT name, backlog_id FROM series WHERE id = ?', [sN.id]), titulo: await D.one(N.dev, 'SELECT title, subtype FROM backlog WHERE id = ?', [lN.id]) };
    const res2 = { received: 0, applied: 0, skippedPending: 0, skippedSame: 0, merged: 0, conflicts: 0 };
    await engine.applyRemoteRows('series', [remotaSerie], uid, res2);
    // Se aplica el SQL y "Reintentar" sube lo bloqueado.
    await S.aplicarNueva();
    N.usar();
    await N.db.db.runAsync("INSERT INTO outbox (table_name, row_id, op, created_at, attempts) VALUES ('series', ?, 'upsert', ?, 0), ('backlog', ?, 'upsert', ?, 0)", [sN.id, new Date().toISOString(), lN.id, new Date().toISOString()]);
    await quiet(() => engine.unblockAll());
    const o2 = await quiet(() => engine.syncOnce(CFG, S.T));
    const ob2 = await D.one(N.dev, 'SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    const srv = (await S.pg.query("select (select count(*)::int from public.series s join public.backlog b on b.id = s.backlog_id where s.id = $1) vinculo, (select subtype from public.backlog where id = $2) subtipo", [sN.id, lN.id])).rows[0];
    tabla('compatibilidad b', [{
        caso: 'servidor sin la migración → SQL → Reintentar',
        esperado: {
            ciclo: 'ok', pullDeLas15: true, bloqueadas: ['backlog', 'series'], motivo: true,
            noPisaNull: { serie: { name: 'Renombrada en otro lado', backlog_id: sN.backlog_id }, titulo: { title: 'Lectura b otra', subtype: 'book' } }, aplicadas: 2, segundaIgual: { applied: 0, skippedSame: 1 },
            trasSql: 'ok', outbox: { raw: 0, blocked: 0 }, servidor: { vinculo: 1, subtipo: 'book' },
        },
        obtenido: {
            ciclo: o1.status, pullDeLas15: o1.status === 'ok' && cursores.n > 0, bloqueadas: [...new Set(bloqueadas.map((b) => b.t))].filter((t) => t === 'backlog' || t === 'series').sort(), motivo: bloqueadas.filter((b) => b.t === 'backlog' || b.t === 'series').every((b) => /subtype|backlog_id|42703/.test(String(b.r))),
            noPisaNull: tras, aplicadas: res.applied, segundaIgual: { applied: res2.applied, skippedSame: res2.skippedSame },
            trasSql: o2.status, outbox: { raw: ob2.raw, blocked: ob2.blocked || 0 }, servidor: srv,
        },
    }]);
    check('primer ciclo contra el servidor viejo: termina, baja las 15 tablas y reporta bloqueadas (no se cuelga ni descarta nada)', o1.status === 'ok' && o1.push && o1.push.blocked > 0, JSON.stringify({ estado: o1.status, push: o1.push }));
}

// =============================================================================================
seccion('17. Borrar una categoría: todo lo demás igual que en c2c42c2');
{
    const REF_75 = 'c2c42c2';
    const app75 = await cargarAppVieja(REF_75, WORK);
    // El mismo escenario en una app cualquiera (svc + cómo activar su conexión): categoría con dos
    // períodos de ritmo, una pausa cerrada y una abierta, dos series sin vínculo con temporadas e
    // historial y, opcionalmente (solo la app nueva), una serie vinculada.
    const escenario = async (svc, usar, uid, { conVinculo = false } = {}) => {
        usar();
        const datos = { name: 'Categoría a borrar', type: 'video', startDate: dia(-9), daysOfWeek: todas(1), frequency: 0, seriesCount: 9, description: null };
        const cat = (await quiet(() => svc.addEntertainmentCategory(uid, datos))).id;
        await quiet(() => svc.updateEntertainmentCategory(cat, { ...datos, daysOfWeek: todas(2) }));
        await quiet(() => svc.pauseCategory(cat, dia(-5)));
        await quiet(() => svc.resumeCategory(cat, dia(-4)));
        await quiet(() => svc.pauseCategory(cat, dia(-1)));
        for (const name of ['S1', 'S2']) {
            await quiet(() => svc.addSeriesWithSeasons({ category_id: cat, name, description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 2 }, [{ season_number: 1, episode_count: 2 }, { season_number: 2, episode_count: 1 }]));
        }
        const s1 = (await svc.getSeriesByCategory(cat)).series.find((s) => s.name === 'S1');
        await quiet(() => svc.markEpisodesWatched(s1.id, 'video', [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], { season: 2, episode: 1, status: 'Mirando' }, Date.now()));
        if (conVinculo) await quiet(() => svc.addSeriesWithSeasons({ category_id: cat, name: 'Ligada', description: '', status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 2 }], { newTitle: { type: 'series', subtype: null, start_year: null } }));
        // Fase 7.5b1: la app c2c42c2 no tiene backlog_tags (TABLES es el de la app actual): tabla ausente = 0.
        const existe = async (t) => !!(await svc.db.getFirstAsync("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [t]));
        const vivos = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await existe(t)) ? (await svc.db.getFirstAsync(`SELECT COUNT(*) n FROM ${t} WHERE deleted_at IS NULL`)).n : 0])));
        await svc.db.runAsync('DELETE FROM outbox');
        const antes = await vivos();
        const r = await quiet(() => svc.deleteEntertainmentCategory(cat));
        const despues = await vivos();
        const ob = await svc.db.getAllAsync('SELECT table_name t, row_id r, COUNT(*) n FROM outbox GROUP BY table_name, row_id');
        const porTabla = {};
        for (const f of ob) porTabla[f.t] = (porTabla[f.t] || 0) + 1;
        const borradas = Object.fromEntries(TABLES.map((t) => [t, antes[t] - despues[t]]).filter(([, n]) => n !== 0));
        const restoDeLaCategoria = {
            categoria: (await svc.db.getFirstAsync('SELECT COUNT(*) n FROM entertainment_categories WHERE id = ? AND deleted_at IS NULL', [cat])).n,
            pausas: (await svc.db.getFirstAsync('SELECT COUNT(*) n FROM entertainment_pauses WHERE category_id = ? AND deleted_at IS NULL', [cat])).n,
            ritmo: (await svc.db.getFirstAsync('SELECT COUNT(*) n FROM entertainment_quotas_history WHERE category_id = ? AND deleted_at IS NULL', [cat])).n,
            series: (await svc.db.getFirstAsync('SELECT COUNT(*) n FROM series WHERE category_id = ? AND deleted_at IS NULL', [cat])).n,
            temporadas: (await svc.db.getFirstAsync('SELECT COUNT(*) n FROM seasons WHERE series_id IN (SELECT id FROM series WHERE category_id = ?) AND deleted_at IS NULL', [cat])).n,
            historial: (await svc.db.getFirstAsync('SELECT COUNT(*) n FROM watch_history WHERE series_id IN (SELECT id FROM series WHERE category_id = ?) AND deleted_at IS NULL', [cat])).n,
        };
        const tituloLigado = conVinculo ? await svc.db.getFirstAsync("SELECT status, deleted_at FROM backlog WHERE title = 'Ligada'") : null;
        return { ok: !!(r && r.success), borradas, outbox: { porTabla, unaPorFila: ob.every((f) => f.n === 1) }, restoDeLaCategoria, tituloLigado: tituloLigado && { estado: tituloLigado.status, vivo: !tituloLigado.deleted_at } };
    };
    const uid17 = '00000000-0000-4000-8000-000000007570';
    const O = await app75.dispositivo(uid17, __setDatabasePath);
    const viejo = await escenario(O.svc, O.usar, uid17);
    const N = await entorno(uid17);
    const nuevo = await escenario(N.db, N.usar, uid17);
    const N2 = await entorno(uid17);
    const nuevoConVinculo = await escenario(N2.db, N2.usar, uid17, { conVinculo: true });
    const nada = { categoria: 0, pausas: 0, ritmo: 0, series: 0, temporadas: 0, historial: 0 };
    tabla(`borrar una categoría frente a ${REF_75}`, [
        { caso: 'sin vinculados: mismas filas borradas y misma outbox que la 1.4.0', esperado: viejo, obtenido: nuevo },
        { caso: 'sin vinculados: no queda nada vivo de la categoría', esperado: nada, obtenido: nuevo.restoDeLaCategoria },
        { caso: 'con una vinculada: lo mismo, más su serie, y el título vuelve a Pendiente (vivo)', esperado: { ok: true, resto: nada, titulo: { estado: 'Pendiente', vivo: true }, backlogEnOutbox: 1, unaPorFila: true }, obtenido: { ok: nuevoConVinculo.ok, resto: nuevoConVinculo.restoDeLaCategoria, titulo: nuevoConVinculo.tituloLigado, backlogEnOutbox: nuevoConVinculo.outbox.porTabla.backlog || 0, unaPorFila: nuevoConVinculo.outbox.unaPorFila } },
    ]);
    check(`app 1.4.0 cargada de ${REF_75} (${app75.archivos} archivos de src/)`, app75.archivos > 50 && app75.migrations.LATEST_VERSION === 7);
}

// =============================================================================================
seccion('18. Reconciliación de la D5 corregida');
{
    const { reconcileLinkedTitles } = await import('../src/data/repositories/series.ts');
    const { mutate } = await import('../src/data/db/connection.ts');
    // (a) Dos dispositivos: A borra la categoría (el título vuelve a Pendiente) y B, sin red, edita el
    // título (sube la fila entera con Mirando, el estado viejo) después. Tras la sync de B, el título
    // queda en Pendiente en los dos y en el servidor; la segunda vuelta no escribe nada.
    const S = await servidor();
    const uid = '00000000-0000-4000-8000-000000007580';
    await nuevoUsuario(S, uid);
    const A = await entorno(uid);
    const cat = await A.crearCategoria({ type: 'video', name: 'D5 compartida' });
    await A.guardar(cat, { name: 'Título compartido', linkEstado: { mode: 'nuevo' }, newType: 'series' });
    A.usar(); await quiet(() => engine.ensureInitialUpload(CFG)); await quiet(() => engine.syncOnce(CFG, S.T));
    const B = await entorno(uid);
    B.usar(); await quiet(() => engine.ensureInitialUpload(CFG)); await quiet(() => engine.syncOnce(CFG, S.T));
    const tB = await B.titulo('series', 'Título compartido');
    A.usar();
    A.ok(await A.db.deleteEntertainmentCategory(cat.id), 'deleteEntertainmentCategory');
    await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar();
    B.ok(await B.db.updateBacklogItem(tB.id, { title: 'Título compartido', format: '40 min', franchise: 'Otros' }), 'updateBacklogItem');
    const ob = await quiet(() => engine.syncOnce(CFG, S.T));
    const srv = (await S.pg.query('select status, format from public.backlog where id = $1', [tB.id])).rows[0];
    A.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
    const cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    A.usar(); const a2 = await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar(); const b2 = await quiet(() => engine.syncOnce(CFG, S.T));
    const enA = await A.titulo('series', 'Título compartido');
    A.usar();
    const candA = (A.ok(await A.db.getBacklogCandidates(uid, 'video'), 'getBacklogCandidates')).data.map((b) => b.id);
    tabla('(a) borrar la categoría en A y editar el título en B sin red', [{
        caso: 'tras la sync: Pendiente en los dos y en el servidor, candidato del selector, segunda vuelta en 0',
        esperado: { reconciliados: 1, servidor: { status: 'Pendiente', format: '40 min' }, enA: { estado: 'Pendiente', vinculado: false, candidato: true }, identicos: true, segunda: [0, 0, 0, 0, 0, 0] },
        obtenido: {
            reconciliados: ob.reconciledTitles, servidor: srv, enA: { estado: enA.status, vinculado: link.isLinked(enA), candidato: candA.includes(enA.id) }, identicos: cmp.identical,
            segunda: [a2.remoteWrites, a2.localWrites, a2.reconciledTitles, b2.remoteWrites, b2.localWrites, b2.reconciledTitles],
        },
    }]);
    // (b) No se tocan: un Mirando sin ninguna serie vinculada (puesto a mano antes de la 7.5) y un
    // Terminado sin serie viva (puede ser a mano, D6).
    const C = await entorno(uid);
    const manual = await C.nuevoTitulo('series', 'Mirando de antes');
    await C.db.db.runAsync("UPDATE backlog SET status = 'Mirando' WHERE id = ?", [manual.id]); // simula la 1.3.9 (Mirando a mano)
    const catC = await C.crearCategoria({ type: 'video' });
    await C.guardar(catC, { name: 'Terminada a mano', linkEstado: { mode: 'nuevo' }, newType: 'anime' });
    const sT = await C.serie(catC, 'Terminada a mano');
    C.usar();
    C.ok(await C.db.updateSeriesProgress(sT.id, 1, 2, 'Terminado'), 'updateSeriesProgress');
    await C.db.db.runAsync('UPDATE series SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), sT.id]); // la serie se borra "por fuera"
    C.usar();
    const n = await mutate(() => reconcileLinkedTitles(uid));
    tabla('(b) lo que la reconciliación no toca', [{
        caso: 'Mirando sin ninguna serie vinculada y Terminado sin serie viva',
        esperado: { reconciliados: 0, mirandoManual: 'Mirando', terminado: 'Terminado' },
        obtenido: { reconciliados: n, mirandoManual: (await C.titulo('series', 'Mirando de antes')).status, terminado: (await C.titulo('anime', 'Terminada a mano')).status },
    }]);
    check('motor puro: titleStatusFor', igual([
        link.titleStatusFor({ current: 'Mirando', liveStatuses: [], deletedLinked: 1 }),
        link.titleStatusFor({ current: 'Terminado', liveStatuses: [], deletedLinked: 1 }),
        link.titleStatusFor({ current: 'Mirando', liveStatuses: [], deletedLinked: 0 }),
        link.titleStatusFor({ current: 'Pendiente', liveStatuses: ['Nueva'], deletedLinked: 1 }),
        link.titleStatusFor({ current: 'Mirando', liveStatuses: ['Terminado'], deletedLinked: 0 }),
        link.titleStatusFor({ current: 'Mirando', liveStatuses: ['Pausado'], deletedLinked: 2 }),
    ], ['Pendiente', null, null, 'Mirando', 'Terminado', null]));
}

// =============================================================================================
seccion('16. unblockAll ("Reintentar"): qué libera y qué no');
{
    const E = await entorno();
    E.usar();
    const futuro = new Date(Date.now() + 3600_000).toISOString();
    const ahora = new Date().toISOString();
    const sembrar = async (fila) => E.db.db.runAsync(
        'INSERT INTO outbox (table_name, row_id, op, created_at, attempts, last_error, next_attempt_at, blocked_at, block_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['backlog', fila.row, 'upsert', ahora, fila.attempts, fila.last_error, fila.next, fila.blocked_at || null, fila.block_reason || null]
    );
    await E.limpiarOutbox();
    await sembrar({ row: 'bloqueada', attempts: 3, last_error: 'columna inexistente (42703)', next: null, blocked_at: ahora, block_reason: 'columna inexistente (42703)' });
    await sembrar({ row: 'hija-padre-bloqueado', attempts: 2, last_error: engine.PARENT_BLOCKED, next: futuro });
    await sembrar({ row: 'red', attempts: 2, last_error: 'red · Network request failed (simulado)', next: futuro });
    await sembrar({ row: 'sesion', attempts: 1, last_error: 'JWT expired (401)', next: futuro });
    await sembrar({ row: 'padre-pendiente', attempts: 1, last_error: 'padre pendiente de subir', next: null });
    const leer = async () => Object.fromEntries((await E.db.db.getAllAsync('SELECT row_id, attempts, last_error, next_attempt_at, blocked_at FROM outbox ORDER BY id')).map((r) => [r.row_id, { attempts: r.attempts, last_error: r.last_error, next: r.next_attempt_at, bloqueada: !!r.blocked_at }]));
    const antes = await leer();
    const n = await quiet(() => engine.unblockAll());
    const despues = await leer();
    tabla('unblockAll', [
        { caso: 'devuelve las que estaban bloqueadas', esperado: 1, obtenido: n },
        { caso: 'bloqueada → liberada', esperado: { attempts: 0, next: null, bloqueada: false }, obtenido: { attempts: despues.bloqueada.attempts, next: despues.bloqueada.next, bloqueada: despues.bloqueada.bloqueada } },
        { caso: 'hija de un padre bloqueado → liberada', esperado: { attempts: 0, next: null }, obtenido: { attempts: despues['hija-padre-bloqueado'].attempts, next: despues['hija-padre-bloqueado'].next } },
        { caso: 'error de red, de sesión y "padre pendiente de subir": intactas', esperado: [antes.red, antes.sesion, antes['padre-pendiente']], obtenido: [despues.red, despues.sesion, despues['padre-pendiente']] },
    ]);
    // El motor escribe y compara la MISMA constante (exportada de engine.ts), nunca un texto copiado.
    const src = readFileSync('src/sync/engine.ts', 'utf8');
    const literal = "'el padre tiene un error bloqueado'";
    const usos = readdirSync('src', { recursive: true }).filter((f) => /\.(ts|js)$/.test(f)).map((f) => readFileSync(join('src', f), 'utf8').split(literal).length - 1).reduce((a, b) => a + b, 0);
    check('PARENT_BLOCKED: una sola definición exportada; markTransient y unblockAll usan la constante', engine.PARENT_BLOCKED === 'el padre tiene un error bloqueado'
        && /export const PARENT_BLOCKED = 'el padre tiene un error bloqueado';/.test(src) && usos === 1
        && /markTransient\(b\.g, PARENT_BLOCKED, 'parent'\)/.test(src) && /last_error = \?',\s*\[PARENT_BLOCKED\]/.test(src), `literales en src/: ${usos}`);
}

console.log(fallas === 0 ? `\nFASE 7.5: ${total} OK.` : `\n${fallas} de ${total} prueba(s) fallaron.`);
process.exit(fallas === 0 ? 0 : 1);
