// Pruebas de la Fase 7.5b2a: Pendiente compacto (O12 + O8). Decisiones F1–F10 y P1–P12 del plan
// aprobado, con los ajustes de la aprobación: año por tipo (películas year ?? start_year; series,
// anime y lectura start_year ?? year), desempates explícitos (año o registro → título → id; título →
// id) y la cobertura enumerada (P3–P7, textos de vacío, Icono.js como único importador).
//
// Tablas esperadas ESCRITAS A MANO desde las decisiones (no copiadas de la salida). La fachada real
// (src/services/db.js) sobre BD node:sqlite SINTÉTICAS en un temporal del sistema; funciones reales
// de BacklogScreen (extraídas con scripts/lib/extraer-pantalla.mjs; hojas por
// scripts/lib/hojas-stub.mjs). La equivalencia compara con el loadItems de b743e8f (referencia fija,
// `git show`, como probar-fase7-3 con 241c26e). Nunca toca un proyecto remoto ni datos reales; no
// imprime filas.
//
// Secciones:
//   1. módulo puro (src/entertainment/backlogList.ts): año por tipo, órdenes y desempates, años de
//      la sección (P4), filtro de año en las 4 páginas, textos de vacío, búsqueda (F9), contador
//      (P6), contadores con búsqueda y año (P3), combinación
//   2. equivalencia con b743e8f (E1–E4) y cambios de orden declarados (E6–E8)
//   3. memoria de sesión (F7) y cambio de sección (P5)
//   4. D6 sin cambios y formulario (P7)
//   5. comprobaciones estáticas (con controles negativos)
//
// Uso: node scripts/probar-fase7-5b2a.mjs
import { extraer, instanciar as instanciarPantalla } from './lib/extraer-pantalla.mjs'; // antes que test-hooks
import { hojasDesdeAlert } from './lib/hojas-stub.mjs';
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
process.env.TZ = 'America/Guayaquil';

const { createDevices, quiet } = await import('./lib/sync-devices.mjs');
const L = await import('../src/entertainment/backlogList.ts');
const link = await import('../src/entertainment/link.ts');
const M = await import('../src/hooks/memoriaPendiente.js');

let fallas = 0, total = 0;
const check = (nombre, ok, detalle = '') => {
    total++;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}${!ok && detalle ? ` — ${detalle}` : ''}`);
    if (!ok) fallas++;
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tabla = (titulo, filas) => {
    const malas = filas.filter((f) => !igual(f.esperado, f.obtenido));
    check(`${titulo} (${filas.length} casos)`, malas.length === 0,
        malas.map((f) => `${f.caso}: esperado ${JSON.stringify(f.esperado)} obtenido ${JSON.stringify(f.obtenido)}`).join(' | '));
};
const seccion = (t) => console.log(`\n== ${t} ==`);

const PANT = 'src/screens/BacklogScreen.js';
const REF = 'b743e8f'; // cierre de la 7.5b1 (app 1.4.4): referencia fija de la equivalencia
const UID = '00000000-0000-4000-8000-000000075b2a'; // uid SINTÉTICO
const WORK = join(tmpdir(), 'registro-pruebas-fase7-5b2a').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const D = createDevices(`${WORK}/disp`);
let nBD = 0;

const leer = (p) => readFileSync(p, 'utf8');
const astDe = (codigo) => parse(codigo, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
const nombreJsx = (n) => (n && n.openingElement && n.openingElement.name && n.openingElement.name.name) || null;
const attr = (el, nombre) => el.openingElement.attributes.find((a) => a.name && a.name.name === nombre);
// Quita comentarios (// y /* */) sin tocar las cadenas.
function sinComentarios(src) {
    let out = '', i = 0, cadena = null;
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        if (cadena) { out += c; if (c === '\\') { out += d ?? ''; i += 2; continue; } if (c === cadena) cadena = null; i++; continue; }
        if (c === '"' || c === "'" || c === '`') { cadena = c; out += c; i++; continue; }
        if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        out += c; i++;
    }
    return out;
}
function archivos(dir) {
    const out = [];
    for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) out.push(...archivos(p));
        else if (/\.(js|jsx|ts|tsx)$/.test(n)) out.push(relative('.', p).replace(/\\/g, '/'));
    }
    return out;
}

// Alert de React Native, para hojas-stub: registra y pulsa el botón elegido.
function crearAlert(eleccion = null) {
    const registro = [];
    return {
        registro,
        Alert: {
            alert: (titulo, mensaje, botones) => {
                registro.push({ titulo, mensaje, botones: botones ? botones.map((b) => b.text) : [] });
                const b = botones && eleccion ? botones.find((x) => x.text === eleccion) : null;
                if (b && b.onPress) b.onPress();
            },
        },
    };
}

// Entorno: un dispositivo con la app nueva y cuenta vinculada a UID; los títulos se crean con la
// fachada y después (solo en esta BD sintética) se fijan estado y created_at con SQL directo.
async function entorno() {
    const dev = await D.newDevice(`bd-${++nBD}`);
    D.use(dev);
    const usar = () => D.use(dev);
    const db = new Proxy(dev.svc, {
        get(target, prop) {
            const v = target[prop];
            return typeof v === 'function' ? (...args) => { usar(); return v.apply(target, args); } : v;
        },
    });
    const r = await quiet(() => db.createLinkedUser(UID, 'prueba@ejemplo.test'));
    if (!r.success) throw new Error('createLinkedUser falló');
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && (res.error || res.code)}`); return res; };
    let n = 0;
    const crear = async (t) => {
        usar();
        ok(await db.addBacklogItem(UID, { type: t.type, title: t.title, year: t.year ?? null, start_year: t.start_year ?? null, subtype: t.subtype ?? null, tags: t.tags || [] }), 'addBacklogItem');
        const fila = await db.db.getFirstAsync('SELECT id FROM backlog WHERE title = ? AND type = ? ORDER BY rowid DESC LIMIT 1', [t.title, t.type]);
        const creado = t.created_at || `2026-01-01T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
        n++;
        await db.db.runAsync('UPDATE backlog SET status = ?, created_at = ? WHERE id = ?', [t.status || 'Pendiente', creado, fila.id]);
        return fila.id;
    };
    return { dev, db, usar, ok, crear, user: { id: UID } };
}

// Funciones reales de la pantalla (actual) y de la referencia (b743e8f).
const actual = (nombre, deps) => instanciarPantalla(extraer(PANT, nombre), deps);
const deRef = (nombre, deps) => instanciarPantalla(extraer(PANT, nombre, { commit: REF }), deps);

// loadItems de b743e8f: SQL con estado/subtipo/orden + filterByTags; contadores de getBacklogCounts.
async function listaVieja(E, { tab, status, sortBy = 'created_at', order = 'DESC', tagFilter = { keys: [], none: false }, subtype = 'Todos' }) {
    let items = null, counts = null;
    const fn = deRef('loadItems', {
        setLoading: () => {}, db: E.db, user: E.user, activeTab: tab, activeStatus: status, sortBy, order, tagFilter, activeSubtype: subtype,
        setItems: (x) => { items = x; }, setCounts: (x) => { counts = x; }, setCatalog: () => {},
    });
    E.usar();
    await fn();
    return { items, counts };
}
// loadItems actual (una lectura de la sección) + buildPages del módulo.
async function listaNueva(E, { tab, filtros = L.EMPTY_FILTERS, orden = L.DEFAULT_ORDER }) {
    let items = null;
    const fn = actual('loadItems', { pedido: { current: 0 }, activeTab: tab, db: E.db, user: E.user, setItems: (x) => { items = x; }, setCatalog: () => {} });
    E.usar();
    await fn();
    return L.buildPages(items, filtros, orden);
}

// =============================================================================================
seccion('1. Módulo puro (src/entertainment/backlogList.ts)');
{
    const ey = (o) => L.effectiveYear(o);
    tabla('año por tipo (F6 ajustada), escrito a mano', [
        { caso: 'película solo con year 1994', esperado: 1994, obtenido: ey({ type: 'movie', year: 1994, start_year: null }) },
        { caso: 'película solo con start_year 2001 (cambio declarado: antes sin año)', esperado: 2001, obtenido: ey({ type: 'movie', year: null, start_year: 2001 }) },
        { caso: 'película con los dos distintos (usa year)', esperado: 1994, obtenido: ey({ type: 'movie', year: 1994, start_year: 2001 }) },
        { caso: 'serie solo con year 2010 (cambio declarado)', esperado: 2010, obtenido: ey({ type: 'series', year: 2010, start_year: null }) },
        { caso: 'serie con los dos distintos (usa start_year)', esperado: 2015, obtenido: ey({ type: 'series', year: 2010, start_year: 2015 }) },
        { caso: 'anime solo con start_year', esperado: 2003, obtenido: ey({ type: 'anime', start_year: 2003 }) },
        { caso: 'lectura sin ninguno → sin año', esperado: null, obtenido: ey({ type: 'reading', year: null, start_year: null }) },
        { caso: 'cadena vacía = sin año', esperado: null, obtenido: ey({ type: 'reading', year: '', start_year: '' }) },
    ]);

    const ids = (xs) => xs.map((x) => x.id);
    const reg = [
        { id: 'r3', title: 'Gamma', created_at: '2026-01-03T00:00:00.000Z' },
        { id: 'r1', title: 'alfa', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'r2b', title: 'Beta', created_at: '2026-01-02T00:00:00.000Z' },
        { id: 'r2a', title: 'Beta', created_at: '2026-01-02T00:00:00.000Z' },
        { id: 'r2c', title: 'Ánfora', created_at: '2026-01-02T00:00:00.000Z' },
    ];
    tabla('orden por Registro con desempates (título y después id, siempre ascendentes)', [
        { caso: 'ascendente', esperado: ['r1', 'r2c', 'r2a', 'r2b', 'r3'], obtenido: ids(L.sortItems(reg, { field: 'created_at', dir: 'asc' })) },
        { caso: 'descendente (el empate del 2 sigue Ánfora, Beta a, Beta b)', esperado: ['r3', 'r2c', 'r2a', 'r2b', 'r1'], obtenido: ids(L.sortItems(reg, { field: 'created_at', dir: 'desc' })) },
        { caso: 'por defecto = Registro descendente', esperado: ['r3', 'r2c', 'r2a', 'r2b', 'r1'], obtenido: ids(L.sortItems(reg)) },
    ]);

    const anios = [
        { id: 'a1', type: 'series', title: 'Zeta', start_year: 2010 },
        { id: 'a2', type: 'series', title: 'Sin año', start_year: null, year: null },
        { id: 'a3', type: 'series', title: 'beta', start_year: 2005 },
        { id: 'a4', type: 'series', title: 'Alfa', start_year: 2010 },
        { id: 'a5', type: 'series', title: 'Alfa', start_year: 2010 },
        { id: 'a6', type: 'series', title: 'Otro sin año', start_year: null },
        { id: 'a7', type: 'series', title: 'Solo year', year: 2007 },
    ];
    tabla('orden por Año: sin año SIEMPRE al final; empate de año → título → id', [
        { caso: 'ascendente', esperado: ['a3', 'a7', 'a4', 'a5', 'a1', 'a6', 'a2'], obtenido: ids(L.sortItems(anios, { field: 'year', dir: 'asc' })) },
        { caso: 'descendente', esperado: ['a4', 'a5', 'a1', 'a7', 'a3', 'a6', 'a2'], obtenido: ids(L.sortItems(anios, { field: 'year', dir: 'desc' })) },
    ]);

    // E7 aplicado al módulo: títulos con acentos, mayúsculas, ñ y números; dos "Dune" (a1, b2).
    const titulos = ['zeta', 'Ábaco', 'abeja', 'Abeja', 'Ñandú', 'nube', 'oso', 'Batman', 'batalla', '2001', '10 cosas'].map((t, i) => ({ id: `t${String(i).padStart(2, '0')}`, title: t }))
        .concat([{ id: 'b2', title: 'Dune' }, { id: 'a1', title: 'Dune' }]);
    const etiqueta = (x) => (x.title === 'Dune' ? `Dune(${x.id})` : x.title);
    tabla('orden por Título (localeCompare("es"); empate → id ascendente), escrito a mano', [
        { caso: 'ascendente', esperado: ['10 cosas', '2001', 'Ábaco', 'abeja', 'Abeja', 'batalla', 'Batman', 'Dune(a1)', 'Dune(b2)', 'nube', 'Ñandú', 'oso', 'zeta'], obtenido: L.sortItems(titulos, { field: 'title', dir: 'asc' }).map(etiqueta) },
        { caso: 'descendente (las dos Dune siguen a1 y después b2)', esperado: ['zeta', 'oso', 'Ñandú', 'nube', 'Dune(a1)', 'Dune(b2)', 'Batman', 'batalla', 'Abeja', 'abeja', 'Ábaco', '2001', '10 cosas'], obtenido: L.sortItems(titulos, { field: 'title', dir: 'desc' }).map(etiqueta) },
    ]);

    const seccionCompleta = [
        { type: 'movie', status: 'Pendiente', year: 1999 },
        { type: 'movie', status: 'Terminado', year: 2010 },
        { type: 'movie', status: 'Mirando', year: null, start_year: 2001 },
        { type: 'movie', status: 'Terminado', year: 1999 },
    ];
    tabla('P4: años de la SECCIÓN completa (todos los estados), "Sin año" solo si existe', [
        { caso: 'sin títulos sin año', esperado: { years: [2010, 2001, 1999], hasNone: false }, obtenido: L.availableYears(seccionCompleta) },
        { caso: 'con uno sin año en otro estado', esperado: { years: [2010, 2001, 1999], hasNone: true }, obtenido: L.availableYears([...seccionCompleta, { type: 'movie', status: 'Mirando', year: null }]) },
        { caso: 'sección vacía', esperado: { years: [], hasNone: false }, obtenido: L.availableYears([]) },
    ]);

    const p4 = [
        { id: 'p1', type: 'anime', title: 'Uno', status: 'Pendiente', start_year: 2020 },
        { id: 'p2', type: 'anime', title: 'Dos', status: 'Mirando', start_year: 2020 },
        { id: 'p3', type: 'anime', title: 'Tres', status: 'Terminado', start_year: 2019 },
        { id: 'p4', type: 'anime', title: 'Cuatro', status: 'Pendiente', start_year: null },
    ];
    // Revisa el FILTRO (conjuntos por página); el orden se prueba en sus propias tablas.
    const pag = (f) => { const r = L.buildPages(p4, { ...L.EMPTY_FILTERS, year: f }); return Object.fromEntries(L.STATUS_TABS.map((t) => [t, r.pages[t].map((x) => x.id).sort()])); };
    tabla('P4: el año elegido vale en las 4 páginas', [
        { caso: 'año 2020', esperado: { Pendiente: ['p1'], Mirando: ['p2'], Terminado: [], Total: ['p1', 'p2'] }, obtenido: pag(2020) },
        { caso: '"Sin año"', esperado: { Pendiente: ['p4'], Mirando: [], Terminado: [], Total: ['p4'] }, obtenido: pag('none') },
        { caso: 'todos (null)', esperado: { Pendiente: ['p1', 'p4'], Mirando: ['p2'], Terminado: ['p3'], Total: ['p1', 'p2', 'p3', 'p4'] }, obtenido: Object.fromEntries(L.STATUS_TABS.map((t) => [t, L.buildPages(p4, L.EMPTY_FILTERS, { field: 'title', dir: 'desc' }).pages[t].map((x) => x.id).sort()])) },
    ]);

    const F = L.EMPTY_FILTERS;
    tabla('textos de página vacía', [
        { caso: 'sin filtros ni búsqueda', esperado: 'No hay títulos.', obtenido: L.emptyText(F) },
        { caso: 'búsqueda de solo espacios = sin filtros', esperado: 'No hay títulos.', obtenido: L.emptyText({ ...F, search: '   ' }) },
        { caso: 'con búsqueda', esperado: 'No hay títulos con estos filtros.', obtenido: L.emptyText({ ...F, search: 'x' }) },
        { caso: 'con año', esperado: 'No hay títulos con estos filtros.', obtenido: L.emptyText({ ...F, year: 'none' }) },
        { caso: 'con subtipo', esperado: 'No hay títulos con estos filtros.', obtenido: L.emptyText({ ...F, subtype: 'manga' }) },
        { caso: 'con etiquetas', esperado: 'No hay títulos con estos filtros.', obtenido: L.emptyText({ ...F, tags: { keys: ['drama'] } }) },
    ]);

    const t = (title) => ({ title });
    tabla('búsqueda (F9): sin mayúsculas ni acentos, subcadena del título recortado; "n" encuentra "ñ"', [
        { caso: '"anime", "ANIME" y "  aní  " encuentran "Ánime clásico"', esperado: [true, true, true], obtenido: ['anime', 'ANIME', '  aní  '].map((q) => L.matchesSearch(t('Ánime clásico'), q)) },
        { caso: '"n" y "nandu" encuentran "Ñandú"', esperado: [true, true], obtenido: ['n', 'nandu'].map((q) => L.matchesSearch(t('Ñandú'), q)) },
        { caso: 'espacios internos reducidos ("la   casa" ↔ "La casa")', esperado: true, obtenido: L.matchesSearch(t('  La casa  '), 'la   casa') },
        { caso: 'vacía o solo espacios no filtra', esperado: [true, true], obtenido: ['', '   '].map((q) => L.matchesSearch(t('Cualquiera'), q)) },
        { caso: 'no coincide', esperado: false, obtenido: L.matchesSearch(t('Batman'), 'robin') },
        { caso: 'normalizeSearch', esperado: 'el nino y la cigüena'.normalize('NFD').replace(/\p{M}/gu, ''), obtenido: L.normalizeSearch('  El  NIÑO y la CIGÜEÑA ') },
    ]);

    tabla('P6: contador de filtros por grupo (0–3); ni la búsqueda ni el orden cuentan', [
        { caso: 'ninguno', esperado: 0, obtenido: L.activeFilterCount(F) },
        { caso: 'solo búsqueda', esperado: 0, obtenido: L.activeFilterCount({ ...F, search: 'x' }) },
        { caso: 'subtipo', esperado: 1, obtenido: L.activeFilterCount({ ...F, subtype: 'book' }) },
        { caso: 'dos etiquetas = 1 grupo', esperado: 1, obtenido: L.activeFilterCount({ ...F, tags: { keys: ['a', 'b'] } }) },
        { caso: '"Sin etiquetas" = 1', esperado: 1, obtenido: L.activeFilterCount({ ...F, tags: { keys: [], none: true } }) },
        { caso: 'subtipo + año', esperado: 2, obtenido: L.activeFilterCount({ ...F, subtype: 'comic', year: 2000 }) },
        { caso: 'los tres (+ búsqueda)', esperado: 3, obtenido: L.activeFilterCount({ ...F, subtype: 'comic', tags: { keys: ['a'] }, year: 'none', search: 'x' }) },
    ]);

    const p3 = [
        { id: 'c1', type: 'series', title: 'Breaking', status: 'Pendiente', start_year: 2008 },
        { id: 'c2', type: 'series', title: 'Break Point', status: 'Mirando', start_year: 2008 },
        { id: 'c3', type: 'series', title: 'Bréak Old', status: 'Terminado', start_year: 2001 },
        { id: 'c4', type: 'series', title: 'Otra', status: 'Pendiente', start_year: 2008 },
        { id: 'c5', type: 'series', title: 'Breakfast', status: 'Terminado', start_year: 2008 },
    ];
    tabla('P3: los contadores de las pestañas reflejan búsqueda y año', [
        { caso: 'sin filtros', esperado: { Pendiente: 2, Mirando: 1, Terminado: 2, Total: 5 }, obtenido: L.buildPages(p3, F).counts },
        { caso: 'búsqueda "break"', esperado: { Pendiente: 1, Mirando: 1, Terminado: 2, Total: 4 }, obtenido: L.buildPages(p3, { ...F, search: 'break' }).counts },
        { caso: 'búsqueda "break" + año 2008', esperado: { Pendiente: 1, Mirando: 1, Terminado: 1, Total: 3 }, obtenido: L.buildPages(p3, { ...F, search: 'break', year: 2008 }).counts },
    ]);

    const combo = [
        { id: 'k1', type: 'reading', title: 'Saga', status: 'Pendiente', subtype: 'comic', tags: '["Drama","Shounen"]', start_year: 2012 },
        { id: 'k2', type: 'reading', title: 'Sandman', status: 'Pendiente', subtype: 'comic', tags: '["Drama"]', start_year: 1989 },
        { id: 'k3', type: 'reading', title: 'Berserk', status: 'Mirando', subtype: 'manga', tags: '["Drama","Shounen"]', start_year: 1989 },
        { id: 'k4', type: 'reading', title: 'Sin etiquetas', status: 'Pendiente', subtype: 'comic', tags: null, start_year: 2012 },
        { id: 'k5', type: 'reading', title: 'Sin subtipo', status: 'Pendiente', subtype: null, tags: '["Drama","Shounen"]', start_year: 2012 },
    ];
    const ver = (estado, f) => L.filterItems(combo, estado, { ...F, ...f }).map((x) => x.id).sort();
    tabla('combinación de estado, subtipo, etiquetas (TODAS / "Sin etiquetas"), año y búsqueda', [
        { caso: 'Pendiente + cómic', esperado: ['k1', 'k2', 'k4'], obtenido: ver('Pendiente', { subtype: 'comic' }) },
        { caso: 'Total + etiquetas Drama y Shounen (TODAS, por clave)', esperado: ['k1', 'k3', 'k5'], obtenido: ver('Total', { tags: { keys: ['DRAMA', 'shounen'] } }) },
        { caso: 'Total + "Sin etiquetas" (exclusivo, aunque haya claves)', esperado: ['k4'], obtenido: ver('Total', { tags: { keys: ['drama'], none: true } }) },
        { caso: '"Sin subtipo" solo aparece con Todos', esperado: [true, false], obtenido: [ver('Total', {}).includes('k5'), ['book', 'comic', 'manga'].some((s) => ver('Total', { subtype: s }).includes('k5'))] },
        { caso: 'Pendiente + cómic + Drama + 2012 + búsqueda "sa"', esperado: ['k1'], obtenido: ver('Pendiente', { subtype: 'comic', tags: { keys: ['drama'] }, year: 2012, search: 'sa' }) },
        { caso: 'Total + año 1989 + búsqueda "SAND"', esperado: ['k2'], obtenido: ver('Total', { year: 1989, search: 'SAND' }) },
    ]);
}

// =============================================================================================
seccion(`2. Equivalencia con ${REF} (loadItems de la referencia) y cambios de orden declarados`);
{
    const E = await entorno();
    // Datos sintéticos: 4 secciones × 13 títulos; estado, subtipo, etiquetas y años variados;
    // created_at distinto por fila (desordenado respecto al título y al orden de alta).
    const NOMBRES = ['zeta', 'Ábaco', 'abeja', 'Abeja', 'Ñandú', 'nube', 'oso', 'Batman', 'batalla', '2001', '10 cosas', 'Dune', 'Dune II'];
    const ESTADOS = ['Pendiente', 'Mirando', 'Terminado'];
    const SUB = ['book', 'comic', 'manga', null];
    const ETQ = [['Con año', 'Drama'], ['Con año'], ['Con año', 'Shounen', 'Drama'], ['Con año'], ['Con año', 'Drama'], [], ['Drama'], ['Shounen'], [], ['Drama', 'Shounen'], [], ['Drama'], []];
    const SECCIONES = ['movie', 'series', 'anime', 'reading'];
    const orden = [7, 2, 11, 0, 9, 4, 12, 1, 6, 3, 10, 5, 8];
    let k = 0;
    for (const type of SECCIONES) {
        for (let i = 0; i < NOMBRES.length; i++) {
            // Los 5 primeros ("Con año") tienen año principal distinto; el resto mezcla nulos y la otra columna.
            const principal = i < 5 ? 1990 + i * 3 : (i % 3 === 0 ? null : 2000 + i);
            const otra = i === 7 ? 2001 : (i === 8 ? 1980 : null);
            const t = { type, title: NOMBRES[i], status: ESTADOS[i % 3], subtype: type === 'reading' ? SUB[i % 4] : null, tags: ETQ[i] };
            if (type === 'movie') { t.year = principal; t.start_year = otra; } else { t.start_year = principal; t.year = otra; }
            t.created_at = `2026-02-${String(1 + Math.floor(orden[i] / 4) + k).padStart(2, '0')}T0${orden[i] % 4}:00:00.000Z`;
            await E.crear(t);
        }
        k += 4;
    }
    const TAGS = [{ keys: [], none: false }, { keys: ['drama'], none: false }, { keys: ['drama', 'shounen'], none: false }, { keys: [], none: true }];
    const celdas = [];
    for (const tab of SECCIONES) for (const subtype of (tab === 'reading' ? ['Todos', 'book', 'comic', 'manga'] : ['Todos'])) for (const tagFilter of TAGS) celdas.push({ tab, subtype, tagFilter });

    const conjuntos = [], contadores = [], ordenReg = [], ordenAnio = [];
    let celdasAnio = 0;
    for (const c of celdas) {
        const filtros = { ...L.EMPTY_FILTERS, subtype: c.subtype, tags: c.tagFilter };
        const nueva = await listaNueva(E, { tab: c.tab, filtros });
        for (const status of L.STATUS_TABS) {
            const v = await listaVieja(E, { tab: c.tab, status, tagFilter: c.tagFilter, subtype: c.subtype });
            const n = nueva.pages[status];
            const etiquetaCelda = `${c.tab}/${status}/${c.subtype}/${JSON.stringify(c.tagFilter)}`;
            conjuntos.push({ caso: etiquetaCelda, esperado: v.items.map((x) => x.id).sort(), obtenido: n.map((x) => x.id).sort() });
            if (status === 'Total') contadores.push({ caso: `${c.tab}/${c.subtype}/${JSON.stringify(c.tagFilter)}`, esperado: v.counts, obtenido: nueva.counts });
            for (const dir of ['DESC', 'ASC']) {
                const vr = await listaVieja(E, { tab: c.tab, status, tagFilter: c.tagFilter, subtype: c.subtype, sortBy: 'created_at', order: dir });
                const nr = await listaNueva(E, { tab: c.tab, filtros, orden: { field: 'created_at', dir: dir.toLowerCase() } });
                ordenReg.push({ caso: `${etiquetaCelda} ${dir}`, esperado: vr.items.map((x) => x.id), obtenido: nr.pages[status].map((x) => x.id) });
                // Año: solo donde el orden viejo está definido (todos con año principal y sin repetir).
                const va = await listaVieja(E, { tab: c.tab, status, tagFilter: c.tagFilter, subtype: c.subtype, sortBy: 'year_start', order: dir });
                const prin = va.items.map((x) => (c.tab === 'movie' ? x.year : x.start_year));
                if (va.items.length > 1 && prin.every((y) => y !== null) && new Set(prin).size === prin.length) {
                    const na = await listaNueva(E, { tab: c.tab, filtros, orden: { field: 'year', dir: dir.toLowerCase() } });
                    ordenAnio.push({ caso: `${etiquetaCelda} ${dir}`, esperado: va.items.map((x) => x.id), obtenido: na.pages[status].map((x) => x.id) });
                    celdasAnio++;
                }
            }
        }
    }
    tabla(`E1: mismo CONJUNTO de filas que ${REF} en cada sección × estado × subtipo × etiquetas`, conjuntos);
    tabla(`E2: mismos CONTADORES de las 4 pestañas que getBacklogCounts (vía el loadItems de ${REF})`, contadores);
    tabla('E3: mismo ORDEN en Registro descendente (por defecto) y ascendente, en cada celda', ordenReg);
    check(`E4: mismo ORDEN en Año ascendente y descendente donde el viejo está definido (${celdasAnio} celdas)`, celdasAnio >= 8 && ordenAnio.every((f) => igual(f.esperado, f.obtenido)),
        celdasAnio < 8 ? `pocas celdas comparables: ${celdasAnio}` : ordenAnio.filter((f) => !igual(f.esperado, f.obtenido)).map((f) => f.caso).join(' | '));

    // E6: cambios declarados del orden por Año (resultados escritos a mano).
    const E6 = await entorno();
    const id = {};
    for (const t of [
        { k: 'A', type: 'movie', title: 'Peli A', year: 1999 },
        { k: 'B', type: 'movie', title: 'Peli B', year: 2010 },
        { k: 'C', type: 'movie', title: 'Peli C' },
        { k: 'P', type: 'movie', title: 'Peli P', start_year: 2001 },
        { k: 'S1', type: 'series', title: 'Serie 1', start_year: 2015, year: 2010 },
        { k: 'S2', type: 'series', title: 'Serie 2', year: 2010 },
        { k: 'S3', type: 'series', title: 'Serie 3' },
        { k: 'S4', type: 'series', title: 'Serie 4', start_year: 2012 },
    ]) id[t.k] = await E6.crear(t);
    const de = (lista) => lista.map((x) => Object.keys(id).find((k) => id[k] === x.id));
    const viejaPelis = async (dir) => de((await listaVieja(E6, { tab: 'movie', status: 'Total', sortBy: 'year_start', order: dir })).items);
    const nuevaPelis = async (dir) => de((await listaNueva(E6, { tab: 'movie', orden: { field: 'year', dir } })).pages.Total);
    const viejaSeries = de((await listaVieja(E6, { tab: 'series', status: 'Total', sortBy: 'year_start', order: 'ASC' })).items);
    tabla('E6: cambios declarados del orden por Año (sin año al final también en ascendente; la otra columna cuando falta la principal)', [
        { caso: 'películas ASC antes: sin year primero (C y P, entre sí indefinido), después 1999, 2010', esperado: { primeros: ['C', 'P'], resto: ['A', 'B'] }, obtenido: (await viejaPelis('ASC')).reduce((m, x, i) => (i < 2 ? { ...m, primeros: [...m.primeros, x].sort() } : { ...m, resto: [...m.resto, x] }), { primeros: [], resto: [] }) },
        { caso: 'películas ASC ahora: 1999, 2001 (P por start_year), 2010, sin año', esperado: ['A', 'P', 'B', 'C'], obtenido: await nuevaPelis('asc') },
        { caso: 'películas DESC ahora: 2010, 2001, 1999, sin año', esperado: ['B', 'P', 'A', 'C'], obtenido: await nuevaPelis('desc') },
        { caso: 'series ASC antes: sin start_year primero (S2 y S3), después 2012, 2015', esperado: { primeros: ['S2', 'S3'], resto: ['S4', 'S1'] }, obtenido: viejaSeries.reduce((m, x, i) => (i < 2 ? { ...m, primeros: [...m.primeros, x].sort() } : { ...m, resto: [...m.resto, x] }), { primeros: [], resto: [] }) },
        { caso: 'series ASC ahora: 2010 (S2 por year), 2012, 2015 (S1 usa start_year), sin año', esperado: ['S2', 'S4', 'S1', 'S3'], obtenido: de((await listaNueva(E6, { tab: 'series', orden: { field: 'year', dir: 'asc' } })).pages.Total) },
    ]);

    // E7: cambio declarado del orden por Título (BINARY → localeCompare('es')), escrito a mano.
    const E7 = await entorno();
    for (const title of ['zeta', 'Ábaco', 'abeja', 'Abeja', 'Ñandú', 'nube', 'oso', 'Batman', 'batalla', '2001', '10 cosas', 'Dune', 'Dune']) await E7.crear({ type: 'movie', title });
    const viejaT = (await listaVieja(E7, { tab: 'movie', status: 'Total', sortBy: 'title', order: 'ASC' })).items;
    const nuevaT = (await listaNueva(E7, { tab: 'movie', orden: { field: 'title', dir: 'asc' } })).pages.Total;
    const nuevaTd = (await listaNueva(E7, { tab: 'movie', orden: { field: 'title', dir: 'desc' } })).pages.Total;
    const dunes = (xs) => xs.filter((x) => x.title === 'Dune').map((x) => x.id);
    tabla('E7: cambio declarado del orden por Título (resultado escrito a mano)', [
        { caso: `antes (${REF}, SQLite BINARY) ASC`, esperado: ['10 cosas', '2001', 'Abeja', 'Batman', 'Dune', 'Dune', 'abeja', 'batalla', 'nube', 'oso', 'zeta', 'Ábaco', 'Ñandú'], obtenido: viejaT.map((x) => x.title) },
        { caso: 'ahora (localeCompare("es")) ASC', esperado: ['10 cosas', '2001', 'Ábaco', 'abeja', 'Abeja', 'batalla', 'Batman', 'Dune', 'Dune', 'nube', 'Ñandú', 'oso', 'zeta'], obtenido: nuevaT.map((x) => x.title) },
        { caso: 'ahora DESC', esperado: ['zeta', 'oso', 'Ñandú', 'nube', 'Dune', 'Dune', 'Batman', 'batalla', 'Abeja', 'abeja', 'Ábaco', '2001', '10 cosas'], obtenido: nuevaTd.map((x) => x.title) },
        { caso: 'las dos Dune por id ascendente, en ASC y en DESC', esperado: [true, true], obtenido: [dunes(nuevaT), dunes(nuevaTd)].map((d) => d.length === 2 && d[0] < d[1]) },
    ]);

    // E8: empates de created_at (el viejo no se compara: su orden no está definido).
    const E8 = await entorno();
    const mismo = '2026-03-01T10:00:00.000Z';
    const e8 = {};
    for (const t of [{ k: 'Beta', title: 'Beta' }, { k: 'alfa', title: 'alfa' }, { k: 'Beta2', title: 'Beta' }, { k: 'nuevo', title: 'Nuevo', created_at: '2026-03-02T10:00:00.000Z' }]) {
        e8[t.k] = await E8.crear({ type: 'anime', title: t.title, created_at: t.created_at || mismo });
    }
    const betas = [e8.Beta, e8.Beta2].sort();
    const nombre = (x) => (x.title === 'Beta' ? `Beta(${x.id === betas[0] ? 1 : 2})` : x.title);
    tabla('E8: empates de Registro → título y después id (siempre ascendentes)', [
        { caso: 'descendente', esperado: ['Nuevo', 'alfa', 'Beta(1)', 'Beta(2)'], obtenido: (await listaNueva(E8, { tab: 'anime' })).pages.Total.map(nombre) },
        { caso: 'ascendente', esperado: ['alfa', 'Beta(1)', 'Beta(2)', 'Nuevo'], obtenido: (await listaNueva(E8, { tab: 'anime', orden: { field: 'created_at', dir: 'asc' } })).pages.Total.map(nombre) },
    ]);
}

// =============================================================================================
seccion('3. Memoria de sesión (F7) y cambio de sección (P5)');
{
    M.reiniciarMemoriaPendiente();
    const inicio = M.leerMemoriaPendiente();
    M.guardarMemoriaPendiente({ tipo: 'anime', estado: 'Mirando', orden: { field: 'title', dir: 'asc' }, busqueda: 'x', year: 2000, search: 'y' });
    const recordada = M.leerMemoriaPendiente();
    // La pantalla guarda SOLO tipo, estado y orden (estático).
    let llamada = null;
    traverse(astDe(leer(PANT)), {
        CallExpression(p) {
            if (p.node.callee.name === 'guardarMemoriaPendiente') llamada = p.node.arguments[0].properties.map((q) => q.key.name).sort();
        },
    });
    tabla('F7: recuerda tipo, estado y orden; no recuerda búsqueda ni año', [
        { caso: 'al abrir la app', esperado: { tipo: 'movie', estado: 'Pendiente', orden: { field: 'created_at', dir: 'desc' } }, obtenido: inicio },
        { caso: 'tras guardar (búsqueda y año se ignoran)', esperado: { tipo: 'anime', estado: 'Mirando', orden: { field: 'title', dir: 'asc' } }, obtenido: recordada },
        { caso: 'la pantalla guarda solo { estado, orden, tipo }', esperado: ['estado', 'orden', 'tipo'], obtenido: llamada },
        { caso: 'cerrar y abrir la app (reiniciar) vuelve al inicio', esperado: inicio, obtenido: M.reiniciarMemoriaPendiente() },
    ]);
    M.guardarMemoriaPendiente({ tipo: 'reading', estado: 'Total', orden: { field: 'year', dir: 'asc' } });
    const antes = M.leerMemoriaPendiente();
    M.guardarMemoriaPendiente({ tipo: 'libros', estado: 'Pausado', orden: { field: 'franchise', dir: 'asc' } });
    const tras1 = M.leerMemoriaPendiente();
    M.guardarMemoriaPendiente({ orden: { field: 'title', dir: 'arriba' } });
    tabla('F7: valida los enumerados (lo inválido se ignora)', [
        { caso: 'tipo, estado y campo inválidos', esperado: antes, obtenido: tras1 },
        { caso: 'dirección inválida', esperado: antes, obtenido: M.leerMemoriaPendiente() },
        { caso: 'nada que guardar', esperado: antes, obtenido: M.guardarMemoriaPendiente(null) },
    ]);
    M.reiniciarMemoriaPendiente();

    // P5 (estático): el efecto de [activeTab] limpia subtipo, etiquetas y año, y no toca la búsqueda.
    const revisarP5 = (codigo) => {
        let r = null;
        traverse(astDe(codigo), {
            CallExpression(p) {
                if (p.node.callee.name !== 'useEffect') return;
                const deps = p.node.arguments[1];
                if (!deps || deps.type !== 'ArrayExpression' || deps.elements.length !== 1 || deps.elements[0].name !== 'activeTab') return;
                const cuerpo = codigo.slice(p.node.arguments[0].start, p.node.arguments[0].end);
                if (!/set(ActiveSubtype|TagFilter|YearFilter)/.test(cuerpo)) return;
                r = /setActiveSubtype\('Todos'\)/.test(cuerpo) && /setTagFilter\(FILTRO_VACIO\)/.test(cuerpo) && /setYearFilter\(null\)/.test(cuerpo) && !/setBusqueda|setBuscando/.test(cuerpo);
            },
        });
        return r === true;
    };
    const SRC = leer(PANT);
    const sembrada = SRC.replace('setYearFilter(null);\n    }, [activeTab]);', "setYearFilter(null);\n        setBusqueda('');\n    }, [activeTab]);");
    const sinAnio = SRC.replace('        setYearFilter(null);\n    }, [activeTab]);', '    }, [activeTab]);');
    check('P5: cambiar de sección limpia año, etiquetas y subtipo y conserva la búsqueda (controles negativos: limpiar la búsqueda / no limpiar el año)',
        revisarP5(SRC) && sembrada !== SRC && !revisarP5(sembrada) && sinAnio !== SRC && !revisarP5(sinAnio));
}

// =============================================================================================
seccion('4. D6 sin cambios y formulario (P7)');
{
    const E = await entorno();
    // D6: serie sin vínculo en Pendiente → hoja "Marcar como Terminado" y, con "Terminado", cambia.
    const idS = await E.crear({ type: 'series', title: 'Serie suelta' });
    const fila = async (id) => { E.usar(); return E.db.db.getFirstAsync('SELECT status FROM backlog WHERE id = ?', [id]); };
    const A1 = crearAlert('Terminado');
    const up1 = actual('handleUpdateStatus', { db: E.db, nextManualStatus: link.nextManualStatus, needsFinishConfirm: link.needsFinishConfirm, loadItems: () => {}, ...hojasDesdeAlert(A1.Alert) });
    E.usar();
    await up1({ id: idS, type: 'series', status: 'Pendiente', title: 'Serie suelta' });
    tabla('D6: "Marcar como Terminado" (serie sin vínculo)', [
        { caso: 'hoja con sus textos y botones', esperado: { titulo: 'Marcar como Terminado', mensaje: '¿Marcar «Serie suelta» como Terminado?', botones: ['Terminado', 'Cancelar'] }, obtenido: A1.registro[0] },
        { caso: 'queda Terminado', esperado: 'Terminado', obtenido: (await fila(idS)).status },
    ]);
    // D6: vinculado → aviso "Vinculado" y no se escribe nada.
    const A2 = crearAlert();
    let escrituras = 0;
    const up2 = actual('handleUpdateStatus', { db: { updateBacklogStatus: async () => { escrituras++; return { success: true }; } }, nextManualStatus: link.nextManualStatus, needsFinishConfirm: link.needsFinishConfirm, loadItems: () => {}, ...hojasDesdeAlert(A2.Alert) });
    await up2({ id: 'x', type: 'reading', status: 'Mirando', title: 'Obra', linked_series_id: 's1', linked_category_name: 'Cómics' });
    tabla('D6: título vinculado', [
        { caso: 'aviso "Vinculado" con su texto', esperado: { titulo: 'Vinculado', mensaje: 'El estado lo cambia la obra en «Cómics».', botones: [] }, obtenido: A2.registro[0] },
        { caso: 'no escribe', esperado: 0, obtenido: escrituras },
    ]);

    // P7: handleAddItem real con la fachada.
    // `estado`: la pestaña en la que está la pantalla al guardar; `pantalla` = dónde queda después
    // (sección y pestaña), aplicando los setters que llame handleAddItem.
    const guardar = async ({ activeTab, formData, editingItem = null, estado = 'Pendiente' }) => {
        const A = crearAlert();
        const llamadas = { setActiveStatus: [], setActiveTab: [], loadItems: 0, modal: null };
        const pantalla = { seccion: activeTab, pestana: estado };
        const fn = actual('handleAddItem', {
            informar: hojasDesdeAlert(A.Alert).informar, validateBacklogForm: link.validateBacklogForm, editingItem,
            formData: { title: '', year: '', format: '24 min', start_year: '', end_year: '', subtype: null, tags: [], ...formData },
            activeTab, db: E.db, user: E.user, FORM_VACIO: {},
            setModalVisible: (v) => { llamadas.modal = v; }, setEditingItem: () => {}, setFormData: () => {},
            setActiveStatus: (s) => { llamadas.setActiveStatus.push(s); pantalla.pestana = s; },
            setActiveTab: (t) => { llamadas.setActiveTab.push(t); pantalla.seccion = t; },
            loadItems: () => { llamadas.loadItems++; },
        });
        E.usar();
        await fn();
        return { alertas: A.registro.map((x) => x.mensaje), ...llamadas, pantalla };
    };
    const tipoDe = async (title) => { E.usar(); const r = await E.db.db.getFirstAsync('SELECT type, subtype, tags FROM backlog WHERE title = ? AND deleted_at IS NULL', [title]); return r ? { ...r } : null; };
    const a = await guardar({ activeTab: 'movie', formData: { type: 'anime', title: 'Nuevo anime', start_year: '2020' }, estado: 'Terminado' });
    const b = await guardar({ activeTab: 'movie', formData: { type: 'movie', title: 'Nueva peli', year: '1994' } });
    const m = await guardar({ activeTab: 'series', formData: { type: 'series', title: 'Nueva desde Mirando' }, estado: 'Mirando' });
    const idEd = await E.crear({ type: 'series', title: 'Para editar', status: 'Mirando' });
    const c = await guardar({ activeTab: 'series', formData: { type: 'movie', title: 'Editada' }, editingItem: { id: idEd, type: 'series', title: 'Para editar' }, estado: 'Mirando' });
    const d = await guardar({ activeTab: 'movie', formData: { type: 'reading', title: 'Libro sin subtipo' } });
    tabla('P7: tipo al agregar (preseleccionado y cambiable), solo lectura al editar y destino al guardar', [
        { caso: 'agregar con otro tipo (desde Películas / Terminado): se guarda con ese tipo y la pantalla queda en su sección y en Pendiente', esperado: { guardado: { type: 'anime', subtype: null, tags: null }, setActiveTab: ['anime'], setActiveStatus: ['Pendiente'], loadItems: 0, modal: false, pantalla: { seccion: 'anime', pestana: 'Pendiente' } }, obtenido: { guardado: await tipoDe('Nuevo anime'), setActiveTab: a.setActiveTab, setActiveStatus: a.setActiveStatus, loadItems: a.loadItems, modal: a.modal, pantalla: a.pantalla } },
        { caso: 'agregar en la misma sección: Pendiente y recarga, sin cambiar de sección', esperado: { type: 'movie', setActiveTab: [], setActiveStatus: ['Pendiente'], loadItems: 1, pantalla: { seccion: 'movie', pestana: 'Pendiente' } }, obtenido: { type: (await tipoDe('Nueva peli')).type, setActiveTab: b.setActiveTab, setActiveStatus: b.setActiveStatus, loadItems: b.loadItems, pantalla: b.pantalla } },
        { caso: 'agregar en la misma sección estando en Mirando: la pantalla pasa a Pendiente', esperado: { type: 'series', setActiveTab: [], loadItems: 1, pantalla: { seccion: 'series', pestana: 'Pendiente' } }, obtenido: { type: (await tipoDe('Nueva desde Mirando')).type, setActiveTab: m.setActiveTab, loadItems: m.loadItems, pantalla: m.pantalla } },
        { caso: 'editar (en Mirando): el tipo es el del título aunque el formulario traiga otro; la pestaña no cambia', esperado: { guardado: { type: 'series', subtype: null, tags: null }, setActiveTab: [], setActiveStatus: [], loadItems: 1, pantalla: { seccion: 'series', pestana: 'Mirando' } }, obtenido: { guardado: await tipoDe('Editada'), setActiveTab: c.setActiveTab, setActiveStatus: c.setActiveStatus, loadItems: c.loadItems, pantalla: c.pantalla } },
        { caso: 'lectura sin subtipo: la validación usa el tipo del formulario', esperado: { alertas: ['Elige el subtipo: libro, cómic o manga.'], guardado: null }, obtenido: { alertas: d.alertas, guardado: await tipoDe('Libro sin subtipo') } },
    ]);

    // P7 (estático): en el formulario, FilaTipos con disabled={!!editingItem} y un onChange que pone
    // el tipo y limpia subtipo y etiquetas. Controles negativos: sin limpiar etiquetas / sin disabled.
    const revisarForm = (codigo) => {
        let r = false;
        traverse(astDe(codigo), {
            JSXElement(p) {
                if (nombreJsx(p.node) !== 'FilaTipos') return;
                let enHoja = false;
                for (let q = p.parentPath; q; q = q.parentPath) if (q.node.type === 'JSXElement' && nombreJsx(q.node) === 'HojaConTeclado') enHoja = true;
                if (!enHoja) return;
                const dis = attr(p.node, 'disabled');
                const onc = attr(p.node, 'onChange');
                const disOk = !!dis && codigo.slice(dis.value.start, dis.value.end).replace(/\s/g, '') === '{!!editingItem}';
                const cuerpo = onc ? codigo.slice(onc.value.start, onc.value.end) : '';
                const oncOk = /type:\s*t\b/.test(cuerpo) && /subtype:\s*null/.test(cuerpo) && /tags:\s*\[\]/.test(cuerpo);
                r = disOk && oncOk;
            },
        });
        return r;
    };
    const SRC = leer(PANT);
    const sinTags = SRC.replace('type: t, subtype: null, tags: [] }', 'type: t, subtype: null }');
    const sinDisabled = SRC.replace('disabled={!!editingItem}', '');
    check('P7: cambiar el tipo en el formulario limpia subtipo y etiquetas; al editar es de solo lectura (controles negativos: sin limpiar etiquetas / sin disabled)',
        revisarForm(SRC) && sinTags !== SRC && !revisarForm(sinTags) && sinDisabled !== SRC && !revisarForm(sinDisabled));
}

// =============================================================================================
seccion('5. Comprobaciones estáticas');
{
    const SRC_TODO = archivos('src');
    const FILA = leer('src/components/FilaTipos.js');
    const PAG = leer('src/components/PaginadorEstados.js');
    const BACK = leer(PANT);

    // S1: la fila de tipos sin desplazamiento horizontal (FilaTipos y la cabecera de la pantalla).
    const sinScrollHorizontal = (codigo) => {
        let malo = false;
        traverse(astDe(codigo), {
            JSXElement(p) {
                const n = nombreJsx(p.node);
                if ((n === 'ScrollView' || n === 'FlatList') && attr(p.node, 'horizontal')) malo = true;
            },
        });
        return !malo;
    };
    const cabecera = BACK.slice(BACK.indexOf('{/* Cabecera compacta'), BACK.indexOf('<PaginadorEstados'));
    const filaSembrada = FILA.replace('<View style={styles.fila} accessibilityRole="tablist">', '<ScrollView horizontal><View style={styles.fila} accessibilityRole="tablist">').replace(/<\/View>\s*\);\s*\}\s*const styles/, '</View></ScrollView>\n    );\n}\n\nconst styles');
    check('S1: tipos en una fila fija, sin ScrollView/FlatList horizontal (FilaTipos y cabecera de Pendiente; control negativo: ScrollView horizontal sembrado)',
        sinScrollHorizontal(FILA) && /fila:\s*\{\s*flexDirection:\s*'row'/.test(FILA) && /flex:\s*1,\s*minWidth:\s*0/.test(FILA) && cabecera.length > 0 && !/ScrollView|FlatList/.test(cabecera)
        && filaSembrada !== FILA && !sinScrollHorizontal(filaSembrada));

    // S2: el paginador es una FlatList horizontal con pagingEnabled, getItemLayout,
    // initialScrollIndex, onMomentumScrollEnd y scrollToIndex; la pantalla lo usa.
    const revisarPag = (codigo) => {
        let ok = false;
        traverse(astDe(codigo), {
            JSXElement(p) {
                if (nombreJsx(p.node) !== 'FlatList') return;
                ok = ['horizontal', 'pagingEnabled', 'getItemLayout', 'initialScrollIndex', 'onMomentumScrollEnd'].every((a) => !!attr(p.node, a));
            },
        });
        return ok && /\.scrollToIndex\(/.test(codigo) && /useWindowDimensions\(\)/.test(codigo);
    };
    const pagSembrado = PAG.replace('            pagingEnabled\n', '');
    check('S2: paginador = FlatList horizontal con pagingEnabled, getItemLayout (ancho de useWindowDimensions), initialScrollIndex, onMomentumScrollEnd y scrollToIndex; BacklogScreen lo usa (control negativo: sin pagingEnabled)',
        revisarPag(PAG) && /<PaginadorEstados[\s\S]*?estados=\{STATUS_TABS\}/.test(BACK) && pagSembrado !== PAG && !revisarPag(pagSembrado));

    // S3: sin gesture-handler, pager-view, reanimated ni PanResponder (src/ y package.json).
    const PROHIBIDO = /react-native-gesture-handler|react-native-pager-view|react-native-reanimated|\bPanResponder\b/;
    const conProhibido = (fuentes) => Object.entries(fuentes).filter(([, c]) => PROHIBIDO.test(sinComentarios(c))).map(([f]) => f);
    const fuentesSrc = Object.fromEntries(SRC_TODO.map((f) => [f, leer(f)]));
    const pkg = JSON.parse(leer('package.json'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const sembradoS3 = { 'src/screens/Copia.js': "import { PanResponder } from 'react-native';\nimport PagerView from 'react-native-pager-view';" };
    check('S3: sin react-native-gesture-handler, react-native-pager-view, react-native-reanimated ni PanResponder en src/ y package.json (control negativo sembrado)',
        conProhibido(fuentesSrc).length === 0 && !deps.some((d) => PROHIBIDO.test(d)) && conProhibido(sembradoS3).length === 1,
        conProhibido(fuentesSrc).join(', '));

    // S4: Icono.js, único archivo que importa @react-native-vector-icons/lucide (y solo /static).
    const importadores = (fuentes) => {
        const malos = [];
        for (const [f, c] of Object.entries(fuentes)) {
            traverse(astDe(c), {
                ImportDeclaration(p) {
                    const v = p.node.source.value;
                    if (!v.startsWith('@react-native-vector-icons/lucide')) return;
                    if (f !== 'src/components/Icono.js' || v !== '@react-native-vector-icons/lucide/static') malos.push(`${f}:${v}`);
                },
            });
        }
        return malos;
    };
    const tieneEstatico = /from '@react-native-vector-icons\/lucide\/static'/.test(fuentesSrc['src/components/Icono.js'] || '');
    const negS4 = importadores({ 'src/screens/BacklogScreen.js': "import { Lucide } from '@react-native-vector-icons/lucide/static';", 'src/components/Icono.js': "import { Lucide } from '@react-native-vector-icons/lucide';" });
    check('S4: Icono.js es el único archivo que importa @react-native-vector-icons/lucide, y solo la entrada /static (control negativo: import en otra pantalla / entrada dinámica)',
        tieneEstatico && importadores(fuentesSrc).length === 0 && negS4.length === 2, importadores(fuentesSrc).join(', '));

    // S5: plugin en app.json, Lucide.ttf fuera de expo-font, versión 1.4.5 / 19 y paquete fijado.
    const app = JSON.parse(leer('app.json')).expo;
    const fuentesExpoFont = (app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-font') || [null, { fonts: [] }])[1].fonts;
    tabla('S5: app.json y package.json', [
        { caso: 'plugin "@react-native-vector-icons/lucide" en app.json', esperado: true, obtenido: app.plugins.includes('@react-native-vector-icons/lucide') },
        { caso: 'Lucide.ttf fuera del plugin de expo-font (solo las 4 Plus Jakarta Sans)', esperado: [4, false], obtenido: [fuentesExpoFont.length, fuentesExpoFont.some((f) => /lucide|vector-icons/i.test(f))] },
        { caso: 'versión 1.4.5 / versionCode 19', esperado: ['1.4.5', 19], obtenido: [app.version, app.android.versionCode] },
        { caso: 'paquete fijado exacto 14.0.0 (sin ^ ni ~)', esperado: '14.0.0', obtenido: pkg.dependencies['@react-native-vector-icons/lucide'] },
    ]);

    // S6: cada glifo del mapa existe en el Lucide.json instalado.
    let iconos = null;
    traverse(astDe(leer('src/components/Icono.js')), {
        VariableDeclarator(p) { if (p.node.id.name === 'ICONOS') iconos = Object.fromEntries(p.node.init.properties.map((q) => [q.key.name, q.value.value])); },
    });
    const glifos = JSON.parse(leer('node_modules/@react-native-vector-icons/lucide/glyphmaps/Lucide.json'));
    const faltan = Object.entries(iconos || {}).filter(([, g]) => !Object.hasOwn(glifos, g));
    tabla('S6: glifos del mapa de Icono.js (existen en el Lucide.json instalado)', [
        { caso: 'mapa', esperado: { peliculas: 'clapperboard', series: 'tv', anime: 'sparkles', lectura: 'book-open', mas: 'plus', filtros: 'sliders-horizontal', buscar: 'search', orden: 'arrow-up-down', cerrar: 'x', etiquetas: 'tags', atras: 'arrow-left' }, obtenido: iconos },
        { caso: 'todos existen', esperado: [], obtenido: faltan },
    ]);

    // S7: franchise sigue sin usarse; ningún Modal (ni con TextInput) en los archivos nuevos.
    const NUEVOS = ['src/entertainment/backlogList.ts', 'src/hooks/memoriaPendiente.js', 'src/components/Icono.js', 'src/components/FilaTipos.js', 'src/components/PaginadorEstados.js',
        'src/components/FiltrosPendienteHoja.js', 'src/components/BuscarPendiente.js', 'src/components/EtiquetasFiltro.js', PANT];
    const conFranquicia = NUEVOS.filter((f) => /franchise|franquicia/i.test(sinComentarios(leer(f))));
    const conModal = NUEVOS.filter((f) => /<Modal\b|\bModal\b.*from 'react-native'|import \{[^}]*\bModal\b[^}]*\} from 'react-native'/.test(sinComentarios(leer(f))));
    check(`S7: franchise sin usar y ningún Modal (con o sin TextInput) en los ${NUEVOS.length} archivos nuevos o reescritos`, conFranquicia.length === 0 && conModal.length === 0,
        [...conFranquicia.map((f) => `franchise: ${f}`), ...conModal.map((f) => `Modal: ${f}`)].join(', '));

    // S8 (O8): el "+" es el ícono "plus" centrado en su botón (sin texto "+").
    let fab = null;
    traverse(astDe(BACK), {
        JSXElement(p) {
            if (nombreJsx(p.node) !== 'TouchableOpacity') return;
            const st = attr(p.node, 'style');
            if (!st || !BACK.slice(st.value.start, st.value.end).includes('styles.fab')) return;
            fab = p.node.children.filter((c) => c.type === 'JSXElement').map((c) => `${nombreJsx(c)}:${(attr(c, 'nombre') || {}).value?.value}`);
        },
    });
    const estiloFab = (/fab:\s*\{[^}]*\}/.exec(BACK) || [''])[0];
    tabla('S8 (O8): el "+" con el ícono "plus", centrado', [
        { caso: 'hijo único del botón: <Icono nombre="mas">', esperado: ['Icono:mas'], obtenido: fab },
        { caso: '"mas" es el glifo "plus"', esperado: 'plus', obtenido: iconos && iconos.mas },
        { caso: 'botón centrado vertical y horizontal; sin texto "+" ni fabIcon', esperado: [true, true, false], obtenido: [/justifyContent:\s*'center'/.test(estiloFab), /alignItems:\s*'center'/.test(estiloFab), /fabIcon|>\+</.test(BACK)] },
    ]);
}

console.log(fallas === 0 ? `\nFASE 7.5b2a: ${total} OK.` : `\n${fallas} de ${total} prueba(s) fallaron.`);
process.exit(fallas === 0 ? 0 : 1);
