// Hooks de módulos para cargar src/services en Node:
// - 'expo-sqlite' → shim sobre node:sqlite;
// - './backup' (desde db.js) → stub que registra las copias previas a migrar;
// - 'expo-file-system' / 'expo-sharing' → stubs sobre node:fs (para probar backup.js);
// - '*.json' → módulo ESM (como lo hace Metro);
// - imports relativos sin extensión → '.js' (convención de Metro).
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shimUrl = new URL('./expo-sqlite-shim.mjs', import.meta.url).href;
const backupStubUrl = new URL('./backup-stub.mjs', import.meta.url).href;
const fileSystemStubUrl = new URL('./expo-file-system-stub.mjs', import.meta.url).href;
const sharingStubUrl = 'data:text/javascript,export const isAvailableAsync=async()=>true;export const shareAsync=async()=>{};';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'expo-sqlite') return { url: shimUrl, shortCircuit: true };
        if (specifier === 'expo-file-system') return { url: fileSystemStubUrl, shortCircuit: true };
        if (specifier === 'expo-sharing') return { url: sharingStubUrl, shortCircuit: true };
        if (specifier === './backup' && context.parentURL && context.parentURL.includes('/src/services/')) {
            return { url: backupStubUrl, shortCircuit: true };
        }
        if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?js$|\.json$/.test(specifier)) {
            return nextResolve(`${specifier}.js`, context);
        }
        return nextResolve(specifier, context);
    },
    // Metro permite `import x from './archivo.json'`; Node necesita convertirlo a módulo.
    load(url, context, nextLoad) {
        if (url.endsWith('.json')) {
            const source = readFileSync(fileURLToPath(url), 'utf8');
            return { format: 'module', source: `export default ${source};`, shortCircuit: true };
        }
        return nextLoad(url, context);
    },
});

globalThis.__DEV__ = true;
