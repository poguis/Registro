// Extracción de funciones de las PANTALLAS (closures de componentes React con JSX) para probarlas
// desde Node (Fases 7.2 y 7.3). No se empaqueta en la app.
//
// - Busca `const <nombre> = (…) => {…}` (una function expression, o la función dentro de
//   `useCallback(fn, deps)`) con @babel/parser y hace el
//   análisis de alcance con @babel/traverse: identificadores libres (estado de React, setters,
//   props, imports), globales y métodos de `db` que usa.
// - La fuente puede ser el archivo del árbol actual o `git show <commit>:<ruta>` (referencia
//   congelada de un commit, como hace dryrun-fase1 con 522161a).
// - instanciar() evalúa la función con new Function inyectando sus dependencias; exige TODAS las
//   libres. Si una función no se encuentra, aparece varias veces, no se puede evaluar o le falta
//   una dependencia, lanza un error con el archivo (y el commit), el nombre y la línea.
//
// IMPORTANTE: importar este módulo ANTES que test-hooks.mjs. Los hooks convierten los .json en
// módulos ESM y @babel/traverse hace require() de JSON internos al cargarse.
// @babel/parser y @babel/traverse son dependencias transitivas de Expo (no están en package.json).
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const traverse = traverseModule.default || traverseModule;

const fuentes = new Map(); // "commit:archivo" → { codigo, ast }
export const extraidas = []; // registro para los informes

const etiquetaFuente = (archivo, commit) => (commit ? `${commit}:${archivo}` : archivo);

export function leerFuente(archivo, commit = null) {
    return commit
        ? execFileSync('git', ['show', `${commit}:${archivo}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        : readFileSync(archivo, 'utf8');
}

function astDe(archivo, commit) {
    const clave = etiquetaFuente(archivo, commit);
    if (!fuentes.has(clave)) {
        const codigo = leerFuente(archivo, commit);
        fuentes.set(clave, { codigo, ast: parse(codigo, { sourceType: 'module', plugins: ['jsx'] }) });
    }
    return fuentes.get(clave);
}

export function extraer(archivo, nombre, { commit = null } = {}) {
    const donde = etiquetaFuente(archivo, commit);
    const { codigo, ast } = astDe(archivo, commit);
    const hallados = [];
    traverse(ast, {
        VariableDeclarator(p) {
            const init = p.node.init;
            if (p.node.id.type !== 'Identifier' || p.node.id.name !== nombre || !init) return;
            if (/FunctionExpression$/.test(init.type)) hallados.push(p.get('init'));
            // `const f = useCallback(async () => {…}, [deps])`: se toma la función (el primer argumento).
            else if (init.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'useCallback'
                && init.arguments[0] && /FunctionExpression$/.test(init.arguments[0].type)) hallados.push(p.get('init.arguments.0'));
        },
    });
    if (hallados.length !== 1) throw new Error(`extracción: ${donde}: "${nombre}" ${hallados.length ? `aparece ${hallados.length} veces` : 'no se encontró'}`);
    const fn = hallados[0];
    const { start, end } = fn.node;
    const linea = fn.node.loc.start.line;
    const libres = new Set(), globales = new Set(), dbMetodos = new Set();
    fn.traverse({
        ReferencedIdentifier(p) {
            const n = p.node.name;
            const b = p.scope.getBinding(n);
            if (!b) globales.add(n);
            else if (b.path.node.start < start || b.path.node.start >= end) libres.add(n);
        },
        MemberExpression(p) {
            if (p.node.object.type === 'Identifier' && p.node.object.name === 'db' && !p.node.computed) dbMetodos.add(p.node.property.name);
        },
    });
    const ext = {
        archivo, commit, donde, nombre, linea, src: codigo.slice(start, end),
        libres: [...libres].sort(), globales: [...globales].sort(), dbMetodos: [...dbMetodos].sort(),
    };
    if (!extraidas.some((e) => e.donde === donde && e.nombre === nombre)) extraidas.push(ext);
    return ext;
}

export function instanciar(ext, deps) {
    const faltan = ext.libres.filter((n) => !Object.hasOwn(deps, n));
    if (faltan.length) throw new Error(`extracción: ${ext.donde}:${ext.linea} "${ext.nombre}": dependencia no provista: ${faltan.join(', ')}`);
    try {
        return new Function(...Object.keys(deps), `"use strict";\nreturn (${ext.src});`)(...Object.values(deps));
    } catch (e) {
        throw new Error(`extracción: ${ext.donde}:${ext.linea} "${ext.nombre}" no se pudo evaluar (${e.name})`);
    }
}
