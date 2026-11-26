// Pruebas de la Fase 7.5b1: etiquetas de Pendiente (O11; decisiones E1–E9 y P-a…P-f del plan
// aprobado, con sus condiciones: name_key de 1 a 60 en el servidor, orden canónico por clave código
// por código, renombrar solo mayúsculas reescribe los títulos, guardar usa el nombre del catálogo,
// filtro y conteo por clave, el singular "Se quitará de 1 título.").
//
// Tablas esperadas escritas desde las decisiones, con la fachada real (src/services/db.js) sobre BD
// node:sqlite SINTÉTICAS en un temporal del sistema, funciones reales de BacklogScreen (extraídas con
// scripts/lib/extraer-pantalla.mjs; hojas por scripts/lib/hojas-stub.mjs), el esquema real de
// supabase/migrations/ en PGlite (con el stub de auth) y, para la migración y la compatibilidad, el
// código real de la app 1.4.1 (1f1eec8, cargado con `git show`). Nunca toca un proyecto remoto ni
// datos reales; no imprime filas.
//
// Secciones:
//   1. módulo puro (src/entertainment/tags.ts)
//   2. catálogo: crear, duplicado sin distinguir mayúsculas, más de 30, vacío, espacios, revivir (P-b)
//   3. renombrar: solo mayúsculas (reescribe los títulos), a una viva (bloqueado), sobre una borrada
//   4. borrar: handleDeleteTag real, textos exactos (0, 1, N) y títulos sin la etiqueta
//   5. guardar un título con etiquetas (handleAddItem real): nuevas, de otras secciones y el nombre
//      del catálogo; una transacción (fallo forzado) y una entrada de outbox por fila
//   6. forma canónica y huérfanos (P-c, P-d)
//   7. filtro E8 en la fachada (lista y conteos, por clave)
//   8. franquicia: comprobación estática (+ control negativo) y que la edición la conserva;
//      nombres largos y botones (estático)
//   9. migración 8 sobre una BD v7 de la 1.4.1; vinculación con backlog_tags
//  10. Supabase: migración 7, privilegios, CHECK, UNIQUE, verificar-fase7-5b1, auditar, verificar-fase2
//  11. sync entre 2 dispositivos
//  12. compatibilidad a (1.4.1 contra el servidor con la migración)
//  13. compatibilidad b (1.4.2 contra el servidor sin la migración)
//
// Uso: node scripts/probar-fase7-5b1.mjs
import { extraer, instanciar as instanciarPantalla } from './lib/extraer-pantalla.mjs'; // antes que test-hooks
import { hojasDesdeAlert } from './lib/hojas-stub.mjs';
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { cargarAppVieja } from './lib/app-vieja.mjs';

const traverse = traverseModule.default || traverseModule;
process.env.TZ = 'America/Guayaquil';

const { createDevices, engine, TABLES, quiet } = await import('./lib/sync-devices.mjs');
const { createPgliteTransport } = await import('./lib/pglite-transport.mjs');
const { snapshotDb, compareSnapshots } = await import('./comparar-sync.mjs');
const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const { getConnection } = await import('../src/data/db/connection.ts');
const { __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { backupCalls } = await import('./lib/backup-stub.mjs');
const { LATEST_VERSION } = await import('../src/services/migrations.js');
const { toRemote, fromRemote, NATURAL_KEYS } = await import('../src/sync/mapping.ts');
const { linkLocalAccount } = await import('../src/data/db/linkAccount.ts');
const T = await import('../src/entertainment/tags.ts');
const link = await import('../src/entertainment/link.ts');

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
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const PANT = 'src/screens/BacklogScreen.js';
// 7.5b2a: el filtro de etiquetas pasó a ser el bloque de chips EtiquetasFiltro.js dentro de la hoja
// "Filtros" (FiltrosPendienteHoja.js, que tiene ahora el título y los botones de esa hoja).
const COMPONENTES = ['src/components/EtiquetasCampo.js', 'src/components/EtiquetasFiltro.js', 'src/components/EtiquetasGestionHoja.js', 'src/components/FiltrosPendienteHoja.js'];
const REF_VIEJA = '1f1eec8'; // app 1.4.1 (corrección de la 7.5)
const MIGRACION_NUEVA = '20261124000100_etiquetas.sql';
const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true };

const WORK = join(tmpdir(), 'registro-pruebas-fase7-5b1').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const D = createDevices(`${WORK}/disp`);
let nBD = 0;
const UID = '00000000-0000-4000-8000-000000075b01'; // uid SINTÉTICO

// Alert de React Native, para hojas-stub: registra y pulsa el botón elegido (texto o lista por orden).
function crearAlert(eleccion = null) {
    const registro = [];
    let n = 0;
    return {
        registro,
        Alert: {
            alert: (titulo, mensaje, botones) => {
                registro.push({ titulo, mensaje, botones: botones ? botones.map((b) => b.text) : [] });
                if (!botones || !eleccion) return;
                const texto = Array.isArray(eleccion) ? eleccion[n++] : eleccion;
                const b = botones.find((x) => x.text === texto);
                if (b && b.onPress) b.onPress();
            },
        },
    };
}

// Entorno: un dispositivo con la app nueva, cuenta vinculada a `uid` y ayudas sobre la fachada real.
async function entorno(uid = UID) {
    const dev = await D.newDevice(`bd-${++nBD}`);
    D.use(dev);
    const usar = () => D.use(dev);
    // La fachada usa la conexión activa: con varios dispositivos, cada llamada activa la del suyo.
    const db = new Proxy(dev.svc, {
        get(target, prop) {
            const v = target[prop];
            return typeof v === 'function' ? (...args) => { usar(); return v.apply(target, args); } : v;
        },
    });
    const r = await quiet(() => db.createLinkedUser(uid, 'prueba@ejemplo.test'));
    if (!r.success) throw new Error('createLinkedUser falló');
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && (res.error || res.code)}`); return res; };
    const titulos = async (type, filtro = null, status = 'Total', subtype = 'Todos') => { usar(); return ok(await db.getBacklogItems(uid, type, status, 'created_at', 'ASC', filtro, subtype), 'getBacklogItems').data; };
    const titulo = async (type, title) => (await titulos(type)).find((b) => b.title === title);
    const nuevoTitulo = async (type, title, extra = {}) => {
        usar();
        ok(await db.addBacklogItem(uid, { type, title, ...extra }), 'addBacklogItem');
        await pausa(3);
        return titulo(type, title);
    };
    const catalogo = async () => { usar(); return ok(await db.getBacklogTags(uid), 'getBacklogTags').data; };
    const etiqueta = async (section, name) => (await catalogo()).find((r) => r.section === section && r.name_key === T.tagKey(name));
    const todas = async (section) => { usar(); return db.db.getAllAsync('SELECT id, name, name_key, deleted_at FROM backlog_tags WHERE section = ? ORDER BY name_key', [section]); };
    const outbox = async () => { usar(); return db.db.getAllAsync('SELECT table_name t, row_id r FROM outbox ORDER BY id'); };
    const limpiarOutbox = async () => { usar(); await db.db.runAsync('DELETE FROM outbox'); };
    const porTabla = (filas) => filas.reduce((m, f) => ({ ...m, [f.t]: (m[f.t] || 0) + 1 }), {});
    const unaPorFila = (filas) => new Set(filas.map((f) => `${f.t}:${f.r}`)).size === filas.length;
    return { dev, db, uid, user: { id: uid }, usar, ok, titulos, titulo, nuevoTitulo, catalogo, etiqueta, todas, outbox, limpiarOutbox, porTabla, unaPorFila };
}

// Funciones reales de BacklogScreen con sus dependencias.
const instanciar = (nombre, deps) => instanciarPantalla(extraer(PANT, nombre), { ...T, ...link, ...deps });

// =============================================================================================
seccion('1. Módulo puro (src/entertainment/tags.ts)');
{
    tabla('tagKey y normalizeTagName (letras no ASCII)', [
        { caso: '"Ánime" y "ánime" dan la misma clave', esperado: true, obtenido: T.tagKey('Ánime') === T.tagKey('ánime') },
        { caso: '"Acción" y "Accion" dan claves distintas', esperado: true, obtenido: T.tagKey('Acción') !== T.tagKey('Accion') },
        { caso: 'clave de "  ÁNIME  "', esperado: 'ánime', obtenido: T.tagKey('  ÁNIME  ') },
        { caso: 'Ñ y Ü conservan la tilde', esperado: ['ñandú', 'pingüino'], obtenido: [T.tagKey('ÑANDÚ'), T.tagKey('PINGÜINO')] },
        { caso: 'espacios internos (también tab y salto) a uno', esperado: 'Ciencia ficción', obtenido: T.normalizeTagName(' Ciencia \t\n ficción ') },
        { caso: 'longitud en puntos de código', esperado: [5, 2], obtenido: [T.tagLength('ánime'), T.tagLength('😀😀')] },
    ]);
    const vivas = [{ id: 'a', name: 'Shounen', name_key: 'shounen' }, { id: 'b', name: 'Isekai', name_key: 'isekai', deleted_at: '2026-01-01T00:00:00.000Z' }];
    tabla('validateTagName', [
        { caso: 'vacío', esperado: { ok: false, error: 'vacio' }, obtenido: T.validateTagName('   ', vivas) },
        { caso: '31 caracteres', esperado: { ok: false, error: 'largo' }, obtenido: T.validateTagName('x'.repeat(31), vivas) },
        { caso: '30 caracteres', esperado: true, obtenido: T.validateTagName('x'.repeat(30), vivas).ok },
        { caso: 'duplicado sin distinguir mayúsculas', esperado: { ok: false, error: 'duplicado' }, obtenido: T.validateTagName('SHOUNEN', vivas) },
        { caso: 'la misma etiqueta al renombrarla no es duplicado', esperado: true, obtenido: T.validateTagName('shounen', vivas, 'a').ok },
        { caso: 'una borrada no cuenta como duplicado', esperado: true, obtenido: T.validateTagName('isekai', vivas).ok },
    ]);
    tabla('forma canónica (P-c) y orden de pantalla', [
        { caso: 'sin repetir por clave, ordenada por clave código por código', esperado: ['accion', 'Acción', 'B'], obtenido: T.canonicalTags(['b', 'Acción', 'accion', 'B ']) },
        { caso: 'vacía o sin strings → null', esperado: [null, null, null], obtenido: [T.canonicalTags([]), T.canonicalTags(['  ']), T.canonicalTags([1, null])] },
        { caso: 'serializeTags', esperado: [null, '["Drama","shounen"]'], obtenido: [T.serializeTags([]), T.serializeTags(['shounen', 'Drama', 'drama'])] },
        { caso: 'misma entrada en otro orden → mismo resultado', esperado: true, obtenido: igual(T.canonicalTags(['z', 'Á', 'a', 'é']), T.canonicalTags(['é', 'a', 'Á', 'z'])) },
        { caso: 'pantalla: localeCompare("es") (Á junto a A, antes que B)', esperado: ['a', 'Ánime', 'Bélico', 'zeta'], obtenido: T.sortForDisplay(['zeta', 'Bélico', 'Ánime', 'a']) },
        { caso: 'parseTags tolerante', esperado: [[], [], ['a']], obtenido: [T.parseTags(null), T.parseTags('no json'), T.parseTags('["a", 2]')] },
    ]);
    const cat = [
        { id: '1', section: 'movie', name: 'Marvel', name_key: 'marvel' },
        { id: '2', section: 'series', name: 'marvel', name_key: 'marvel' },
        { id: '3', section: 'series', name: 'Drama', name_key: 'drama' },
        { id: '4', section: 'anime', name: 'Isekai', name_key: 'isekai' },
        { id: '5', section: 'anime', name: 'Mecha', name_key: 'mecha', deleted_at: '2026-01-01T00:00:00.000Z' },
    ];
    tabla('sugerencias y vista del formulario (E7)', [
        { caso: 'de otras secciones para Películas (una por clave, sin borradas)', esperado: ['Drama', 'Isekai'], obtenido: T.suggestionsFromOtherSections(cat, 'movie') },
        { caso: 'excluye las ya elegidas', esperado: ['Isekai'], obtenido: T.suggestionsFromOtherSections(cat, 'movie', ['DRAMA']) },
        { caso: 'vista: sección, elegidas que no existen y sugerencias', esperado: { sectionTags: [{ name: 'Marvel', key: 'marvel', selected: true }], extra: ['Nueva'], others: ['Drama', 'Isekai'] }, obtenido: T.formTagView(cat, 'movie', ['marvel', 'Nueva']) },
        { caso: 'toggleTag por clave', esperado: [['Marvel'], []], obtenido: [T.toggleTag([], 'Marvel'), T.toggleTag(['marvel'], 'MARVEL')] },
    ]);
    const filas = [
        { id: 'a', name: 'Shounen', name_key: 'shounen' }, { id: 'b', name: 'Drama', name_key: 'drama' },
        { id: 'c', name: 'Mecha', name_key: 'mecha', deleted_at: '2026-01-01T00:00:00.000Z' },
    ];
    const titulos = [{ id: 't1', tags: '["Drama","Shounen"]' }, { id: 't2', tags: '["Shounen"]' }, { id: 't3', tags: null }];
    tabla('planes: crear, renombrar, borrar', [
        { caso: 'crear nueva', esperado: { ok: true, name: 'Seinen', action: { kind: 'insert', name: 'Seinen', key: 'seinen' } }, obtenido: T.planCreate(' Seinen ', filas) },
        { caso: 'crear sobre una borrada → revivir (P-b)', esperado: { ok: true, name: 'MECHA', action: { kind: 'revive', id: 'c', name: 'MECHA' } }, obtenido: T.planCreate('MECHA', filas) },
        { caso: 'crear duplicada', esperado: { ok: false, error: 'duplicado' }, obtenido: T.planCreate('drama', filas) },
        { caso: 'renombrar solo mayúsculas: mismo id y títulos reescritos', esperado: { ok: true, actions: [{ kind: 'rename', id: 'a', name: 'SHOUNEN', key: 'shounen' }], titles: [{ id: 't1', tags: '["Drama","SHOUNEN"]' }, { id: 't2', tags: '["SHOUNEN"]' }], name: 'SHOUNEN' }, obtenido: T.planRename(filas[0], 'SHOUNEN', filas, titulos) },
        { caso: 'renombrar a una viva → bloqueado', esperado: { ok: false, error: 'duplicado' }, obtenido: T.planRename(filas[0], 'DRAMA', filas, titulos) },
        { caso: 'renombrar sobre una borrada: revive esa y borra la renombrada', esperado: { ok: true, actions: [{ kind: 'revive', id: 'c', name: 'Mecha' }, { kind: 'delete', id: 'b' }], titles: [{ id: 't1', tags: '["Mecha","Shounen"]' }], name: 'Mecha' }, obtenido: T.planRename(filas[1], 'Mecha', filas, titulos) },
        { caso: 'renombrar igual → sin cambios', esperado: true, obtenido: !!T.planRename(filas[1], ' Drama ', filas, titulos).unchanged },
        { caso: 'borrar: quita de 2 títulos', esperado: { actions: [{ kind: 'delete', id: 'a' }], titles: [{ id: 't1', tags: '["Drama"]' }, { id: 't2', tags: null }], count: 2 }, obtenido: T.planDelete(filas[0], titulos) },
        { caso: 'textos de borrado (0, 1, N)', esperado: ['No está en ningún título.', 'Se quitará de 1 título.', 'Se quitará de 3 títulos.'], obtenido: [T.deleteTagText(0), T.deleteTagText(1), T.deleteTagText(3)] },
    ]);
    tabla('guardar un título (P-a, P-d) y filtro (E8)', [
        { caso: 'nombre del catálogo, revivir y crear', esperado: { ok: true, names: ['Drama', 'Mecha', 'Seinen'], actions: [{ kind: 'revive', id: 'c', name: 'Mecha' }, { kind: 'insert', name: 'Seinen', key: 'seinen' }] }, obtenido: T.resolveTitleTags(['drama', 'Mecha', 'Seinen', 'DRAMA'], filas) },
        { caso: 'nueva de más de 30 → error', esperado: { ok: false, error: 'largo', name: 'y'.repeat(31) }, obtenido: T.resolveTitleTags(['y'.repeat(31)], filas) },
        { caso: 'filtro: TODAS las elegidas, por clave', esperado: ['t1'], obtenido: T.filterByTags(titulos, { keys: ['DRAMA', 'shounen'] }).map((x) => x.id) },
        { caso: 'filtro: "Sin etiquetas" exclusivo', esperado: ['t3'], obtenido: T.filterByTags(titulos, { keys: ['drama'], none: true }).map((x) => x.id) },
        { caso: 'filtro vacío → todos', esperado: 3, obtenido: T.filterByTags(titulos, { keys: [] }).length },
        { caso: 'countTitlesWithTag por clave', esperado: [2, 1, 0], obtenido: [T.countTitlesWithTag(titulos, 'SHOUNEN'), T.countTitlesWithTag(titulos, 'drama'), T.countTitlesWithTag(titulos, 'mecha')] },
    ]);
}

// =============================================================================================
seccion('2. Catálogo con la fachada: crear, duplicado, más de 30, vacío, espacios y revivir (P-b)');
{
    const E = await entorno();
    await E.limpiarOutbox();
    const r1 = await E.db.createBacklogTag(E.uid, 'anime', '  Shounen   jump ');
    const ob1 = await E.outbox();
    const r2 = await E.db.createBacklogTag(E.uid, 'anime', 'SHOUNEN JUMP');
    const r3 = await E.db.createBacklogTag(E.uid, 'anime', 'z'.repeat(31));
    const r4 = await E.db.createBacklogTag(E.uid, 'anime', '   ');
    const r5 = await E.db.createBacklogTag(E.uid, 'series', 'shounen jump'); // otra sección: se permite
    const ob2 = await E.outbox();
    const fila = await E.etiqueta('anime', 'shounen jump');
    tabla('crear', [
        { caso: 'nueva: normalizada, con su clave y una entrada de outbox', esperado: { ok: true, name: 'Shounen jump', key: 'shounen jump', outbox: { backlog_tags: 1 } }, obtenido: { ok: r1.success, name: fila.name, key: fila.name_key, outbox: E.porTabla(ob1) } },
        { caso: 'duplicada sin distinguir mayúsculas / más de 30 / vacía → código, sin escribir', esperado: ['duplicado', 'largo', 'vacio'], obtenido: [r2.code, r3.code, r4.code] },
        { caso: 'la misma clave en otra sección sí se crea', esperado: { ok: true, outbox: 2 }, obtenido: { ok: r5.success, outbox: ob2.length } },
    ]);
    // Borrar y volver a crear → la misma fila revivida (P-b), con el nombre nuevo.
    E.ok(await E.db.deleteBacklogTag(fila.id), 'deleteBacklogTag');
    await E.limpiarOutbox();
    const r6 = await E.db.createBacklogTag(E.uid, 'anime', 'SHOUNEN Jump');
    const filas = await E.todas('anime');
    tabla('revivir una borrada', [{
        caso: 'mismo id, viva, nombre nuevo, sin otra fila; una entrada de outbox',
        esperado: { id: fila.id, filas: 1, vivo: true, name: 'SHOUNEN Jump', key: 'shounen jump', outbox: 1 },
        obtenido: { id: r6.id, filas: filas.length, vivo: !filas[0].deleted_at, name: filas[0].name, key: filas[0].name_key, outbox: (await E.outbox()).length },
    }]);
}

// =============================================================================================
seccion('3. Renombrar: solo mayúsculas, a una viva (bloqueado) y sobre una borrada');
{
    const E = await entorno();
    for (const n of ['Shounen', 'Drama', 'Mecha']) E.ok(await E.db.createBacklogTag(E.uid, 'anime', n), 'createBacklogTag');
    E.ok(await E.db.createBacklogTag(E.uid, 'series', 'Shounen'), 'createBacklogTag');
    const a1 = await E.nuevoTitulo('anime', 'A1', { tags: ['Shounen', 'Drama'] });
    const a2 = await E.nuevoTitulo('anime', 'A2', { tags: ['shounen'] });
    const a3 = await E.nuevoTitulo('anime', 'A3', { tags: [] });
    const s1 = await E.nuevoTitulo('series', 'S1', { tags: ['Shounen'] });
    const shounen = await E.etiqueta('anime', 'shounen');
    // Solo mayúsculas: mismo id y los títulos de la sección pasan al nombre nuevo (los de otra no).
    await E.limpiarOutbox();
    const rr1 = await E.db.renameBacklogTag(shounen.id, 'SHOUNEN');
    const ob1 = await E.outbox();
    const tags = async (t) => (await E.titulo(t.type, t.title)).tags;
    tabla('renombrar solo mayúsculas', [{
        caso: 'mismo id; A1 y A2 reescritos; A3 y S1 sin tocar; una entrada por fila',
        esperado: { ok: true, id: shounen.id, name: 'SHOUNEN', a1: '["Drama","SHOUNEN"]', a2: '["SHOUNEN"]', a3: null, s1: '["Shounen"]', outbox: { backlog_tags: 1, backlog: 2 }, unaPorFila: true },
        obtenido: { ok: rr1.success, id: rr1.id, name: (await E.etiqueta('anime', 'shounen')).name, a1: await tags(a1), a2: await tags(a2), a3: await tags(a3), s1: await tags(s1), outbox: E.porTabla(ob1), unaPorFila: E.unaPorFila(ob1) },
    }]);
    // A una viva → bloqueado, sin escribir.
    await E.limpiarOutbox();
    const rr2 = await E.db.renameBacklogTag(shounen.id, 'drama');
    tabla('renombrar a una viva', [{ caso: 'código duplicado y outbox vacía', esperado: { code: 'duplicado', outbox: 0 }, obtenido: { code: rr2.code, outbox: (await E.outbox()).length } }]);
    // Sobre una borrada: se revive la borrada, se borra la renombrada y los títulos pasan al nombre nuevo.
    const mecha = await E.etiqueta('anime', 'mecha');
    E.ok(await E.db.deleteBacklogTag(mecha.id), 'deleteBacklogTag');
    const drama = await E.etiqueta('anime', 'drama');
    await E.limpiarOutbox();
    const rr3 = await E.db.renameBacklogTag(drama.id, 'MECHA');
    const filas = await E.todas('anime');
    tabla('renombrar sobre una borrada', [{
        caso: 'Drama → MECHA: revive la fila de Mecha, borra Drama, A1 queda ["MECHA","SHOUNEN"]',
        esperado: { ok: true, id: mecha.id, vivas: ['mecha', 'shounen'], dramaBorrada: true, mechaName: 'MECHA', a1: '["MECHA","SHOUNEN"]', outbox: { backlog_tags: 2, backlog: 1 } },
        obtenido: { ok: rr3.success, id: rr3.id, vivas: filas.filter((f) => !f.deleted_at).map((f) => f.name_key), dramaBorrada: !!filas.find((f) => f.id === drama.id).deleted_at, mechaName: filas.find((f) => f.id === mecha.id).name, a1: await tags(a1), outbox: E.porTabla(await E.outbox()) },
    }]);
    // Renombrado normal (cambia la clave).
    const rr4 = await E.db.renameBacklogTag(shounen.id, 'Seinen');
    tabla('renombrar a un nombre nuevo', [{ caso: 'mismo id con clave nueva; A2 ["Seinen"]', esperado: { ok: true, key: 'seinen', a2: '["Seinen"]' }, obtenido: { ok: rr4.success, key: (await E.todas('anime')).find((f) => f.id === shounen.id).name_key, a2: await tags(a2) } }]);
}

// =============================================================================================
seccion('4. Borrar: handleDeleteTag real, textos exactos y títulos sin la etiqueta');
{
    const E = await entorno();
    for (const n of ['Cero', 'Uno', 'Dos']) E.ok(await E.db.createBacklogTag(E.uid, 'movie', n), 'createBacklogTag');
    await E.nuevoTitulo('movie', 'P1', { tags: ['Uno', 'Dos'] });
    await E.nuevoTitulo('movie', 'P2', { tags: ['Dos'] });
    const usage = E.ok(await E.db.getBacklogTagUsage(E.uid, 'movie'), 'getBacklogTagUsage').usage;
    const borrar = async (name, eleccion) => {
        const A = crearAlert(eleccion);
        let filtro = { keys: [T.tagKey(name)], none: false };
        const fn = instanciar('handleDeleteTag', {
            db: E.db, user: E.user, ...hojasDesdeAlert(A.Alert), tagUsage: usage, tagFilter: filtro,
            setTagFilter: (f) => { filtro = f; }, loadItems: async () => {}, loadTagUsage: async () => {},
        });
        E.usar();
        const r = await fn(await E.etiqueta('movie', name));
        return { r, alerta: A.registro[0], filtro };
    };
    await E.limpiarOutbox();
    const cancel = await borrar('Dos', 'Cancelar');
    const sinCambios = (await E.outbox()).length;
    const b0 = await borrar('Cero', 'Borrar');
    const b1 = await borrar('Uno', 'Borrar');
    await E.limpiarOutbox();
    const b2 = await borrar('Dos', 'Borrar');
    const ob2 = await E.outbox();
    tabla('textos de la hoja', [
        { caso: 'N = 0', esperado: { titulo: 'Borrar «Cero»', mensaje: 'No está en ningún título.', botones: ['Cancelar', 'Borrar'] }, obtenido: b0.alerta },
        { caso: 'N = 1', esperado: { titulo: 'Borrar «Uno»', mensaje: 'Se quitará de 1 título.', botones: ['Cancelar', 'Borrar'] }, obtenido: b1.alerta },
        { caso: 'N = 2', esperado: { titulo: 'Borrar «Dos»', mensaje: 'Se quitará de 2 títulos.', botones: ['Cancelar', 'Borrar'] }, obtenido: b2.alerta },
    ]);
    tabla('efectos', [
        { caso: 'Cancelar: no escribe nada', esperado: { r: false, outbox: 0 }, obtenido: { r: cancel.r, outbox: sinCambios } },
        { caso: 'borrar "Dos": etiqueta borrada, P1 ["Uno"→ya borrada] sin Dos, P2 null; una entrada por fila', esperado: { r: true, p1: null, p2: null, outbox: { backlog_tags: 1, backlog: 2 }, unaPorFila: true }, obtenido: { r: b2.r, p1: (await E.titulo('movie', 'P1')).tags, p2: (await E.titulo('movie', 'P2')).tags, outbox: E.porTabla(ob2), unaPorFila: E.unaPorFila(ob2) } },
        { caso: 'el filtro deja de incluir la etiqueta borrada', esperado: [], obtenido: b2.filtro.keys },
        { caso: 'ya no queda ninguna viva en Películas', esperado: 0, obtenido: (await E.catalogo()).filter((r) => r.section === 'movie').length },
    ]);
}

// =============================================================================================
seccion('5. Guardar un título con etiquetas (handleAddItem real): una transacción y el nombre del catálogo');
{
    const E = await entorno();
    E.ok(await E.db.createBacklogTag(E.uid, 'series', 'Drama'), 'createBacklogTag');
    E.ok(await E.db.createBacklogTag(E.uid, 'anime', 'Isekai'), 'createBacklogTag');
    const guardar = async ({ tab, form, editing = null }) => {
        const A = crearAlert();
        let modal = true;
        const fn = instanciar('handleAddItem', {
            db: E.db, user: E.user, activeTab: tab, formData: { title: '', year: '', format: '24 min', start_year: '', end_year: '', subtype: null, tags: [], ...form },
            editingItem: editing, ...hojasDesdeAlert(A.Alert),
            setModalVisible: (v) => { modal = v; }, setEditingItem: () => {}, setFormData: () => {}, setActiveStatus: () => {}, setActiveTab: () => {}, // 7.5b2a (P7): al guardar va a la sección del título
            loadItems: () => {},
            FORM_VACIO: {},
        });
        E.usar();
        await fn();
        return { alertas: A.registro, modal };
    };
    // Nueva + de otra sección (Isekai, de Anime) + la del catálogo con otras mayúsculas (drama → Drama).
    await E.limpiarOutbox();
    const g1 = await guardar({ tab: 'series', form: { title: 'Serie con etiquetas', tags: ['drama', 'Isekai', 'Nueva etiqueta'] } });
    const ob1 = await E.outbox();
    const t1 = await E.titulo('series', 'Serie con etiquetas');
    const catSeries = (await E.catalogo()).filter((r) => r.section === 'series').map((r) => r.name).sort();
    tabla('alta con etiquetas', [{
        caso: 'título con el nombre del catálogo; Isekai y "Nueva etiqueta" creadas en Series; una entrada por fila',
        esperado: { alertas: [], modal: false, tags: '["Drama","Isekai","Nueva etiqueta"]', catalogoSeries: ['Drama', 'Isekai', 'Nueva etiqueta'], outbox: { backlog_tags: 2, backlog: 1 }, unaPorFila: true },
        obtenido: { alertas: g1.alertas, modal: g1.modal, tags: t1.tags, catalogoSeries: catSeries, outbox: E.porTabla(ob1), unaPorFila: E.unaPorFila(ob1) },
    }]);
    // Edición: cada nombre se reemplaza por el del catálogo para su clave; quitar todas → null.
    const g2 = await guardar({ tab: 'series', form: { title: 'Serie con etiquetas', tags: ['ISEKAI', 'nueva ETIQUETA'] }, editing: t1 });
    const t2 = await E.titulo('series', 'Serie con etiquetas');
    await guardar({ tab: 'series', form: { title: 'Serie con etiquetas', tags: [] }, editing: t2 });
    const t3 = await E.titulo('series', 'Serie con etiquetas');
    tabla('edición', [
        { caso: 'nombres del catálogo, sin crear nada nuevo', esperado: { alertas: [], tags: '["Isekai","Nueva etiqueta"]', catalogoSeries: 3 }, obtenido: { alertas: g2.alertas, tags: t2.tags, catalogoSeries: (await E.catalogo()).filter((r) => r.section === 'series').length } },
        { caso: 'sin etiquetas → NULL', esperado: null, obtenido: t3.tags },
        { caso: 'editar sin enviar tags (otra pantalla) las conserva', esperado: '["Drama"]', obtenido: await (async () => { E.ok(await E.db.updateBacklogItem(t3.id, { title: 'Serie con etiquetas', tags: ['Drama'] }), 'u'); E.ok(await E.db.updateBacklogItem(t3.id, { title: 'Serie con etiquetas' }), 'u'); return (await E.titulo('series', 'Serie con etiquetas')).tags; })() },
    ]);
    // Una transacción: un fallo forzado en el INSERT del título no deja ninguna etiqueta ni outbox.
    const conn = getConnection();
    const original = conn.runAsync.bind(conn);
    await E.limpiarOutbox();
    const antes = (await E.db.db.getFirstAsync('SELECT COUNT(*) n FROM backlog_tags')).n;
    conn.runAsync = (sql, ...rest) => (/^\s*INSERT INTO backlog \(/.test(sql) ? Promise.reject(new Error('fallo forzado')) : original(sql, ...rest));
    let res;
    try { res = await quiet(() => E.db.addBacklogItem(E.uid, { type: 'anime', title: 'Falla', tags: ['Nunca creada'] })); } finally { conn.runAsync = original; }
    tabla('una transacción', [{
        caso: 'fallo en el INSERT del título: ninguna etiqueta nueva, ningún título, outbox vacía',
        esperado: { success: false, etiquetas: antes, titulo: false, outbox: 0 },
        obtenido: { success: res.success, etiquetas: (await E.db.db.getFirstAsync('SELECT COUNT(*) n FROM backlog_tags')).n, titulo: !!(await E.titulo('anime', 'Falla')), outbox: (await E.outbox()).length },
    }]);
}

// =============================================================================================
seccion('6. Forma canónica y huérfanos (P-c, P-d)');
{
    const E = await entorno();
    E.ok(await E.db.createBacklogTag(E.uid, 'reading', 'Clásico'), 'createBacklogTag');
    const t = await E.nuevoTitulo('reading', 'Libro', { subtype: 'book', tags: ['clásico'] });
    // Un título que trae un nombre sin etiqueta viva (otro dispositivo; aquí, escrito a mano) y
    // uno que coincide con una borrada.
    E.ok(await E.db.createBacklogTag(E.uid, 'reading', 'Borrada'), 'createBacklogTag');
    E.ok(await E.db.deleteBacklogTag((await E.etiqueta('reading', 'borrada')).id), 'deleteBacklogTag');
    E.usar();
    await E.db.db.runAsync('UPDATE backlog SET tags = ? WHERE id = ?', ['["Huérfana","BORRADA","Clásico"]', t.id]);
    const visto = await E.titulo('reading', 'Libro');
    const filtrado = (await E.titulos('reading', { keys: ['huérfana'] })).map((x) => x.title);
    await E.limpiarOutbox();
    E.ok(await E.db.updateBacklogItem(t.id, { title: 'Libro', subtype: 'book', tags: T.parseTags(visto.tags) }), 'updateBacklogItem');
    const despues = await E.titulo('reading', 'Libro');
    const filas = await E.todas('reading');
    tabla('huérfanos', [
        { caso: 'se muestran y se filtran', esperado: { tags: ['BORRADA', 'Clásico', 'Huérfana'], filtro: ['Libro'] }, obtenido: { tags: T.parseTags(visto.tags).sort(), filtro: filtrado } },
        { caso: 'al guardar: la huérfana se crea y la borrada se revive (con el nombre del título)', esperado: { vivas: ['borrada', 'clásico', 'huérfana'], tags: '["BORRADA","Clásico","Huérfana"]', outbox: { backlog_tags: 2, backlog: 1 } }, obtenido: { vivas: filas.filter((f) => !f.deleted_at).map((f) => f.name_key), tags: despues.tags, outbox: E.porTabla(await E.outbox()) } },
    ]);
    // Forma canónica en la BD local y en el mapeo (ida y vuelta, y sameAsLocal sin falsas diferencias).
    const local = await E.db.db.getFirstAsync('SELECT * FROM backlog WHERE id = ?', [t.id]);
    const remota = toRemote('backlog', local);
    const otroOrden = { ...remota, tags: ['Huérfana', 'Clásico', 'BORRADA'] };
    const deVuelta = fromRemote('backlog', otroOrden);
    const { sameAsLocal } = await import('../src/sync/mapping.ts');
    tabla('forma canónica en el mapeo', [
        { caso: 'toRemote envía el array canónico', esperado: ['BORRADA', 'Clásico', 'Huérfana'], obtenido: remota.tags },
        { caso: 'fromRemote canoniza otro orden', esperado: '["BORRADA","Clásico","Huérfana"]', obtenido: deVuelta.tags },
        { caso: 'sameAsLocal: otro orden = igual', esperado: true, obtenido: sameAsLocal('backlog', local, deVuelta) },
        { caso: 'array vacío o NULL del servidor → NULL local', esperado: [null, null], obtenido: [fromRemote('backlog', { ...remota, tags: [] }).tags, fromRemote('backlog', { ...remota, tags: null }).tags] },
        { caso: 'toRemote rechaza un valor que no es array de strings', esperado: 'MappingError', obtenido: (() => { try { toRemote('backlog', { ...local, tags: '[1]' }); return 'sin error'; } catch (e) { return e.constructor.name; } })() },
        { caso: 'NATURAL_KEYS de backlog_tags', esperado: ['user_id', 'section', 'name_key'], obtenido: NATURAL_KEYS.backlog_tags },
        { caso: 'backlog_tags es la última de TABLES', esperado: 'backlog_tags', obtenido: TABLES.at(-1) },
    ]);
}

// =============================================================================================
seccion('7. Filtro E8 en la fachada (lista y conteos, por clave)');
{
    const E = await entorno();
    for (const n of ['Drama', 'Acción', 'Accion']) E.ok(await E.db.createBacklogTag(E.uid, 'series', n), 'createBacklogTag');
    await E.nuevoTitulo('series', 'S-DA', { tags: ['Drama', 'Acción'] });
    await E.nuevoTitulo('series', 'S-D', { tags: ['drama'] });
    await E.nuevoTitulo('series', 'S-A-sin-tilde', { tags: ['Accion'] });
    const sd = await E.nuevoTitulo('series', 'S-sin', {});
    E.ok(await E.db.updateBacklogStatus(sd.id, 'Terminado'), 'updateBacklogStatus');
    const nombres = async (f, status = 'Total') => (await E.titulos('series', f, status)).map((x) => x.title).sort();
    const conteos = async (f) => { E.usar(); return E.ok(await E.db.getBacklogCounts(E.uid, 'series', f), 'getBacklogCounts').counts; };
    tabla('lista', [
        { caso: 'una etiqueta (otra mayúscula)', esperado: ['S-D', 'S-DA'], obtenido: await nombres({ keys: ['DRAMA'] }) },
        { caso: 'dos: TODAS', esperado: ['S-DA'], obtenido: await nombres({ keys: ['drama', 'acción'] }) },
        { caso: 'los acentos cuentan', esperado: ['S-A-sin-tilde'], obtenido: await nombres({ keys: ['accion'] }) },
        { caso: '"Sin etiquetas"', esperado: ['S-sin'], obtenido: await nombres({ keys: [], none: true }) },
        { caso: 'combinado con el estado', esperado: [], obtenido: await nombres({ none: true }, 'Pendiente') },
        { caso: 'sin filtro (o el "Todos" de antes)', esperado: 4, obtenido: (await E.titulos('series', 'Todos')).length },
    ]);
    tabla('conteos', [
        { caso: 'Drama', esperado: { Pendiente: 2, Mirando: 0, Terminado: 0, Total: 2 }, obtenido: await conteos({ keys: ['drama'] }) },
        { caso: '"Sin etiquetas"', esperado: { Pendiente: 0, Mirando: 0, Terminado: 1, Total: 1 }, obtenido: await conteos({ none: true }) },
        { caso: 'sin filtro', esperado: { Pendiente: 3, Mirando: 0, Terminado: 1, Total: 4 }, obtenido: await conteos(null) },
        { caso: 'uso por clave para el texto de borrado', esperado: { accion: 1, acción: 1, drama: 2 }, obtenido: Object.fromEntries(Object.entries(E.ok(await E.db.getBacklogTagUsage(E.uid, 'series'), 'u').usage).sort()) },
    ]);
}

// =============================================================================================
seccion('8. Franquicia: comprobación estática (+ control negativo), conservación; nombres largos y botones');
{
    // Babel: ningún identificador, propiedad, texto ni literal "franchise", "Franquicia", "Marvel" o
    // "DC Comics" en la pantalla de Pendiente ni en los componentes nuevos.
    const prohibidos = /franchise|franquicia|marvel|dc comics/i;
    const usos = (codigo, archivo) => {
        const ast = parse(codigo, { sourceType: 'module', plugins: ['jsx'] });
        const hall = [];
        traverse(ast, {
            Identifier(p) { if (prohibidos.test(p.node.name)) hall.push(`${archivo}:${p.node.loc.start.line} ${p.node.name}`); },
            StringLiteral(p) { if (prohibidos.test(p.node.value)) hall.push(`${archivo}:${p.node.loc.start.line} "${p.node.value}"`); },
            TemplateElement(p) { if (prohibidos.test(p.node.value.raw)) hall.push(`${archivo}:${p.node.loc.start.line} \`${p.node.value.raw}\``); },
            JSXText(p) { if (prohibidos.test(p.node.value)) hall.push(`${archivo}:${p.node.loc.start.line} ${p.node.value.trim()}`); },
        });
        return hall;
    };
    const archivos = [PANT, ...COMPONENTES];
    const hall = archivos.flatMap((a) => usos(readFileSync(a, 'utf8'), a));
    check(`la pantalla y los componentes no muestran, filtran ni escriben franchise (${archivos.length} archivos)`, hall.length === 0, hall.join(', '));
    const sembrados = [
        'const x = item.franchise;',
        "const y = { franchise: 'Otros' };",
        "const z = <Text>Universo / Franquicia</Text>;",
        "const w = ['Marvel', 'DC Comics'];",
        'const v = `🦸 Marvel`;',
    ];
    const detectados = sembrados.filter((s) => usos(`${readFileSync(PANT, 'utf8')}\n${s}\n`, 'copia').length > 0).length;
    check(`control negativo: el detector encuentra las ${sembrados.length} violaciones sembradas en una copia`, detectados === sembrados.length, `${detectados}/${sembrados.length}`);
    // Conservación: editar un título con 'Marvel' (de antes) la conserva; uno nuevo queda en 'Otros'.
    const E = await entorno();
    const t = await E.nuevoTitulo('movie', 'Peli vieja', {});
    E.usar();
    await E.db.db.runAsync("UPDATE backlog SET franchise = 'Marvel' WHERE id = ?", [t.id]);
    E.ok(await E.db.updateBacklogItem(t.id, { title: 'Peli vieja editada', year: 2001, tags: ['Superhéroes'] }), 'updateBacklogItem');
    const r = await E.db.db.getFirstAsync('SELECT title, franchise, tags FROM backlog WHERE id = ?', [t.id]);
    const n = await E.nuevoTitulo('movie', 'Peli nueva', { franchise: 'Marvel' });
    tabla('franchise en los datos', [
        { caso: 'editar conserva Marvel', esperado: { title: 'Peli vieja editada', franchise: 'Marvel', tags: '["Superhéroes"]' }, obtenido: { ...r } },
        { caso: 'alta: el DEFAULT pone Otros (aunque llegue otra cosa)', esperado: 'Otros', obtenido: n.franchise },
    ]);
    // Nombres largos (estático): la línea de etiquetas de la fila en 1 línea con elipsis; chips y
    // nombres de la gestión en 1 línea; botones de las hojas y del campo con minHeight ≥ 52.
    const pant = readFileSync(PANT, 'utf8');
    const campo = readFileSync(COMPONENTES[0], 'utf8'), filtro = readFileSync(COMPONENTES[1], 'utf8'), gestion = readFileSync(COMPONENTES[2], 'utf8'), hojaFiltros = readFileSync(COMPONENTES[3], 'utf8');
    const minHeights = (src, estilos) => estilos.map((e) => { const m = new RegExp(`\\b${e}:\\s*\\{[^}]*minHeight:\\s*(\\d+)`).exec(src) || new RegExp(`\\b${e}:\\s*\\{[^}]*height:\\s*(\\d+)`).exec(src); return m ? Number(m[1]) : 0; });
    tabla('nombres largos y botones (estático)', [
        { caso: 'fila: etiquetas en 1 línea con elipsis', esperado: true, obtenido: /styles\.tagsLine[^>]*numberOfLines=\{1\}\s+ellipsizeMode="tail"/.test(pant) },
        { caso: 'chips del campo y del filtro: 1 línea con elipsis, contenedor que encoge', esperado: [true, true], obtenido: [campo, filtro].map((s) => /styles\.chipTexto[^>]*numberOfLines=\{1\}\s+ellipsizeMode="tail"/.test(s) && /maxWidth:\s*'100%'/.test(s) && /flexShrink:\s*1/.test(s)) },
        { caso: 'chips: texto centrado vertical y horizontal (O9)', esperado: [true, true], obtenido: [campo, filtro].map((s) => /textAlign:\s*'center'/.test(s) && /textAlignVertical:\s*'center'/.test(s) && /includeFontPadding:\s*false/.test(s) && /justifyContent:\s*'center'/.test(s)) },
        { caso: 'gestión: nombre en 1 línea con elipsis dentro de un contenedor flex 1 / minWidth 0', esperado: true, obtenido: /styles\.filaNombre[^>]*numberOfLines=\{1\}\s+ellipsizeMode="tail"/.test(gestion) && /filaTextos:\s*\{\s*flex:\s*1,\s*minWidth:\s*0/.test(gestion) },
        { caso: 'botones ≥ 52: campo (boton), hoja Filtros (boton), gestión (boton, botonAncho, icono)', esperado: [true, true, true], obtenido: [minHeights(campo, ['boton']), minHeights(hojaFiltros, ['boton']), minHeights(gestion, ['boton', 'botonAncho', 'icono'])].map((xs) => xs.every((x) => x >= 52)) },
        { caso: 'títulos de hoja en 1 línea con elipsis (Filtros y gestión)', esperado: [true, true], obtenido: [hojaFiltros, gestion].map((s) => /styles\.titulo[^>]*numberOfLines=\{1\}\s+ellipsizeMode="tail"/.test(s)) },
    ]);
}

// =============================================================================================
const vieja = await cargarAppVieja(REF_VIEJA, WORK);
const CFG_VIEJA = { ...vieja.config.DEFAULT_SYNC_CONFIG, enabled: true };

seccion(`9. Migración 8 sobre una BD v7 de la app 1.4.1 (${REF_VIEJA}); vinculación con backlog_tags`);
{
    check(`app 1.4.1 cargada de ${REF_VIEJA} (${vieja.archivos} archivos de src/)`, vieja.archivos > 50 && vieja.migrations.LATEST_VERSION === 7);
    const O = await vieja.dispositivo(UID, __setDatabasePath);
    O.usar();
    const ok = (res, que) => { if (!res || !res.success) throw new Error(`${que}: ${res && res.error}`); return res; };
    ok(await quiet(() => O.svc.addBacklogItem(UID, { type: 'movie', title: 'Peli v7', franchise: 'Marvel' })), 'addBacklogItem');
    ok(await quiet(() => O.svc.addBacklogItem(UID, { type: 'reading', title: 'Lectura v7', subtype: 'manga' })), 'addBacklogItem');
    const uv7 = (await O.svc.db.getFirstAsync('PRAGMA user_version')).user_version;
    await O.svc.db.closeAsync();
    const falla = `${WORK}/mig/falla/app_registro_v3.db`, migra = `${WORK}/mig/migra/app_registro_v3.db`, v7b = `${WORK}/mig/v7b/app_registro_v3.db`;
    for (const p of [falla, migra, v7b]) { mkdirSync(dirname(p), { recursive: true }); copyFileSync(O.path, p); }
    const { DatabaseSync } = await import('node:sqlite');
    const leer = (p) => { const d = new DatabaseSync(p, { readOnly: true }); try { return { uv: d.prepare('PRAGMA user_version').get().user_version, tabla: !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backlog_tags'").get(), col: d.prepare('PRAGMA table_info(backlog)').all().some((c) => c.name === 'tags') }; } finally { d.close(); } };
    DEV_FLAGS.DEV_FAIL_MIGRATION = true;
    let abrio = true;
    try { await D.openDevice('mig-falla', falla); } catch { abrio = false; }
    DEV_FLAGS.DEV_FAIL_MIGRATION = false;
    const copias0 = backupCalls.length;
    const dev = await D.openDevice('mig-migra', migra);
    const copias = backupCalls.slice(copias0);
    D.use(dev);
    const resumen = await dev.svc.db.getFirstAsync("SELECT payload FROM _migration_log WHERE version = 8 AND kind = 'summary'");
    const p8 = resumen ? JSON.parse(resumen.payload) : null;
    const unique = (await dev.svc.db.getAllAsync('PRAGMA index_list(backlog_tags)')).filter((i) => i.unique && i.origin === 'u').length;
    const nulos = (await dev.svc.db.getFirstAsync('SELECT COUNT(*) n FROM backlog WHERE tags IS NOT NULL')).n;
    const outboxN = (await dev.svc.db.getFirstAsync('SELECT COUNT(*) n FROM outbox')).n;
    const franq = (await dev.svc.db.getFirstAsync("SELECT franchise FROM backlog WHERE title = 'Peli v7'")).franchise;
    tabla('migración 8', [{
        caso: 'v7 con datos → v8',
        esperado: { uv7: 7, falla: { abre: false, uv: 7, tabla: false, col: false }, migra: { uv: LATEST_VERSION, tabla: true, col: true }, copia: ['pre-migracion-v8'], conteosIguales: true, vaciaTrasMigrar: 0, unique: 1, tagsNulos: 0, outboxSinCambios: true, franquiciaIntacta: 'Marvel', latest: 8 },
        obtenido: { uv7, falla: { abre: abrio, ...leer(falla) }, migra: leer(migra), copia: copias, conteosIguales: !!p8 && Object.keys(p8.before).every((k) => p8.before[k] === p8.after[k]), vaciaTrasMigrar: p8 && p8.after.backlog_tags, unique, tagsNulos: nulos, outboxSinCambios: outboxN >= 0 && outboxN === (await (async () => { const d = new DatabaseSync(v7b, { readOnly: true }); try { return d.prepare('SELECT COUNT(*) n FROM outbox').get().n; } finally { d.close(); } })()), franquiciaIntacta: franq, latest: LATEST_VERSION },
    }]);
    await dev.svc.db.closeAsync();
    const migra2 = `${WORK}/mig/migra2/app_registro_v3.db`;
    mkdirSync(dirname(migra2), { recursive: true });
    copyFileSync(v7b, migra2);
    const dev2 = await D.openDevice('mig-migra2', migra2);
    await dev2.svc.db.closeAsync();
    const cmp = compareSnapshots(snapshotDb(v7b), snapshotDb(migra2));
    check(`comparar-sync: v7 (sin la tabla ni la columna) y v8 (tabla vacía, tags NULL) idénticas en las ${TABLES.length} tablas, mismo saldo`, cmp.identical && cmp.balanceEqual, TABLES.filter((t) => !cmp.tables[t].same).join(','));
    const backup = await import('../src/services/backup.js');
    const validar = async (path, etiqueta) => {
        __setDatabasePath(path);
        const bk = await quiet(() => backup.createBackup());
        const res = spawnSync(process.execPath, ['scripts/validar-respaldo.mjs', bk.json.path, '--db', bk.physical.path, '--out', `${WORK}/validado-${etiqueta}.sqlite`], { encoding: 'utf8' });
        const meta = JSON.parse(readFileSync(bk.json.path, 'utf8')).meta;
        return { ok: res.status === 0 && /Respaldo válido/.test(res.stdout), uv: meta.userVersion };
    };
    tabla('validar-respaldo', [{ caso: 'respaldos v7 y v8', esperado: [{ ok: true, uv: 7 }, { ok: true, uv: 8 }], obtenido: [await validar(v7b, 'v7'), await validar(migra2, 'v8')] }]);
    // Vinculación de una cuenta local (sin vincular) que ya tiene etiquetas: backlog_tags pasa al uid.
    const L = await D.newDevice('vincular');
    D.use(L);
    const localId = '11111111-1111-4111-8111-111111111111';
    await L.svc.db.runAsync("INSERT INTO users (id, username, created_at, updated_at) VALUES (?, 'local', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", [localId]);
    await L.svc.db.runAsync("INSERT INTO backlog_tags (id, user_id, section, name, name_key) VALUES ('t-1', ?, 'anime', 'Isekai', 'isekai'), ('t-2', ?, 'movie', 'Drama', 'drama')", [localId, localId]);
    const uidV = '00000000-0000-4000-8000-000000075b09';
    const rv = await linkLocalAccount(L.svc.db, { uid: uidV, email: 'prueba@ejemplo.test' }, { createPhysicalCopy: async () => ({ path: 'copia-de-prueba' }) });
    const tagsV = await L.svc.db.getAllAsync('SELECT DISTINCT user_id FROM backlog_tags');
    tabla('vinculación', [{ caso: 'linked y backlog_tags con el uid de Google (y su conteo en el resumen)', esperado: { status: 'linked', usuarios: [uidV], conteo: 2 }, obtenido: { status: rv.status, usuarios: tagsV.map((x) => x.user_id), conteo: rv.counts.backlog_tags } }]);
}

// =============================================================================================
// Servidor PGlite con las migraciones reales: todas o sin la nueva.
async function servidor({ conNueva = true } = {}) {
    const pg = new PGlite();
    await pg.exec(readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8'));
    const files = readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort().filter((f) => conNueva || f !== MIGRACION_NUEVA);
    for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    const Tr = createPgliteTransport(pg);
    return { pg, T: Tr, files, aplicarNueva: () => pg.exec(readFileSync(`supabase/migrations/${MIGRACION_NUEVA}`, 'utf8')) };
}
const nuevoUsuario = async (S, uid) => { await S.pg.query('insert into auth.users (id) values ($1)', [uid]); S.T.uid = uid; };

seccion('10. Supabase: migración 7, privilegios, CHECK, UNIQUE, verificar-fase7-5b1, auditar-fase6 y verificar-fase2 (PGlite)');
{
    const S = await servidor({ conNueva: false });
    const todasM = readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort();
    check('la migración nueva es la última (7.ª) del directorio', todasM.at(-1) === MIGRACION_NUEVA && todasM.length === 7 && S.files.length === 6);
    const sqlMig = readFileSync(`supabase/migrations/${MIGRACION_NUEVA}`, 'utf8').replace(/--.*$/gm, '');
    // "on delete cascade" (la FK user_id → auth.users, igual que en las demás tablas) no borra nada.
    const sinCascada = sqlMig.replace(/\bon\s+delete\s+cascade\b/gi, '');
    check('la migración solo agrega (sin drop, delete, truncate, alter column, rename ni insert/update de filas) y va en begin/commit',
        !/\b(drop|delete|truncate|alter\s+column|rename)\b/i.test(sinCascada) && !/\binsert\s+into\b/i.test(sqlMig) && !/\bupdate\s+public\./i.test(sqlMig) && /\bbegin\b/i.test(sqlMig) && /\bcommit\b/i.test(sqlMig));
    check('la migración hace revoke en la tabla nueva y concede solo select, insert, update a authenticated',
        /revoke all on table public\.backlog_tags from anon, authenticated, public;/i.test(sqlMig) && /grant select, insert, update on table public\.backlog_tags to authenticated;/i.test(sqlMig) && (sqlMig.match(/\bgrant\b/gi) || []).length === 2);
    const ROLES = "('anon', 'authenticated', 'PUBLIC', 'service_role')";
    const privilegios = async (pg, t) => {
        const tablaP = (await pg.query(`
            select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as rol, a.privilege_type as p, a.is_grantable as g
            from pg_class c, aclexplode(c.relacl) a
            where c.oid = 'public.${t}'::regclass and (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) in ${ROLES}
            order by 1, 2`)).rows.map((r) => `${r.rol}:${r.p}:${r.g}`);
        const acl = (await pg.query(`select attname, coalesce(attacl::text, '') as acl from pg_attribute where attrelid = 'public.${t}'::regclass and attnum > 0 and not attisdropped order by attname`)).rows;
        const columnas = {};
        for (const r of (await pg.query(`select column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = '${t}' and grantee in ${ROLES} order by 1, 2, 3`)).rows) (columnas[r.column_name] ||= []).push(`${r.grantee}:${r.privilege_type}`);
        return { tabla: tablaP, acl, columnas };
    };
    const uid = '00000000-0000-4000-8000-000000075b10';
    await S.pg.query('insert into auth.users (id) values ($1)', [uid]);
    await S.pg.query(`insert into public.backlog (id, user_id, type, title, status, created_at, updated_at, deleted_at)
        values (gen_random_uuid(), $1, 'movie', '[prueba]', 'Pendiente', now(), now(), now()), (gen_random_uuid(), $1, 'reading', 'Lectura', 'Pendiente', now(), now(), null)`, [uid]);
    const antes = await privilegios(S.pg, 'backlog');
    let errMig = null;
    try { await S.aplicarNueva(); } catch (e) { errMig = e.message; }
    const despues = await privilegios(S.pg, 'backlog');
    const nueva = await privilegios(S.pg, 'backlog_tags');
    const sinTags = (cols) => Object.fromEntries(Object.entries(cols).filter(([c]) => c !== 'tags'));
    tabla('privilegios (anon, authenticated, PUBLIC, service_role)', [
        { caso: 'la migración aplica sobre filas existentes y tombstones', esperado: null, obtenido: errMig },
        { caso: 'backlog: ACL de tabla igual antes y después', esperado: antes.tabla, obtenido: despues.tabla },
        { caso: 'backlog: columnas sin ACL propia (también tags)', esperado: true, obtenido: despues.acl.every((r) => r.acl === '') && despues.acl.some((r) => r.attname === 'tags') },
        { caso: 'backlog: columnas existentes con los mismos privilegios', esperado: antes.columnas, obtenido: sinTags(despues.columnas) },
        { caso: 'backlog.tags: los mismos que title', esperado: antes.columnas.title, obtenido: despues.columnas.tags },
        { caso: 'backlog_tags: anon y PUBLIC sin nada; authenticated S/I/U', esperado: ['authenticated:INSERT:false', 'authenticated:SELECT:false', 'authenticated:UPDATE:false'], obtenido: nueva.tabla.filter((x) => !x.startsWith('service_role')) },
        { caso: 'backlog_tags: sin ACL de columna', esperado: true, obtenido: nueva.acl.every((r) => r.acl === '') },
        { caso: 'backlog_tags: service_role con lo mismo que backlog (default de la plataforma)', esperado: despues.tabla.filter((x) => x.startsWith('service_role')), obtenido: nueva.tabla.filter((x) => x.startsWith('service_role')) },
    ]);
    const intento = async (sql, p) => { try { await S.pg.query(sql, p); return 'ok'; } catch (e) { return e.code; } };
    const ins = (section, name, key) => intento('insert into public.backlog_tags (id, user_id, section, name, name_key, created_at, updated_at) values (gen_random_uuid(), $1, $2, $3, $4, now(), now())', [uid, section, name, key]);
    const bId = (await S.pg.query("select id from public.backlog where title = 'Lectura'")).rows[0].id;
    tabla('CHECK y UNIQUE reales', [
        { caso: 'sección válida / inválida', esperado: ['ok', '23514'], obtenido: [await ins('anime', 'Isekai', 'isekai'), await ins('novela', 'X', 'x')] },
        { caso: 'name: 30 / 31 caracteres / espacio al inicio / vacío', esperado: ['ok', '23514', '23514', '23514'], obtenido: [await ins('movie', 'a'.repeat(30), 'a'.repeat(30)), await ins('movie', 'b'.repeat(31), 'b'.repeat(31)), await ins('movie', ' c', 'c'), await ins('movie', '', '')] },
        { caso: 'name_key: 60 / 61 caracteres (name ≤ 30)', esperado: ['ok', '23514'], obtenido: [await ins('series', 'd', 'd'.repeat(60)), await ins('series', 'e', 'e'.repeat(61))] },
        { caso: 'UNIQUE (user_id, section, name_key): misma clave en la sección / en otra sección', esperado: ['23505', 'ok'], obtenido: [await ins('anime', 'ISEKAI', 'isekai'), await ins('reading', 'Isekai', 'isekai')] },
        { caso: 'backlog.tags: array de strings / NULL / vacío / con un número / objeto', esperado: ['ok', 'ok', 'ok', '23514', '23514'], obtenido: [
            await intento(`update public.backlog set tags = '["Shounen","Drama"]' where id = $1`, [bId]),
            await intento('update public.backlog set tags = null where id = $1', [bId]),
            await intento(`update public.backlog set tags = '[]' where id = $1`, [bId]),
            await intento(`update public.backlog set tags = '["a", 1]' where id = $1`, [bId]),
            await intento(`update public.backlog set tags = '{"a": "b"}' where id = $1`, [bId]),
        ] },
    ]);
    const sql = readFileSync('supabase/verificar-fase7-5b1.sql', 'utf8');
    const escritura = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"));
    const conMig = (await S.pg.query(sql)).rows;
    const S6 = await servidor({ conNueva: false });
    const sinMig = (await S6.pg.query(sql)).rows;
    tabla('verificar-fase7-5b1.sql', [
        { caso: 'solo lectura (un SELECT, sin escritura fuera de comentarios y literales)', esperado: false, obtenido: escritura },
        { caso: 'con la migración: 20 filas, todas ok', esperado: { filas: 20, ok: 20 }, obtenido: { filas: conMig.length, ok: conMig.filter((r) => r.ok).length } },
        { caso: 'sin la migración: fallan las 13 del esquema nuevo, sin error', esperado: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 14, 17, 18], obtenido: sinMig.filter((r) => !r.ok).map((r) => r.orden) },
    ]);
    // auditar-fase6.sql: estrictos ok con la migración; informativos que cambian.
    const AUD = readFileSync('supabase/auditar-fase6.sql', 'utf8');
    const auditar = async () => {
        const X = await servidor();
        const u = '00000000-0000-4000-8000-000000075b11';
        await X.pg.query('insert into auth.users (id) values ($1)', [u]);
        await X.pg.query("insert into auth.identities (user_id, provider) values ($1, 'google')", [u]);
        await X.pg.exec('begin transaction read only');
        try { return (await X.pg.query(AUD)).rows; } finally { await X.pg.exec('rollback'); }
    };
    const a7 = await auditar();
    const kind = (r) => (r.esperado === null ? 'I' : r.chequeo.startsWith('(solo Supabase)') ? 'S' : 'E');
    const estrictos = a7.filter((r) => kind(r) === 'E');
    const soloSupabase = a7.filter((r) => kind(r) === 'S').map((r) => r.orden);
    check(`auditar-fase6.sql con la migración: ${estrictos.filter((r) => r.ok === true).length}/${estrictos.length} estrictos ok (+ ${soloSupabase.length} solo Supabase: ${soloSupabase.map((n) => '#' + n).join(', ')})`, estrictos.length === 16 && soloSupabase.length === 2 && estrictos.every((r) => r.ok === true), estrictos.filter((r) => r.ok !== true).map((r) => `#${r.orden} ${r.valor}`).join(','));
    const i22 = a7.find((r) => r.orden === 22);
    console.log(`     #22 (informativo, service_role en las 16 tablas): ${i22 ? i22.valor : '?'}`);
    const v2 = (await (await servidor()).pg.query(readFileSync('supabase/verificar-fase2.sql', 'utf8'))).rows;
    check(`verificar-fase2.sql con la migración: ${v2.filter((r) => r.ok).length}/${v2.length} ok (esperados de 16 tablas; FK compuestas 8)`, v2.length === 22 && v2.every((r) => r.ok), v2.filter((r) => !r.ok).map((r) => `${r.orden}:${r.valor}`).join(', '));
}

// =============================================================================================
seccion('11. Sync entre 2 dispositivos');
{
    const S = await servidor();
    const uid = '00000000-0000-4000-8000-000000075b20';
    await nuevoUsuario(S, uid);
    const A = await entorno(uid);
    for (const n of ['Drama', 'Isekai']) A.ok(await A.db.createBacklogTag(uid, 'anime', n), 'createBacklogTag');
    await A.nuevoTitulo('anime', 'Compartido 1', { tags: ['Drama', 'Isekai'] });
    await A.nuevoTitulo('anime', 'Compartido 2', { tags: ['isekai'] });
    A.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const oa = await quiet(() => engine.syncOnce(CFG, S.T));
    const B = await entorno(uid);
    B.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const ob = await quiet(() => engine.syncOnce(CFG, S.T));
    A.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
    let cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    const srvTags = (await S.pg.query("select count(*)::int n from public.backlog_tags where user_id = $1 and deleted_at is null", [uid])).rows[0].n;
    const tB = await B.titulo('anime', 'Compartido 1');
    tabla('A sube, B baja', [{
        caso: 'catálogo y backlog.tags convergen',
        esperado: { a: 'ok', b: 'ok', servidor: 2, tagsEnB: '["Drama","Isekai"]', catalogoB: ['drama', 'isekai'], identicos: true },
        obtenido: { a: oa.status, b: ob.status, servidor: srvTags, tagsEnB: tB.tags, catalogoB: (await B.catalogo()).map((r) => r.name_key).sort(), identicos: cmp.identical },
    }]);
    // La misma etiqueta creada sin red en los dos (igual en uno, con otras mayúsculas en el otro).
    A.ok(await A.db.createBacklogTag(uid, 'series', 'Comedia'), 'c');
    B.ok(await B.db.createBacklogTag(uid, 'series', 'Comedia'), 'c');
    A.ok(await A.db.createBacklogTag(uid, 'series', 'Shounen'), 'c');
    B.ok(await B.db.createBacklogTag(uid, 'series', 'shounen'), 'c');
    A.usar(); const s1 = await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar(); const s2 = await quiet(() => engine.syncOnce(CFG, S.T));
    A.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
    const filasSrv = (await S.pg.query("select name_key, count(*)::int n from public.backlog_tags where user_id = $1 and section = 'series' group by 1 order by 1", [uid])).rows;
    cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    const nombreShounen = (await S.pg.query("select name from public.backlog_tags where user_id = $1 and section = 'series' and name_key = 'shounen'", [uid])).rows[0].name;
    tabla('misma etiqueta sin red en los dos', [{
        caso: 'una fila por clave (fusión por clave natural); gana la última escritura del nombre; A y B idénticos',
        esperado: { ciclos: ['ok', 'ok'], servidor: [{ name_key: 'comedia', n: 1 }, { name_key: 'shounen', n: 1 }], fusionadas: true, nombreShounen: 'shounen', identicos: true },
        obtenido: { ciclos: [s1.status, s2.status], servidor: filasSrv, fusionadas: s2.merged >= 2, nombreShounen, identicos: cmp.identical },
    }]);
    // Borrar y volver a crear → la misma fila revivida (también en el otro dispositivo).
    const isekai = await A.etiqueta('anime', 'isekai');
    A.ok(await A.db.deleteBacklogTag(isekai.id), 'd');
    A.ok(await A.db.createBacklogTag(uid, 'anime', 'Isekai'), 'c');
    A.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
    const filasIsekai = (await S.pg.query("select id, deleted_at from public.backlog_tags where user_id = $1 and section = 'anime' and name_key = 'isekai'", [uid])).rows;
    tabla('borrar y volver a crear', [{
        caso: 'misma fila (mismo id) viva en el servidor y en B; los títulos la perdieron al borrar',
        esperado: { filas: 1, mismoId: true, viva: true, enB: true, tituloB: '["Drama"]' },
        obtenido: { filas: filasIsekai.length, mismoId: filasIsekai[0].id === isekai.id, viva: filasIsekai[0].deleted_at === null, enB: !!(await B.etiqueta('anime', 'isekai')), tituloB: (await B.titulo('anime', 'Compartido 1')).tags },
    }]);
    // Renombrar y borrar se propagan con los títulos.
    A.ok(await A.db.updateBacklogItem((await A.titulo('anime', 'Compartido 2')).id, { title: 'Compartido 2', tags: ['Isekai', 'Drama'] }), 'u');
    const drama = await A.etiqueta('anime', 'drama');
    A.ok(await A.db.renameBacklogTag(drama.id, 'Drama clásico'), 'r');
    A.ok(await A.db.deleteBacklogTag((await A.etiqueta('anime', 'isekai')).id), 'd');
    A.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar(); await quiet(() => engine.syncOnce(CFG, S.T));
    cmp = compareSnapshots(snapshotDb(A.dev.path), snapshotDb(B.dev.path));
    tabla('renombrar y borrar', [{
        caso: 'B ve el nombre nuevo y los títulos reescritos',
        esperado: { catalogoAnimeB: ['Drama clásico'], t1: '["Drama clásico"]', t2: '["Drama clásico"]', identicos: true },
        obtenido: { catalogoAnimeB: (await B.catalogo()).filter((r) => r.section === 'anime').map((r) => r.name), t1: (await B.titulo('anime', 'Compartido 1')).tags, t2: (await B.titulo('anime', 'Compartido 2')).tags, identicos: cmp.identical },
    }]);
    // Segunda sincronización: 0 escrituras en los dos.
    A.usar(); const z1 = await quiet(() => engine.syncOnce(CFG, S.T));
    B.usar(); const z2 = await quiet(() => engine.syncOnce(CFG, S.T));
    tabla('segunda sincronización', [{ caso: 'remota y local en 0 (A y B)', esperado: [[0, 0], [0, 0]], obtenido: [[z1.remoteWrites, z1.localWrites], [z2.remoteWrites, z2.localWrites]] }]);
}

// =============================================================================================
seccion(`12. Compatibilidad a: la app 1.4.1 (${REF_VIEJA}) contra el servidor CON la migración`);
{
    const S = await servidor();
    const uid = '00000000-0000-4000-8000-000000075b30';
    await nuevoUsuario(S, uid);
    const N = await entorno(uid);
    N.ok(await N.db.createBacklogTag(uid, 'movie', 'Clásicas'), 'c');
    const tN = await N.nuevoTitulo('movie', 'Con etiquetas', { tags: ['Clásicas'] });
    N.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    await quiet(() => engine.syncOnce(CFG, S.T));
    const O = await vieja.dispositivo(uid, __setDatabasePath);
    O.usar();
    await quiet(() => vieja.engine.ensureInitialUpload(CFG_VIEJA));
    const p1 = await quiet(() => vieja.engine.syncOnce(CFG_VIEJA, S.T));
    const ob1 = await O.svc.db.getFirstAsync('SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    const tO = (await O.svc.getBacklogItems(uid, 'movie', 'Total')).data.find((b) => b.id === tN.id);
    const e1 = await quiet(() => O.svc.updateBacklogItem(tO.id, { title: 'Con etiquetas (editado en la 1.4.1)', franchise: 'Otros' }));
    const p2 = await quiet(() => vieja.engine.syncOnce(CFG_VIEJA, S.T));
    const ob2 = await O.svc.db.getFirstAsync('SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    const srv = (await S.pg.query('select title, tags from public.backlog where id = $1', [tN.id])).rows[0];
    N.usar();
    const pn = await quiet(() => engine.syncOnce(CFG, S.T));
    const tN2 = await N.titulo('movie', 'Con etiquetas (editado en la 1.4.1)');
    tabla('compatibilidad a', [{
        caso: 'pull y push de la 1.4.1; tags se conserva en el servidor y en la nueva',
        esperado: { pull: 'ok', outboxTrasPull: { raw: 0, blocked: 0 }, edicion: true, push: 'ok', outboxTrasPush: { raw: 0, blocked: 0 }, servidor: { title: 'Con etiquetas (editado en la 1.4.1)', tags: ['Clásicas'] }, nueva: 'ok', tagsNueva: '["Clásicas"]' },
        obtenido: { pull: p1.status, outboxTrasPull: { raw: ob1.raw, blocked: ob1.blocked || 0 }, edicion: !!e1.success, push: p2.status, outboxTrasPush: { raw: ob2.raw, blocked: ob2.blocked || 0 }, servidor: srv, nueva: pn.status, tagsNueva: tN2 && tN2.tags },
    }]);
    check('la 1.4.1 no conoce backlog_tags (no está en su TABLES) y su fromRemote ignora tags (lectura del código)', !vieja.mapping.TABLES.includes('backlog_tags') && !('tags' in vieja.mapping.fromRemote('backlog', { tags: ['x'], title: 't' })));
}

// =============================================================================================
seccion('13. Compatibilidad b: la app 1.4.2 contra un servidor SIN la migración');
{
    const S = await servidor({ conNueva: false });
    const uid = '00000000-0000-4000-8000-000000075b40';
    await nuevoUsuario(S, uid);
    const N = await entorno(uid);
    N.ok(await N.db.createBacklogTag(uid, 'anime', 'Isekai'), 'c');
    const tN = await N.nuevoTitulo('anime', 'Bloqueado', { tags: ['Isekai'] });
    // Fuera de backlog todo sube (backlog siempre manda la columna tags, así que todas sus filas se
    // bloquean, como en la 7.5); y una tarjeta creada en "otro dispositivo" (cards, la 15.ª tabla)
    // prueba que el pull llega hasta el final antes de fallar en backlog_tags.
    N.ok(await N.db.addEntertainmentCategory(uid, { name: 'Sube igual', type: 'video', startDate: '2026-11-01', daysOfWeek: { Monday: 1 }, frequency: 0, seriesCount: 3, description: null }), 'addEntertainmentCategory');
    await S.pg.query("insert into public.cards (id, user_id, name, type, created_at, updated_at) values (gen_random_uuid(), $1, 'Tarjeta remota', 'debit', now(), now())", [uid]);
    N.usar();
    await quiet(() => engine.ensureInitialUpload(CFG));
    const o1 = await quiet(() => engine.syncOnce(CFG, S.T));
    const bloqueadas = await D.all(N.dev, 'SELECT DISTINCT table_name t, block_reason r FROM outbox WHERE blocked_at IS NOT NULL');
    const tarjetaBajo = (await D.one(N.dev, "SELECT COUNT(*) n FROM cards WHERE name = 'Tarjeta remota'")).n;
    const lastError = (await D.one(N.dev, "SELECT value FROM sync_meta WHERE key = 'last_error'")).value;
    const sinEtiquetasSubio = (await S.pg.query("select count(*)::int n from public.entertainment_categories where name = 'Sube igual'")).rows[0].n;
    // El pull nunca pone NULL sobre tags: una fila de backlog del servidor sin la columna actualiza solo lo que trae.
    await N.db.db.runAsync('DELETE FROM outbox WHERE row_id = ?', [tN.id]);
    const remoto = { ...toRemote('backlog', await D.one(N.dev, 'SELECT * FROM backlog WHERE id = ?', [tN.id])), title: 'Bloqueado (otro lado)', server_updated_at: new Date().toISOString() };
    delete remoto.tags;
    const res = { received: 0, applied: 0, skippedPending: 0, skippedSame: 0, merged: 0, conflicts: 0 };
    D.use(N.dev);
    await engine.applyRemoteRows('backlog', [remoto], uid, res);
    const tras = await D.one(N.dev, 'SELECT title, tags FROM backlog WHERE id = ?', [tN.id]);
    // Se aplica el SQL: el siguiente ciclo baja backlog_tags solo; "Reintentar" sube lo bloqueado.
    await S.aplicarNueva();
    N.usar();
    await N.db.db.runAsync("INSERT INTO outbox (table_name, row_id, op, created_at, attempts) VALUES ('backlog', ?, 'upsert', ?, 0)", [tN.id, new Date().toISOString()]);
    const o2 = await quiet(() => engine.syncOnce(CFG, S.T));
    const sigueBloqueado = (await D.one(N.dev, 'SELECT COUNT(*) n FROM outbox WHERE blocked_at IS NOT NULL')).n;
    await quiet(() => engine.unblockAll());
    const o3 = await quiet(() => engine.syncOnce(CFG, S.T));
    const ob3 = await D.one(N.dev, 'SELECT COUNT(*) raw, SUM(blocked_at IS NOT NULL) blocked FROM outbox');
    const srv = (await S.pg.query('select (select tags from public.backlog where id = $1) tags, (select count(*)::int from public.backlog_tags where user_id = $2 and deleted_at is null) catalogo', [tN.id, uid])).rows[0];
    tabla('compatibilidad b', [{
        caso: 'servidor sin la migración → SQL → (pull solo) → Reintentar',
        esperado: {
            ciclo1: 'offline', bajaronLas15: true, bloqueadas: ['backlog', 'backlog_tags'], motivo: true, lastError: true, loDemasSube: 1,
            noPisaNull: { title: 'Bloqueado (otro lado)', tags: '["Isekai"]' },
            trasSql: 'ok', bloqueadasHastaReintentar: true, trasReintentar: 'ok', outbox: { raw: 0, blocked: 0 }, servidor: { tags: ['Isekai'], catalogo: 1 },
        },
        obtenido: {
            ciclo1: o1.status, bajaronLas15: tarjetaBajo === 1, bloqueadas: [...new Set(bloqueadas.map((b) => b.t))].sort(),
            motivo: bloqueadas.every((b) => /tags|backlog_tags|42703|42P01|PGRST20[45]/.test(String(b.r))), lastError: /backlog_tags/.test(String(lastError)), loDemasSube: sinEtiquetasSubio,
            noPisaNull: tras, trasSql: o2.status, bloqueadasHastaReintentar: sigueBloqueado > 0, trasReintentar: o3.status, outbox: { raw: ob3.raw, blocked: ob3.blocked || 0 }, servidor: srv,
        },
    }]);
}

// =============================================================================================
seccion('14. Corrección 1.4.3: título completo en Pendiente (C1) y Atrás con una hoja abierta');
{
    // C1 (estático, Babel): el título de la fila sin numberOfLines; el campo de título multilínea
    // (hasta 5 líneas, Enter cierra el teclado, saltos de línea → espacio); las etiquetas de la fila
    // siguen en 1 línea con elipsis.
    const attrs = (el) => Object.fromEntries(el.openingElement.attributes.filter((a) => a.name).map((a) => [a.name.name, a.value]));
    const fuente = (n) => (n ? (n.type === 'StringLiteral' ? n.value : n.expression ? (n.expression.type === 'NumericLiteral' ? n.expression.value : 'expr') : 'expr') : true);
    // ¿El atributo style del elemento nombra styles.<estilo>?
    const usaEstilo = (el, estilo) => JSON.stringify(el.openingElement.attributes.find((a) => a.name && a.name.name === 'style') || {}).includes(`"name":"${estilo}"`);
    const revisarC1 = (codigo) => {
        const ast = parse(codigo, { sourceType: 'module', plugins: ['jsx'] });
        const r = { tituloSinLimite: null, campoMultilinea: false, enterCierra: false, cincoLineas: false, saltosAEspacio: false, etiquetasUnaLinea: null };
        traverse(ast, {
            JSXElement(p) {
                const n = p.node.openingElement.name.name;
                const a = attrs(p.node);
                if (n === 'Text' && usaEstilo(p.node, 'itemTitle')) r.tituloSinLimite = !('numberOfLines' in a);
                if (n === 'Text' && usaEstilo(p.node, 'tagsLine')) r.etiquetasUnaLinea = fuente(a.numberOfLines) === 1 && fuente(a.ellipsizeMode) === 'tail';
                if (n === 'TextInput' && usaEstilo(p.node, 'titleInput')) {
                    r.campoMultilinea = 'multiline' in a && a.multiline === null;
                    r.enterCierra = fuente(a.submitBehavior) === 'blurAndSubmit';
                    r.saltosAEspacio = /replace\(\/\\s\*\[\\r\\n\]\+\\s\*\/g, ' '\)/.test(codigo.slice(p.node.start, p.node.end));
                }
            },
        });
        r.cincoLineas = /titleInput:\s*\{[^}]*lineHeight:\s*22[^}]*maxHeight:\s*5 \* 22 \+ 30/.test(codigo);
        return r;
    };
    const SRC = readFileSync(PANT, 'utf8');
    const real = revisarC1(SRC);
    tabla('C1 en la pantalla (estático)', [
        { caso: 'título de la fila sin numberOfLines (se ve completo)', esperado: true, obtenido: real.tituloSinLimite },
        { caso: 'campo de título: multiline, Enter cierra el teclado (blurAndSubmit), hasta 5 líneas (5 × 22 + 30) y saltos de línea → espacio', esperado: [true, true, true, true], obtenido: [real.campoMultilinea, real.enterCierra, real.cincoLineas, real.saltosAEspacio] },
        { caso: 'etiquetas de la fila en 1 línea con elipsis', esperado: true, obtenido: real.etiquetasUnaLinea },
    ]);
    const sembrar = (de, a) => { if (!SRC.includes(de)) throw new Error(`no está en la pantalla: ${de}`); return SRC.replace(de, a); };
    const copias = [
        revisarC1(sembrar('<Text style={[styles.itemTitle, { color: theme.ink }]}>', '<Text style={[styles.itemTitle, { color: theme.ink }]} numberOfLines={2}>')).tituloSinLimite === false,
        revisarC1(sembrar('                                multiline\n', '')).campoMultilinea === false,
        revisarC1(sembrar('submitBehavior="blurAndSubmit"', 'submitBehavior="newline"')).enterCierra === false,
        revisarC1(sembrar('maxHeight: 5 * 22 + 30', 'maxHeight: 400')).cincoLineas === false,
        revisarC1(sembrar("<Text style={[styles.tagsLine, { color: theme.accent }]} numberOfLines={1} ellipsizeMode=\"tail\">", '<Text style={[styles.tagsLine, { color: theme.accent }]}>')).etiquetasUnaLinea === false,
    ];
    check(`control negativo C1: el revisor detecta las ${copias.length} violaciones sembradas en copias`, copias.every(Boolean), copias.map((x, i) => `${i + 1}:${x}`).join(' '));
    // Atrás (arnés): handleBack REAL de App.js con la pila real de hojas (src/hooks/hojasAbiertas.js).
    const pila = await import('../src/hooks/hojasAbiertas.js');
    const crearBack = () => {
        const llamadas = { setCurrentView: [], setNavigationHistory: [], confirm: 0, salir: 0 };
        const fn = instanciarPantalla(extraer('App.js', 'handleBack'), {
            cerrarHojaAbierta: pila.cerrarHojaAbierta, navigationHistory: ['HOME'], currentView: 'BACKLOG',
            setNavigationHistory: (h) => llamadas.setNavigationHistory.push(h), setCurrentView: (v) => llamadas.setCurrentView.push(v),
            confirm: async () => { llamadas.confirm++; return null; }, BackHandler: { exitApp: () => { llamadas.salir++; } },
        });
        return { fn, llamadas };
    };
    const cerradas = [];
    const q1 = pila.registrarHoja(() => cerradas.push('formulario'));
    const q2 = pila.registrarHoja(() => cerradas.push('gestión'));
    const b1 = crearBack();
    const r1 = b1.fn();
    q2();
    const r2 = b1.fn();
    q1();
    const b3 = crearBack();
    const r3 = b3.fn();
    tabla('Atrás con una hoja abierta (handleBack real de App.js)', [
        { caso: 'dos hojas abiertas: cierra solo la de arriba y no navega', esperado: { devuelve: true, cerradas: ['gestión'], navega: [] }, obtenido: { devuelve: r1, cerradas: cerradas.slice(0, 1), navega: b1.llamadas.setCurrentView.slice(0, 1) } },
        { caso: 'queda una: la cierra y sigue sin navegar', esperado: { devuelve: true, cerradas: ['gestión', 'formulario'], navega: [] }, obtenido: { devuelve: r2, cerradas, navega: b1.llamadas.setCurrentView } },
        { caso: 'sin hojas: navega como siempre (vuelve a HOME)', esperado: { devuelve: true, navega: ['HOME'], abiertas: false }, obtenido: { devuelve: r3, navega: b3.llamadas.setCurrentView, abiertas: pila.hayHojaAbierta() } },
    ]);
}

// =============================================================================================
seccion('15. Corrección 1.4.4: alturas de la hoja (D1, D2) y almacén de hojas (identidad estable y limpieza)');
{
    const { alturaHoja } = await import('../src/components/alturaHoja.js');
    // Ventana de 800 dp; gestos: insets top 32 / bottom 24; 3 botones: top 32 / bottom 48.
    // Contenido de la hoja de etiquetas ≈ 250 + 52 por fila: 0 → 250, 3 → 406, 20 → 1290.
    const G = { top: 32, bottom: 24 }, B = { top: 32, bottom: 48 };
    const h = (insets, teclado, variante, contenido, ventana = 800) => alturaHoja({ ventana, insets, teclado, variante, contenido });
    tabla('alturaHoja (función pura)', [
        { caso: 'gestos, teclado cerrado, 0 etiquetas: mide su contenido; relleno = insets.bottom (llega al borde)', esperado: { tope: 56, relleno: 24, maxAlto: 680, alto: 250, scroll: false }, obtenido: h(G, 0, 'inferior', 250) },
        { caso: 'gestos, teclado cerrado, 3 etiquetas: mide su contenido', esperado: { tope: 56, relleno: 24, maxAlto: 680, alto: 406, scroll: false }, obtenido: h(G, 0, 'inferior', 406) },
        { caso: 'gestos, teclado cerrado, 20 etiquetas: 85 % de la ventana y scroll', esperado: { tope: 56, relleno: 24, maxAlto: 680, alto: 680, scroll: true }, obtenido: h(G, 0, 'inferior', 1290) },
        { caso: '3 botones, teclado cerrado, 20 etiquetas: 85 % (cabe en el área libre de 696)', esperado: { tope: 56, relleno: 48, maxAlto: 680, alto: 680, scroll: true }, obtenido: h(B, 0, 'inferior', 1290) },
        { caso: 'gestos, teclado de 300 abierto, 3 etiquetas: el área libre (420); relleno = teclado + insets.bottom, sin doble espacio', esperado: { tope: 56, relleno: 324, maxAlto: 420, alto: 406, scroll: false }, obtenido: h(G, 300, 'inferior', 406) },
        { caso: 'gestos, teclado abierto, 20 etiquetas: el área libre y scroll', esperado: { tope: 56, relleno: 324, maxAlto: 420, alto: 420, scroll: true }, obtenido: h(G, 300, 'inferior', 1290) },
        { caso: '3 botones, teclado abierto, 3 etiquetas: el área libre (396) y scroll', esperado: { tope: 56, relleno: 348, maxAlto: 396, alto: 396, scroll: true }, obtenido: h(B, 300, 'inferior', 406) },
        { caso: 'centrada, gestos, teclado cerrado: 85 % (área libre 700 con el margen de 20)', esperado: { tope: 56, relleno: 24, maxAlto: 680, alto: 600, scroll: false }, obtenido: h(G, 0, 'centrada', 600) },
        { caso: 'centrada, gestos, teclado abierto: el área libre (400)', esperado: { tope: 56, relleno: 324, maxAlto: 400, alto: 400, scroll: true }, obtenido: h(G, 300, 'centrada', 600) },
        { caso: 'ventana chica (600), 3 botones: el máximo nunca pasa del área libre (496 < 510)', esperado: { tope: 56, relleno: 48, maxAlto: 496 }, obtenido: h(B, 0, 'inferior', undefined, 600) },
        { caso: 'sin contenido: solo tope, relleno y máximo', esperado: { tope: 56, relleno: 24, maxAlto: 680 }, obtenido: h(G, 0, 'inferior', undefined) },
    ]);
    // Almacén (puro): identidad estable, orden, limpieza y pila de Atrás.
    const A = await import('../src/hooks/almacenHojas.js');
    const P = await import('../src/hooks/hojasAbiertas.js');
    let avisos = 0;
    const desuscribir = A.suscribirHojas(() => { avisos++; });
    const cerradas = [];
    A.ponerHoja('h1', { onClose: () => cerradas.push('h1 v1'), texto: 'a' });
    A.ponerHoja('h2', { onClose: () => cerradas.push('h2'), texto: 'x' });
    const antes = A.leerHojas();
    A.ponerHoja('h1', { onClose: () => cerradas.push('h1 v2'), texto: 'ab' }); // la pantalla re-renderiza (escribir)
    const despues = A.leerHojas();
    const estado1 = { ids: despues.map((e) => e.id), texto: despues[0].props.texto, otraIdentidad: antes !== despues, mismaH2: antes[1] === despues[1], pila: P.hayHojaAbierta() };
    P.cerrarHojaAbierta(); // Atrás: cierra la de arriba (h2) con su onClose
    A.quitarHoja('h2'); // la pantalla la oculta (visible = false)
    P.cerrarHojaAbierta(); // Atrás otra vez: h1 con su onClose MÁS RECIENTE
    A.quitarHoja('h1'); // la pantalla se desmonta con la hoja abierta
    const avisosAntes = avisos;
    A.quitarHoja('no-existe');
    desuscribir();
    tabla('almacén de hojas (puro)', [
        { caso: 'mismo id: se actualiza en su lugar (no otra entrada), el orden se mantiene y la otra entrada no cambia', esperado: { ids: ['h1', 'h2'], texto: 'ab', otraIdentidad: true, mismaH2: true, pila: true }, obtenido: estado1 },
        { caso: 'Atrás cierra la de arriba y después la otra con su onClose más reciente', esperado: ['h2', 'h1 v2'], obtenido: cerradas },
        { caso: 'al ocultar y al desmontar: fuera del almacén y de la pila de Atrás', esperado: { hojas: 0, pila: false }, obtenido: { hojas: A.leerHojas().length, pila: P.hayHojaAbierta() } },
        { caso: 'quitar una que no está no avisa a nadie', esperado: 0, obtenido: avisos - avisosAntes },
    ]);
}

console.log(fallas === 0 ? `\nFASE 7.5b1: ${total} OK.` : `\n${fallas} de ${total} prueba(s) fallaron.`);
process.exit(fallas === 0 ? 0 : 1);
