// Metro para la variante dev (APP_VARIANT=development), igual en PowerShell y Git Bash.
// Uso: npm run start:dev  (solo para desarrollar; las pruebas sin red usan el APK con JS embebido)
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['expo', 'start', ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, APP_VARIANT: 'development' },
});
process.exit(r.status ?? 1);
