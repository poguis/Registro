// Escaneo de SOLO LECTURA de contraseñas en .local-data/ (Fase 7.1). Nunca imprime un valor.
//
// Uso: node scripts/escanear-contrasenas.mjs [--dir <dir>] [--tmp <dir>]
//   --dir  directorio a recorrer (por defecto .local-data/)
//   --tmp  dónde copiar las BD antes de abrirlas (por defecto el temporal del sistema); las copias
//          se borran al terminar
//
// - .db / .sqlite: se copian (con su -wal/-journal si existen) al temporal y se miran TODAS las
//   columnas password de todas las tablas. Nunca se abre un archivo en su sitio.
// - .json: claves "password" en cualquier nivel.
// Clase de cada archivo: "real" (algún valor distinto de NULL, '', [OCULTO] y del patrón sintético
// ^PASSWORD_SINTETICA(-\d{2})?$), "sintética" (solo valores sintéticos), "sin contraseña" (ni
// columna/clave password con valor) o "ilegible" (no se pudo abrir o analizar).
// Limitaciones: solo valores de columnas o claves (no restos en páginas libres); no mira .txt ni .log.
// Salida: 1 si hay algún "real"; 2 si no hay "real" pero hay "ilegible"; 0 si no.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { esSintetica, RAIZ } from './lib/fixtures.mjs';
import { PASSWORD_PLACEHOLDER } from './lib/sqlite-utils.mjs';

const ES_DB = /\.(db|sqlite)$/i;
const ES_JSON = /\.json$/i;
const vacio = (v) => v === null || v === undefined || v === '' || v === PASSWORD_PLACEHOLDER;
const clasificar = (c) => (c.real > 0 ? 'real' : c.sintetica > 0 ? 'sintética' : 'sin contraseña');

function listar(dir) {
    const out = [];
    const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (ES_DB.test(e.name) || ES_JSON.test(e.name)) out.push(p);
        }
    };
    walk(dir);
    return out.sort();
}

function escanearDb(path, tmp) {
    const copia = join(tmp, `${randomUUID().slice(0, 8)}.db`); // ruta corta (SQLite en Windows: ≤ 260)
    copyFileSync(path, copia);
    for (const s of ['-wal', '-journal']) if (existsSync(path + s)) copyFileSync(path + s, copia + s);
    const c = { columnas: 0, real: 0, sintetica: 0 };
    let d;
    try {
        d = new DatabaseSync(copia);
        const tablas = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
        for (const t of tablas) {
            const qt = `"${t.replace(/"/g, '""')}"`;
            for (const col of d.prepare(`PRAGMA table_info(${qt})`).all()) {
                if (col.name.toLowerCase() !== 'password') continue;
                c.columnas++;
                for (const r of d.prepare(`SELECT "${col.name}" AS v FROM ${qt}`).all()) {
                    if (vacio(r.v)) continue;
                    if (esSintetica(r.v)) c.sintetica++; else c.real++;
                }
            }
        }
    } finally {
        try { d?.close(); } catch { /* ya cerrada */ }
        for (const s of ['', '-wal', '-journal', '-shm']) rmSync(copia + s, { force: true });
    }
    return c;
}

function escanearJson(path) {
    const c = { columnas: 0, real: 0, sintetica: 0 };
    const walk = (v) => {
        if (Array.isArray(v)) { for (const x of v) walk(x); return; }
        if (v && typeof v === 'object') {
            for (const [k, x] of Object.entries(v)) {
                if (k.toLowerCase() === 'password' && (x === null || typeof x !== 'object')) {
                    c.columnas++;
                    if (!vacio(x)) { if (esSintetica(x)) c.sintetica++; else c.real++; }
                } else walk(x);
            }
        }
    };
    walk(JSON.parse(readFileSync(path, 'utf8')));
    return c;
}

// Devuelve [{ ruta (relativa a dir), tipo, clase, columnas, real, sintetica }].
export function escanear(dir, { tmp = tmpdir() } = {}) {
    const base = resolve(dir);
    const trabajo = join(resolve(tmp), `ec-${randomUUID().slice(0, 8)}`);
    mkdirSync(trabajo, { recursive: true });
    const res = [];
    try {
        for (const p of listar(base)) {
            const ruta = relative(base, p).split(sep).join('/');
            const tipo = ES_DB.test(p) ? 'bd' : 'json';
            try {
                const c = tipo === 'bd' ? escanearDb(p, trabajo) : escanearJson(p);
                res.push({ ruta, tipo, clase: clasificar(c), ...c });
            } catch (e) {
                res.push({ ruta, tipo, clase: 'ilegible', columnas: 0, real: 0, sintetica: 0, motivo: e.code || e.name });
            }
        }
    } finally {
        rmSync(trabajo, { recursive: true, force: true });
    }
    return res;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const argv = process.argv.slice(2);
    const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
    const dir = resolve(RAIZ, flag('--dir') || '.local-data');
    const res = escanear(dir, { tmp: flag('--tmp') || tmpdir() });
    const n = (k) => res.filter((r) => r.clase === k).length;
    for (const r of res.filter((x) => x.clase !== 'sin contraseña')) {
        console.log(`${r.clase.padEnd(10)} ${r.ruta} — ${r.tipo}, ${r.columnas} columna(s)/clave(s) password, ${r.real} valor(es) real(es), ${r.sintetica} sintético(s)${r.motivo ? `, motivo ${r.motivo}` : ''}`);
    }
    console.log(`\n${res.length} archivo(s) .db/.sqlite/.json en ${dir}: ${n('real')} real, ${n('sintética')} sintética, ${n('sin contraseña')} sin contraseña, ${n('ilegible')} ilegible`);
    process.exit(n('real') > 0 ? 1 : n('ilegible') > 0 ? 2 : 0);
}
