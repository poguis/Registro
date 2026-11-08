// Metro para la variante dev (APP_VARIANT=development), igual en PowerShell y Git Bash.
// Uso: npm run start:dev  (solo para desarrollar; las pruebas sin red usan el APK con JS embebido)
import { spawnSync } from 'node:child_process';

// En Windows npx es un .cmd y necesita shell; se pasa UN solo comando citado en vez de args con
// `shell: true` (aviso DEP0190, Fase 6.5).
const isWin = process.platform === 'win32';
const args = ['expo', 'start', ...process.argv.slice(2)];
const quoteArg = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);
const opts = { stdio: 'inherit', env: { ...process.env, APP_VARIANT: 'development' } };
const r = isWin
    ? spawnSync(['npx', ...args].map(quoteArg).join(' '), { ...opts, shell: true })
    : spawnSync('npx', args, opts);
process.exit(r.status ?? 1);
