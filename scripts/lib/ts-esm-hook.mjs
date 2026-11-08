// Hook de carga SOLO para los scripts de PC (Fase 6.5): marca los módulos de src/ como ESM para
// que Node no emita MODULE_TYPELESS_PACKAGE_JSON ("Reparsing as ES module…"). package.json no
// declara "type" a propósito (no se toca el build de la app), así que Node tendría que adivinar el
// formato de cada .ts/.js de src/; aquí se lo decimos: .ts → module-typescript, .js → module.
//
// Uso: `import './lib/ts-esm-hook.mjs'` ANTES de cargar algo de src/, y cargar src/ con
// `await import(...)`: en ESM los imports estáticos de un módulo se cargan antes de ejecutar
// cualquiera de ellos, así que un import estático de src/ no pasaría por este hook.
// scripts/lib/test-hooks.mjs ya lo importa.
import { registerHooks } from 'node:module';

const SRC = new URL('../../src/', import.meta.url).href;

registerHooks({
    load(url, context, nextLoad) {
        if (url.startsWith(SRC)) {
            if (url.endsWith('.ts')) return nextLoad(url, { ...context, format: 'module-typescript' });
            if (url.endsWith('.js')) return nextLoad(url, { ...context, format: 'module' });
        }
        return nextLoad(url, context);
    },
});
