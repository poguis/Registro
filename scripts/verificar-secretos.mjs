// Verifica que no haya secretos en el repo ni en el APK. NUNCA imprime valores: solo
// archivo:línea, el tipo de hallazgo y conteos.
//
//   node scripts/verificar-secretos.mjs                 # archivos versionados + no ignorados
//   node scripts/verificar-secretos.mjs --apk <ruta>    # además, el bundle JS de ese APK
//
// Busca VALORES de clave (no la palabra "service_role", que aparece en la documentación y
// en el propio supabase-js):
//   - sb_secret_…            (secret key de Supabase)
//   - GOCSPX-…               (Client secret de Google OAuth)
//   - JWT de tres segmentos (eyJ….….…): cualquier token en el repo es un error; si su payload
//     dice role service_role, se marca como tal
//   - asignaciones SERVICE_ROLE_KEY=<valor> / SUPABASE_SECRET…=<valor>
// Además:
//   - .env ignorado por git y no versionado; .env.example solo con marcadores <…>.
//   - con --apk: el bundle DEBE contener la URL de Supabase y una clave sb_publishable_
//     (las variables EXPO_PUBLIC_* se incrustaron), sin secretos.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

const PATTERNS = [
    ['sb_secret_', /sb_secret_[A-Za-z0-9_-]{8,}/g],
    ['client secret de Google (GOCSPX-)', /GOCSPX-[A-Za-z0-9_-]{8,}/g],
    ['asignación de clave secreta', /(SERVICE_ROLE_KEY|SUPABASE_SECRET[A-Z_]*|SECRET_KEY)\s*[=:]\s*['"]?[A-Za-z0-9._-]{16,}/g],
];
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function scanText(text) {
    const found = [];
    for (const [kind, re] of PATTERNS) {
        for (const m of text.matchAll(re)) found.push({ kind, index: m.index });
    }
    for (const m of text.matchAll(JWT_RE)) {
        let kind = 'JWT';
        try {
            const payload = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString('utf8'));
            if (payload.role === 'service_role') kind = 'JWT service_role';
            else if (payload.role === 'anon') kind = 'JWT anon (clave legacy)';
        } catch { /* no decodificable */ }
        found.push({ kind, index: m.index });
    }
    return found;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// 1. Archivos del repo: versionados + no versionados que git NO ignora.
const files = [
    ...execSync('git ls-files', { encoding: 'utf8' }).split('\n'),
    ...execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' }).split('\n'),
].filter((f) => f && existsSync(f) && statSync(f).isFile() && statSync(f).size < 5_000_000);
const hits = [];
for (const f of files) {
    const buf = readFileSync(f);
    if (buf.includes(0)) continue; // binario
    const text = buf.toString('utf8');
    for (const h of scanText(text)) hits.push(`${f}:${lineOf(text, h.index)} (${h.kind})`);
}
check(`repo: 0 secretos en ${files.length} archivos (versionados + no ignorados)`, hits.length === 0, hits.join(', '));

// 2. .env
let envIgnored = false;
try { execSync('git check-ignore -q .env'); envIgnored = true; } catch { envIgnored = false; }
const envTracked = execSync('git ls-files .env', { encoding: 'utf8' }).trim() !== '';
check('.env ignorado por git y no versionado', envIgnored && !envTracked);
if (existsSync('.env.example')) {
    const ex = readFileSync('.env.example', 'utf8');
    const values = ex.split('\n').filter((l) => /^\s*[A-Z0-9_]+\s*=/.test(l)).map((l) => l.split('=').slice(1).join('=').trim());
    check('.env.example solo tiene marcadores <…>', values.length > 0 && values.every((v) => v.includes('<') && v.includes('>')), `${values.length} variable(s)`);
}
let envUrl = null;
if (existsSync('.env')) {
    const env = readFileSync('.env', 'utf8');
    const url = /^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env);
    const key = /^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(env);
    envUrl = url ? url[1].trim() : null;
    check('.env: la URL tiene forma https://<ref>.supabase.co', !!envUrl && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(envUrl));
    check('.env: la clave es publishable (sb_publishable_…)', !!key && key[1].trim().startsWith('sb_publishable_'));
    check('.env: sin secretos', scanText(env).length === 0);
}

// 3. APK
const apkIndex = process.argv.indexOf('--apk');
if (apkIndex >= 0) {
    const apk = process.argv[apkIndex + 1];
    check('APK: existe', !!apk && existsSync(apk), apk || '');
    if (apk && existsSync(apk)) {
        const bundle = execSync(`unzip -p "${apk}" assets/index.android.bundle`, { maxBuffer: 64 * 1024 * 1024 });
        const text = bundle.toString('latin1');
        check('APK: tiene el JS embebido (assets/index.android.bundle)', bundle.length > 100_000, `${(bundle.length / 1048576).toFixed(1)} MB`);
        const apkHits = scanText(text).map((h) => h.kind);
        check('APK: 0 secretos en el bundle', apkHits.length === 0, apkHits.join(', '));
        const urlInBundle = envUrl ? text.includes(envUrl.replace(/\/$/, '')) : /https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text);
        check('APK: contiene la URL de Supabase' + (envUrl ? ' del .env' : ''), urlInBundle);
        check('APK: contiene una clave sb_publishable_', /sb_publishable_[A-Za-z0-9_-]{8,}/.test(text));
    }
}

console.log(failures === 0 ? '\nSIN SECRETOS.' : `\n${failures} verificación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
