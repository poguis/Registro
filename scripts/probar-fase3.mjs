// Pruebas en PC de la Fase 3 con el código REAL de src/ sobre node:sqlite:
//   - migración 3 (users sin password, legacy_users.password vacío, secure_delete);
//   - vinculación con Google (uid ficticio), bloqueos y fallos simulados;
//   - flujo de cuenta (identidad al arrancar, @user_session, instalación nueva);
//   - storage cifrado, URL de retorno por variante, parser del callback y plugin de firma.
// Trabaja en .local-data/pruebas-fase3/ con copias (nunca toca originales). No imprime filas
// ni contraseñas: solo conteos.
//
// Uso: node scripts/probar-fase3.mjs
import './lib/test-hooks.mjs';
import { mkdirSync, rmSync, copyFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { hashRows } from './lib/sqlite-utils.mjs';

const require = createRequire(import.meta.url);
const { __setDatabasePath, openDatabaseAsync } = await import('./lib/expo-sqlite-shim.mjs');
const { backupCalls, backupStub } = await import('./lib/backup-stub.mjs');
const { asyncStore, secureStore, constantsState, AsyncStorageStub: AsyncStorageOther } = await import('./lib/auth-stubs.mjs');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { MIGRATIONS, runMigrations, LATEST_VERSION } = await import('../src/services/migrations.js');
const { DatabaseService } = await import('../src/services/db.js');
const dbSingleton = (await import('../src/services/db.js')).default;
const { DOMAIN_TABLES } = await import('../src/data/db/migration3.ts');
const { LargeSecureStore, encrypt, decrypt } = await import('../src/auth/secureStorage.ts');
const { redirectUrlFor, parseCallbackUrl, getRedirectUrl, getVariant } = await import('../src/auth/redirect.ts');
const { installCryptoShim } = await import('../src/auth/cryptoShim.ts');
const flow = await import('../src/auth/accountFlow.ts');

const WORK = resolve('.local-data/pruebas-fase3').replace(/\\/g, '/');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);
const quiet = async (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try { return await fn(); } finally { console.log = log; console.error = error; }
};

// ---------------------------------------------------------------- utilidades de BD
const prepare = (label, source) => {
    const dir = `${WORK}/${label}`;
    mkdirSync(dir, { recursive: true });
    copyFileSync(source, `${dir}/app_registro_v3.db`);
    return `${dir}/app_registro_v3.db`;
};
// Lleva una copia hasta la v2 con el runner real (sin la migración 3).
async function toV2(path) {
    const later = MIGRATIONS.splice(2); // quita las migraciones posteriores a la 2
    try {
        __setDatabasePath(path);
        const conn = await openDatabaseAsync('app_registro_v3.db');
        await quiet(() => runMigrations(conn, { createPhysicalCopy: async () => ({ path: 'stub' }), listDbFiles: () => [] }));
        await conn.closeAsync();
    } finally {
        MIGRATIONS.push(...later);
    }
}
const open = async (path) => {
    __setDatabasePath(path);
    const svc = new DatabaseService();
    const ok = await quiet(() => svc.init());
    return { svc, ok };
};
const raw = (path) => new DatabaseSync(path, { readOnly: true });
const uv = (path) => { const d = raw(path); const v = d.prepare('PRAGMA user_version').get().user_version; d.close(); return v; };
const colsOf = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
// Huella de las 15 tablas (opcionalmente sin user_id) + conteos + outbox.
function snapshot(path, { withoutUserId = false } = {}) {
    const d = raw(path);
    const s = { counts: {}, hashes: {} };
    for (const t of DOMAIN_TABLES) {
        let rows = d.prepare(`SELECT * FROM ${t}`).all();
        if (withoutUserId) rows = rows.map(({ user_id, ...r }) => r);
        s.counts[t] = rows.length;
        s.hashes[t] = hashRows(rows);
    }
    s.outbox = d.prepare('SELECT COUNT(*) n FROM outbox').get().n;
    s.users = hashRows(d.prepare('SELECT * FROM users').all());
    s.legacyUsers = hashRows(d.prepare('SELECT * FROM legacy_users').all());
    s.log = d.prepare('SELECT COUNT(*) n FROM _migration_log').get().n;
    s.uv = d.prepare('PRAGMA user_version').get().user_version;
    d.close();
    return s;
}
const sameDomain = (a, b) => JSON.stringify(a.counts) === JSON.stringify(b.counts) && JSON.stringify(a.hashes) === JSON.stringify(b.hashes);
const sameAll = (a, b) => sameDomain(a, b) && a.outbox === b.outbox && a.users === b.users && a.legacyUsers === b.legacyUsers && a.log === b.log && a.uv === b.uv;
const passwordsOf = (path) => {
    const d = raw(path);
    const out = [];
    for (const t of ['users', 'legacy_users']) {
        if (colsOf(d, t).includes('password')) {
            for (const r of d.prepare(`SELECT password FROM ${t}`).all()) if (r.password && r.password.length >= 3) out.push(r.password);
        }
    }
    d.close();
    return [...new Set(out)];
};
const bytesContain = (path, needles) => {
    const buf = readFileSync(path);
    return needles.filter((n) => buf.includes(Buffer.from(n, 'utf8'))).length;
};

const SOURCES = {
    'real (celular, post-fix)': '.local-data/respaldo-post-fase1-fix/registro_respaldo_20261025-195442.db',
    'emulador tras checklist': '.local-data/emulador-fase1/tras-checklist.db',
    'A (emulador antes, v1)': '.local-data/emulador-antes.db',
    'B (2 cuentas, v1)': '.local-data/emulador/checklist/app.db',
    'C (emulador EAS, v1)': '.local-data/emulador-eas/antes.db',
};

// ---------------------------------------------------------------------------
section('Migración 3 sobre las BD reales y de prueba');
const migrated = {};
for (const [label, source] of Object.entries(SOURCES)) {
    if (!existsSync(source)) { check(`${label}: existe`, false, source); continue; }
    const key = label.split(' ')[0];
    const path = prepare(key, source);
    await toV2(path);
    const before = snapshot(path);
    const passwords = passwordsOf(path);
    const d0 = raw(path);
    const usersBefore = JSON.stringify(d0.prepare('SELECT id, username FROM users ORDER BY id').all().map((r) => ({ ...r })));
    d0.close();
    backupCalls.length = 0;
    const r = await open(path);
    await r.svc.db?.closeAsync();
    const after = snapshot(path);
    const d = raw(path);
    const noPwCol = !colsOf(d, 'users').includes('password') && ['email', 'linked_at'].every((c) => colsOf(d, 'users').includes(c));
    const legacyVisible = d.prepare("SELECT COUNT(*) n FROM legacy_users WHERE password <> ''").get().n;
    const usersAfter = JSON.stringify(d.prepare('SELECT id, username FROM users ORDER BY id').all().map((x) => ({ ...x })));
    const log3 = d.prepare("SELECT COUNT(*) n FROM _migration_log WHERE version = 3 AND kind = 'summary'").get().n;
    d.close();
    const leaked = bytesContain(path, passwords);
    check(`${label}: v2 → v${LATEST_VERSION}, copia previa pedida`, before.uv === 2 && r.ok && after.uv === LATEST_VERSION && backupCalls.includes('pre-migracion-v3'));
    check(`${label}: 15 tablas idénticas (conteos y contenido) y outbox sin cambios`, sameDomain(before, after) && before.outbox === after.outbox,
        `${Object.values(after.counts).reduce((a, b) => a + b, 0)} filas`);
    check(`${label}: users sin password (con email y linked_at), mismos usuarios`, noPwCol && usersAfter === usersBefore, `${JSON.parse(usersAfter).length} cuenta(s)`);
    check(`${label}: legacy_users.password vacío y resumen en _migration_log`, legacyVisible === 0 && log3 === 1);
    check(`${label}: secure_delete — 0 de ${passwords.length} contraseña(s) quedan en los bytes del .db`, leaked === 0 && !existsSync(`${path}-journal`));
    const r2 = await open(path);
    await r2.svc.db?.closeAsync();
    check(`${label}: segundo arranque no hace nada`, r2.ok && r2.svc.lastMigration.applied.length === 0 && sameAll(after, snapshot(path)));
    migrated[key] = path;
}

// ---------------------------------------------------------------------------
section('Migración 3: fallos simulados');
{
    const path = prepare('fallo-m3', SOURCES['emulador tras checklist']);
    await toV2(path);
    const before = snapshot(path);
    DEV_FLAGS.DEV_FAIL_MIGRATION = true;
    const r = await open(path);
    DEV_FLAGS.DEV_FAIL_MIGRATION = false;
    check('DEV_FAIL_MIGRATION: init falla y la BD queda idéntica (v2, password intacto)', !r.ok && sameAll(before, snapshot(path)) && passwordsOf(path).length > 0);
    backupStub.shouldFail = true;
    const rb = await open(path);
    backupStub.shouldFail = false;
    check('copia previa fallida: no migra y no toca nada', !rb.ok && sameAll(before, snapshot(path)));
    const rr = await open(path);
    await rr.svc.db?.closeAsync();
    check(`reintento: migra hasta v${LATEST_VERSION}`, rr.ok && uv(path) === LATEST_VERSION);
}

// ---------------------------------------------------------------------------
section('Vinculación con Google (uid ficticio)');
async function linkCase(label, path, uid, email = 'prueba@ejemplo.test') {
    const r = await open(path);
    const res = await quiet(() => r.svc.linkAccount(uid, email));
    await r.svc.db?.closeAsync();
    return res;
}
for (const key of ['real', 'emulador', 'A', 'C']) {
    const src = migrated[key];
    if (!src) continue;
    const path = prepare(`vincular-${key}`, src);
    const before = snapshot(path);
    const beforeNoUid = snapshot(path, { withoutUserId: true });
    const uid = randomUUID();
    backupCalls.length = 0;
    const res = await linkCase(key, path, uid);
    const after = snapshot(path);
    const afterNoUid = snapshot(path, { withoutUserId: true });
    const d = raw(path);
    let foreign = 0;
    for (const t of DOMAIN_TABLES) foreign += d.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id <> ?`).get(uid).n;
    const u = d.prepare('SELECT id, email, linked_at FROM users').all();
    const linkLog = d.prepare("SELECT COUNT(*) n FROM _migration_log WHERE kind = 'link'").get().n;
    d.close();
    check(`${key}: vincula (copia previa pedida)`, res.success && res.result.status === 'linked' && backupCalls.includes('pre-vinculacion'), res.error || res.result?.status);
    check(`${key}: conteos idénticos, 0 user_id ≠ uid, contenido igual salvo user_id (updated_at intacto)`,
        JSON.stringify(before.counts) === JSON.stringify(after.counts) && foreign === 0 && JSON.stringify(beforeNoUid.hashes) === JSON.stringify(afterNoUid.hashes));
    check(`${key}: users.id = uid con email y linked_at; nada en la outbox; registro 'link'`,
        u.length === 1 && u[0].id === uid && u[0].email === 'prueba@ejemplo.test' && !!u[0].linked_at && after.outbox === before.outbox && linkLog === 1);
    const s1 = snapshot(path);
    const again = await linkCase(key, path, uid);
    check(`${key}: segunda vinculación con el mismo uid → 'already', sin cambios`, again.success && again.result.status === 'already' && sameAll(s1, snapshot(path)));
    const other = await linkCase(key, path, randomUUID(), 'otra@ejemplo.test');
    check(`${key}: otra cuenta de Google → 'other-account', sin cambios`, other.success && other.result.status === 'other-account' && sameAll(s1, snapshot(path)));
}
if (migrated.B) {
    const path = prepare('vincular-B', migrated.B);
    const before = snapshot(path);
    backupCalls.length = 0;
    const res = await linkCase('B', path, randomUUID());
    check('B (2 cuentas locales): vinculación bloqueada, sin copia ni cambios', res.success && res.result.status === 'multiple-accounts' && !backupCalls.includes('pre-vinculacion') && sameAll(before, snapshot(path)));
}
{
    const path = prepare('vincular-fallo', migrated.emulador);
    const before = snapshot(path);
    DEV_FLAGS.DEV_FAIL_LINK = true;
    const res = await linkCase('fallo', path, randomUUID());
    DEV_FLAGS.DEV_FAIL_LINK = false;
    check('DEV_FAIL_LINK: la vinculación falla y la BD queda idéntica', !res.success && sameAll(before, snapshot(path)), res.error);
    backupStub.shouldFail = true;
    const rb = await linkCase('fallo', path, randomUUID());
    backupStub.shouldFail = false;
    check('copia previa fallida: no vincula y no toca nada', !rb.success && sameAll(before, snapshot(path)));
    const bad = await linkCase('fallo', path, 'no-es-un-uuid');
    check('uid no válido: rechazado sin cambios', !bad.success && sameAll(before, snapshot(path)));
}

// ---------------------------------------------------------------------------
section('Flujo de cuenta (accountFlow) con el singleton de la app');
async function useSingleton(path) {
    if (dbSingleton.db) await dbSingleton.db.closeAsync();
    dbSingleton.db = null;
    dbSingleton._initPromise = null;
    __setDatabasePath(path);
    return quiet(() => dbSingleton.init());
}
const fakeSession = (id, email) => ({ user: { id, email } });
{
    const path = prepare('flujo', migrated.real);
    await useSingleton(path);
    asyncStore.clear();
    asyncStore.set(flow.LEGACY_SESSION_KEY, JSON.stringify({ id: 1, username: 'x' })); // sesión antigua (id entero)
    const id1 = await quiet(() => flow.resolveStartupIdentity());
    check('sin vincular y sin red: abre con la cuenta local (sesión antigua mapeada a UUID)', id1.kind === 'open' && !id1.user.linked
        && JSON.parse(asyncStore.get(flow.LEGACY_SESSION_KEY)).id === id1.user.id);
    asyncStore.delete(flow.LEGACY_SESSION_KEY);
    const id2 = await quiet(() => flow.resolveStartupIdentity());
    check('sin vincular y sin @user_session: abre con la única cuenta', id2.kind === 'open');
    asyncStore.set(flow.LEGACY_SESSION_KEY, JSON.stringify({ id: id2.user.id, username: id2.user.username }));
    const uid = randomUUID();
    const a1 = await quiet(() => flow.afterGoogleLogin(fakeSession(uid, 'yo@ejemplo.test')));
    check('login con Google sobre datos sin vincular → pide confirmación con el email', a1.kind === 'confirm-link' && a1.email === 'yo@ejemplo.test');
    const c = await quiet(() => flow.confirmLink(fakeSession(uid, 'yo@ejemplo.test')));
    check('confirmar → vinculado y @user_session borrada', c.ok && c.user.id === uid && c.user.linked && !asyncStore.has(flow.LEGACY_SESSION_KEY));
    const id3 = await quiet(() => flow.resolveStartupIdentity());
    check('vinculado, sin red ni sesión de Google: abre con los datos locales', id3.kind === 'open' && id3.user.id === uid);
    const a2 = await quiet(() => flow.afterGoogleLogin(fakeSession(uid, 'yo@ejemplo.test')));
    check('mismo Google tras vincular → entra directo', a2.kind === 'ready' && a2.user.id === uid);
    const before = snapshot(path);
    const a3 = await quiet(() => flow.afterGoogleLogin(fakeSession(randomUUID(), 'otra@ejemplo.test')));
    check('otra cuenta de Google tras vincular → bloqueada, sin cambios', a3.kind === 'blocked' && a3.reason === 'other-account' && sameAll(before, snapshot(path)));
}
if (migrated.B) {
    const path = prepare('flujo-B', migrated.B);
    await useSingleton(path);
    asyncStore.clear();
    const idB = await quiet(() => flow.resolveStartupIdentity());
    check('B sin @user_session: lista para elegir cuenta local', idB.kind === 'choose' && idB.users.length === 2);
    const aB = await quiet(() => flow.afterGoogleLogin(fakeSession(randomUUID(), 'x@ejemplo.test')));
    check('B: login con Google → bloqueado (varias cuentas), sin cambios', aB.kind === 'blocked' && aB.reason === 'multiple-accounts');
}
{
    // Instalación nueva: BD vacía (init crea el esquema desde cero y migra hasta la 3).
    const dir = `${WORK}/nueva`;
    mkdirSync(dir, { recursive: true });
    const path = `${dir}/app_registro_v3.db`;
    await useSingleton(path);
    asyncStore.clear();
    const idN = await quiet(() => flow.resolveStartupIdentity());
    check('instalación nueva: exige login con Google', idN.kind === 'needs-login' && uv(path) === LATEST_VERSION);
    const uid = randomUUID();
    const aN = await quiet(() => flow.afterGoogleLogin(fakeSession(uid, 'nuevo@ejemplo.test')));
    const d = raw(path);
    const cats = d.prepare('SELECT COUNT(*) n FROM finance_categories WHERE user_id = ?').get(uid).n;
    const ob = d.prepare("SELECT COUNT(*) n FROM outbox WHERE table_name = 'finance_categories'").get().n;
    const usersN = d.prepare('SELECT id, linked_at FROM users').all();
    d.close();
    check('instalación nueva: crea la cuenta vinculada (id = uid) con 6 categorías en la outbox', aN.kind === 'ready' && usersN.length === 1 && usersN[0].id === uid && !!usersN[0].linked_at && cats === 6 && ob === 6);
}
if (dbSingleton.db) await dbSingleton.db.closeAsync();

// ---------------------------------------------------------------------------
section('Storage cifrado (LargeSecureStore)');
{
    asyncStore.clear();
    secureStore.clear();
    const key = 'sb-apftkztkqvjpvdmeixzw-auth-token';
    // JWT ficticio armado en tiempo de ejecución (verificar-secretos rechaza tokens literales en el repo).
    const fakeJwt = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiJwcnVlYmEifQ', 'firma-ficticia'].join('.');
    const session = JSON.stringify({ access_token: fakeJwt, refresh_token: 'refresh-ficticio-123', token_type: 'bearer' });
    await LargeSecureStore.setItem(key, session);
    const stored = asyncStore.get(key) || '';
    check('AsyncStorage guarda solo hex cifrado (sin eyJ, access_token ni refresh_token)', /^[0-9a-f]+$/.test(stored) && !/eyJ|access_token|refresh_token/.test(stored));
    check('SecureStore guarda una llave de 256 bits (64 hex)', /^[0-9a-f]{64}$/.test(secureStore.get(key) || ''));
    check('getItem devuelve el valor original', (await LargeSecureStore.getItem(key)) === session);
    const firstKey = secureStore.get(key);
    await LargeSecureStore.setItem(key, session);
    check('cada setItem usa una llave nueva (CTR sin reutilizar llave)', secureStore.get(key) !== firstKey && asyncStore.get(key) !== stored);
    secureStore.delete(key); // como tras restaurar un Auto Backup: hay cifrado pero no llave
    check('cifrado sin llave → sin sesión y se borra el residuo', (await LargeSecureStore.getItem(key)) === null && !asyncStore.has(key));
    await LargeSecureStore.setItem(`${key}-code-verifier`, 'verificador');
    check('clave del code_verifier PKCE válida para SecureStore', (await LargeSecureStore.getItem(`${key}-code-verifier`)) === 'verificador');
    await LargeSecureStore.removeItem(key);
    check('removeItem borra cifrado y llave', !asyncStore.has(key) && !secureStore.has(key));
    const k = new Uint8Array(32).fill(7);
    check('encrypt/decrypt AES-256-CTR ida y vuelta (UTF-8)', decrypt(encrypt('ñandú ✓', k), k) === 'ñandú ✓');
}

// ---------------------------------------------------------------------------
section('Limpieza de verificadores PKCE residuales');
{
    const { clearPkceVerifiers } = await import('../src/auth/googleAuth.ts');
    asyncStore.clear();
    secureStore.clear();
    const base = 'sb-apftkztkqvjpvdmeixzw-auth-token';
    await LargeSecureStore.setItem(base, '{"sesion":"ficticia"}');
    for (const k of [`${base}-flow-37c071ff-code-verifier`, `${base}-flow-b602ad5b-code-verifier`, `${base}-flows-code-verifier`, `${base}-code-verifier`]) {
        await LargeSecureStore.setItem(k, 'verificador');
    }
    await AsyncStorageOther.setItem('@otra_clave', 'x');
    const removed = await clearPkceVerifiers();
    const left = [...asyncStore.keys()];
    check('borra los 4 (slots, índice y clave clásica), cifrado y llave', removed === 4 && !left.some((k) => k.endsWith('-code-verifier')) && ![...secureStore.keys()].some((k) => k.endsWith('-code-verifier')));
    check('no toca la sesión ni otras claves', left.includes(base) && left.includes('@otra_clave') && (await LargeSecureStore.getItem(base)) === '{"sesion":"ficticia"}');
}

// ---------------------------------------------------------------------------
section('Shim de crypto para PKCE (S256)');
{
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    let ok = false;
    let detail = '';
    try {
        Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
        installCryptoShim();
        const c = globalThis.crypto;
        const bytes = c.getRandomValues(new Uint8Array(16));
        const digest = new Uint8Array(await c.subtle.digest('SHA-256', new TextEncoder().encode('abc')));
        const hex = Buffer.from(digest).toString('hex');
        ok = bytes.some((b) => b !== 0) && hex === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        detail = 'getRandomValues + SHA-256("abc") correcto';
    } catch (e) {
        detail = e.message;
    } finally {
        Object.defineProperty(globalThis, 'crypto', desc);
    }
    check('sin crypto global (como Hermes), el shim provee getRandomValues y subtle.digest SHA-256', ok, detail);
}

// ---------------------------------------------------------------------------
section('Variantes y URL de retorno');
{
    const appJson = JSON.parse(readFileSync('app.json', 'utf8')).expo;
    const appConfig = require('../app.config.js');
    const evalVariant = (v) => {
        const prev = process.env.APP_VARIANT;
        if (v) process.env.APP_VARIANT = v; else delete process.env.APP_VARIANT;
        try { return appConfig({ config: appJson }); } finally { if (prev === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = prev; }
    };
    const prod = evalVariant(null);
    const dev = evalVariant('development');
    check('producción: com.poguis.Registro, "Registro", poguis-registro', prod.android.package === 'com.poguis.Registro' && prod.name === 'Registro' && prod.scheme === 'poguis-registro');
    check('desarrollo: com.poguis.Registro.dev, "Registro Dev", poguis-registro-dev', dev.android.package === 'com.poguis.Registro.dev' && dev.name === 'Registro Dev' && dev.scheme === 'poguis-registro-dev');
    // Misma versión en las dos variantes (la vigente de app.json; 1.3.2 / 6 desde la Fase 6.5).
    check('versión 1.3.2 / versionCode 6 en ambas', [prod, dev].every((c) => c.version === '1.3.2' && c.android.versionCode === 6));
    check('plugin de firma: eas en producción, debug solo en dev', JSON.stringify(prod.plugins.at(-1)) === JSON.stringify(['./plugins/withReleaseSigning', { mode: 'eas' }])
        && JSON.stringify(dev.plugins.at(-1)) === JSON.stringify(['./plugins/withReleaseSigning', { mode: 'debug' }]));
    check('expo-secure-store excluido del Auto Backup (configureAndroidBackup: true)', prod.plugins.some((p) => Array.isArray(p) && p[0] === 'expo-secure-store' && p[1].configureAndroidBackup === true));
    constantsState.expoConfig = prod;
    const rProd = getRedirectUrl();
    const vProd = getVariant();
    constantsState.expoConfig = dev;
    const rDev = getRedirectUrl();
    const vDev = getVariant();
    constantsState.expoConfig = null;
    check('redirectTo exacto: poguis-registro://auth/callback y poguis-registro-dev://auth/callback',
        rProd === 'poguis-registro://auth/callback' && rDev === 'poguis-registro-dev://auth/callback', `${rProd} · ${rDev}`);
    check('getVariant: producción vs development (la prueba de RLS solo en dev)', vProd === 'production' && vDev === 'development');
    let threw = false;
    try { evalVariant('staging'); } catch { threw = true; }
    check('APP_VARIANT desconocida → error al evaluar la config', threw);
    const red = redirectUrlFor('poguis-registro');
    check('callback con ?code=…', JSON.stringify(parseCallbackUrl(`${red}?code=abc-123`, red)) === '{"code":"abc-123"}');
    check('callback con #error_description', 'error' in parseCallbackUrl(`${red}#error=access_denied&error_description=Usuario+cancel%C3%B3`, red)
        && parseCallbackUrl(`${red}#error=access_denied&error_description=Usuario+cancel%C3%B3`, red).error === 'Usuario canceló');
    check('callback sin parámetros → error', 'error' in parseCallbackUrl(red, red));
    check('callback de otro scheme (p. ej. la otra variante) → error', 'error' in parseCallbackUrl('poguis-registro-dev://auth/callback?code=x', red));
}

// ---------------------------------------------------------------------------
section('Plugin de firma sobre la plantilla real de prebuild (node_modules/expo/template.tgz)');
{
    const { applySigning } = require('../plugins/withReleaseSigning.js');
    const template = execSync('tar -xzOf node_modules/expo/template.tgz package/android/app/build.gradle').toString();
    const eas = applySigning(template, 'eas');
    const releaseBlock = eas.slice(eas.indexOf('buildTypes'));
    check('eas: lee las 4 propiedades REGISTRO_UPLOAD_* y falla en whenReady si faltan',
        ['REGISTRO_UPLOAD_STORE_FILE', 'REGISTRO_UPLOAD_STORE_PASSWORD', 'REGISTRO_UPLOAD_KEY_ALIAS', 'REGISTRO_UPLOAD_KEY_PASSWORD'].every((p) => eas.includes(`'${p}'`))
        && eas.includes('gradle.taskGraph.whenReady') && eas.includes('throw new GradleException'));
    check('eas: buildTypes.release usa signingConfigs.release (nunca debug)', /release\s*\{[\s\S]*?signingConfig signingConfigs\.release/.test(releaseBlock)
        && !/release\s*\{[^}]*signingConfig signingConfigs\.debug/.test(releaseBlock));
    check('eas: buildTypes.debug sigue con signingConfigs.debug', /debug\s*\{\s*signingConfig signingConfigs\.debug/.test(releaseBlock));
    check('eas: aplicar dos veces no duplica (idempotente)', applySigning(eas, 'eas') === eas);
    const dbg = applySigning(template, 'debug');
    check('debug (variante dev): release con debug.keystore y sin propiedades de EAS', !dbg.includes('REGISTRO_UPLOAD') && /release\s*\{[\s\S]*?signingConfig signingConfigs\.debug/.test(dbg.slice(dbg.indexOf('buildTypes'))));
    check('el plugin no contiene valores secretos (solo nombres de propiedades)', !/storePassword\s+'(?!android')/.test(eas) && !/keyPassword\s+'(?!android')/.test(eas));
}

// ---------------------------------------------------------------------------
section('Respaldo: dos en el mismo segundo no chocan (VACUUM INTO no sobrescribe)');
{
    const backup = await import('../src/services/backup.js');
    __setDatabasePath(migrated.real);
    const b1 = await quiet(() => backup.createBackup());
    const b2 = await quiet(() => backup.createBackup());
    const b3 = await quiet(() => backup.createPhysicalCopy('pre-vinculacion', b1.stamp));
    const b4 = await quiet(() => backup.createPhysicalCopy('pre-vinculacion', b1.stamp));
    check('createBackup seguido: archivos distintos, cada JSON con el sello de su .db',
        b1.physical.path !== b2.physical.path && b1.json.path !== b2.json.path && b2.json.path.includes(b2.stamp) && existsSync(b2.physical.path));
    check('copia previa repetida con el mismo sello: no falla (sufijo -2)', b3.path !== b4.path && b4.path.endsWith(`${b1.stamp}-2.db`));
}

console.log(failures === 0 ? '\nTODAS LAS PRUEBAS DE LA FASE 3 PASARON.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
