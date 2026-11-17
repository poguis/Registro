// Pruebas de la Fase 7.1 (fixtures saneados): generador, fixture() y escáner de contraseñas.
// Todo el trabajo va a un directorio temporal (--tmp, por defecto el del sistema) que se borra al
// terminar; .local-data/ solo se lee (los originales, si existen, se copian byte a byte).
// No imprime contraseñas ni contenido de filas: solo conteos y OK/FALLA.
//
// Uso: node scripts/probar-fase7-1.mjs [--tmp <dir>]
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    ORIGINALES, NOMBRES, RAIZ, MANIFEST, PASSWORD_SINTETICA, archivoDe, SINTETICA_RE, esSintetica, sinteticaN, fixture,
} from './lib/fixtures.mjs';
import { sanear } from './sanear-fixtures.mjs';
import { escanear } from './escanear-contrasenas.mjs';

const argv = process.argv.slice(2);
const TMP = resolve(argv.includes('--tmp') ? argv[argv.indexOf('--tmp') + 1] : tmpdir());
const WORK = join(TMP, `pf71-${randomUUID().slice(0, 8)}`); // corto: SQLite en Windows no abre rutas > 260
mkdirSync(WORK, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);
const callado = [];
const silencio = (l) => callado.push(l); // el log del generador no se imprime en las pruebas sintéticas
const foto = (dir) => (existsSync(dir) ? readdirSync(dir).sort().map((f) => `${f}|${statSync(join(dir, f)).size}|${statSync(join(dir, f)).mtimeMs}`).join('\n') : 'no existe');
const conEnv = (dir, fn) => {
    const prev = process.env.REGISTRO_FIXTURES_DIR;
    if (dir === undefined) delete process.env.REGISTRO_FIXTURES_DIR; else process.env.REGISTRO_FIXTURES_DIR = dir;
    try { return fn(); } finally { if (prev === undefined) delete process.env.REGISTRO_FIXTURES_DIR; else process.env.REGISTRO_FIXTURES_DIR = prev; }
};
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// Valores "reales" FICTICIOS de esta prueba (no son contraseñas de nadie).
const R1 = 'clave-ficticia-prueba-uno';
const R2 = 'clave-ficticia-prueba-dos';
const vecesEn = (path, v) => { const b = readFileSync(path); let n = 0; for (let i = b.indexOf(v); i >= 0; i = b.indexOf(v, i + 1)) n++; return n; };

// Fixture sintético: users (id INTEGER PK) y legacy_users (sin PK entera ni índices), valores
// repetidos, NULL y '', filas borradas en backlog (huecos de rowid y páginas libres) y una tabla con
// texto. huecoSinIndice: borra una fila de legacy_users; ahí VACUUM renumera los rowid (visto con
// SQLite de Node 24) y el generador debe detenerse sin escribir.
function crearFixture(path, { repetidaEn = null, huecoSinIndice = false } = {}) {
    const d = new DatabaseSync(path);
    d.exec(`
        PRAGMA user_version = 2;
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT);
        CREATE TABLE legacy_users (id TEXT, username TEXT, password TEXT);
        CREATE TABLE backlog (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, notes TEXT);
    `);
    const iu = d.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const il = d.prepare('INSERT INTO legacy_users (id, username, password) VALUES (?, ?, ?)');
    const ib = d.prepare('INSERT INTO backlog (id, user_id, title, notes) VALUES (?, ?, ?, ?)');
    [['a', R1], ['b', R2], ['c', R1], ['d', null], ['e', '']].forEach(([u, p], i) => { iu.run(u, p); il.run(`id-${i}`, u, p); });
    for (let i = 0; i < 300; i++) ib.run(`b-${String(i).padStart(4, '0')}`, 'u', `Elemento ${i}`, 'x'.repeat(200));
    d.exec("DELETE FROM backlog WHERE id < 'b-0150'");
    if (huecoSinIndice) d.exec("DELETE FROM legacy_users WHERE id = 'id-1'");
    if (repetidaEn === 'texto') d.prepare("UPDATE backlog SET notes = ? WHERE id = 'b-0200'").run(`nota con ${R2} dentro`);
    d.close();
}

try {
    // =====================================================================
    section('1. Generador sobre fixtures sintéticos: valores distintos → sintéticos distintos');
    const f1 = join(WORK, 'f1.db');
    crearFixture(f1);
    const s1 = join(WORK, 'salida-1');
    const r1 = sanear({ fuentes: { 'emulador-antes': f1 }, salida: s1, tmp: WORK, log: silencio });
    const out1 = join(s1, archivoDe('emulador-antes'));
    check('sanear: 1/1 OK, copia y manifest escritos', r1.ok && existsSync(out1) && existsSync(join(s1, MANIFEST)));
    const d1 = new DatabaseSync(out1, { readOnly: true });
    const pu = d1.prepare('SELECT password p FROM users ORDER BY rowid').all().map((r) => r.p);
    const pl = d1.prepare('SELECT password p FROM legacy_users ORDER BY rowid').all().map((r) => r.p);
    const fl = d1.prepare('PRAGMA freelist_count').get().freelist_count;
    const uv = d1.prepare('PRAGMA user_version').get().user_version;
    d1.close();
    check('2 valores distintos → -01 y -02 en orden de aparición (legacy_users antes que users); compartidos siguen compartidos; NULL y \'\' igual',
        JSON.stringify(pu) === JSON.stringify([sinteticaN(1), sinteticaN(2), sinteticaN(1), null, ''])
        && JSON.stringify(pl) === JSON.stringify([sinteticaN(1), sinteticaN(2), sinteticaN(1), null, '']));
    check('valores ficticios "reales": 0 veces en los bytes; freelist 0; user_version igual', vecesEn(out1, R1) + vecesEn(out1, R2) === 0 && fl === 0 && uv === 2);
    const man1 = readFileSync(join(s1, MANIFEST), 'utf8');
    const e1 = JSON.parse(man1).fixtures['emulador-antes'];
    check('manifest: valoresDistintos 2, filas no vacías 6, conteos por tabla, sin valores', e1.contrasenas.valoresDistintos === 2 && e1.contrasenas.filasNoVacias === 6
        && e1.tablas.backlog === 150 && !man1.includes(R1) && !man1.includes(R2) && !man1.includes(PASSWORD_SINTETICA));
    check('el generador no dejó su directorio de trabajo', readdirSync(WORK).filter((f) => f.startsWith('sf-')).length === 0);
    check('el log del generador no contiene los valores', !callado.join('\n').includes(R1) && !callado.join('\n').includes(R2));

    // =====================================================================
    section('2. Segundo intento sin --forzar: se niega sin escribir');
    const antes2 = foto(s1);
    const r2 = sanear({ fuentes: { 'emulador-antes': f1 }, salida: s1, tmp: WORK, log: silencio });
    check('sanear sin forzar sobre una salida existente: ok=false y la salida no cambia', !r2.ok && r2.motivo === 'existe' && foto(s1) === antes2);
    const cli = spawnSync(process.execPath, ['scripts/sanear-fixtures.mjs', '--salida', s1, '--tmp', WORK], { cwd: RAIZ, encoding: 'utf8' });
    check('CLI sin --forzar: código 1, mensaje claro y la salida no cambia', cli.status === 1 && cli.stdout.includes('--forzar') && foto(s1) === antes2);
    const r2b = sanear({ fuentes: { 'emulador-antes': f1 }, salida: s1, tmp: WORK, forzar: true, log: silencio });
    check('con forzar: reemplaza la copia y el manifest', r2b.ok && existsSync(join(s1, MANIFEST)));

    // =====================================================================
    section('3. Valor real repetido en otra columna TEXT: se detiene sin escribir');
    const f3 = join(WORK, 'f3.db');
    crearFixture(f3, { repetidaEn: 'texto' });
    const s3 = join(WORK, 'salida-3');
    callado.length = 0;
    const r3 = sanear({ fuentes: { 'emulador-antes': f1, 'emulador-checklist': f3 }, salida: s3, tmp: WORK, log: silencio });
    check('ok=false, la salida no se crea (ni copias ni manifest parcial)', !r3.ok && !existsSync(s3));
    check('informa tabla y columna (backlog.notes) sin el valor', callado.some((l) => l.includes('backlog.notes')) && !callado.join('\n').includes(R2));
    // Parada por rowid: si VACUUM renumera una tabla, el generador no escribe nada.
    const f3b = join(WORK, 'f3b.db');
    crearFixture(f3b, { huecoSinIndice: true });
    const s3b = join(WORK, 'salida-3b');
    callado.length = 0;
    const r3b = sanear({ fuentes: { 'emulador-antes': f3b }, salida: s3b, tmp: WORK, log: silencio });
    check('VACUUM renumera rowid (hueco en una tabla sin índice) → se detiene sin escribir e indica la tabla',
        !r3b.ok && !existsSync(s3b) && callado.some((l) => l.startsWith('FALLA') && l.includes('difieren: legacy_users')));

    // =====================================================================
    section('4. fixture(): manifest con un hash alterado');
    check('fixture() con el manifest correcto devuelve la copia del directorio', conEnv(s1, () => fixture('emulador-antes')) === out1.replace(/\\/g, '/'));
    const manPath = join(s1, MANIFEST);
    const man = JSON.parse(readFileSync(manPath, 'utf8'));
    const shaOk = man.fixtures['emulador-antes'].sha256;
    man.fixtures['emulador-antes'].sha256 = shaOk.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    writeFileSync(manPath, JSON.stringify(man));
    const m4 = conEnv(s1, () => lanza(() => fixture('emulador-antes')));
    check('hash alterado → error que pide ejecutar sanear-fixtures', !!m4 && m4.includes('no coincide') && m4.includes('node scripts/sanear-fixtures.mjs'));
    man.fixtures['emulador-antes'].sha256 = shaOk;
    writeFileSync(manPath, JSON.stringify(man));
    const dAlt = new DatabaseSync(out1); dAlt.exec("UPDATE backlog SET title = 'cambiado' WHERE id = 'b-0151'"); dAlt.close();
    const m4b = conEnv(s1, () => lanza(() => fixture('emulador-antes')));
    check('archivo alterado (manifest intacto) → el mismo error', !!m4b && m4b.includes('no coincide'));
    check('nombre desconocido → error', !!lanza(() => fixture('no-existe')));

    // =====================================================================
    section('5. REGISTRO_FIXTURES_DIR vacío o inexistente: error claro, sin recurrir a los originales');
    const vacio = join(WORK, 'vacio');
    mkdirSync(vacio);
    let todosFallan = true, ningunOriginal = true;
    for (const dir of [vacio, join(WORK, 'no-existe')]) {
        for (const n of NOMBRES) {
            let ruta = null, msg = null;
            conEnv(dir, () => { try { ruta = fixture(n); } catch (e) { msg = e.message; } });
            if (!msg || !msg.includes('node scripts/sanear-fixtures.mjs')) todosFallan = false;
            if (ruta && resolve(ruta).toLowerCase() === resolve(RAIZ, ORIGINALES[n]).toLowerCase()) ningunOriginal = false;
        }
    }
    check(`los ${NOMBRES.length} nombres fallan con el mensaje en los dos casos`, todosFallan);
    check('nunca devuelve la ruta de un original', ningunOriginal);
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
        "import { fixtureOSalir } from './scripts/lib/fixtures.mjs'; fixtureOSalir('emulador-antes'); console.log('NO-DEBERIA');"],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, REGISTRO_FIXTURES_DIR: vacio } });
    check('fixtureOSalir (lo que usan las suites): FALLA, código 1 y no sigue', sub.status === 1 && sub.stdout.startsWith('FALLA') && !sub.stdout.includes('NO-DEBERIA'));

    // =====================================================================
    section('6. Escáner de contraseñas: un caso de cada clase');
    const esc = join(WORK, 'escaner');
    mkdirSync(join(esc, 'sub'), { recursive: true });
    const mk = (name, valor, col = true) => {
        const d = new DatabaseSync(join(esc, name));
        d.exec(`CREATE TABLE users (id TEXT${col ? ', password TEXT' : ''})`);
        if (col) d.prepare('INSERT INTO users VALUES (?, ?)').run('u', valor); else d.prepare('INSERT INTO users VALUES (?)').run('u');
        d.close();
    };
    mk('real.db', R1);
    mk('sintetica.db', sinteticaN(3));
    mk('sub/sin-columna.sqlite', null, false);
    mk('oculta.db', '[OCULTO]');
    mk('casi-sintetica.db', `${PASSWORD_SINTETICA}-1`); // un solo dígito: NO es sintética
    writeFileSync(join(esc, 'visible.json'), JSON.stringify({ data: { users: [{ id: 'u', password: R2 }] } }));
    writeFileSync(join(esc, 'oculto.json'), JSON.stringify({ data: { users: [{ id: 'u', password: '[OCULTO]' }] } }));
    writeFileSync(join(esc, 'sint.json'), JSON.stringify({ data: { users: [{ id: 'u', password: PASSWORD_SINTETICA }] } }));
    writeFileSync(join(esc, 'roto.db'), 'esto no es sqlite');
    const antes6 = foto(esc);
    const res = escanear(esc, { tmp: WORK });
    const clase = Object.fromEntries(res.map((r) => [r.ruta, r.clase]));
    check('clases: real / sintética / sin contraseña / ilegible', clase['real.db'] === 'real' && clase['visible.json'] === 'real' && clase['casi-sintetica.db'] === 'real'
        && clase['sintetica.db'] === 'sintética' && clase['sint.json'] === 'sintética'
        && clase['sub/sin-columna.sqlite'] === 'sin contraseña' && clase['oculta.db'] === 'sin contraseña' && clase['oculto.json'] === 'sin contraseña'
        && clase['roto.db'] === 'ilegible', JSON.stringify(Object.values(clase).reduce((a, c) => ({ ...a, [c]: (a[c] || 0) + 1 }), {})));
    check('el escáner no modifica los archivos ni deja copias', foto(esc) === antes6 && readdirSync(WORK).filter((f) => f.startsWith('ec-')).length === 0);
    const cli6 = spawnSync(process.execPath, ['scripts/escanear-contrasenas.mjs', '--dir', esc, '--tmp', WORK], { cwd: RAIZ, encoding: 'utf8' });
    check('CLI: código 1 con algún "real" y la salida no contiene valores', cli6.status === 1 && !cli6.stdout.includes(R1) && !cli6.stdout.includes(R2));
    for (const f of ['real.db', 'visible.json', 'casi-sintetica.db', 'roto.db']) rmSync(join(esc, f));
    const cli6b = spawnSync(process.execPath, ['scripts/escanear-contrasenas.mjs', '--dir', esc, '--tmp', WORK], { cwd: RAIZ, encoding: 'utf8' });
    check('CLI: código 0 sin "real" ni "ilegible"', cli6b.status === 0);
    check('patrón sintético: constante sola o con dos dígitos', esSintetica(PASSWORD_SINTETICA) && esSintetica(sinteticaN(1)) && esSintetica(sinteticaN(99))
        && !esSintetica(`${PASSWORD_SINTETICA}-001`) && !esSintetica(`x${PASSWORD_SINTETICA}`) && !esSintetica(`${PASSWORD_SINTETICA}-01 `) && SINTETICA_RE.flags === '');

    // =====================================================================
    section('7. Los 7 fixtures');
    const existen = NOMBRES.filter((n) => existsSync(resolve(RAIZ, ORIGINALES[n])));
    if (existen.length === NOMBRES.length) {
        const s7 = join(WORK, 'salida-7');
        callado.length = 0;
        const r7 = sanear({ salida: s7, tmp: WORK, log: silencio });
        const fallos = callado.filter((l) => l.startsWith('FALLA')).length;
        check('originales presentes: sanear 7/7 con todas las verificaciones', r7.ok && fallos === 0, `${fallos} FALLA`);
        check('fixture() valida los 7 en esa salida', r7.ok && conEnv(s7, () => NOMBRES.every((n) => existsSync(fixture(n)))));
    } else if (existen.length === 0) {
        let ok = true;
        try { for (const n of NOMBRES) fixture(n); } catch { ok = false; }
        check('originales ya borrados: fixture() valida los 7 en el directorio de copias saneadas', ok);
    } else {
        check('los 7 originales están todos o ninguno', false, `${existen.length} de ${NOMBRES.length}`);
    }
} finally {
    rmSync(WORK, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nTODAS LAS PRUEBAS DE LA FASE 7.1 PASARON.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
