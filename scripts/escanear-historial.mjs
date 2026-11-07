// Escaneo de secretos en TODO el historial de git (Fase 6.1). Solo lectura: usa git rev-list,
// git log --all -p, git log --all --name-only y git ls-files. NUNCA imprime un valor: solo tipo,
// severidad, commit corto, fecha y ruta. Al final corre verificar-secretos.mjs sobre el repo y
// sobre el último APK release y el último dev de .local-data/apk/.
//
// Uso: node scripts/escanear-historial.mjs
// Salida: 0 sin hallazgos CRÍTICOS ni ALTOS y verificar-secretos (repo + release) OK;
//         1 hallazgo ALTO o verificar-secretos falló; 2 hallazgo CRÍTICO.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';

const printed = [];
const out = (line = '') => { printed.push(line); console.log(line); };
// Sin shell (argumentos como lista): el mismo comando funciona en Windows y en POSIX.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });

// ---------------------------------------------------------------- patrones de VALOR (contenido)
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const VALUE_PATTERNS = [
    // [tipo, severidad, regex] — sb_secret_: la misma regex que verificar-secretos.mjs.
    ['sb_secret_ (secret key de Supabase)', 'CRÍTICO', /sb_secret_[A-Za-z0-9][A-Za-z0-9_-]{19,}/g],
    ['GOCSPX- (client secret de Google)', 'CRÍTICO', /GOCSPX-[A-Za-z0-9_-]{8,}/g],
    ['REGISTRO_UPLOAD_*_PASSWORD con valor asignado', 'ALTO', /REGISTRO_UPLOAD_(STORE|KEY)_PASSWORD\s*[=:]\s*[^\s'"()]/g],
    ['sb_publishable_ (clave pública por diseño)', 'informativo', /sb_publishable_[A-Za-z0-9_-]{10,}/g],
];
// Rol del payload de un JWT, decodificado en memoria (el token nunca se guarda ni se imprime).
const jwtRole = (token) => {
    try {
        const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).role || '(sin role)';
    } catch {
        return '(no decodificable)';
    }
};

// ---------------------------------------------------------------- patrones de NOMBRE de archivo
const FILE_PATTERNS = [
    ['archivo de llave (.jks/.keystore/.p12/.pem)', /\.(jks|keystore|p12|pem)$/i],
    ['archivo .env', /(^|\/)\.env$/],
];
const fileSeverity = (type, path) => (/(^|\/)debug\.keystore$/.test(path) ? 'informativo (debug.keystore)' : 'ALTO');

const findings = new Map(); // clave tipo|commit|ruta → hallazgo (sin valor)
const add = (type, severity, commit, date, path) => {
    const key = `${type}|${commit}|${path}`;
    if (!findings.has(key)) findings.set(key, { type, severity, commit, date, path, n: 0 });
    findings.get(key).n++;
};

// Clasifica una línea: llama a sink(tipo, severidad) por cada coincidencia (nunca con el valor).
function scanLine(line, sink) {
    for (const [type, severity, re] of VALUE_PATTERNS) {
        for (const _ of line.matchAll(re)) sink(type, severity);
    }
    for (const m of line.matchAll(JWT_RE)) {
        const role = jwtRole(m[0]);
        if (role === 'service_role') sink('JWT con role service_role', 'CRÍTICO');
        else sink(`JWT (role ${role})`, 'informativo');
    }
}

// Autoprueba con secretos SINTÉTICOS generados en memoria (no hay literales de clave en este
// archivo): cada patrón debe detectarse, y una mención sin valor no.
{
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const fakeJwt = (role) => `${b64({ alg: 'HS256' })}.${b64({ role, iss: 'prueba' })}.${'x'.repeat(20)}`;
    const cases = [
        [`const k = "${'sb_' + 'secret_'}${'A'.repeat(24)}"`, 'CRÍTICO'],
        [`id: ${'GOCSPX'}-${'B'.repeat(12)}`, 'CRÍTICO'],
        [`token=${fakeJwt('service_role')}`, 'CRÍTICO'],
        [`token=${fakeJwt('anon')}`, 'informativo'],
        [`${'REGISTRO_UPLOAD_'}STORE_PASSWORD=${'C'.repeat(10)}`, 'ALTO'],
        [`key: ${'sb_' + 'publishable_'}${'D'.repeat(16)}`, 'informativo'],
        ["storePassword project.findProperty('REGISTRO_UPLOAD_STORE_PASSWORD')", null],
    ];
    const bad = cases.filter(([line, expected]) => {
        const got = [];
        scanLine(line, (_t, sev) => got.push(sev));
        return expected === null ? got.length !== 0 : !(got.length === 1 && got[0] === expected);
    });
    if (bad.length) { console.log(`FALLA autoprueba de patrones: ${bad.length} caso(s)`); process.exit(1); }
}

// ---------------------------------------------------------------- 1. contenido de todo el historial
const commits = Number(git('rev-list', '--all', '--count').trim());
const log = git('log', '--all', '-p', '--no-color', '--format=@@C %h %cs');
let commit = '?', date = '?', path = '?';
let addedLines = 0;
const scannedPaths = new Set();
for (const line of log.split('\n')) {
    if (line.startsWith('@@C ')) { [, commit, date] = line.split(' '); continue; }
    if (line.startsWith('diff --git ')) { const m = / b\/(.*)$/.exec(line); path = m ? m[1] : '?'; continue; }
    if (line.startsWith('+++ ')) { if (line !== '+++ /dev/null') path = line.replace(/^\+\+\+ b\//, ''); continue; }
    if (!line.startsWith('+')) continue; // solo líneas agregadas: un secreto borrado ya apareció al agregarse
    addedLines++;
    scannedPaths.add(path);
    scanLine(line, (type, severity) => add(type, severity, commit, date, path));
}

// ---------------------------------------------------------------- 2. nombres de archivo (historial y hoy)
let fc = '?', fd = '?';
for (const line of git('log', '--all', '--name-only', '--format=@@C %h %cs').split('\n')) {
    if (line.startsWith('@@C ')) { [, fc, fd] = line.split(' '); continue; }
    if (!line.trim()) continue;
    for (const [type, re] of FILE_PATTERNS) if (re.test(line)) add(`${type} en el historial`, fileSeverity(type, line), fc, fd, line);
}
for (const f of git('ls-files').split('\n').filter(Boolean)) {
    for (const [type, re] of FILE_PATTERNS) if (re.test(f)) add(`${type} versionado HOY`, fileSeverity(type, f), 'HEAD', '-', f);
}

// ---------------------------------------------------------------- reporte (sin valores)
out(`== Escaneo del historial: ${commits} commits (git log --all), ${addedLines} líneas agregadas en ${scannedPaths.size} rutas + nombres de archivo ==`);
out('Autoprueba de patrones con secretos sintéticos: OK (7/7)');
const all = [...findings.values()];
const severities = ['CRÍTICO', 'ALTO'];
for (const sev of severities) {
    const list = all.filter((f) => f.severity === sev);
    out(`\n${sev}: ${list.length}`);
    for (const f of list) out(`  ${f.type} · commit ${f.commit} · ${f.date} · ${f.path} (${f.n} coincidencia/s)`);
}
const info = all.filter((f) => !severities.includes(f.severity));
out(`\nInformativos: ${info.length} (por tipo: coincidencias · commits distintos · rutas)`);
const byType = new Map();
for (const f of info) {
    const t = byType.get(f.type) || { n: 0, commits: new Set(), paths: new Set() };
    t.n += f.n; t.commits.add(f.commit); t.paths.add(f.path);
    byType.set(f.type, t);
}
for (const [type, t] of byType) out(`  ${type}: ${t.n} · ${t.commits.size} commit/s · ${[...t.paths].join(', ')}`);

const critical = all.filter((f) => f.severity === 'CRÍTICO').length;
const high = all.filter((f) => f.severity === 'ALTO').length;
if (critical) {
    out('\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    out(`!!! ${critical} hallazgo(s) CRÍTICO(s): DETENERSE y avisar al usuario antes de seguir. !!!`);
    out('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
}

// ---------------------------------------------------------------- 3. verificar-secretos (repo y APK)
const latest = (prefix) => {
    const dir = '.local-data/apk';
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.apk'))
        .map((f) => ({ f: `${dir}/${f}`, t: statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t);
    return files.length ? files[0].f : null;
};
// Fallos que son desfase de configuración de un APK viejo con el .env actual (no secretos ni el
// proyecto/clave del otro): la URL o la clave de SU proyecto, o syncEnabled.
const CONFIG_DRIFT = [/la URL es la de su proyecto en \.env/, /la clave es la de su proyecto en \.env/, /sincronización/];
const runVerifier = (label, extra, informative) => {
    out(`\n== verificar-secretos ${label} ==`);
    const r = spawnSync(process.execPath, ['scripts/verificar-secretos.mjs', ...extra], { encoding: 'utf8' });
    const lines = (r.stdout || '').split('\n').filter(Boolean);
    for (const l of lines) out(`  ${l}`);
    const fails = lines.filter((l) => l.startsWith('FALLA'));
    const onlyDrift = fails.length > 0 && fails.every((l) => CONFIG_DRIFT.some((re) => re.test(l)));
    const verdict = r.status === 0 ? 'OK' : informative && onlyDrift ? 'INFORMATIVO (solo desfase de configuración con el .env actual)' : 'FALLA';
    out(`  → código ${r.status} · ${verdict}${fails.length ? ` · falló: ${fails.map((l) => l.replace(/^FALLA\s+/, '').split(' — ')[0]).join(' | ')}` : ''}`);
    return verdict;
};
const release = latest('registro-release-');
const dev = latest('registro-dev-');
const vRepo = runVerifier('(repo)', [], false);
const vRelease = release ? runVerifier(`--apk ${release}`, ['--apk', release], false) : 'FALTA';
const vDev = dev ? runVerifier(`--apk ${dev} (informativo)`, ['--apk', dev], true) : 'FALTA';

// ---------------------------------------------------------------- autochequeo: ningún valor impreso
const valueRes = [JWT_RE, ...VALUE_PATTERNS.filter(([type]) => !type.startsWith('REGISTRO_UPLOAD')).map(([, , re]) => re)];
const leaked = printed.reduce((n, l) => n + valueRes.reduce((k, re) => k + [...l.matchAll(new RegExp(re.source, 'g'))].length, 0), 0);
out(`\nAutochequeo: valores de secreto en la salida de este script: ${leaked}`);

out(`\nResumen: CRÍTICOS ${critical} · ALTOS ${high} · informativos ${info.length} · verificar-secretos repo ${vRepo} · release ${vRelease} · dev ${vDev}`);
const code = critical ? 2 : (high || leaked || vRepo !== 'OK' || vRelease !== 'OK' || vDev === 'FALLA') ? 1 : 0;
process.exit(code);
