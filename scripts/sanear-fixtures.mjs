// Genera copias SANEADAS de los fixtures de prueba (Fase 7.1): cada contraseña real distinta pasa a
// un valor sintético distinto (PASSWORD_SINTETICA-01, -02, … en orden de primera aparición por tabla
// y rowid); las filas que compartían valor lo siguen compartiendo; NULL y '' no cambian.
//
// Uso: node scripts/sanear-fixtures.mjs [--salida <dir>] [--forzar] [--tmp <dir>]
//   --salida  directorio de las copias (por defecto .local-data/fixtures-saneados/)
//   --forzar  reemplaza las copias y el manifest de una salida que ya existe (si no, se niega)
//   --tmp     dónde crear el directorio de trabajo temporal (por defecto el temporal del sistema);
//             se borra siempre al terminar, también si algo falla
//
// Por fixture: copia byte a byte el original a un temporal (nunca lo abre en su sitio), detecta las
// columnas password de TODAS las tablas, lee los valores reales solo en memoria (nunca los imprime ni
// los escribe), se detiene sin escribir nada si un valor real aparece en otra columna TEXT o en el
// esquema, los cambia con secure_delete, hace VACUUM y verifica (solo conteos, booleanos y hashes).
// Solo si los 7 pasan se copian a la salida, con manifest.json al final (sin manifest parcial).
// Salida: 0 todo OK; 1 algún fixture falló o la salida ya existe sin --forzar.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ORIGINALES, RAIZ, MANIFEST, DIR_POR_DEFECTO, archivoDe, sinteticaN, PASSWORD_SINTETICA, sha256Archivo } from './lib/fixtures.mjs';

const COMPANEROS = ['-wal', '-journal', '-shm'];
const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const plain = (r) => Object.fromEntries(Object.entries(r));
const q = (t) => `"${t.replace(/"/g, '""')}"`;

// Datos de una BD necesarios para comparar antes/después, sin imprimir nada.
function leer(path) {
    const d = new DatabaseSync(path, { readOnly: true });
    try {
        const one = (sql) => plain(d.prepare(sql).get());
        const tablas = d.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(plain);
        const info = {
            userVersion: one('PRAGMA user_version').user_version,
            esquema: sha(d.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all().map(plain)), // sin rootpage
            esquemaSql: d.prepare('SELECT sql FROM sqlite_master WHERE sql IS NOT NULL').all().map((r) => r.sql),
            pageSize: one('PRAGMA page_size').page_size,
            encoding: one('PRAGMA encoding').encoding,
            autoVacuum: one('PRAGMA auto_vacuum').auto_vacuum,
            freelist: one('PRAGMA freelist_count').freelist_count,
            integridad: d.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]).join('|'),
            fk: sha(d.prepare('PRAGMA foreign_key_check').all().map(plain)),
            fkN: d.prepare('PRAGMA foreign_key_check').all().length,
            conteos: {}, hashes: {}, columnasPassword: [], textos: [],
        };
        for (const { name: t, sql } of tablas) {
            const cols = d.prepare(`PRAGMA table_info(${q(t)})`).all().map(plain);
            const pw = cols.filter((c) => c.name.toLowerCase() === 'password').map((c) => c.name);
            const sinRowid = /\bWITHOUT\s+ROWID\b/i.test(sql || '');
            let filas = d.prepare(sinRowid ? `SELECT * FROM ${q(t)}` : `SELECT rowid AS "__rowid__", * FROM ${q(t)} ORDER BY rowid`).all().map(plain);
            info.conteos[t] = filas.length;
            for (const c of pw) {
                info.columnasPassword.push({ tabla: t, columna: c, filas: filas.map((r) => ({ rowid: r.__rowid__, valor: r[c] })) });
            }
            // Textos de las demás columnas (para buscar un valor real fuera de las columnas password).
            for (const r of filas) for (const c of cols) if (!pw.includes(c.name) && typeof r[c.name] === 'string') info.textos.push({ tabla: t, columna: c.name, v: r[c.name] });
            filas = filas.map((r) => { const o = { ...r }; for (const c of pw) delete o[c]; return o; });
            if (sinRowid) filas.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
            info.hashes[t] = sha(filas); // incluye el rowid: prueba que VACUUM no renumeró
        }
        return info;
    } finally {
        d.close();
    }
}
const cabeceraModo = (path) => { const b = readFileSync(path).subarray(18, 20); return `${b[0]}/${b[1]}`; }; // 1/1 diario clásico, 2/2 WAL
const vecesEnBytes = (path, valor) => {
    const buf = readFileSync(path);
    const aguja = Buffer.from(valor, 'utf8');
    let n = 0;
    for (let i = buf.indexOf(aguja); i >= 0; i = buf.indexOf(aguja, i + 1)) n++;
    return n;
};

// Sanea UN fixture dentro de `trabajo`; devuelve { ok, checks, entrada, destino } (destino = archivo saneado).
// Nombres cortos en el temporal (f<i>/o.db, s.db, v.db): en Windows SQLite no abre rutas de más de
// 260 caracteres.
function sanearUno(nombre, origen, trabajo, indice, log) {
    const checks = [];
    const check = (texto, ok, detalle = '') => { checks.push(ok); log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}: ${texto}${detalle ? ` — ${detalle}` : ''}`); return ok; };
    if (!existsSync(origen)) { check('existe el original', false); return { ok: false }; }
    const conCompaneros = COMPANEROS.filter((s) => existsSync(origen + s));
    if (!check('el original no tiene -wal/-journal/-shm al lado', conCompaneros.length === 0, conCompaneros.join(', '))) return { ok: false };
    const dir = join(trabajo, `f${indice}`);
    mkdirSync(dir, { recursive: true });
    const copia = join(dir, 'o.db');
    copyFileSync(origen, copia); // byte a byte; el original nunca se abre en su sitio
    const modo = cabeceraModo(copia);
    const antes = leer(copia);

    // Valores reales distintos, en orden de primera aparición por tabla (alfabético) y rowid.
    const mapa = new Map();
    let noVacias = 0, noTexto = 0;
    for (const col of antes.columnasPassword) {
        for (const { valor } of col.filas) {
            if (valor === null || valor === '') continue;
            if (typeof valor !== 'string') { noTexto++; continue; }
            noVacias++;
            if (!mapa.has(valor)) mapa.set(valor, sinteticaN(mapa.size + 1));
        }
    }
    const reales = [...mapa.keys()];
    if (!check('todas las contraseñas no vacías son texto', noTexto === 0, `${noTexto} no son texto`)) return { ok: false };
    if (!check(`columnas password detectadas: ${antes.columnasPassword.length}; filas no vacías ${noVacias}; valores distintos ${reales.length}`, reales.length <= 99)) return { ok: false };
    if (!check('la constante sintética no aparece en el original', vecesEnBytes(copia, PASSWORD_SINTETICA) === 0)) return { ok: false };
    if (!check('ningún valor real coincide con un valor sintético', reales.every((v) => !v.startsWith(PASSWORD_SINTETICA)))) return { ok: false };
    // D.4: un valor real dentro de otra columna TEXT (o del esquema) → detenerse sin escribir.
    const repetidos = new Set();
    for (const { tabla, columna, v } of antes.textos) if (reales.some((r) => v.includes(r))) repetidos.add(`${tabla}.${columna}`);
    if (antes.esquemaSql.some((s) => reales.some((r) => s.includes(r)))) repetidos.add('sqlite_master.sql');
    if (!check('ningún valor real aparece en otra columna TEXT ni en el esquema', repetidos.size === 0, [...repetidos].join(', '))) return { ok: false };

    // Saneado: secure_delete + UPDATE parametrizado + VACUUM.
    const trabajoDb = join(dir, 's.db');
    copyFileSync(copia, trabajoDb);
    const d = new DatabaseSync(trabajoDb);
    try {
        d.exec('PRAGMA secure_delete = ON');
        d.exec('BEGIN');
        for (const col of antes.columnasPassword) {
            const st = d.prepare(`UPDATE ${q(col.tabla)} SET ${q(col.columna)} = ? WHERE ${q(col.columna)} = ?`);
            for (const [real, sintetica] of mapa) st.run(sintetica, real);
        }
        d.exec('COMMIT');
        d.exec('VACUUM');
        if (modo === '2/2') d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) {
        try { d.exec('ROLLBACK'); } catch { /* sin transacción abierta */ }
        d.close();
        check('saneado (UPDATE + VACUUM)', false, e.code || 'error de SQLite');
        return { ok: false };
    }
    d.close();
    const restos = COMPANEROS.filter((s) => existsSync(trabajoDb + s));
    check('sin -journal ni -wal tras cerrar', restos.length === 0, restos.join(', '));

    // Verificación D.7 sobre una copia de la salida (abrirla puede crear -shm en modo WAL).
    const verif = join(dir, 'v.db');
    copyFileSync(trabajoDb, verif);
    const desp = leer(verif);
    check(`user_version igual (${antes.userVersion})`, desp.userVersion === antes.userVersion);
    check('sqlite_master igual (type, name, tbl_name, sql)', desp.esquema === antes.esquema);
    check(`page_size (${antes.pageSize}), encoding (${antes.encoding}), auto_vacuum y modo de diario de la cabecera iguales`,
        desp.pageSize === antes.pageSize && desp.encoding === antes.encoding && desp.autoVacuum === antes.autoVacuum && cabeceraModo(trabajoDb) === modo);
    const tablas = Object.keys(antes.conteos);
    const conteosIguales = tablas.every((t) => desp.conteos[t] === antes.conteos[t]) && Object.keys(desp.conteos).length === tablas.length;
    check(`${tablas.length} tablas: mismo número de filas`, conteosIguales, `${tablas.reduce((a, t) => a + antes.conteos[t], 0)} filas`);
    const distintasRowid = tablas.filter((t) => desp.hashes[t] !== antes.hashes[t]);
    check('mismo SHA-256 por tabla (rowid + columnas, sin password, en orden de rowid)', distintasRowid.length === 0, distintasRowid.length ? `difieren: ${distintasRowid.join(', ')}` : '');
    let pwOk = desp.columnasPassword.length === antes.columnasPassword.length;
    for (const col of antes.columnasPassword) {
        const otra = desp.columnasPassword.find((c) => c.tabla === col.tabla && c.columna === col.columna);
        if (!otra || otra.filas.length !== col.filas.length) { pwOk = false; continue; }
        col.filas.forEach((f, i) => {
            const g = otra.filas[i];
            const esperado = f.valor === null || f.valor === '' ? f.valor : mapa.get(f.valor);
            if (g.rowid !== f.rowid || g.valor !== esperado) pwOk = false;
        });
    }
    const distintosDespues = new Set(desp.columnasPassword.flatMap((c) => c.filas.map((f) => f.valor)).filter((v) => v !== null && v !== '')).size;
    check(`columnas password: mismas filas no vacías (${noVacias}), cada valor real → su sintético, ${reales.length} valor(es) distinto(s) antes y después`,
        pwOk && distintosDespues === reales.length);
    const apariciones = reales.reduce((a, r) => a + vecesEnBytes(trabajoDb, r), 0);
    check('los valores reales aparecen 0 veces en los bytes del archivo saneado', apariciones === 0, `${apariciones}`);
    check(`freelist_count = 0 (${desp.freelist}), integrity_check = ok, foreign_key_check igual (${antes.fkN})`,
        desp.freelist === 0 && desp.integridad === 'ok' && desp.fk === antes.fk);
    mapa.clear();
    const ok = checks.every(Boolean);
    const archivoSha = sha256Archivo(trabajoDb);
    if (ok) log(`     ${nombre}: SHA-256 del saneado ${archivoSha}`);
    return {
        ok,
        destino: trabajoDb,
        entrada: {
            archivo: archivoDe(nombre), sha256: archivoSha, user_version: antes.userVersion, tablas: antes.conteos,
            contrasenas: { columnas: antes.columnasPassword.map((c) => `${c.tabla}.${c.columna}`), filasNoVacias: noVacias, valoresDistintos: reales.length },
        },
    };
}

// API (también la usan las pruebas). Nunca escribe en `salida` si algo falla.
export function sanear({ fuentes = ORIGINALES, salida = DIR_POR_DEFECTO, tmp = tmpdir(), forzar = false, log = console.log } = {}) {
    const out = resolve(RAIZ, salida);
    if (existsSync(out) && !forzar) {
        log(`FALLA la salida ya existe: ${out} (usa --forzar para reemplazar sus copias y el manifest)`);
        return { ok: false, motivo: 'existe' };
    }
    const trabajo = join(resolve(tmp), `sf-${randomUUID().slice(0, 8)}`);
    mkdirSync(trabajo, { recursive: true });
    try {
        const resultados = {};
        let i = 0;
        for (const [nombre, origen] of Object.entries(fuentes)) {
            log(`\n== ${nombre} ==`);
            try {
                resultados[nombre] = sanearUno(nombre, resolve(RAIZ, origen), trabajo, ++i, log);
            } catch (e) {
                // Nunca se imprime el mensaje completo de un error inesperado: solo su código.
                log(`FALLA ${nombre}: error inesperado (${e.code || e.name}${e.errstr ? `: ${e.errstr}` : ''})`);
                resultados[nombre] = { ok: false };
            }
        }
        const nOk = Object.values(resultados).filter((r) => r.ok).length;
        const total = Object.keys(fuentes).length;
        log(`\n${nOk}/${total} fixtures saneados y verificados`);
        if (nOk !== total) return { ok: false, motivo: 'fallo', resultados };
        // Todo bien: se copian las copias y, al final, el manifest.
        mkdirSync(out, { recursive: true });
        if (forzar) for (const f of [MANIFEST, ...Object.keys(fuentes).map(archivoDe)]) rmSync(join(out, f), { force: true });
        const manifest = { formato: 1, generador: 'scripts/sanear-fixtures.mjs', fixtures: {} };
        for (const [nombre, r] of Object.entries(resultados)) {
            copyFileSync(r.destino, join(out, archivoDe(nombre)));
            if (sha256Archivo(join(out, archivoDe(nombre))) !== r.entrada.sha256) throw new Error(`la copia de ${nombre} en la salida no coincide`);
            manifest.fixtures[nombre] = r.entrada;
        }
        writeFileSync(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
        log(`Escrito en ${out}: ${readdirSync(out).length} archivo(s)`);
        return { ok: true, salida: out, resultados };
    } finally {
        rmSync(trabajo, { recursive: true, force: true }); // contiene copias con los valores reales
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const argv = process.argv.slice(2);
    const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
    const r = sanear({ salida: flag('--salida') || DIR_POR_DEFECTO, tmp: flag('--tmp') || tmpdir(), forzar: argv.includes('--forzar') });
    process.exit(r.ok ? 0 : 1);
}
