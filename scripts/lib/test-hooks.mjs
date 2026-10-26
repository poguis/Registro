// Hooks de módulos para cargar src/ (JS y TS) en Node:
// - 'expo-sqlite' → shim sobre node:sqlite;
// - 'expo-crypto' → randomUUID de node:crypto;
// - './backup' (desde src/services/db.js) → stub que registra las copias previas a migrar;
// - 'expo-file-system' / 'expo-sharing' → stubs sobre node:fs (para probar backup.js);
// - '*.json' → módulo ESM (como lo hace Metro);
// - imports relativos sin extensión → '.ts' si existe, si no '.js' (convención de Metro).
//   Node 24 ejecuta los .ts quitando los tipos.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shimUrl = new URL('./expo-sqlite-shim.mjs', import.meta.url).href;
const backupStubUrl = new URL('./backup-stub.mjs', import.meta.url).href;
const fileSystemStubUrl = new URL('./expo-file-system-stub.mjs', import.meta.url).href;
const sharingStubUrl = 'data:text/javascript,export const isAvailableAsync=async()=>true;export const shareAsync=async()=>{};';
const cryptoStubUrl = 'data:text/javascript,export const randomUUID=()=>globalThis.crypto.randomUUID();';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'expo-sqlite') return { url: shimUrl, shortCircuit: true };
        if (specifier === 'expo-crypto') return { url: cryptoStubUrl, shortCircuit: true };
        if (specifier === 'expo-file-system') return { url: fileSystemStubUrl, shortCircuit: true };
        if (specifier === 'expo-sharing') return { url: sharingStubUrl, shortCircuit: true };
        if (specifier === './backup' && context.parentURL && context.parentURL.endsWith('/services/db.js')) {
            return { url: backupStubUrl, shortCircuit: true };
        }
        if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$|\.json$/.test(specifier)) {
            const asTs = new URL(`${specifier}.ts`, context.parentURL);
            return nextResolve(existsSync(fileURLToPath(asTs)) ? `${specifier}.ts` : `${specifier}.js`, context);
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
