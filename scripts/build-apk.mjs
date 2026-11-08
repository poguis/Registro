// Build local de un APK por variante (Fase 3). Sin EAS.
//
//   npm run build:release   → producción: com.poguis.Registro, firmado con el keystore de EAS
//   npm run build:dev       → desarrollo: com.poguis.Registro.dev, release con debug.keystore
//
// Pasos: (1) respaldo único de android/ en .local-data/android-respaldo-fase2/ si no existe;
// (2) `expo prebuild -p android --clean` con APP_VARIANT; (3) sdk.dir en local.properties;
// (4) `gradlew assembleRelease` con JDK 17 (JS embebido: no usa Metro); (5) copia el APK a
// .local-data/apk/; (6) imprime applicationId, versionName/versionCode (aapt2) y la huella
// SHA-256 del certificado (apksigner); (7) verificar-secretos --apk.
// El release de producción FALLA si la huella no es la de EAS (3132ded2…3e52): NO instalar.
// Necesita .env (EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';

const VARIANT = process.argv[2];
const CONF = {
    production: { appVariant: undefined, appId: 'com.poguis.Registro', out: 'release', expectedSha256: '3132ded21252a5812b6683fae636facf2468cdb38d0d59e4db05f9b056c83e52' },
    development: { appVariant: 'development', appId: 'com.poguis.Registro.dev', out: 'dev', expectedSha256: null },
}[VARIANT];
if (!CONF) {
    console.error('Uso: node scripts/build-apk.mjs production|development');
    process.exit(2);
}

const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'D:\\Users\\Carlos\\AppData\\Local\\Android\\Sdk';
const JDK = process.env.REGISTRO_JAVA_HOME || 'C:\\Program Files\\Microsoft\\jdk-17.0.20.101-hotspot';
const BUILD_TOOLS = join(SDK, 'build-tools', '36.0.0');
const isWin = process.platform === 'win32';

const fail = (msg) => { console.error(`\n✖ ${msg}`); process.exit(1); };
// En Windows, npx / gradlew.bat / apksigner.bat necesitan shell (Node no ejecuta .cmd/.bat sin
// ella). Para no pasar `args` junto con `shell: true` (aviso DEP0190, Fase 6.5) se arma UN solo
// comando con cada argumento citado si hace falta. En Linux/macOS, sin shell y con args.
const quoteArg = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);
const spawnCmd = (cmd, args, opts = {}) => (isWin
    ? spawnSync([cmd, ...args].map(quoteArg).join(' '), { ...opts, shell: true })
    : spawnSync(cmd, args, opts));
const run = (cmd, args, opts = {}) => {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const r = spawnCmd(cmd, args, { stdio: 'inherit', ...opts });
    if (r.status !== 0) fail(`${cmd} terminó con código ${r.status}`);
};
const capture = (cmd, args) => {
    const r = spawnCmd(cmd, args, { encoding: 'utf8' });
    if (r.status !== 0) fail(`${cmd} falló: ${r.stderr || r.stdout}`);
    return r.stdout;
};

// 0. .env presente (las EXPO_PUBLIC_* se incrustan en el bundle durante el build)
if (!existsSync('.env')) fail('Falta .env (copia .env.example y pon la Project URL y la publishable key).');
// Cada variante necesita su proyecto (app.config.js los pone en extra.supabase).
const REQUIRED = VARIANT === 'production'
    ? ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
    : ['EXPO_PUBLIC_SUPABASE_DEV_URL', 'EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY'];
const envText = readFileSync('.env', 'utf8');
const missing = REQUIRED.filter((v) => !new RegExp(`^${v}=\\S+`, 'm').test(envText));
if (missing.length) fail(`Faltan en .env: ${missing.join(', ')} (variante ${VARIANT}).`);

// 1. Respaldo único de android/ antes del primer prebuild --clean (sin build/, .gradle/ ni .cxx/)
const BACKUP = '.local-data/android-respaldo-fase2';
if (existsSync('android') && !existsSync(BACKUP)) {
    const SKIP = new Set(['build', '.gradle', '.cxx']);
    cpSync('android', BACKUP, { recursive: true, filter: (src) => !src.split(/[\\/]/).some((p) => SKIP.has(p)) });
    const size = (dir) => readdirSync(dir).reduce((n, f) => {
        const p = join(dir, f);
        const s = statSync(p);
        return n + (s.isDirectory() ? size(p) : s.size);
    }, 0);
    console.log(`Respaldo de android/ creado en ${BACKUP} (${(size(BACKUP) / 1024).toFixed(0)} KB).`);
}

// 2. prebuild limpio con la variante. Antes se detiene el daemon de Gradle: en Windows
// mantiene bloqueados archivos de android/app/build y --clean falla con EBUSY.
const env = { ...process.env, CI: '1', EXPO_NO_GIT_STATUS: '1' };
if (existsSync(isWin ? 'android/gradlew.bat' : 'android/gradlew')) {
    spawnCmd(isWin ? '.\\gradlew.bat' : './gradlew', ['--stop'], { cwd: 'android', stdio: 'inherit', env: { ...env, JAVA_HOME: JDK } });
}
if (CONF.appVariant) env.APP_VARIANT = CONF.appVariant; else delete env.APP_VARIANT;
run('npx', ['expo', 'prebuild', '-p', 'android', '--clean', '--no-install'], { env });

// 3. local.properties
const lp = 'android/local.properties';
if (!existsSync(lp) || !/^sdk\.dir=/m.test(readFileSync(lp, 'utf8'))) {
    writeFileSync(lp, `sdk.dir=${SDK.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`);
}

// 4. assembleRelease con JDK 17 (JS embebido en el APK)
const gradleEnv = { ...env, JAVA_HOME: JDK };
run(isWin ? '.\\gradlew.bat' : './gradlew', ['assembleRelease'], { cwd: 'android', env: gradleEnv });

// 5. Copia a .local-data/apk/
const built = 'android/app/build/outputs/apk/release/app-release.apk';
if (!existsSync(built)) fail(`No se generó ${built}`);
mkdirSync('.local-data/apk', { recursive: true });
// Nombre único por variante, versión y commit: nunca se sobrescribe un APK ya instalado en un
// dispositivo (p. ej. registro-release-1.2.0-vc3-052561f.apk; "-mod-<fecha>" si hay cambios sin commitear).
const appJson = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15); // AAAAMMDDTHHMMSS
const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim() ? `-mod-${stamp}` : '';
const out = `.local-data/apk/registro-${CONF.out}-${appJson.version}-vc${appJson.android.versionCode}-${head}${dirty}.apk`;
if (existsSync(out)) fail(`Ya existe ${out}: no se sobrescribe un APK existente.`);
copyFileSync(built, out);

// 6. Identidad y firma del APK
const badging = capture(join(BUILD_TOOLS, isWin ? 'aapt2.exe' : 'aapt2'), ['dump', 'badging', out]);
const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
const label = /application-label:'([^']*)'/.exec(badging);
const certs = capture(join(BUILD_TOOLS, isWin ? 'apksigner.bat' : 'apksigner'), ['verify', '--print-certs', out]);
const sha = /Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/.exec(certs);
console.log(`\nAPK: ${resolve(out)}`);
console.log(`  applicationId: ${pkg ? pkg[1] : '?'}`);
console.log(`  nombre:        ${label ? label[1] : '?'}`);
console.log(`  versionName:   ${pkg ? pkg[3] : '?'}   versionCode: ${pkg ? pkg[2] : '?'}`);
console.log(`  SHA-256 cert:  ${sha ? sha[1] : '?'}`);
if (!pkg || pkg[1] !== CONF.appId) fail(`applicationId inesperado (se esperaba ${CONF.appId}).`);
if (CONF.expectedSha256 && (!sha || sha[1] !== CONF.expectedSha256)) {
    fail('La huella NO es la del keystore de EAS (3132ded2…3e52). NO instales este APK ni desinstales nada.');
}
if (CONF.expectedSha256) console.log('  ✔ Huella de EAS correcta: se puede instalar encima con install -r.');

// 7. Secretos y variables incrustadas
run('node', ['scripts/verificar-secretos.mjs', '--apk', out]);
