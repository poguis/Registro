// Fase 7.3 — Equivalencia del motor puro de entretenimiento (src/entertainment/) con el código
// de las pantallas tal como estaba en d55b5e1 (referencia congelada: `git show d55b5e1:<pantalla>`,
// extraída con scripts/lib/extraer-pantalla.mjs). Resultado esperado: 0 diferencias.
//
// 1. Los 14 casos de probar-fase7-2: se ejecuta como subproceso (17 OK) y su bloque CASOS tiene
//    que ser idéntico al de d55b5e1 (el oráculo se generó con el código viejo).
// 2. Nivel puro: cola de video y de lectura (generateInterleavedList/generateEpisodesForSeries de
//    d55b5e1 frente a buildQueue/episodesForSeries) sobre entradas generadas con semilla fija.
// 3. Nivel pantalla (efectos): cada función de las 4 pantallas, VIEJA (d55b5e1) y NUEVA (árbol
//    actual, con el motor inyectado), con un db que registra cada llamada (método y argumentos,
//    en orden), stubs de Alert (título, mensaje, botones) y de cada setter/recarga; para cada
//    alerta con botones se prueba cada botón. Se comparan los registros completos.
// Ante una diferencia imprime la semilla, la familia, el índice y un caso mínimo (datos
// sintéticos). No usa la BD ni .local-data/.
//
// Uso: node scripts/probar-fase7-3.mjs [--semilla N] [--casos N]
import { extraer, instanciar } from './lib/extraer-pantalla.mjs'; // antes que test-hooks (ver el módulo)
import './lib/test-hooks.mjs';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

process.env.TZ = 'America/Guayaquil';
const REF = 'd55b5e1';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const SEMILLA = flag('--semilla', 0x7a3);
const CASOS = flag('--casos', 600);

const utils = await import('../src/services/backlogUtils.js');
const motorCola = await import('../src/entertainment/queue.ts');
const motorDetalle = await import('../src/entertainment/seriesDetail.ts');
const BASE = { ...utils, ...motorCola, ...motorDetalle };

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);

const P = {
    video: { registro: 'src/screens/ChapterRegistryScreen.js', detalle: 'src/screens/SeriesDetailScreen.js' },
    reading: { registro: 'src/screens/ReadingRegistryScreen.js', detalle: 'src/screens/ReadingDetailScreen.js' },
};

// =============================================================================================
// 1. Los 14 casos de probar-fase7-2
// =============================================================================================
section('1. Los 14 casos de probar-fase7-2 (oráculo generado con el código de d55b5e1)');
{
    const bloque = (t) => t.slice(t.indexOf('const CASOS = ['), t.indexOf('// 2. MECANISMO'));
    const viejo = bloque(execFileSync('git', ['show', `${REF}:scripts/probar-fase7-2.mjs`], { encoding: 'utf8' }));
    const nuevo = bloque(readFileSync('scripts/probar-fase7-2.mjs', 'utf8'));
    check(`bloque CASOS de probar-fase7-2 idéntico al de ${REF}`, viejo.length > 0 && viejo === nuevo, `${nuevo.length} caracteres`);
    const r = spawnSync(process.execPath, ['scripts/probar-fase7-2.mjs'], { encoding: 'utf8', timeout: 600000 });
    const oks = (r.stdout.match(/^OK/gm) || []).length;
    const fallas = (r.stdout.match(/^FALLA/gm) || []).length;
    check('probar-fase7-2 con el motor nuevo: 17 OK, 0 FALLA', r.status === 0 && oks === 17 && fallas === 0, `${oks} OK, ${fallas} FALLA`);
}

// =============================================================================================
// Generador con semilla fija (mulberry32) — datos SINTÉTICOS
// =============================================================================================
function mulberry32(a) {
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const ESTADOS = ['Nueva', 'Mirando', 'Pausado', 'En espera', 'Terminado'];
const DIAS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hoyMas = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return utils.getLocalDateString(d); };

function generarCaso(rng, variante) {
    const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const bool = (p = 0.5) => rng() < p;
    const nSeries = int(0, 6);
    const series = [];
    for (let i = 0; i < nSeries; i++) {
        const nTemp = int(1, 4);
        let seasons = Array.from({ length: nTemp }, (_, k) => ({ season_number: k + 1, episode_count: bool(0.12) ? 0 : int(1, 25) }));
        if (bool(0.1)) seasons = seasons.filter((_, k) => k !== int(0, nTemp - 1)); // temporada que falta
        series.push({
            id: `s${i}`, name: `Serie ${i}`, description: bool(0.3) ? null : 'desc', status: pick(ESTADOS),
            current_season: int(0, nTemp + 1), current_episode: int(0, 26),
            initial_season: bool(0.2) ? null : int(0, 2), initial_episode: bool(0.2) ? null : int(0, 3),
            total_seasons: bool(0.15) ? int(0, 5) : nTemp, sort_order: int(0, 4),
            cycle_offset: int(0, 5), interleave_offset: int(0, 5), last_watched_at: int(0, 3), seasons,
        });
    }
    const quotas = Object.fromEntries(DIAS.map((d) => [d, int(0, 3)]));
    const start = hoyMas(-int(0, 20));
    const categoria = {
        id: 'cat-1', name: 'Categoría', type: variante, start_date: start, days_of_week: quotas,
        frequency: variante === 'video' ? 0 : pick([1, 2, 3, -2, -3]), series_count: pick([null, undefined, 0, 1, 2, 3, 5]),
        is_paused: bool(0.3), pauses: bool(0.2) ? [{ pause_start: hoyMas(-int(1, 5)), pause_end: bool() ? null : hoyMas(-1) }] : [],
        quotas_history: [{ quotas, start_date: start, end_date: null }], totalWatched: int(0, 40),
    };
    // Lo que devuelve getFullWatchlist (video y lectura comparten la consulta).
    const watchlist = series.map((s) => ({
        s_id: s.id, s_name: s.name, status: s.status, current_season: s.current_season, current_episode: s.current_episode,
        initial_season: s.initial_season, initial_episode: s.initial_episode, total_seasons: s.total_seasons, sort_order: s.sort_order,
        cycle_offset: s.cycle_offset, interleave_offset: s.interleave_offset, last_watched_at: s.last_watched_at,
        c_id: 'cat-1', start_date: start, frequency: categoria.frequency, days_of_week: quotas, type: variante, seasons: s.seasons,
    }));
    const historial = Array.from({ length: int(0, 4) }, (_, k) => ({
        id: `h${k}`, series_id: pick(series.map((s) => s.id).concat('sx')), s_name: 'X', season_number: int(1, 3), episode_number: int(1, 9),
        watched_at: 1000 + k, read_at: 2000 + k,
    }));
    const filas = (n) => Array.from({ length: n }, (_, k) => ({ number: k + 1, episodes: pick(['', '0', '3', 'abc', '12', '1']) }));
    const ids = series.map((s) => s.id);
    return {
        variante, series, categoria, watchlist, historial,
        respuestas: { exito: bool(0.85), lecturasOk: bool(0.9) },
        form: {
            name: pick(['', '  ', 'Nueva serie']), seasons: filas(int(0, 3)), status: pick(ESTADOS),
            currentSeason: pick(['0', '1', '2', 'x', 1, 3]), currentEpisode: pick(['0', '1', '5', 'x', 1]),
            isEditing: bool(0.4), editingSeriesId: ids.length && bool(0.8) ? pick(ids) : 'zzz',
        },
        filasQuitar: filas(int(0, 3)),
        tab: pick(['Viendo', 'Viendo', 'En espera', 'Terminado']), indice: int(-1, nSeries + 1),
        toque: {
            seriesId: ids.length ? pick(ids) : 'zzz', sNum: int(0, 5), eNum: int(0, 26), ultimo: bool(0.3),
            activa: pick(['ninguna', 'misma', 'otra']),
        },
        reinicio: ids.length && bool(0.85) ? pick(ids) : null,
        pausa: ids.length ? pick(ids) : null,
        marcar: { modo: pick(['primero', 'otro', 'fantasma', 'primero']), indice: int(0, 30) },
        tabRegistro: pick(['pending', 'pending', 'watched']),
    };
}

// =============================================================================================
// Entorno de registro: db, Alert, setters y recargas que anotan todo, en orden
// =============================================================================================
const PROBE = { probe: true, current_season: 0, current_episode: 0, status: 'Probe' };
function normalizar(v, prof = 0) {
    if (prof > 12) return '…';
    if (v === undefined) return { __undef: true };
    if (typeof v === 'function') { try { return { __fn: normalizar(v(PROBE), prof + 1) }; } catch { return { __fn: 'lanza' }; } }
    if (v instanceof Error) return { __error: v.name };
    if (Array.isArray(v)) return v.map((x) => normalizar(x, prof + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizar(x, prof + 1)]));
    return v;
}
const clonar = (v) => structuredClone(v);

function crearMundo(caso, eleccion) {
    const reg = [];
    const anotar = (...e) => reg.push(e);
    const { respuestas } = caso;
    const respuestaDb = (m, args) => {
        switch (m) {
            case 'getSeriesByCategory': return { success: respuestas.lecturasOk, series: clonar(caso.series.map(({ seasons, ...s }) => s)) };
            case 'getSeasonsBySeries': return { success: respuestas.lecturasOk, seasons: clonar((caso.series.find((s) => s.id === args[0]) || { seasons: [] }).seasons) };
            case 'getFullWatchlist': return { success: respuestas.lecturasOk, data: clonar(caso.watchlist) };
            case 'getHistory': case 'getReadingHistory': return { success: respuestas.lecturasOk, data: clonar(caso.historial) };
            case 'getEntertainmentCategories': return { success: respuestas.lecturasOk, categories: clonar([caso.categoria]) };
            default: return { success: respuestas.exito };
        }
    };
    const db = new Proxy({}, { get: (_, m) => (...args) => { anotar('db', m, normalizar(args)); return Promise.resolve(respuestaDb(m, args)); } });
    const Alert = {
        alert: (titulo, mensaje, botones) => {
            anotar('alert', titulo, mensaje, botones ? botones.map((b) => [b.text, b.style || null]) : null);
            if (botones && eleccion) {
                const b = botones.find((x) => x.text === eleccion);
                if (b && b.onPress) { const r = b.onPress(); if (r && r.catch) r.catch((e) => anotar('rechazo', e.name)); }
            }
        },
    };
    const recarga = (nombre) => (...args) => { anotar('llamada', nombre, normalizar(args)); return Promise.resolve(); };
    const consola = { log: () => {}, error: () => anotar('console.error'), warn: () => {} };
    return { reg, db, Alert, recarga, consola };
}

// Dependencias de una función de pantalla: valores del caso, stubs que anotan y, si hace falta,
// otras funciones de la MISMA pantalla y versión (p. ej. getFilteredSeries, generateInterleavedList).
const RECARGAS = ['fetchSeries', 'loadData', 'refreshCategory', 'resetForm', 'loadItems'];
function construir(archivo, nombre, commit, mundo, valores, pila = []) {
    const ext = extraer(archivo, nombre, { commit });
    const deps = { ...BASE, db: mundo.db, Alert: mundo.Alert, console: mundo.consola, ...valores };
    for (const libre of ext.libres) {
        if (Object.hasOwn(deps, libre)) continue;
        if (/^set[A-Z]/.test(libre)) { deps[libre] = (v) => mundo.reg.push(['set', libre, normalizar(v)]); continue; }
        if (RECARGAS.includes(libre)) { deps[libre] = mundo.recarga(libre); continue; }
        if (pila.includes(libre)) continue;
        deps[libre] = construir(archivo, libre, commit, mundo, valores, [...pila, nombre]);
    }
    return instanciar(ext, deps);
}

const vaciar = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };

// Ejecuta `nombre` (vieja o nueva) en un mundo nuevo y devuelve el registro de efectos.
async function ejecutar(archivo, nombre, commit, caso, valores, args, eleccion) {
    const mundo = crearMundo(caso, eleccion);
    try {
        const fn = construir(archivo, nombre, commit, mundo, clonar(valores));
        const r = fn(...clonar(args));
        if (r && typeof r.then === 'function') await r;
        mundo.reg.push(['retorno', normalizar(r && typeof r.then === 'function' ? undefined : r)]);
    } catch (e) {
        if (/^extracción:/.test(e.message)) throw e;
        // La vieja y la nueva tienen que lanzar la MISMA excepción (tipo y mensaje) en el mismo punto.
        mundo.reg.push(['lanza', e.name, e.message]);
    }
    await vaciar();
    return mundo.reg;
}

// Cobertura de la familia en curso: cuántas comparaciones tuvieron escrituras, alertas o excepciones.
let cobertura = null;
const anotarCobertura = (reg) => {
    if (!cobertura) return;
    if (reg.some((e) => e[0] === 'db' && !/^get/.test(e[1]))) cobertura.escrituras++;
    if (reg.some((e) => e[0] === 'alert')) cobertura.alertas++;
    if (reg.some((e) => e[0] === 'lanza')) cobertura.lanza++;
};

// Compara vieja/nueva para cada botón posible de la primera alerta con botones.
async function comparar(archivo, nombre, caso, valores, args) {
    const base = await ejecutar(archivo, nombre, REF, caso, valores, args, null);
    const alerta = base.find((e) => e[0] === 'alert' && e[3]);
    const elecciones = [null, ...(alerta ? alerta[3].map((b) => b[0]) : [])];
    let n = 0;
    for (const eleccion of elecciones) {
        const viejo = eleccion === null ? base : await ejecutar(archivo, nombre, REF, caso, valores, args, eleccion);
        const nuevo = await ejecutar(archivo, nombre, null, caso, valores, args, eleccion);
        anotarCobertura(viejo);
        n++;
        const a = JSON.stringify(viejo), b = JSON.stringify(nuevo);
        if (a !== b) return { igual: false, n, eleccion, viejo, nuevo };
    }
    return { igual: true, n };
}

// =============================================================================================
// Familias: qué función y con qué estado/argumentos
// =============================================================================================
const FAMILIAS = [
    {
        id: 'cola (nivel puro)', puro: true,
        async correr(caso) {
            const v = caso.variante, archivo = P[v].registro;
            const mundo = crearMundo(caso, null);
            const viejaEps = construir(archivo, 'generateEpisodesForSeries', REF, mundo, {});
            const viejaCola = construir(archivo, 'generateInterleavedList', REF, mundo, { generateEpisodesForSeries: viejaEps });
            const a = JSON.stringify(viejaCola(clonar(caso.watchlist)));
            const b = JSON.stringify(motorCola.buildQueue(clonar(caso.watchlist), v));
            if (a !== b) return { igual: false, n: 1, viejo: a, nuevo: b };
            // episodesForSeries directamente: solo video (en lectura, la serie cerrada se filtra en la cola).
            if (v === 'video') {
                for (const s of caso.watchlist) {
                    const x = JSON.stringify(viejaEps(clonar(s))), y = JSON.stringify(motorCola.episodesForSeries(clonar(s), 'video'));
                    if (x !== y) return { igual: false, n: 2, viejo: x, nuevo: y };
                }
            }
            return { igual: true, n: 1 + (v === 'video' ? caso.watchlist.length : 0) };
        },
    },
    {
        id: 'registro: loadData', async correr(caso) {
            const v = caso.variante;
            const val = v === 'video'
                ? { user: { id: 'u' }, category: caso.categoria, tab: caso.tabRegistro, currentCategory: caso.categoria }
                : { user: { id: 'u' }, category: caso.categoria, currentTab: caso.tabRegistro };
            return comparar(P[v].registro, 'loadData', caso, val, []);
        },
    },
    {
        id: 'registro: onMarkWatched', async correr(caso) {
            const v = caso.variante;
            const items = motorCola.buildQueue(clonar(caso.watchlist), v);
            let item;
            if (caso.marcar.modo === 'fantasma' || items.length === 0) item = { uniqueId: 'fx', seriesId: 'sx', seriesName: 'X', season: 1, episode: 1, status: 'pending' };
            else if (caso.marcar.modo === 'primero') { const idsS = [...new Set(items.map((i) => i.seriesId))]; const sid = idsS[caso.marcar.indice % idsS.length]; item = items.find((i) => i.seriesId === sid); }
            else item = items[caso.marcar.indice % items.length];
            return comparar(P[v].registro, 'onMarkWatched', caso, { rawSeries: caso.watchlist, items }, [item]);
        },
    },
    {
        id: 'registro: onUnmarkWatched', async correr(caso) {
            const v = caso.variante;
            const item = { uniqueId: 'u1', seriesId: caso.series[0]?.id || 'sx', season: caso.toque.sNum, episode: caso.toque.eNum, status: 'watched' };
            return comparar(P[v].registro, 'onUnmarkWatched', caso, {}, [item]);
        },
    },
    {
        id: 'detalle: fetchSeries', async correr(caso) {
            return comparar(P[caso.variante].detalle, 'fetchSeries', caso, { category: caso.categoria }, []);
        },
    },
    {
        id: 'detalle: handleSave', async correr(caso) {
            const f = caso.form;
            return comparar(P[caso.variante].detalle, 'handleSave', caso, {
                name: f.name, description: 'd', status: f.status, seasons: f.seasons, currentSeason: f.currentSeason, currentEpisode: f.currentEpisode,
                isEditing: f.isEditing, editingSeriesId: f.editingSeriesId, originalList: caso.series, category: caso.categoria,
            }, []);
        },
    },
    {
        id: 'detalle: handleAddSeason / handleRemoveSeason', async correr(caso) {
            const a = await comparar(P[caso.variante].detalle, 'handleAddSeason', caso, { seasons: caso.form.seasons }, []);
            if (!a.igual) return a;
            const b = await comparar(P[caso.variante].detalle, 'handleRemoveSeason', caso, { seasons: caso.filasQuitar }, []);
            return b.igual ? { igual: true, n: a.n + b.n } : b;
        },
    },
    {
        id: 'detalle: updateToChapter', async correr(caso) {
            const t = caso.toque;
            const objetivo = caso.series.find((s) => s.id === t.seriesId);
            let sNum = t.sNum, eNum = t.eNum;
            if (t.ultimo && objetivo) { sNum = objetivo.total_seasons; eNum = objetivo.seasons.find((s) => s.season_number === objetivo.total_seasons)?.episode_count || 0; }
            const activeSeries = t.activa === 'ninguna' ? null : t.activa === 'misma' ? (objetivo || null) : (caso.series.find((s) => s.id !== t.seriesId) || null);
            return comparar(P[caso.variante].detalle, 'updateToChapter', caso, { activeSeries, originalList: caso.series }, [t.seriesId, sNum, eNum]);
        },
    },
    {
        id: 'detalle: handleRestart', async correr(caso) {
            const activeSeries = caso.reinicio ? caso.series.find((s) => s.id === caso.reinicio) : null;
            return comparar(P[caso.variante].detalle, 'handleRestart', caso, { activeSeries }, []);
        },
    },
    {
        id: 'detalle: handleTogglePauseSeries', async correr(caso) {
            if (!caso.pausa) return { igual: true, n: 0 };
            const s = caso.series.find((x) => x.id === caso.pausa);
            return comparar(P[caso.variante].detalle, 'handleTogglePauseSeries', caso, { originalList: caso.series }, [s]);
        },
    },
    {
        id: 'detalle: handleTogglePauseCategory', async correr(caso) {
            return comparar(P[caso.variante].detalle, 'handleTogglePauseCategory', caso, { currentCategory: caso.categoria }, []);
        },
    },
    {
        id: 'detalle: moveUp / moveDown / getFilteredSeries', async correr(caso) {
            const val = { originalList: caso.series, currentStatusTab: caso.tab };
            let n = 0;
            for (const nombre of ['moveUp', 'moveDown']) {
                const r = await comparar(P[caso.variante].detalle, nombre, caso, val, [caso.indice]);
                if (!r.igual) return r;
                n += r.n;
            }
            const r = await comparar(P[caso.variante].detalle, 'getFilteredSeries', caso, val, []);
            return r.igual ? { igual: true, n: n + r.n } : r;
        },
    },
    {
        id: 'atraso: calculateHeaderBacklog / calculateGlobalBacklog', async correr(caso) {
            const v = caso.variante;
            const a = await comparar(P[v].detalle, 'calculateHeaderBacklog', caso, { originalList: caso.series, currentCategory: caso.categoria }, []);
            if (!a.igual || v !== 'video') return a;
            const b = await comparar(P[v].registro, 'calculateGlobalBacklog', caso, { currentCategory: caso.categoria }, [caso.watchlist, caso.categoria]);
            return b.igual ? { igual: true, n: a.n + b.n } : b;
        },
    },
];

// Caso mínimo: quita series (y sus filas derivadas) mientras la diferencia persista.
async function reducir(familia, caso) {
    let actual = caso;
    for (let cambio = true; cambio;) {
        cambio = false;
        for (let i = 0; i < actual.series.length; i++) {
            const prueba = clonar(actual);
            const id = prueba.series[i].id;
            prueba.series.splice(i, 1);
            prueba.watchlist = prueba.watchlist.filter((w) => w.s_id !== id);
            let r;
            try { r = await familia.correr(prueba); } catch { continue; }
            if (!r.igual) { actual = prueba; cambio = true; break; }
        }
    }
    return actual;
}

// =============================================================================================
// 2 y 3. Equivalencia sobre entradas generadas
// =============================================================================================
section(`2-3. Equivalencia con ${REF} sobre ${CASOS} entradas generadas por variante (semilla ${SEMILLA})`);
for (const familia of FAMILIAS) {
    let ejecuciones = 0, casosOk = 0, diferencia = null;
    cobertura = { escrituras: 0, alertas: 0, lanza: 0 };
    for (const variante of ['video', 'reading']) {
        const rng = mulberry32(SEMILLA ^ (variante === 'video' ? 0 : 0x5eed));
        for (let i = 0; i < CASOS && !diferencia; i++) {
            const caso = generarCaso(rng, variante);
            let r;
            try { r = await familia.correr(caso); } catch (e) { r = { igual: false, n: 0, error: e.message }; }
            if (!r.igual) { diferencia = { variante, i, caso, r }; break; }
            ejecuciones += r.n; casosOk++;
        }
        if (diferencia) break;
    }
    if (!diferencia) {
        const cob = familia.puro ? '' : ` (con escrituras ${cobertura.escrituras}, con alertas ${cobertura.alertas}, con excepción ${cobertura.lanza})`;
        check(`${familia.id}: ${casosOk} casos (video + lectura), ${ejecuciones} comparaciones${cob}, 0 diferencias`, true);
    } else {
        const minimo = diferencia.r.error ? diferencia.caso : await reducir(familia, diferencia.caso);
        const r = diferencia.r.error ? diferencia.r : await familia.correr(minimo);
        check(`${familia.id}: diferencia`, false,
            `semilla ${SEMILLA}, ${diferencia.variante}, caso #${diferencia.i}${r.eleccion !== undefined ? `, botón ${JSON.stringify(r.eleccion)}` : ''}${r.error ? `, error: ${r.error}` : ''}`);
        console.log('     caso mínimo (sintético):', JSON.stringify({ series: minimo.series, categoria: minimo.categoria, form: minimo.form, toque: minimo.toque, tab: minimo.tab, indice: minimo.indice, marcar: minimo.marcar, respuestas: minimo.respuestas }));
        if (!r.error) {
            console.log('     viejo:', typeof r.viejo === 'string' ? r.viejo.slice(0, 600) : JSON.stringify(r.viejo).slice(0, 600));
            console.log('     nuevo:', typeof r.nuevo === 'string' ? r.nuevo.slice(0, 600) : JSON.stringify(r.nuevo).slice(0, 600));
        }
    }
}

cobertura = null;

// Controles negativos: el comparador detecta un cambio deliberado (no pasa sin probar nada).
section('Controles negativos del comparador');
{
    // a) Cola: la variante equivocada (lectura en vez de video) tiene que dar alguna diferencia.
    const rng = mulberry32(SEMILLA);
    let detectadas = 0;
    for (let i = 0; i < CASOS; i++) {
        const caso = generarCaso(rng, 'video');
        const mundo = crearMundo(caso, null);
        const eps = construir(P.video.registro, 'generateEpisodesForSeries', REF, mundo, {});
        const vieja = construir(P.video.registro, 'generateInterleavedList', REF, mundo, { generateEpisodesForSeries: eps });
        if (JSON.stringify(vieja(clonar(caso.watchlist))) !== JSON.stringify(motorCola.buildQueue(clonar(caso.watchlist), 'reading'))) detectadas++;
    }
    check(`cola: usar la variante de lectura en video se detecta (${detectadas} de ${CASOS} casos)`, detectadas > 0);
    // b) Efectos: moveUp frente a moveDown (de d55b5e1) con la misma entrada tienen que diferir a veces.
    const rng2 = mulberry32(SEMILLA + 1);
    let difieren = 0;
    for (let i = 0; i < CASOS; i++) {
        const caso = generarCaso(rng2, 'video');
        const val = { originalList: caso.series, currentStatusTab: 'Viendo' };
        const a = await ejecutar(P.video.detalle, 'moveUp', REF, caso, val, [1], null);
        const b = await ejecutar(P.video.detalle, 'moveDown', REF, caso, val, [1], null);
        if (JSON.stringify(a) !== JSON.stringify(b)) difieren++;
    }
    check(`efectos: el registro distingue moveUp de moveDown (${difieren} de ${CASOS} casos)`, difieren > 0);
}

// =============================================================================================
// 4. Las pantallas de registro ya no contienen la cola
// =============================================================================================
section('4. La lógica movida ya no está en las pantallas');
{
    const PATRON = /generateInterleavedList|generateEpisodesForSeries|BATCH_SIZE|interleavedOrder|maxInterleave|additionalInterleave/;
    const restos = Object.values(P).flatMap((p) => [p.registro, p.detalle]).filter((f) => PATRON.test(readFileSync(f, 'utf8')));
    check('las 4 pantallas ya no definen la cola ni los cálculos de intercalado (solo llaman al motor)', restos.length === 0, restos.join(', '));
    const usan = Object.values(P).every((p) => /buildQueue\(/.test(readFileSync(p.registro, 'utf8')) && /from '\.\.\/entertainment\/seriesDetail'/.test(readFileSync(p.detalle, 'utf8')));
    check('los registros llaman a buildQueue y los detalles importan seriesDetail', usan);
}

console.log(failures === 0 ? '\nTODAS LAS PRUEBAS DE LA FASE 7.3 PASARON (0 diferencias).' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
