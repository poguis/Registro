// Dirección visual A "Hueso y petróleo" (Fase 7, antes de la 7.5): comprobaciones estáticas del
// tema, las hojas propias (O6) y las reglas de UI. Solo lee archivos del repo; no abre la BD ni
// toca la red. Uso: node scripts/probar-tema.mjs  (sale con código 1 si algo falla).
//
//  1. Contraste WCAG (los dos modos): ≥ 4.5 de ink, muted, aheadFg/behindFg/okFg, accent, money.*
//     y tones.*.fg sobre bg y surface; de cada par fg/bg (adelanto, atraso, al día, tonos) entre sí;
//     de onAccent sobre accent; de accent sobre soft; de ink y muted sobre raised. ≥ 3 de
//     lineStrong sobre bg, surface y raised y del texto destructivo (onDanger) sobre danger.
//     `line` es decorativo: se informa sin exigirle 3:1.
//  2. Ningún Alert.alert en App.js ni en src/ (lista de excepciones aprobadas: vacía).
//  3. Ningún color fijo (#hex, rgb()/rgba(), nombres de color) en src/screens, src/components y
//     App.js: los valores viven solo en src/contexts/ThemeContext.js (y el splash en app.json).
//  4. Ningún token viejo (background, card, text, subText, border…) ni en el tema ni en el código.
//  5. Fuentes: ninguna pantalla importa Text/TextInput de react-native (usan src/components/AppText)
//     y no queda fontWeight fuera de AppText; los 4 TTF existen y coinciden con el plugin de
//     expo-font de app.json y con FONT del tema.
//  6. Hoja y aviso: Modal transparente con slide y onRequestClose, botones ≥ 52 con
//     accessibilityRole="button", aviso con accessibilityLiveRegion; proveedores en la raíz.
//  7. Esquema conocido: la dirección visual no tocó el esquema (LATEST_VERSION 6, 5 archivos de
//     Supabase); desde la 7.5, LATEST_VERSION = 7 (migraciones 1–7) y 6 archivos en supabase/migrations;
//     desde la 7.5b1, LATEST_VERSION = 8 y 7 archivos.
//  8. Teclado (corrección 1.4.3 de la 7.5b1): todo formulario u hoja con TextInput del módulo de
//     entretenimiento usa src/components/HojaConTeclado.js (alto del teclado de los eventos de RN +
//     insets de safe-area, sin KeyboardAvoidingView ni Modal), montada directamente en la vista raíz
//     de la pantalla; Atrás tiene un solo listener (App.js) que primero cierra la hoja abierta.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
// @babel/parser y @babel/traverse: dependencias transitivas de Expo (como en extraer-pantalla.mjs).
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

const RAIZ = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');

let fallas = 0, oks = 0;
function check(nombre, ok, detalle = '') {
    if (ok) { oks++; console.log(`OK   ${nombre}${detalle ? ' — ' + detalle : ''}`); }
    else { fallas++; console.log(`FALLA ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}
const info = (texto) => console.log(`INFO ${texto}`);

// ---------------------------------------------------------------------------------------------
// Tema: se evalúa SOLO el literal `colors` y `FONT` de ThemeContext.js (el archivo importa React y
// AsyncStorage, que no hacen falta para leer los valores).
// ---------------------------------------------------------------------------------------------
const TEMA = leer('src/contexts/ThemeContext.js');
function literal(nombre) {
    const ini = TEMA.indexOf(`export const ${nombre} = `);
    if (ini < 0) throw new Error(`ThemeContext.js: no está "export const ${nombre}"`);
    const desde = TEMA.indexOf('{', ini);
    let prof = 0, i = desde;
    for (; i < TEMA.length; i++) {
        if (TEMA[i] === '{') prof++;
        else if (TEMA[i] === '}' && --prof === 0) break;
    }
    return new Function(`"use strict"; return (${TEMA.slice(desde, i + 1)});`)();
}
const colors = literal('colors');
const FONT = literal('FONT');

// Contraste WCAG 2.x entre dos colores #RRGGBB.
function luminancia(hex) {
    const h = hex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`color no #RRGGBB: ${hex}`);
    const c = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) {
    const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
}

console.log('== 1. Contraste (WCAG) ==');
for (const modo of ['light', 'dark']) {
    const t = colors[modo];
    const minimo = (nombre, fg, bg, min) => {
        const r = contraste(fg, bg);
        check(`${modo}: ${nombre} ≥ ${min}`, r >= min, r.toFixed(2));
    };
    const textos = {
        ink: t.ink, muted: t.muted, aheadFg: t.aheadFg, behindFg: t.behindFg, okFg: t.okFg, accent: t.accent,
        ...Object.fromEntries(Object.entries(t.money).map(([k, v]) => [`money.${k}`, v])),
        ...Object.fromEntries(Object.entries(t.tones).map(([k, v]) => [`tones.${k}.fg`, v.fg])),
    };
    const peor = (fondo) => Object.entries(textos).map(([k, v]) => [k, contraste(v, t[fondo])]).sort((a, b) => a[1] - b[1])[0];
    for (const fondo of ['bg', 'surface']) {
        const malos = Object.entries(textos).filter(([, v]) => contraste(v, t[fondo]) < 4.5).map(([k, v]) => `${k} ${contraste(v, t[fondo]).toFixed(2)}`);
        const [pk, pv] = peor(fondo);
        check(`${modo}: ${Object.keys(textos).length} tokens de texto sobre ${fondo} ≥ 4.5`, malos.length === 0, malos.length ? malos.join(', ') : `el menor: ${pk} ${pv.toFixed(2)}`);
    }
    minimo('aheadFg sobre aheadBg', t.aheadFg, t.aheadBg, 4.5);
    minimo('behindFg sobre behindBg', t.behindFg, t.behindBg, 4.5);
    minimo('okFg sobre okBg', t.okFg, t.okBg, 4.5);
    const tonosMalos = Object.entries(t.tones).filter(([, v]) => contraste(v.fg, v.bg) < 4.5).map(([k, v]) => `${k} ${contraste(v.fg, v.bg).toFixed(2)}`);
    const tonoMin = Object.entries(t.tones).map(([k, v]) => [k, contraste(v.fg, v.bg)]).sort((a, b) => a[1] - b[1])[0];
    check(`${modo}: tones.*.fg sobre su propio bg ≥ 4.5 (6 tonos)`, tonosMalos.length === 0, tonosMalos.length ? tonosMalos.join(', ') : `el menor: ${tonoMin[0]} ${tonoMin[1].toFixed(2)}`);
    minimo('onAccent sobre accent', t.onAccent, t.accent, 4.5);
    minimo('accent sobre soft', t.accent, t.soft, 4.5);
    minimo('ink sobre raised', t.ink, t.raised, 4.5);
    minimo('muted sobre raised', t.muted, t.raised, 4.5);
    for (const fondo of ['bg', 'surface', 'raised']) minimo(`lineStrong sobre ${fondo}`, t.lineStrong, t[fondo], 3);
    minimo('texto destructivo (onDanger) sobre danger', t.onDanger, t.danger, 3);
    info(`${modo}: line (decorativo, sin exigencia) sobre bg ${contraste(t.line, t.bg).toFixed(2)}, sobre surface ${contraste(t.line, t.surface).toFixed(2)}`);
}
check('los dos modos tienen las mismas claves', JSON.stringify(Object.keys(colors.light).sort()) === JSON.stringify(Object.keys(colors.dark).sort())
    && JSON.stringify(Object.keys(colors.light.tones).sort()) === JSON.stringify(Object.keys(colors.dark.tones).sort())
    && JSON.stringify(Object.keys(colors.light.money).sort()) === JSON.stringify(Object.keys(colors.dark.money).sort()));

// ---------------------------------------------------------------------------------------------
// Archivos de código
// ---------------------------------------------------------------------------------------------
function archivos(dir, ext = /\.(js|jsx|ts|tsx)$/) {
    const abs = join(RAIZ, dir);
    if (!existsSync(abs)) return [];
    const out = [];
    for (const n of readdirSync(abs)) {
        const p = join(abs, n);
        if (statSync(p).isDirectory()) out.push(...archivos(relative(RAIZ, p), ext));
        else if (ext.test(n)) out.push(relative(RAIZ, p).replace(/\\/g, '/'));
    }
    return out;
}
// Quita comentarios (// y /* */) sin tocar el contenido de las cadenas.
function sinComentarios(src) {
    let out = '', i = 0, cadena = null;
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        if (cadena) {
            out += c;
            if (c === '\\') { out += d ?? ''; i += 2; continue; }
            if (c === cadena) cadena = null;
            i++; continue;
        }
        if (c === '"' || c === "'" || c === '`') { cadena = c; out += c; i++; continue; }
        if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        out += c; i++;
    }
    return out;
}
const lineasCon = (archivo, re) => sinComentarios(leer(archivo)).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => re.test(l)).map(([n]) => `${archivo}:${n}`);

// Controles negativos de los detectores (si no detectan esto, sus OK no valen nada).
{
    const muestra = sinComentarios("const a = { color: '#fff' }; // '#000' en comentario\n/* rgba(0,0,0,1) */ Alert.alert('x');\nconst b = theme.card;");
    const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/;
    check('control negativo: los detectores ven un color fijo, Alert.alert y un token viejo (y no los comentarios)',
        COLOR.test(muestra) && !muestra.includes("'#000'") && !/rgba\(0,0,0,1\)/.test(muestra) && /\bAlert\.alert\s*\(/.test(muestra) && /\btheme\.card\b/.test(muestra));
}

const UI = ['App.js', ...archivos('src/screens'), ...archivos('src/components')];
const TODO_SRC = ['App.js', ...archivos('src')];

console.log('\n== 2. Alertas del sistema ==');
const EXCEPCIONES_ALERT = []; // aprobadas: ninguna
const conAlert = TODO_SRC.flatMap((f) => lineasCon(f, /\bAlert\.alert\s*\(/)).filter((x) => !EXCEPCIONES_ALERT.includes(x.split(':')[0]));
check('ningún Alert.alert en App.js ni en src/ (excepciones aprobadas: ninguna)', conAlert.length === 0, conAlert.join(', ') || `${TODO_SRC.length} archivos`);
const importaAlert = UI.filter((f) => /import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*'react-native'/.test(leer(f)));
check('ninguna pantalla importa Alert de react-native', importaAlert.length === 0, importaAlert.join(', '));

console.log('\n== 3. Colores fijos ==');
const COLOR_FIJO = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|['"](red|white|black|blue|green|gray|grey|yellow|orange|purple|pink|brown)['"]/;
const fijos = UI.flatMap((f) => lineasCon(f, COLOR_FIJO));
check(`ningún color fijo en App.js, src/screens y src/components (${UI.length} archivos)`, fijos.length === 0, fijos.slice(0, 15).join(', '));
const sumaAlfa = UI.flatMap((f) => lineasCon(f, /\+\s*['"][0-9a-fA-F]{2}['"]/));
check('ningún color armado con opacidad en hex (token + \'22\')', sumaAlfa.length === 0, sumaAlfa.join(', '));

console.log('\n== 4. Tokens viejos ==');
const VIEJOS = ['background', 'card', 'text', 'subText', 'border', 'inputBackground', 'header', 'success', 'error', 'info', 'infoText', 'modalOverlay'];
check('el tema no define tokens viejos', VIEJOS.every((k) => !(k in colors.light) && !(k in colors.dark)), VIEJOS.filter((k) => k in colors.light).join(', '));
const reViejos = new RegExp(`\\btheme\\.(${VIEJOS.join('|')})\\b`);
const usosViejos = TODO_SRC.flatMap((f) => lineasCon(f, reViejos));
check('ningún theme.<token viejo> en el código', usosViejos.length === 0, usosViejos.join(', '));

console.log('\n== 5. Fuentes ==');
const SIN_APPTEXT = UI.filter((f) => f !== 'src/components/AppText.js').filter((f) => {
    const m = [...leer(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g)].map((x) => x[1]).join(',');
    return /\bText\b|\bTextInput\b/.test(m);
});
check('ninguna pantalla importa Text/TextInput de react-native (usan AppText)', SIN_APPTEXT.length === 0, SIN_APPTEXT.join(', '));
const conPeso = UI.filter((f) => f !== 'src/components/AppText.js').flatMap((f) => lineasCon(f, /\bfontWeight\b/));
check('sin fontWeight fuera de AppText (Android: un archivo por peso)', conPeso.length === 0, conPeso.join(', '));
const app = JSON.parse(leer('app.json'));
const pluginFont = (app.expo.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-font');
const ttf = pluginFont ? pluginFont[1].fonts : [];
check('plugin expo-font en app.json con 4 TTF', ttf.length === 4, ttf.map((p) => basename(p)).join(', '));
check('los 4 TTF existen en node_modules', ttf.length === 4 && ttf.every((p) => existsSync(join(RAIZ, p))));
const familias = ttf.map((p) => basename(p).replace(/\.ttf$/, '')).sort();
check('FONT del tema = nombres de archivo de los TTF (familia en Android)', JSON.stringify(Object.values(FONT).sort()) === JSON.stringify(familias), Object.values(FONT).join(', '));

console.log('\n== 6. Hoja inferior, aviso y raíz ==');
const HOJA = sinComentarios(leer('src/components/BottomSheet.js'));
check('BottomSheet: Modal transparente, animationType="slide" y onRequestClose', /<Modal[\s\S]*?\btransparent\b[\s\S]*?animationType="slide"[\s\S]*?onRequestClose=/.test(HOJA));
check('BottomSheet: botones ≥ 52 de alto con accessibilityRole="button"', /minHeight:\s*52/.test(HOJA) && /accessibilityRole="button"/.test(HOJA));
check('Toast: accessibilityLiveRegion', /accessibilityLiveRegion=/.test(leer('src/components/Toast.js')));
const APP = sinComentarios(leer('App.js'));
check('App.js: ThemeProvider > SafeAreaProvider > SheetProvider en la raíz, con SystemBars',
    /<ThemeProvider>\s*<SafeAreaProvider>\s*<SheetProvider>/.test(APP) && /<SystemBars\s*\/>/.test(APP));
const CTX = sinComentarios(leer('src/contexts/SheetContext.js'));
check('SheetContext: cola de hojas (de a una) y confirm como promesa', /cola/i.test(CTX) && /new Promise/.test(CTX));

console.log('\n== 7. Sin cambios de esquema ==');
const MIG = leer('src/services/migrations.js');
const versiones = [...MIG.matchAll(/^\s*version:\s*(\d+),/gm)].map((m) => Number(m[1]));
check('migraciones locales 1–8 (LATEST_VERSION = 8, Fase 7.5b1)', JSON.stringify(versiones) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]), versiones.join(', '));
const SUPA = readdirSync(join(RAIZ, 'supabase/migrations')).sort();
const ESPERADAS = ['20261026000100_server_updated_at.sql', '20261026000200_tablas.sql', '20261026000300_indices_triggers.sql', '20261026000400_rls_grants.sql', '20261121000100_frecuencia_cuotas.sql', '20261122000100_vinculo_pendiente.sql', '20261124000100_etiquetas.sql'];
check('supabase/migrations: los 7 archivos esperados (7.º de la Fase 7.5b1)', JSON.stringify(SUPA) === JSON.stringify(ESPERADAS), SUPA.join(', '));

console.log('\n== 8. Teclado: el campo con el foco nunca queda tapado (correcciones 1.4.3 y 1.4.4) ==');
const HCT = sinComentarios(leer('src/components/HojaConTeclado.js'));
const ALT = sinComentarios(leer('src/components/alturaHoja.js'));
const elev = Number((/anfitrion:\s*\{[^}]*elevation:\s*(\d+)/.exec(HCT) || [])[1] || 0);
// 1.4.4: alturas en la función pura alturaHoja (insets.top + 24 arriba; insets.bottom, + el teclado,
// abajo; 85 % de la ventana) y publicación en el almacén (ponerHoja) desde useLayoutEffect.
check('HojaConTeclado: alto de keyboardDidShow/keyboardDidHide (endCoordinates.height) + insets de safe-area por alturaHoja, toda la ventana (absoluteFill) por encima del "+" (elevation > 10, zIndex), publicada en el almacén desde useLayoutEffect; sin KeyboardAvoidingView, measureInWindow, BackHandler ni Modal',
    /Keyboard\.addListener\('keyboardDidShow'/.test(HCT) && /Keyboard\.addListener\('keyboardDidHide'/.test(HCT) && /endCoordinates\.height/.test(HCT)
    && /useSafeAreaInsets\(\)/.test(HCT) && /alturaHoja\(\{ ventana, insets, teclado: altoTeclado/.test(HCT) && /maxHeight: maxAlto/.test(HCT)
    && /arriba \+ MARGEN_ARRIBA/.test(ALT) && /tecla \+ abajo : abajo/.test(ALT) && /FRACCION_MAXIMA = 0\.85/.test(ALT)
    && /StyleSheet\.absoluteFill/.test(HCT) && elev > 10 && /zIndex:\s*\d+/.test(HCT)
    && /useLayoutEffect\(\(\) => \{\s*if \(visible\) ponerHoja\(/.test(HCT) && /useLayoutEffect\(\(\) => \(\) => quitarHoja\(/.test(HCT)
    && !/KeyboardAvoidingView|measureInWindow|BackHandler|<Modal\b/.test(HCT), `elevation ${elev}`);
// Atrás: un solo listener (App.js) y su handleBack cierra primero la hoja abierta.
const conListener = TODO_SRC.flatMap((f) => lineasCon(f, /BackHandler\.addEventListener\s*\(/));
const APPB = sinComentarios(leer('App.js'));
const cuerpoBack = (/const handleBack = useCallback\(\(\) => \{\s*([^\n]*)/.exec(APPB) || [])[1] || '';
check('Atrás: un solo listener de hardwareBackPress (App.js) y lo primero de handleBack es cerrar la hoja abierta (cerrarHojaAbierta)',
    conListener.length === 1 && conListener[0].startsWith('App.js:') && /^if \(cerrarHojaAbierta\(\)\) return true;/.test(cuerpoBack.trim()), conListener.join(', ') || 'ninguno');
// Babel: en los formularios del módulo, todo TextInput (y todo EtiquetasCampo) va dentro de una
// HojaConTeclado; ningún Modal tiene campos ni hojas. Desde la 1.4.4 da igual dónde la monte la
// pantalla: la hoja se dibuja en HojasHost, último hijo de la View raíz de App.js.
const ARCHIVOS_TECLADO = ['src/screens/BacklogScreen.js', 'src/components/EtiquetasCampo.js', 'src/components/EtiquetasGestionHoja.js',
    'src/screens/SeriesAnimeScreen.js', 'src/screens/SeriesDetailScreen.js', 'src/screens/ReadingDetailScreen.js'];
const CAMPOS = new Set(['TextInput', 'EtiquetasCampo']);
const nombreJsx = (n) => (n && n.openingElement && n.openingElement.name && n.openingElement.name.name) || null;
function revisarTeclado(codigo, archivo) {
    const malas = [];
    const ast = parse(codigo, { sourceType: 'module', plugins: ['jsx'] });
    const componenteDeCampo = archivo.endsWith('EtiquetasCampo.js'); // sus TextInput se revisan donde se usa
    // Funciones que una ListaDeHoja (dentro de una HojaConTeclado) usa como renderItem: sus campos
    // están dentro de la hoja aunque el JSX esté en otra función (p. ej. renderFila).
    const renderDeHoja = new Set();
    traverse(ast, {
        JSXElement(p) {
            if (nombreJsx(p.node) !== 'ListaDeHoja') return;
            let dentro = false;
            for (let q = p.parentPath; q; q = q.parentPath) if (q.node.type === 'JSXElement' && nombreJsx(q.node) === 'HojaConTeclado') dentro = true;
            const attr = p.node.openingElement.attributes.find((a) => a.name && a.name.name === 'renderItem');
            if (dentro && attr && attr.value && attr.value.expression && attr.value.expression.type === 'Identifier') renderDeHoja.add(attr.value.expression.name);
        },
    });
    const enRenderDeHoja = (p) => {
        for (let q = p.parentPath; q; q = q.parentPath) {
            if (q.node.type === 'VariableDeclarator' && q.node.id && renderDeHoja.has(q.node.id.name)) return true;
        }
        return false;
    };
    traverse(ast, {
        JSXElement(p) {
            const nombre = nombreJsx(p.node);
            const ancestros = [];
            for (let q = p.parentPath; q; q = q.parentPath) if (q.node.type === 'JSXElement') ancestros.push(nombreJsx(q.node));
            const linea = `${archivo}:${p.node.loc.start.line}`;
            if (CAMPOS.has(nombre) && !(componenteDeCampo && nombre === 'TextInput') && !ancestros.includes('HojaConTeclado') && !enRenderDeHoja(p)) malas.push(`${linea} ${nombre} fuera de HojaConTeclado`);
            if (CAMPOS.has(nombre) && ancestros.includes('Modal')) malas.push(`${linea} ${nombre} dentro de un Modal`);
            if ((nombre === 'HojaConTeclado' || nombre === 'EtiquetasGestionHoja') && ancestros.includes('Modal')) malas.push(`${linea} ${nombre} dentro de un Modal`);
        },
    });
    return malas;
}
const malasTeclado = ARCHIVOS_TECLADO.flatMap((f) => revisarTeclado(leer(f), f));
const ROOT = (/function Root\(\) \{[\s\S]*?\n\}/.exec(APPB) || [''])[0];
// (sinComentarios deja el comentario JSX como "{}")
const raizOk = /\{ready \? <AppContent \/> : null\}\s*(\{\s*(\/\*[^*]*\*\/)?\s*\}\s*)?<HojasHost \/>\s*<\/View>/.test(ROOT)
    && /export default function HojaConTeclado[\s\S]*?\n    return null;\n\}/.test(HCT);
check(`formularios del módulo: todo campo dentro de HojaConTeclado, ningún Modal con campos ni hojas (${ARCHIVOS_TECLADO.length} archivos); la hoja se dibuja en HojasHost, último hijo de la View raíz de App.js (HojaConTeclado no dibuja en su lugar)`, malasTeclado.length === 0 && raizOk, malasTeclado.join(' | ') || (raizOk ? '' : 'HojasHost no es el último hijo de Root o HojaConTeclado dibuja en su lugar'));
const sembrado = `function P() { return (
    <SafeAreaView>
        <TextInput value="a" />
        <Modal visible><HojaConTeclado visible><TextInput /></HojaConTeclado></Modal>
        <View><HojaConTeclado visible><Text>x</Text></HojaConTeclado></View>
        <EtiquetasCampo />
    </SafeAreaView>); }`;
const negativasTeclado = revisarTeclado(sembrado, 'control');
check('control negativo: el revisor encuentra las 4 violaciones sembradas (campo fuera, campo y hoja dentro de un Modal, EtiquetasCampo fuera; una hoja dentro de otra View ya no es violación)', negativasTeclado.length === 4, negativasTeclado.join(' | '));
// 1.4.4 (D1): ninguna hoja tiene un alto fijo o en porcentaje en su tarjeta (el hijo directo de
// HojaConTeclado) ni en su ScrollDeHoja / ListaDeHoja: el máximo lo pone HojaConTeclado (alturaHoja).
function revisarAltos(codigo, archivo) {
    const malas = [];
    const ast = parse(codigo, { sourceType: 'module', plugins: ['jsx'] });
    const estilos = new Map(); // nombre de estilo → claves de su objeto
    traverse(ast, {
        ObjectProperty(p) {
            if (p.node.key && p.node.key.type === 'Identifier' && p.node.value.type === 'ObjectExpression') {
                estilos.set(p.node.key.name, p.node.value.properties.filter((q) => q.key).map((q) => q.key.name || q.key.value));
            }
        },
    });
    const clavesDe = (expr) => {
        if (!expr) return [];
        if (expr.type === 'ArrayExpression') return expr.elements.flatMap(clavesDe);
        if (expr.type === 'ObjectExpression') return expr.properties.filter((q) => q.key).map((q) => q.key.name || q.key.value);
        if (expr.type === 'MemberExpression' && expr.object.name === 'styles' && expr.property.name) return estilos.get(expr.property.name) || [];
        if (expr.type === 'LogicalExpression') return clavesDe(expr.right);
        return [];
    };
    const revisar = (el, que) => {
        const s = el.openingElement.attributes.find((a) => a.name && a.name.name === 'style');
        const claves = s && s.value && s.value.expression ? clavesDe(s.value.expression) : [];
        const malas2 = claves.filter((k) => k === 'height' || k === 'maxHeight');
        if (malas2.length) malas.push(`${archivo}:${el.loc.start.line} ${que} con ${malas2.join('/')}`);
    };
    traverse(ast, {
        JSXElement(p) {
            const n = nombreJsx(p.node);
            if (n === 'ScrollDeHoja' || n === 'ListaDeHoja') revisar(p.node, n);
            if (n === 'HojaConTeclado') for (const c of p.node.children) if (c.type === 'JSXElement') revisar(c, 'tarjeta de la hoja');
        },
    });
    return malas;
}
const malasAltos = ARCHIVOS_TECLADO.flatMap((f) => revisarAltos(leer(f), f));
check(`ninguna hoja con alto fijo o en porcentaje en su tarjeta ni en su lista (${ARCHIVOS_TECLADO.length} archivos)`, malasAltos.length === 0, malasAltos.join(' | '));
const sembradoAltos = `const styles = { tarjeta: { padding: 20, maxHeight: '85%' }, lista: { height: 300 } };
function P() { return (<HojaConTeclado visible><View style={[styles.tarjeta]}><ScrollDeHoja style={{ maxHeight: 400 }} /><ListaDeHoja style={styles.lista} /></View></HojaConTeclado>); }`;
const negativasAltos = revisarAltos(sembradoAltos, 'control');
check('control negativo: el revisor de altos encuentra las 3 violaciones sembradas (tarjeta en porcentaje, ScrollDeHoja de 400, ListaDeHoja de 300)', negativasAltos.length === 3, negativasAltos.join(' | '));

console.log(`\n${fallas === 0 ? 'TEMA' : 'TEMA CON FALLAS'}: ${oks} OK, ${fallas} FALLA.`);
process.exit(fallas === 0 ? 0 : 1);
