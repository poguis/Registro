// Fase 7.2 — Pruebas de CARACTERIZACIÓN del módulo de entretenimiento (Pendiente, Series/Anime,
// Lectura). Describen lo que la app hace HOY, no lo que debería hacer: si el comportamiento
// cambia, la prueba falla y hay que decidir si el cambio es intencional.
//
// - Código real: la fachada src/services/db.js (repositorios + node:sqlite con el shim de las
//   suites), src/services/backlogUtils.js y las funciones de las PANTALLAS, que no se pueden
//   importar (son closures de componentes React con JSX): se EXTRAEN del archivo con
//   @babel/parser (+ @babel/traverse para el análisis de alcance), dependencias transitivas de
//   Expo ya presentes en node_modules (no están en package.json), y se evalúan con new Function
//   inyectando sus dependencias (fachada real, funciones reales de backlogUtils y stubs del
//   estado de React y de Alert). Si una función no se encuentra, no se puede evaluar o usa una
//   dependencia no provista, FALLA con el archivo, el nombre y la línea.
// - Fase 7.3: la extracción vive en scripts/lib/extraer-pantalla.mjs (la comparte probar-fase7-3).
//   Las pantallas llaman ahora al motor puro (src/entertainment/queue.ts y seriesDetail.ts), que
//   se inyecta como dependencia real, igual que backlogUtils. La cola ya no es una función de la
//   pantalla: se obtiene con el loadData real de cada registro (que llama a buildQueue).
// - Datos: SOLO sintéticos, en una BD nueva en un temporal del sistema (nunca .local-data/).
// - Las tablas CASOS (entrada → resultado actual) están separadas del mecanismo para servir de
//   oráculo cuando esta lógica se mueva a módulos puros.
// - Fechas relativas a hoy en America/Guayaquil (calculateBacklog usa new Date()).
//
// Uso: node scripts/probar-fase7-2.mjs [--descubrir]
//   --descubrir  imprime el resultado actual de cada caso en JSON (para regenerar el oráculo)
//
// extraer-pantalla.mjs (que carga @babel/*) se importa ANTES que test-hooks.mjs: los hooks
// convierten los .json en módulos ESM y @babel/traverse hace require() de JSON internos.
import { extraer as extraerPantalla, instanciar as instanciarPantalla, extraidas } from './lib/extraer-pantalla.mjs';
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TZ = 'America/Guayaquil'; // antes de cualquier Date (ningún import crea fechas al cargarse)

const DESCUBRIR = process.argv.includes('--descubrir');

const { createDevices, quiet } = await import('./lib/sync-devices.mjs');
const utils = await import('../src/services/backlogUtils.js');
const motorCola = await import('../src/entertainment/queue.ts');
const motorDetalle = await import('../src/entertainment/seriesDetail.ts');
const { calculateBacklog, calculateBacklogV2, getQuotasForDate, getLocalDateString, getWatchedCountSinceStart, getAbsoluteEpisodeCount } = utils;

// =============================================================================================
// 1. ORÁCULO: casos (entrada → resultado actual). "comportamiento" es la frase que se imprime.
//    Etiquetas de capítulo: "<serie>·T<temporada>E<capítulo>". Fechas como "hoy±N".
// =============================================================================================
const CASOS = [
    {
        id: 'C1', titulo: 'Rotación con 5 series (1 temporada × 4 caps), cuota N=1 y N=2 por día',
        entrada: { series: ['S1', 'S2', 'S3', 'S4', 'S5'], capitulos: 4, cuotas: [1, 2] },
        actual: {
            cola10: ['S1·T1E1', 'S2·T1E1', 'S3·T1E1', 'S4·T1E1', 'S5·T1E1', 'S1·T1E2', 'S2·T1E2', 'S3·T1E2', 'S4·T1E2', 'S5·T1E2'],
            colaIgualConN2: true, sortOrder: [1, 2, 3, 4, 5], interleaveOffset: [0, 0, 0, 0, 0],
            atrasoHoyN1: 1, atrasoHoyN2: 2,
        },
        comportamiento: 'la cola es round-robin de 1 capítulo por serie en sort_order; N (cuota diaria) NO cambia el orden, solo cuántos de los primeros se marcan como atraso',
    },
    {
        id: 'C2', titulo: 'Serie agregada a mitad de ciclo (tras ver 7 capítulos de 5 series)',
        entrada: { vistosAntes: 7, nueva: 'S6' },
        actual: {
            progresoAntes: { S1: 2, S2: 2, S3: 1, S4: 1, S5: 1 },
            S6: { sortOrder: 6, interleaveOffset: 2, sortOrderPedidoPorPantalla: 6 },
            cola12: ['S3·T1E2', 'S4·T1E2', 'S5·T1E2', 'S1·T1E3', 'S2·T1E3', 'S3·T1E3', 'S4·T1E3', 'S5·T1E3', 'S6·T1E1', 'S1·T1E4', 'S2·T1E4', 'S3·T1E4'],
            atrasoAntes: 3, atrasoDespues: 3,
        },
        comportamiento: 'la serie nueva recibe interleave_offset = máximo progreso de las activas: entra al final de la vuelta SIGUIENTE (tras S5·T1E3), no al final de la vuelta actual; el atraso de la categoría no cambia',
    },
    {
        id: 'C3', titulo: 'Pausar y reanudar una serie (S2) a mitad de ciclo',
        entrada: { pausar: 'S2', vistosDuranteLaPausa: 5 },
        actual: {
            colaEnPausa5: ['S3·T1E2', 'S4·T1E2', 'S5·T1E2', 'S1·T1E3', 'S3·T1E3'],
            totalVistoSegunPantalla: { registroCapitulos: 10, detalleSerie: 12, listaCategorias: 12 },
            interleaveS2: { antes: 0, despues: 1 },
            colaTrasReanudar6: ['S4·T1E3', 'S5·T1E3', 'S1·T1E4', 'S2·T1E3', 'S3·T1E4', 'S4·T1E4'],
        },
        comportamiento: 'la serie pausada sale de la cola; al reanudar, interleave_offset sube hasta igualar al más avanzado y vuelve detrás de él; mientras está pausada, el Registro de capítulos (getFullWatchlist excluye "Pausado") deja de contar su progreso y muestra más atraso que el detalle y la lista de categorías',
    },
    {
        id: 'C4', titulo: 'Cambiar la cuota de dos días de la semana (hoy y ayer) en una categoría de video',
        entrada: { inicio: 'hoy-9', cuotas: 'todas 1', cambio: { diaDeHoy: 3, diaDeAyer: 5 } },
        actual: {
            pasadoIgual: true, cuotaHoy: { antes: 1, despues: 3 }, cuotaAyer: { antes: 1, despues: 1 },
            metaAntes: 10, metaDespues: 12,
            historial: { registros: 2, primeroCierra: 'hoy-1', segundoAbre: 'hoy' },
            segundaEdicionMismoDia: { registros: 3, registroSinDias: true },
        },
        comportamiento: 'editar las cuotas cierra el período vigente AYER y abre uno nuevo HOY: el pasado no cambia y el cambio rige ya para hoy; editar dos veces el mismo día deja un registro vacío (inicio hoy, fin ayer)',
    },
    {
        id: 'C5', titulo: 'Saldo adelantado (video, cuota 1 diaria, 5 días, 8 vistos)',
        entrada: { inicio: 'hoy-4', cuota: 1, vistos: 8 },
        actual: { meta: 5, atrasoCaps: 0, adelantoCaps: 3, adelantoDias: 3, atrasoDias: 0 },
        comportamiento: 'adelanto = vistos − meta; los días de adelanto se cuentan hacia adelante desde mañana con las cuotas vigentes',
    },
    {
        id: 'C6', titulo: 'Marcar el último capítulo de la última temporada (1×2) en el Registro de capítulos',
        entrada: { temporadas: [2] },
        actual: {
            alerta: { titulo: '¡Completada!', botones: ['En espera', 'Terminado', 'Cancelar'] },
            terminado: { status: 'Terminado', T: 1, E: 2, vistos: 2, enCola: false, historial: 2 },
            enEspera: { status: 'En espera', T: 1, E: 2, vistos: 2, enCola: false, historial: 2 },
            cancelar: { status: 'Mirando', T: 1, E: 2, vistos: 1, enCola: true, historial: 1 },
        },
        comportamiento: 'al marcar el último capítulo pregunta "En espera" o "Terminado"; el puntero se queda en el último capítulo y el estado cerrado suma +1 al conteo; Cancelar no guarda nada',
    },
    {
        id: 'C7', titulo: 'Serie terminada 6×20: agregar el capítulo 21 a la T6 y, aparte, una T7 nueva',
        entrada: { temporadas: '6 × 20', agregarCap: 21, nuevaTemporada: 10 },
        actual: {
            terminada: { status: 'Terminado', T: 6, E: 20, vistos: 120 },
            con21: { status: 'Terminado', T: 6, E: 20, total: 6, vistos: 120, enCola: false },
            tocarCap21: { botones: ['En espera', 'Terminado', 'Cancelar'], conTerminado: { status: 'Terminado', T: 6, E: 21, vistos: 121 } },
            tocarCap20: { status: 'Mirando', T: 6, E: 20, vistos: 119, colaPrimero: 'Serie·T6E20' },
            conT7: { status: 'Terminado', T: 6, E: 20, total: 7, vistos: 120, enCola: false },
            tocarT7C1: { status: 'Mirando', T: 7, E: 1, vistos: 120, colaPrimero: 'Serie·T7E1' },
        },
        comportamiento: 'editar una serie terminada no la reanuda (sigue Terminado y fuera de la cola); para el cap. 21 la única vía (tocarlo en la grilla) lo da por VISTO al cerrarla otra vez, y tocar el 20 lo vuelve a "no visto" (−1); una temporada nueva sí se reanuda bien tocando su C1',
    },
    {
        id: 'C8', titulo: 'Lectura: obra de 2 partes × 2 tomos, frecuencia 2 por día; y "1 cada 3 días"',
        entrada: { partes: [2, 2], frecuencia: 2, inicio: 'hoy-2', frecuenciaNegativa: -3, inicioNegativa: 'hoy-8' },
        actual: {
            cola: ['Obra·T1E1', 'Obra·T1E2', 'Obra·T2E1', 'Obra·T2E2'],
            alertaFinal: { titulo: '¡Completada!', botones: ['En espera', 'Terminado', 'Cancelar'] },
            final: { status: 'Terminado', T: 2, E: 2, vistos: 4, historialLectura: 4, historialVideo: 0 },
            metaFrecuencia2: { meta: 6, atraso: 2, unidad: 'Tomos' },
            metaUnoCada3: { meta: 3, diasValidos: 9 },
        },
        comportamiento: 'lectura usa las mismas columnas que video (temporada = parte, capítulo = tomo) y el mismo algoritmo de cola; la meta es días activos × frecuencia (o días/N con frecuencia negativa) y la unidad mostrada es "Tomos"',
    },
    {
        id: 'C9', titulo: 'Hipótesis: ¿cambiar frecuencia o fecha de inicio recalcula el pasado?',
        entrada: { lectura: { inicio: 'hoy-9', frecuencia: '2 → 3', inicioNuevo: 'hoy-19' }, video: { inicio: 'hoy-9', inicioAntes: 'hoy-19', inicioDespues: 'hoy-4' } },
        actual: {
            lecturaFrecuencia: { metaAntes: 20, metaDespues: 30, historialCambia: false },
            lecturaInicio: { metaAntes: 20, metaDespues: 40, historialCambia: false },
            videoInicioAntes: { metaAntes: 10, metaDespues: 20 },
            videoInicioDespues: { metaAntes: 10, metaDespues: 5 },
        },
        comportamiento: 'SÍ: frecuencia (lectura) y fecha de inicio (lectura y video) no tienen historial; cambiarlas recalcula toda la meta desde el inicio (solo las cuotas por día tienen historial)',
    },
    {
        id: 'C10', titulo: 'Punto de inicio: T0C1, T1C0 (estado Nueva) y T0C1 con estado Mirando',
        entrada: { formas: ['Nueva T0C1', 'Nueva T1C0', 'Mirando T0C1'] },
        actual: {
            nuevaT0C1: { guardado: { T: 0, E: 1, inicialT: 0, inicialE: 1 }, colaPrimero: 'A·T1E1', vistos: 0 },
            nuevaT1C0: { guardado: { T: 1, E: 0, inicialT: 1, inicialE: 0 }, colaPrimero: 'B·T1E1', vistos: 0 },
            mirandoT0C1: { alerta: 'Temporada fuera de rango', guardada: false },
            temporadasDelFormulario: 'numeradas desde 1',
        },
        comportamiento: 'no hay temporada 0 ni capítulo 0 reales: con estado Nueva se guardan sin validar pero la cola y el conteo los tratan como T1E1; con Mirando se rechazan; las temporadas del formulario empiezan en 1',
    },
    {
        id: 'C11', titulo: 'Volver a ver (Reiniciar)',
        entrada: { casos: ['Terminado 1×3', 'empezada en T2E1 (2×2)', 'En espera 1×3'] },
        actual: {
            desdeTerminado: { cycleOffset: 3, T: 1, E: 1, status: 'Mirando', vistosAntes: 3, vistosDespues: 3, inicial: 'T1E1' },
            empezadaEnT2: { vistosAntes: 2, cycleOffset: 2, inicial: 'T2E1', vistosTrasVerT1Completa: 2 },
            desdeEnEspera: { vistosAntes: 3, cycleOffset: 2, vistosDespues: 2 },
        },
        comportamiento: 'Reiniciar suma lo visto a cycle_offset y vuelve a T1E1 en "Mirando" sin tocar initial_season/episode: si la serie empezó a mitad, ver de nuevo la parte anterior al inicio no cuenta; desde "En espera" pierde 1 (no suma el último capítulo, que sí contaba)',
    },
    {
        id: 'C12', titulo: 'Límite de series activas (series_count)',
        entrada: { limites: [null, 0, 2] },
        actual: {
            sinLimite: { guardadas: 3, alertas: [] },
            limiteCero: { guardadas: 0, alertas: ['Límite Alcanzado'] },
            limiteDos: { guardadas: 2, alertas: ['Límite Alcanzado'] },
            formularioCategoria: { ceroSeGuardaComo: 0, vacioSeGuardaComo: null, ceroAlReabrirSeMuestra: '' },
        },
        comportamiento: 'series_count NULL = sin límite; 0 bloquea TODA serie nueva (el esquema dice "0 = sin límite"); al reabrir el formulario un 0 se muestra vacío y al guardar pasa a NULL',
    },
    {
        id: 'C13', titulo: 'Pendiente (backlog) frente a series',
        entrada: { tipo: 'series' },
        actual: {
            cicloEstados: ['Pendiente', 'Mirando', 'Terminado', 'Pendiente'],
            filasBacklogTrasCrearSerie: 0, seriesTrasCambiarBacklog: 1, statusSerieSinCambio: 'Nueva',
        },
        comportamiento: 'Pendiente es una lista independiente: el botón de estado rota Pendiente → Mirando → Terminado → Pendiente y no toca series; crear una serie no crea nada en Pendiente',
    },
    {
        id: 'C14', titulo: 'Pausa de categoría (video, cuota 1 diaria desde hoy-6)',
        entrada: { pausa: 'hoy-3 → hoy-2', mismoDia: 'pausar hoy y reanudar hoy' },
        actual: { metaSinPausa: 7, metaConPausa: 5, mismoDia: { metaAntes: 7, metaDespues: 7, pausaFinAntesDeInicio: true } },
        comportamiento: 'los días dentro de una pausa no suman cuota; pausar y reanudar el mismo día (la pantalla reanuda con fecha de ayer) deja una pausa con fin anterior al inicio y no excluye nada',
    },
];

// =============================================================================================
// 2. MECANISMO: extracción del código real de las pantallas del árbol actual
//    (scripts/lib/extraer-pantalla.mjs: @babel/parser + @babel/traverse)
// =============================================================================================
// Busca la función en el archivo y devuelve su texto y su análisis de alcance: identificadores
// libres (closures/imports), globales y métodos de db.
const extraer = (archivo, nombre) => extraerPantalla(archivo, nombre);

// Evalúa la función extraída con sus dependencias. Exige que estén TODAS las libres. Los imports
// que use la pantalla se inyectan siempre con la versión REAL: backlogUtils y, desde la 7.3, el
// motor puro (src/entertainment/queue.ts y seriesDetail.ts).
function instanciar(ext, depsDelCaso) {
    return instanciarPantalla(ext, { ...utils, ...motorCola, ...motorDetalle, ...depsDelCaso });
}

const PANTALLA = {
    registro: 'src/screens/ChapterRegistryScreen.js',
    detalle: 'src/screens/SeriesDetailScreen.js',
    registroLectura: 'src/screens/ReadingRegistryScreen.js',
    detalleLectura: 'src/screens/ReadingDetailScreen.js',
    categorias: 'src/screens/SeriesAnimeScreen.js',
    pendiente: 'src/screens/BacklogScreen.js',
};

// Alert de React Native: registra cada alerta y, si se eligió un botón, ejecuta su onPress.
function crearAlert() {
    const registro = [];
    let eleccion = null, pendiente = null;
    return {
        Alert: {
            alert: (titulo, mensaje, botones) => {
                registro.push({ titulo, botones: botones ? botones.map((b) => b.text) : [], mensaje });
                if (botones && eleccion) {
                    const b = botones.find((x) => x.text === eleccion);
                    if (b && b.onPress) pendiente = b.onPress();
                }
            },
        },
        registro,
        elegir(x) { eleccion = x; },
        async esperar() { const p = pendiente; pendiente = null; if (p) await p; },
    };
}

// Promesa que resuelve la próxima vez que la pantalla "recarga" (loadData / fetchSeries).
function crearRecarga() {
    let resolver = null;
    return {
        fn: () => { if (resolver) { const r = resolver; resolver = null; r(); } },
        esperar: (ms = 5000) => new Promise((res, rej) => {
            resolver = res;
            setTimeout(() => rej(new Error('la pantalla no recargó a tiempo')), ms).unref();
        }),
    };
}

// =============================================================================================
// 3. ENTORNO: BD sintética nueva por caso, fachada real y "pantallas" extraídas
// =============================================================================================
const WORK = join(tmpdir(), 'registro-pruebas-fase7-2').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const D = createDevices(WORK);
const UID = '00000000-0000-4000-8000-000000000072'; // uid SINTÉTICO
let nBD = 0;

const hoyMas = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const dia = (n) => getLocalDateString(hoyMas(n));
const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const nombreDia = (n) => DIAS[hoyMas(n).getDay()];
const todas = (q) => Object.fromEntries(DIAS.map((d) => [d, q]));
const etiqueta = (ep) => `${ep.seriesName}·T${ep.season}E${ep.episode}`;

async function nuevoEntorno() {
    const dev = await D.newDevice(`bd-${++nBD}`);
    D.use(dev);
    const db = dev.svc;
    const r = await quiet(() => db.createLinkedUser(UID, 'prueba@ejemplo.test'));
    if (!r.success) throw new Error('createLinkedUser falló');
    const user = { id: UID };
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && res.error}`); return res; };

    const crearCategoria = async ({ type = 'video', startDate = dia(0), quotas = todas(1), frequency = 0, seriesCount = null }) => {
        const res = ok(await db.addEntertainmentCategory(UID, { name: `Cat ${type}`, type, startDate, daysOfWeek: quotas, frequency, seriesCount, description: null }), 'addEntertainmentCategory');
        return categoria(res.id);
    };
    const categoria = async (id) => (ok(await db.getEntertainmentCategories(UID), 'getEntertainmentCategories')).categories.find((c) => c.id === id);
    const cargarLista = async (cat, archivo = PANTALLA.detalle) => {
        let lista = null;
        const fetchSeries = instanciar(extraer(archivo, 'fetchSeries'), { category: cat, db, setOriginalList: (l) => { lista = l; }, console });
        await quiet(() => fetchSeries());
        return lista;
    };
    const watchlist = async (cat) => (ok(await db.getFullWatchlist(UID, cat.id), 'getFullWatchlist')).data;

    // Cola de la pantalla de registro (video o lectura), con su loadData REAL en la pestaña de
    // pendientes: lee la fachada, llama a buildQueue (motor) y guarda la cola con setItems.
    // (Antes de la 7.3 eran las funciones generateInterleavedList/generateEpisodesForSeries de la
    // pantalla; ahora son buildQueue/episodesForSeries de src/entertainment/queue.ts.)
    const cola = async (cat, archivo = PANTALLA.registro) => {
        let raw = null, items = null;
        const noop = () => {};
        const capturas = { setRawSeries: (v) => { raw = v; }, setItems: (v) => { items = v; }, setLoading: noop, setCurrentCategory: noop, setCounts: noop };
        let loadData;
        if (archivo === PANTALLA.registro) {
            const calculateGlobalBacklog = instanciar(extraer(archivo, 'calculateGlobalBacklog'), { setHeaderBacklog: noop, currentCategory: cat });
            loadData = instanciar(extraer(archivo, 'loadData'), { ...capturas, db, user, category: cat, tab: 'pending', calculateGlobalBacklog });
        } else {
            loadData = instanciar(extraer(archivo, 'loadData'), { ...capturas, db, user, category: cat, currentTab: 'pending', setBacklogInfo: noop, console });
        }
        await quiet(() => loadData());
        if (!items) throw new Error(`${archivo}: loadData no produjo la cola`);
        return { raw, items };
    };

    // "Agregar serie" del detalle (handleSave real) con el estado del formulario.
    const agregarSerie = async (cat, { name, temporadas, status = 'Nueva', T = 1, E = 1, archivo = PANTALLA.detalle, editar = null }) => {
        const A = crearAlert();
        const originalList = await cargarLista(cat, archivo);
        const recarga = crearRecarga();
        const handleSave = instanciar(extraer(archivo, 'handleSave'), {
            name, description: '', status, seasons: temporadas.map((n, i) => ({ number: i + 1, episodes: String(n) })),
            currentSeason: T, currentEpisode: E, isEditing: !!editar, editingSeriesId: editar,
            originalList, category: cat, db, Alert: A.Alert, setModalVisible: () => {}, fetchSeries: recarga.fn, resetForm: () => {},
        });
        await quiet(() => handleSave());
        return { alertas: A.registro.map((a) => a.titulo), mensajes: A.registro.map((a) => a.mensaje) };
    };
    const sinMensaje = (a) => (a ? { titulo: a.titulo, botones: a.botones } : null);

    // Marcar visto el primer pendiente de una serie en el registro (onMarkWatched real).
    const marcar = async (cat, nombreSerie, eleccion = null, { archivo = PANTALLA.registro } = {}) => {
        const { raw, items } = await cola(cat, archivo);
        const item = items.find((i) => i.seriesName === nombreSerie);
        if (!item) throw new Error(`${nombreSerie} no está en la cola`);
        const A = crearAlert();
        A.elegir(eleccion);
        const recarga = crearRecarga();
        const espera = recarga.esperar();
        const onMarkWatched = instanciar(extraer(archivo, 'onMarkWatched'), { rawSeries: raw, items, db, Alert: A.Alert, loadData: recarga.fn });
        await quiet(() => onMarkWatched(item));
        const final = A.registro.find((a) => a.botones.length);
        if (final && (eleccion === null || eleccion === 'Cancelar')) espera.catch(() => {});
        else await quiet(() => espera);
        await A.esperar();
        return sinMensaje(final);
    };
    // Marca visto siguiendo el orden de la cola (n capítulos).
    const verEnOrden = async (cat, n, archivo = PANTALLA.registro) => {
        const vistos = [];
        for (let i = 0; i < n; i++) {
            const { items } = await cola(cat, archivo);
            vistos.push(etiqueta(items[0]));
            await marcar(cat, items[0].seriesName, null, { archivo });
        }
        return vistos;
    };

    const serie = async (cat, nombreSerie) => (await cargarLista(cat)).find((s) => s.name === nombreSerie);
    const resumen = async (cat, nombreSerie, extra = {}) => {
        const s = await serie(cat, nombreSerie);
        const { items } = await cola(cat);
        return { status: s.status, T: s.current_season, E: s.current_episode, ...extra, vistos: getWatchedCountSinceStart(s), enCola: items.some((i) => i.seriesName === nombreSerie) };
    };

    // Grilla de progreso del detalle (updateToChapter real).
    const tocarCapitulo = async (cat, nombreSerie, sNum, eNum, eleccion = null) => {
        const originalList = await cargarLista(cat);
        const s = originalList.find((x) => x.name === nombreSerie);
        const A = crearAlert();
        A.elegir(eleccion);
        const recarga = crearRecarga();
        const espera = recarga.esperar();
        const updateToChapter = instanciar(extraer(PANTALLA.detalle, 'updateToChapter'), {
            activeSeries: s, originalList, db, Alert: A.Alert, fetchSeries: recarga.fn, setActiveSeries: () => {},
        });
        await quiet(() => updateToChapter(s.id, sNum, eNum));
        const alerta = A.registro.find((a) => a.botones.length);
        if (alerta && (eleccion === null || eleccion === 'Cancelar')) espera.catch(() => {});
        else await quiet(() => espera);
        await A.esperar();
        return sinMensaje(alerta);
    };

    const pausarSerie = async (cat, nombreSerie) => {
        const originalList = await cargarLista(cat);
        const s = originalList.find((x) => x.name === nombreSerie);
        const handleTogglePauseSeries = instanciar(extraer(PANTALLA.detalle, 'handleTogglePauseSeries'), { originalList, db, fetchSeries: () => {} });
        await quiet(() => handleTogglePauseSeries(s));
    };

    const reiniciar = async (cat, nombreSerie) => {
        const s = await serie(cat, nombreSerie);
        const A = crearAlert();
        A.elegir('Reiniciar');
        const handleRestart = instanciar(extraer(PANTALLA.detalle, 'handleRestart'), {
            activeSeries: s, db, Alert: A.Alert, fetchSeries: () => {}, setProgressModalVisible: () => {},
        });
        await quiet(() => handleRestart());
        await A.esperar();
    };

    return { db, user, crearCategoria, categoria, cargarLista, watchlist, cola, agregarSerie, marcar, verEnOrden, serie, resumen, tocarCapitulo, pausarSerie, reiniciar, ok };
}

const progreso = (lista) => Object.fromEntries(lista.map((s) => [s.name, getWatchedCountSinceStart(s) + (s.interleave_offset || 0)]));

// =============================================================================================
// 4. ESCENARIOS: producen el resultado actual de cada caso (misma forma que CASOS[i].actual)
// =============================================================================================
const ESCENARIOS = {
    async C1(entrada) {
        const r = {};
        for (const q of entrada.cuotas) {
            const E = await nuevoEntorno();
            const cat = await E.crearCategoria({ quotas: todas(q) });
            for (const nombre of entrada.series) await E.agregarSerie(cat, { name: nombre, temporadas: [entrada.capitulos] });
            const { items } = await E.cola(cat);
            const lista = await E.cargarLista(cat);
            const calc = calculateBacklogV2(await E.categoria(cat.id), await E.watchlist(cat));
            r[q] = { cola10: items.slice(0, 10).map(etiqueta), atraso: calc.items, sortOrder: lista.map((s) => s.sort_order), interleaveOffset: lista.map((s) => s.interleave_offset) };
        }
        return {
            cola10: r[1].cola10, colaIgualConN2: JSON.stringify(r[1].cola10) === JSON.stringify(r[2].cola10),
            sortOrder: r[1].sortOrder, interleaveOffset: r[1].interleaveOffset, atrasoHoyN1: r[1].atraso, atrasoHoyN2: r[2].atraso,
        };
    },

    async C2(entrada) {
        const E = await nuevoEntorno();
        const cat = await E.crearCategoria({ quotas: todas(10) });
        for (const n of ['S1', 'S2', 'S3', 'S4', 'S5']) await E.agregarSerie(cat, { name: n, temporadas: [4] });
        await E.verEnOrden(cat, entrada.vistosAntes);
        const antes = await E.cargarLista(cat);
        const atrasoAntes = calculateBacklogV2(await E.categoria(cat.id), await E.watchlist(cat)).items;
        const activas = antes.filter((s) => ['Nueva', 'Mirando', 'Pausado'].includes(s.status));
        await E.agregarSerie(cat, { name: entrada.nueva, temporadas: [4] });
        const despues = await E.cargarLista(cat);
        const s6 = despues.find((s) => s.name === entrada.nueva);
        const { items } = await E.cola(cat);
        return {
            progresoAntes: progreso(antes),
            S6: { sortOrder: s6.sort_order, interleaveOffset: s6.interleave_offset, sortOrderPedidoPorPantalla: activas.length + 1 },
            cola12: items.slice(0, 12).map(etiqueta),
            atrasoAntes, atrasoDespues: calculateBacklogV2(await E.categoria(cat.id), await E.watchlist(cat)).items,
        };
    },

    async C3(entrada) {
        const E = await nuevoEntorno();
        const cat = await E.crearCategoria({ quotas: todas(10) });
        for (const n of ['S1', 'S2', 'S3', 'S4', 'S5']) await E.agregarSerie(cat, { name: n, temporadas: [4] });
        await E.verEnOrden(cat, 7);
        const s2Antes = await E.serie(cat, entrada.pausar);
        await E.pausarSerie(cat, entrada.pausar);
        const vistos = await E.verEnOrden(cat, entrada.vistosDuranteLaPausa);
        // Total visto de la categoría según cada pantalla, con S2 pausada.
        const registro = (await E.watchlist(cat)).reduce((a, s) => a + getWatchedCountSinceStart(s), 0);
        const detalle = (await E.cargarLista(cat)).reduce((a, s) => a + getWatchedCountSinceStart(s), 0);
        const listaCategorias = (await E.categoria(cat.id)).totalWatched;
        await E.pausarSerie(cat, entrada.pausar); // reanudar (mismo botón)
        const s2Despues = await E.serie(cat, entrada.pausar);
        const { items } = await E.cola(cat);
        return {
            colaEnPausa5: vistos,
            totalVistoSegunPantalla: { registroCapitulos: registro, detalleSerie: detalle, listaCategorias },
            interleaveS2: { antes: s2Antes.interleave_offset, despues: s2Despues.interleave_offset },
            colaTrasReanudar6: items.slice(0, 6).map(etiqueta),
        };
    },

    async C4() {
        const E = await nuevoEntorno();
        const cat = await E.crearCategoria({ startDate: dia(-9), quotas: todas(1) });
        // La meta y la cuota de cada día pasado (hoy-9 … hoy-1) antes del cambio.
        const cuotasPasado = (c) => Array.from({ length: 9 }, (_, i) => getQuotasForDate(hoyMas(i - 9), c)[nombreDia(i - 9)]);
        const c0 = await E.categoria(cat.id);
        const antes = { pasado: cuotasPasado(c0), hoy: getQuotasForDate(hoyMas(0), c0)[nombreDia(0)], ayer: getQuotasForDate(hoyMas(0), c0)[nombreDia(-1)], meta: calculateBacklog(c0, 0).targetItems };
        // Edición con el handleSave REAL de la lista de categorías.
        const editar = async (quotas) => {
            const A = crearAlert();
            const handleSave = instanciar(extraer(PANTALLA.categorias, 'handleSave'), {
                name: c0.name, type: 'video', startDate: c0.start_date, selectedDays: quotas, frequency: '0', seriesCount: '',
                description: '', isEditing: true, editingId: cat.id, db: E.db, user: E.user, Alert: A.Alert, setModalVisible: () => {}, fetchCategories: () => {},
            });
            await quiet(() => handleSave());
        };
        const nuevas = { ...todas(1), [nombreDia(0)]: 3, [nombreDia(-1)]: 5 };
        await editar(nuevas);
        const c1 = await E.categoria(cat.id);
        const hist = c1.quotas_history;
        const rel = (fecha) => (fecha === dia(0) ? 'hoy' : fecha === dia(-1) ? 'hoy-1' : fecha);
        await editar({ ...nuevas, [nombreDia(0)]: 4 });
        const c2 = await E.categoria(cat.id);
        return {
            pasadoIgual: JSON.stringify(cuotasPasado(c1)) === JSON.stringify(antes.pasado),
            cuotaHoy: { antes: antes.hoy, despues: getQuotasForDate(hoyMas(0), c1)[nombreDia(0)] },
            cuotaAyer: { antes: antes.pasado[8], despues: cuotasPasado(c1)[8] },
            metaAntes: antes.meta, metaDespues: calculateBacklog(c1, 0).targetItems,
            historial: { registros: hist.length, primeroCierra: rel(hist[0].end_date), segundoAbre: rel(hist[1].start_date) },
            segundaEdicionMismoDia: { registros: c2.quotas_history.length, registroSinDias: c2.quotas_history.some((h) => h.end_date && h.end_date < h.start_date) },
        };
    },

    async C5(entrada) {
        const E = await nuevoEntorno();
        const cat = await E.crearCategoria({ startDate: dia(-4), quotas: todas(entrada.cuota) });
        const calc = calculateBacklog(await E.categoria(cat.id), entrada.vistos);
        return { meta: calc.targetItems, atrasoCaps: calc.backlogItems, adelantoCaps: calc.adelantoItems, adelantoDias: calc.adelantoDays, atrasoDias: calc.diffDays };
    },

    async C6() {
        const r = {};
        for (const eleccion of ['Terminado', 'En espera', 'Cancelar']) {
            const E = await nuevoEntorno();
            const cat = await E.crearCategoria({});
            await E.agregarSerie(cat, { name: 'X', temporadas: [2] });
            await E.marcar(cat, 'X');
            const alerta = await E.marcar(cat, 'X', eleccion);
            const hist = (E.ok(await E.db.getHistory(UID, cat.id), 'getHistory')).data.length;
            r[eleccion] = { alerta, estado: await E.resumen(cat, 'X', {}), hist };
        }
        const forma = (x) => ({ status: x.estado.status, T: x.estado.T, E: x.estado.E, vistos: x.estado.vistos, enCola: x.estado.enCola, historial: x.hist });
        return { alerta: r.Terminado.alerta, terminado: forma(r.Terminado), enEspera: forma(r['En espera']), cancelar: forma(r.Cancelar) };
    },

    async C7() {
        const preparar = async () => {
            const E = await nuevoEntorno();
            const cat = await E.crearCategoria({});
            await E.agregarSerie(cat, { name: 'Serie', temporadas: [20, 20, 20, 20, 20, 20] });
            const s = await E.serie(cat, 'Serie');
            await E.db.updateSeriesProgress(s.id, 6, 20, 'Terminado');
            return { E, cat, s };
        };
        const corto = (x) => ({ status: x.status, T: x.T, E: x.E, vistos: x.vistos });
        // a) capítulo 21 en la T6
        let { E, cat, s } = await preparar();
        const terminada = corto(await E.resumen(cat, 'Serie'));
        const sTerm = await E.serie(cat, 'Serie');
        await E.agregarSerie(cat, { name: 'Serie', temporadas: [20, 20, 20, 20, 20, 21], status: sTerm.status, T: sTerm.current_season, E: sTerm.current_episode, editar: s.id });
        const s21 = await E.serie(cat, 'Serie');
        const con21 = { ...corto(await E.resumen(cat, 'Serie')), total: s21.total_seasons, enCola: (await E.resumen(cat, 'Serie')).enCola };
        const alerta21 = await E.tocarCapitulo(cat, 'Serie', 6, 21, 'Cancelar');
        await E.tocarCapitulo(cat, 'Serie', 6, 21, 'Terminado');
        const tras21 = corto(await E.resumen(cat, 'Serie'));
        // tocar el 20 (desde el estado "Terminado en 6×20 con 21 caps")
        ({ E, cat, s } = await preparar());
        await E.agregarSerie(cat, { name: 'Serie', temporadas: [20, 20, 20, 20, 20, 21], status: 'Terminado', T: 6, E: 20, editar: s.id });
        await E.tocarCapitulo(cat, 'Serie', 6, 20);
        const tras20 = corto(await E.resumen(cat, 'Serie'));
        const cola20 = (await E.cola(cat)).items[0];
        // b) temporada 7 nueva
        ({ E, cat, s } = await preparar());
        await E.agregarSerie(cat, { name: 'Serie', temporadas: [20, 20, 20, 20, 20, 20, 10], status: 'Terminado', T: 6, E: 20, editar: s.id });
        const s7 = await E.serie(cat, 'Serie');
        const conT7r = await E.resumen(cat, 'Serie');
        await E.tocarCapitulo(cat, 'Serie', 7, 1);
        const trasT7 = corto(await E.resumen(cat, 'Serie'));
        const colaT7 = (await E.cola(cat)).items[0];
        return {
            terminada,
            con21: { status: con21.status, T: con21.T, E: con21.E, total: con21.total, vistos: con21.vistos, enCola: con21.enCola },
            tocarCap21: { botones: alerta21 ? alerta21.botones : [], conTerminado: tras21 },
            tocarCap20: { ...tras20, colaPrimero: cola20 ? etiqueta(cola20) : null },
            conT7: { status: conT7r.status, T: conT7r.T, E: conT7r.E, total: s7.total_seasons, vistos: conT7r.vistos, enCola: conT7r.enCola },
            tocarT7C1: { ...trasT7, colaPrimero: colaT7 ? etiqueta(colaT7) : null },
        };
    },

    async C8(entrada) {
        const E = await nuevoEntorno();
        const cat = await E.crearCategoria({ type: 'reading', startDate: dia(-2), quotas: todas(1), frequency: entrada.frecuencia });
        await E.agregarSerie(cat, { name: 'Obra', temporadas: entrada.partes, archivo: PANTALLA.detalleLectura });
        const cola = (await E.cola(cat, PANTALLA.registroLectura)).items.map(etiqueta);
        let alertaFinal = null;
        for (let i = 0; i < 4; i++) {
            const a = await E.marcar(cat, 'Obra', i === 3 ? 'Terminado' : null, { archivo: PANTALLA.registroLectura });
            if (a) alertaFinal = a;
        }
        const s = await E.serie(cat, 'Obra');
        const hl = (E.ok(await E.db.getReadingHistory(UID, cat.id), 'getReadingHistory')).data.length;
        const hv = (E.ok(await E.db.getHistory(UID, cat.id), 'getHistory')).data.length;
        const c = await E.categoria(cat.id);
        const calc = calculateBacklog(c, 4); // 4 tomos leídos
        const catN = await E.crearCategoria({ type: 'reading', startDate: dia(-8), quotas: todas(1), frequency: entrada.frecuenciaNegativa });
        const calcN = calculateBacklog(await E.categoria(catN.id), 0);
        return {
            cola,
            alertaFinal,
            final: { status: s.status, T: s.current_season, E: s.current_episode, vistos: getWatchedCountSinceStart(s), historialLectura: hl, historialVideo: hv },
            metaFrecuencia2: { meta: calc.targetItems, atraso: calc.backlogItems, unidad: calc.unit },
            metaUnoCada3: { meta: calcN.targetItems, diasValidos: calcN.validDaysPassed },
        };
    },

    async C9() {
        const E = await nuevoEntorno();
        const editar = async (c, cambios) => {
            const datos = { name: c.name, type: c.type, startDate: c.start_date, daysOfWeek: c.days_of_week, frequency: c.frequency, seriesCount: c.series_count, description: null, ...cambios };
            E.ok(await E.db.updateEntertainmentCategory(c.id, datos), 'updateEntertainmentCategory');
            return E.categoria(c.id);
        };
        const meta = (c) => calculateBacklog(c, 0).targetItems;
        // Lectura: frecuencia
        let c = await E.crearCategoria({ type: 'reading', startDate: dia(-9), quotas: todas(1), frequency: 2 });
        let h0 = c.quotas_history.length;
        let c2 = await editar(c, { frequency: 3 });
        const lecturaFrecuencia = { metaAntes: meta(c), metaDespues: meta(c2), historialCambia: c2.quotas_history.length !== h0 };
        // Lectura: fecha de inicio
        c = await E.crearCategoria({ type: 'reading', startDate: dia(-9), quotas: todas(1), frequency: 2 });
        h0 = c.quotas_history.length;
        c2 = await editar(c, { startDate: dia(-19) });
        const lecturaInicio = { metaAntes: meta(c), metaDespues: meta(c2), historialCambia: c2.quotas_history.length !== h0 };
        // Video: fecha de inicio antes y después
        c = await E.crearCategoria({ startDate: dia(-9), quotas: todas(1) });
        c2 = await editar(c, { startDate: dia(-19) });
        const videoInicioAntes = { metaAntes: meta(c), metaDespues: meta(c2) };
        c = await E.crearCategoria({ startDate: dia(-9), quotas: todas(1) });
        c2 = await editar(c, { startDate: dia(-4) });
        const videoInicioDespues = { metaAntes: meta(c), metaDespues: meta(c2) };
        return { lecturaFrecuencia, lecturaInicio, videoInicioAntes, videoInicioDespues };
    },

    async C10() {
        const E = await nuevoEntorno();
        const cat = await E.crearCategoria({});
        const guardado = (s) => ({ T: s.current_season, E: s.current_episode, inicialT: s.initial_season, inicialE: s.initial_episode });
        await E.agregarSerie(cat, { name: 'A', temporadas: [3], status: 'Nueva', T: '0', E: '1' });
        await E.agregarSerie(cat, { name: 'B', temporadas: [3], status: 'Nueva', T: '1', E: '0' });
        const r = await E.agregarSerie(cat, { name: 'C', temporadas: [3], status: 'Mirando', T: '0', E: '1' });
        const lista = await E.cargarLista(cat);
        const { items } = await E.cola(cat);
        const a = lista.find((s) => s.name === 'A'), b = lista.find((s) => s.name === 'B');
        const primero = (n) => { const it = items.find((i) => i.seriesName === n); return it ? etiqueta(it) : null; };
        // "+ Temporada" REAL del formulario sobre una lista vacía: ¿con qué número empieza?
        // (Antes de la 7.3 se miraba el texto de handleAddSeason; ahora llama a appendSeasonRow.)
        let filas = null;
        const handleAddSeason = instanciar(extraer(PANTALLA.detalle, 'handleAddSeason'), { seasons: [], setSeasons: (v) => { filas = v; } });
        handleAddSeason();
        return {
            nuevaT0C1: { guardado: guardado(a), colaPrimero: primero('A'), vistos: getWatchedCountSinceStart(a) },
            nuevaT1C0: { guardado: guardado(b), colaPrimero: primero('B'), vistos: getWatchedCountSinceStart(b) },
            mirandoT0C1: { alerta: r.mensajes[0] || null, guardada: lista.some((s) => s.name === 'C') },
            temporadasDelFormulario: filas && filas.length === 1 && filas[0].number === 1 ? 'numeradas desde 1' : 'otra',
        };
    },

    async C11() {
        // a) desde Terminado
        let E = await nuevoEntorno();
        let cat = await E.crearCategoria({});
        await E.agregarSerie(cat, { name: 'R', temporadas: [3] });
        let s = await E.serie(cat, 'R');
        await E.db.updateSeriesProgress(s.id, 1, 3, 'Terminado');
        const vA = getWatchedCountSinceStart(await E.serie(cat, 'R'));
        await E.reiniciar(cat, 'R');
        s = await E.serie(cat, 'R');
        const desdeTerminado = { cycleOffset: s.cycle_offset, T: s.current_season, E: s.current_episode, status: s.status, vistosAntes: vA, vistosDespues: getWatchedCountSinceStart(s), inicial: `T${s.initial_season}E${s.initial_episode}` };
        // b) empezada en T2E1 (2×2), vista hasta el final de la T2 (Mirando en T2E2 + marcar)
        E = await nuevoEntorno();
        cat = await E.crearCategoria({});
        await E.agregarSerie(cat, { name: 'M', temporadas: [2, 2], status: 'Mirando', T: '2', E: '1' });
        await E.marcar(cat, 'M');
        await E.marcar(cat, 'M', 'Terminado');
        const vB = getWatchedCountSinceStart(await E.serie(cat, 'M'));
        await E.reiniciar(cat, 'M');
        s = await E.serie(cat, 'M');
        const cyc = s.cycle_offset;
        await E.marcar(cat, 'M'); await E.marcar(cat, 'M'); // T1 completa (2 caps) de nuevo
        const empezadaEnT2 = { vistosAntes: vB, cycleOffset: cyc, inicial: `T${s.initial_season}E${s.initial_episode}`, vistosTrasVerT1Completa: getWatchedCountSinceStart(await E.serie(cat, 'M')) };
        // c) desde En espera
        E = await nuevoEntorno();
        cat = await E.crearCategoria({});
        await E.agregarSerie(cat, { name: 'W', temporadas: [3] });
        s = await E.serie(cat, 'W');
        await E.db.updateSeriesProgress(s.id, 1, 3, 'En espera');
        const vC = getWatchedCountSinceStart(await E.serie(cat, 'W'));
        await E.reiniciar(cat, 'W');
        s = await E.serie(cat, 'W');
        const desdeEnEspera = { vistosAntes: vC, cycleOffset: s.cycle_offset, vistosDespues: getWatchedCountSinceStart(s) };
        return { desdeTerminado, empezadaEnT2, desdeEnEspera };
    },

    async C12() {
        const r = {};
        for (const [clave, limite] of [['sinLimite', null], ['limiteCero', 0], ['limiteDos', 2]]) {
            const E = await nuevoEntorno();
            const cat = await E.crearCategoria({ seriesCount: limite });
            const alertas = [];
            for (const n of ['A', 'B', 'C']) alertas.push(...(await E.agregarSerie(cat, { name: n, temporadas: [2] })).alertas);
            r[clave] = { guardadas: (await E.cargarLista(cat)).length, alertas: [...new Set(alertas)] };
        }
        // Formulario de categoría (SeriesAnimeScreen): cómo se guarda y se reabre series_count.
        const E = await nuevoEntorno();
        const guardarCon = async (seriesCountTexto) => {
            let id = null;
            const A = crearAlert();
            // La fachada real, solo interceptando el id creado (los métodos están en el prototipo).
            const db = Object.create(E.db);
            db.addEntertainmentCategory = async (u, data) => { const res = await E.db.addEntertainmentCategory(u, data); id = res.id; return res; };
            const handleSave = instanciar(extraer(PANTALLA.categorias, 'handleSave'), {
                name: 'F', type: 'video', startDate: dia(0), selectedDays: todas(1), frequency: '', seriesCount: seriesCountTexto,
                description: '', isEditing: false, editingId: null, db, user: E.user, Alert: A.Alert, setModalVisible: () => {}, fetchCategories: () => {},
            });
            await quiet(() => handleSave());
            return E.categoria(id);
        };
        const cCero = await guardarCon('0');
        const cVacio = await guardarCon('');
        let mostrado = null;
        const noop = () => {};
        const openModal = instanciar(extraer(PANTALLA.categorias, 'openModal'), {
            setIsEditing: noop, setEditingId: noop, setName: noop, setType: noop, setStartDate: noop, getLocalDateString, console,
            setSelectedDays: noop, setFrequency: noop, setSeriesCount: (v) => { mostrado = v; }, setDescription: noop, setModalVisible: noop,
        });
        openModal(cCero);
        return { ...r, formularioCategoria: { ceroSeGuardaComo: cCero.series_count, vacioSeGuardaComo: cVacio.series_count, ceroAlReabrirSeMuestra: mostrado } };
    },

    async C13() {
        const E = await nuevoEntorno();
        E.ok(await E.db.addBacklogItem(UID, { type: 'series', title: 'Pendiente X' }), 'addBacklogItem');
        const ciclo = [];
        const estado = async () => (E.ok(await E.db.getBacklogItems(UID, 'series', 'Total'), 'getBacklogItems')).data.find((b) => b.title === 'Pendiente X');
        ciclo.push((await estado()).status);
        for (let i = 0; i < 3; i++) {
            const actual = await estado();
            const handleUpdateStatus = instanciar(extraer(PANTALLA.pendiente, 'handleUpdateStatus'), { db: E.db, loadItems: () => {} });
            await quiet(() => handleUpdateStatus(actual));
            ciclo.push((await estado()).status);
        }
        const cat = await E.crearCategoria({});
        await E.agregarSerie(cat, { name: 'Pendiente X', temporadas: [2] });
        const filas = (E.ok(await E.db.getBacklogItems(UID, 'series', 'Total'), 'getBacklogItems')).data.length;
        return { cicloEstados: ciclo, filasBacklogTrasCrearSerie: filas - 1, seriesTrasCambiarBacklog: (await E.cargarLista(cat)).length, statusSerieSinCambio: (await E.serie(cat, 'Pendiente X')).status };
    },

    async C14() {
        const E = await nuevoEntorno();
        const meta = async (id) => calculateBacklog(await E.categoria(id), 0).targetItems;
        const a = await E.crearCategoria({ startDate: dia(-6), quotas: todas(1) });
        const metaSinPausa = await meta(a.id);
        E.ok(await E.db.pauseCategory(a.id, dia(-3)), 'pauseCategory');
        E.ok(await E.db.resumeCategory(a.id, dia(-2)), 'resumeCategory');
        const metaConPausa = await meta(a.id);
        // Mismo día: la pantalla pausa con fecha de hoy y reanuda con fecha de AYER.
        const b = await E.crearCategoria({ startDate: dia(-6), quotas: todas(1) });
        const metaAntes = await meta(b.id);
        E.ok(await E.db.pauseCategory(b.id, dia(0)), 'pauseCategory');
        E.ok(await E.db.resumeCategory(b.id, dia(-1)), 'resumeCategory');
        const pausas = (E.ok(await E.db.getCategoryPauses(b.id), 'getCategoryPauses')).pauses;
        return { metaSinPausa, metaConPausa, mismoDia: { metaAntes, metaDespues: await meta(b.id), pausaFinAntesDeInicio: pausas.every((p) => p.pause_end < p.pause_start) } };
    },
};

// =============================================================================================
// 5. EJECUCIÓN
// =============================================================================================
let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const descubierto = {};
for (const caso of CASOS) {
    console.log(`\n== ${caso.id}. ${caso.titulo} ==`);
    let resultado;
    try {
        resultado = await ESCENARIOS[caso.id](caso.entrada);
    } catch (e) {
        check(`${caso.id}: el escenario se ejecuta`, false, e.message);
        continue;
    }
    descubierto[caso.id] = resultado;
    const igual = JSON.stringify(resultado) === JSON.stringify(caso.actual);
    check(`${caso.id}: comportamiento actual: ${caso.comportamiento}`, igual,
        igual ? '' : `difiere del oráculo — obtenido ${JSON.stringify(resultado)}`);
}

console.log('\n== Funciones extraídas de las pantallas (archivo:línea · closures/imports · db) ==');
for (const e of extraidas) {
    console.log(`     ${e.archivo}:${e.linea} ${e.nombre} · libres: ${e.libres.join(', ') || '—'} · db: ${e.dbMetodos.join(', ') || '—'}`);
}
check(`extracción con @babel/parser: ${extraidas.length} funciones, todas con sus dependencias provistas`, extraidas.length > 0);
// Pruebas negativas del mecanismo: el error dice archivo, nombre y (si existe) línea.
const errorDe = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const noExiste = errorDe(() => extraer(PANTALLA.detalle, 'funcionQueNoExiste'));
check('extracción: una función inexistente falla con archivo y nombre', !!noExiste && noExiste.includes(PANTALLA.detalle) && noExiste.includes('funcionQueNoExiste'), noExiste || '');
const sinDep = errorDe(() => instanciar(extraer(PANTALLA.detalle, 'handleTogglePauseSeries'), { db: null, fetchSeries: null }));
check('extracción: una dependencia no provista falla con archivo:línea, nombre y la dependencia', !!sinDep && /SeriesDetailScreen\.js:\d+ "handleTogglePauseSeries".*originalList/.test(sinDep), sinDep || '');

if (DESCUBRIR) console.log(`\n--descubrir\n${JSON.stringify(descubierto, null, 1)}`);
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* el shim puede tener archivos abiertos */ }
console.log(failures === 0 ? '\nTODAS LAS PRUEBAS DE LA FASE 7.2 PASARON.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
