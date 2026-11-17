// Fixtures de prueba saneados (Fase 7.1). No se empaqueta en la app.
//
// Las suites NUNCA leen los originales de .local-data/ (copias con la contraseña antigua): leen
// las copias saneadas que genera scripts/sanear-fixtures.mjs, con cada contraseña real distinta
// cambiada por un valor sintético distinto (PASSWORD_SINTETICA-01, -02, …).
//
// - ORIGINALES: nombre lógico → ruta original. Es el ÚNICO lugar del repo con esas rutas y solo lo
//   usan el generador (sanear-fixtures.mjs) y sus pruebas (probar-fase7-1.mjs).
// - fixture(nombre): ruta de la copia saneada en REGISTRO_FIXTURES_DIR o, por defecto,
//   .local-data/fixtures-saneados/. Comprueba el SHA-256 contra manifest.json; si falta el archivo o
//   no coincide, lanza un error. Nunca devuelve un original.
// - PASSWORD_SINTETICA: no es un secreto (es una constante conocida de prueba).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const PASSWORD_SINTETICA = 'fixture-sintetico-no-secreto-f71';
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Solo esto cuenta como sintético: la constante sola o con un sufijo de dos dígitos.
export const SINTETICA_RE = new RegExp(`^${escapar(PASSWORD_SINTETICA)}(-\\d{2})?$`);
export const esSintetica = (v) => typeof v === 'string' && SINTETICA_RE.test(v);
// i-ésimo valor sintético (1 → "-01"); máximo 99 valores distintos por fixture.
export const sinteticaN = (i) => {
    if (!Number.isInteger(i) || i < 1 || i > 99) throw new Error(`índice sintético fuera de rango (1–99): ${i}`);
    return `${PASSWORD_SINTETICA}-${String(i).padStart(2, '0')}`;
};

export const ORIGINALES = Object.freeze({
    'real-20261020': '.local-data/respaldo-real/registro_respaldo_20261020-211827.db', // celular, v1
    'real-20261025-fix': '.local-data/respaldo-post-fase1-fix/registro_respaldo_20261025-195442.db', // celular, v2
    'emulador-antes': '.local-data/emulador-antes.db', // emulador, 1 cuenta
    'emulador-checklist': '.local-data/emulador/checklist/app.db', // emulador, 2 cuentas
    'emulador-eas-antes': '.local-data/emulador-eas/antes.db', // emulador EAS
    'emulador-fase1-tras-checklist': '.local-data/emulador-fase1/tras-checklist.db', // emulador, v2 con tombstones
    'emulador-fase1-despues': '.local-data/emulador-fase1/despues.db', // emulador, v2
});
export const NOMBRES = Object.freeze(Object.keys(ORIGINALES));

export const MANIFEST = 'manifest.json';
export const DIR_POR_DEFECTO = resolve(RAIZ, '.local-data/fixtures-saneados');
export const archivoDe = (nombre) => `${nombre}.db`;
// Un valor vacío ("") cuenta como no definido.
export const dirFixtures = () => (process.env.REGISTRO_FIXTURES_DIR ? resolve(process.env.REGISTRO_FIXTURES_DIR) : DIR_POR_DEFECTO);

export const sha256Archivo = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const ORIGINALES_ABS = new Set(Object.values(ORIGINALES).map((p) => resolve(RAIZ, p).toLowerCase()));
const cacheHash = new Map(); // ruta → { size, mtimeMs, sha }
const AYUDA = 'Ejecuta: node scripts/sanear-fixtures.mjs';

export function fixture(nombre) {
    if (!Object.hasOwn(ORIGINALES, nombre)) throw new Error(`fixture desconocido: "${nombre}" (válidos: ${NOMBRES.join(', ')})`);
    const dir = dirFixtures();
    const falla = (motivo) => new Error(`Fixture saneado "${nombre}" no disponible en ${dir}: ${motivo}. ${AYUDA}`);
    const manifestPath = resolve(dir, MANIFEST);
    if (!existsSync(manifestPath)) throw falla(`falta ${MANIFEST}`);
    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { throw falla(`${MANIFEST} ilegible`); }
    const entrada = manifest && manifest.fixtures && manifest.fixtures[nombre];
    if (!entrada || typeof entrada.sha256 !== 'string') throw falla(`${MANIFEST} no tiene "${nombre}"`);
    // La ruta sale del nombre lógico, nunca del manifest: siempre dentro del directorio.
    const path = resolve(dir, archivoDe(nombre));
    const rel = relative(dir, path);
    if (rel.startsWith('..') || isAbsolute(rel) || ORIGINALES_ABS.has(path.toLowerCase())) throw falla('ruta fuera del directorio de copias saneadas');
    if (!existsSync(path)) throw falla(`falta ${archivoDe(nombre)}`);
    const st = statSync(path);
    let c = cacheHash.get(path);
    if (!c || c.size !== st.size || c.mtimeMs !== st.mtimeMs) {
        c = { size: st.size, mtimeMs: st.mtimeMs, sha: sha256Archivo(path) };
        cacheHash.set(path, c);
    }
    if (c.sha !== entrada.sha256) throw falla(`el SHA-256 de ${archivoDe(nombre)} no coincide con ${MANIFEST}`);
    return path.replace(/\\/g, '/');
}

// Para las suites: si el fixture no está, imprime FALLA con el motivo y termina con código 1.
export function fixtureOSalir(nombre) {
    try {
        return fixture(nombre);
    } catch (e) {
        console.log(`FALLA ${e.message}`);
        process.exit(1);
    }
}
