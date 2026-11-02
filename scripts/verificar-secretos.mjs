// Verifica que no haya secretos en el repo ni en el APK. NUNCA imprime valores: solo
// archivo:línea, el tipo de hallazgo y conteos.
//
//   node scripts/verificar-secretos.mjs                 # archivos versionados + no ignorados
//   node scripts/verificar-secretos.mjs --apk <ruta>    # además, el bundle JS de ese APK
//
// Busca VALORES de clave (no la palabra "service_role", que aparece en la documentación y
// en el propio supabase-js):
//   - sb_secret_…            (secret key de Supabase; no el literal "sb_secret_" de supabase-js)
//   - GOCSPX-…               (Client secret de Google OAuth)
//   - JWT de tres segmentos (eyJ….….…): cualquier token en el repo es un error; si su payload
//     dice role service_role, se marca como tal
//   - asignaciones SERVICE_ROLE_KEY=<valor> / SUPABASE_SECRET…=<valor>
// Además:
//   - .env ignorado por git y no versionado; .env.example solo con marcadores <…>.
//   - con --apk: assets/app.config DEBE traer SOLO el proyecto de su variante (URL + sb_publishable_)
//     y, en producción, syncEnabled false; bundle y config sin secretos.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

const PATTERNS = [
    // Una clave real sigue al prefijo con un alfanumérico y es larga. supabase-js contiene el literal
    // "sb_secret_" (isNewApiKey) y en el bytecode de Hermes queda pegado a la cadena siguiente.
    ['sb_secret_', /sb_secret_[A-Za-z0-9][A-Za-z0-9_-]{19,}/g],
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
// Proyectos por variante (Fase 4): producción y Registro Dev.
const ENV_PAIRS = {
    production: ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
    development: ['EXPO_PUBLIC_SUPABASE_DEV_URL', 'EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY'],
};
const envUrls = {};
const envKeys = {};
if (existsSync('.env')) {
    const env = readFileSync('.env', 'utf8');
    for (const [variant, [urlVar, keyVar]] of Object.entries(ENV_PAIRS)) {
        const url = new RegExp(`^${urlVar}=(.+)$`, 'm').exec(env);
        const key = new RegExp(`^${keyVar}=(.+)$`, 'm').exec(env);
        if (!url && !key) {
            console.log(`AVISO .env: sin variables de ${variant} (${urlVar}, ${keyVar})`);
            continue;
        }
        envUrls[variant] = url ? url[1].trim().replace(/\/$/, '') : null;
        envKeys[variant] = key ? key[1].trim() : null;
        check(`.env (${variant}): la URL tiene forma https://<ref>.supabase.co`, !!envUrls[variant] && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(envUrls[variant]));
        check(`.env (${variant}): la clave es publishable (sb_publishable_…)`, !!key && key[1].trim().startsWith('sb_publishable_'));
    }
    if (envUrls.production && envUrls.development) {
        check('.env: producción y Registro Dev son proyectos distintos', envUrls.production !== envUrls.development);
    }
    if (envKeys.production && envKeys.development) {
        check('.env: las publishable keys de producción y Registro Dev son distintas', envKeys.production !== envKeys.development);
    }
    check('.env: sin secretos', scanText(env).length === 0);
}
const refOf = (url) => (url ? url.replace(/^https:\/\//, '').split('.')[0] : null);

// 3. APK: el bundle sin secretos; assets/app.config con SOLO el proyecto de su variante y la
// sincronización apagada en producción.
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
        const configText = execSync(`unzip -p "${apk}" assets/app.config`, { maxBuffer: 8 * 1024 * 1024 }).toString('utf8');
        const config = JSON.parse(configText);
        const extra = config.extra || {};
        const variant = extra.variant;
        const supa = extra.supabase || {};
        check('APK: 0 secretos en assets/app.config', scanText(configText).length === 0);
        check(`APK (${variant}): la sincronización está ${variant === 'production' ? 'APAGADA (syncEnabled false)' : 'habilitada solo en dev'}`,
            variant === 'production' ? extra.syncEnabled === false : variant === 'development' && extra.syncEnabled === true);
        check(`APK (${variant}): trae una URL de Supabase y una clave sb_publishable_`,
            /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supa.url || '') && String(supa.key || '').startsWith('sb_publishable_'));
        if (envUrls[variant]) check(`APK (${variant}): la URL es la de su proyecto en .env`, supa.url === envUrls[variant]);
        if (envKeys[variant]) check(`APK (${variant}): la clave es la de su proyecto en .env`, supa.key === envKeys[variant]);
        const other = variant === 'production' ? 'development' : 'production';
        if (envKeys[other]) check(`APK (${variant}): no contiene la clave de ${other} (ni en el bundle ni en app.config)`, !text.includes(envKeys[other]) && !configText.includes(envKeys[other]));
        const otherRef = refOf(envUrls[other]);
        if (otherRef) {
            check(`APK (${variant}): no contiene el proyecto de ${other} (ni en el bundle ni en app.config)`, !text.includes(otherRef) && !configText.includes(otherRef));
        }
    }
}

console.log(failures === 0 ? '\nSIN SECRETOS.' : `\n${failures} verificación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
