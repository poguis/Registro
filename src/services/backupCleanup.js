import * as SQLite from 'expo-sqlite';
import { File, Directory } from 'expo-file-system';
import { listBackupDirFiles } from './backup';
import { planRetention, isKnownBackupName, backupPairKey, stampOf } from './backupRetention';

// Limpieza de la carpeta respaldos/ (Fase 6.7). Decide con planRetention (función pura) y borra
// SOLO dentro de respaldos/. Nunca lanza: un fallo en un archivo no detiene a los demás ni rompe la
// app. Devuelve un resumen SIN nombres de archivo ni datos del usuario.
//
// Contraseña antigua (regla 3): se VERIFICA en el propio celular, solo en los archivos que la
// retención conservaría (los que se van a borrar no hace falta abrirlos):
//   - .json: se analiza y se buscan campos `password` con valor visible (no vacío ni "[OCULTO]");
//   - .db: se abre con expo-sqlite DIRECTAMENTE (no por la conexión ni las migraciones de la app),
//     se cuentan las contraseñas visibles en users/legacy_users y se cierra. expo-sqlite 16.0.10 no
//     tiene opción de solo lectura (SQLiteOpenOptions: enableChangeListener, useNewConnection,
//     finalizeUnusedStatementsBeforeClosing, libSQL*; en Android abre con sqlite3_open). Abrirlo es
//     seguro porque: (a) antes se lee la cabecera y solo se abre un archivo SQLite en modo diario
//     clásico (bytes 18/19 = 1; en WAL abrir crearía -wal/-shm); (b) solo se abre si no hay
//     -journal/-wal/-shm (sin diario caliente no hay recuperación que escriba); (c) solo se ejecutan
//     SELECT y PRAGMA de lectura, que no escriben; (d) después se comprueba que no aparecieron
//     archivos auxiliares y que el tamaño no cambió. Si aparece un auxiliar, se informa y ese .db
//     no se borra.
//   - Si un archivo no se puede verificar: si se pudo leer la cabecera, user_version <= 2 (antes de
//     la migración 3) cuenta como "con contraseña"; si no, cuenta así si su sello es anterior a
//     PASSWORD_CUTOFF_STAMP (la migración 3 del celular real, 2026-11-01 12:40:39 hora local).

export const PASSWORD_CUTOFF_STAMP = '20261101-124039';
const PLACEHOLDER = '[OCULTO]';
const AUX = ['-journal', '-wal', '-shm'];
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

const dirname = (path) => path.substring(0, path.lastIndexOf('/'));
const toFileUri = (path) => (path.startsWith('file://') ? path : `file://${path}`);
const stripUri = (p) => p.replace(/^file:\/\//, '');

function readHeader(file) {
    let handle = null;
    try {
        handle = file.open();
        const b = handle.readBytes(100);
        const magic = String.fromCharCode(...b.slice(0, 15));
        if (magic !== 'SQLite format 3') return null;
        const userVersion = ((b[60] << 24) | (b[61] << 16) | (b[62] << 8) | b[63]) >>> 0;
        return { rollback: b[18] === 1 && b[19] === 1, userVersion };
    } catch {
        return null;
    } finally {
        try { handle && handle.close(); } catch { /* nada */ }
    }
}

const auxPresent = (dirPath, name) => AUX.filter((s) => new File(toFileUri(`${dirPath}/${name}${s}`)).exists);

async function inspectDb(dirPath, name) {
    const file = new File(toFileUri(`${dirPath}/${name}`));
    if (auxPresent(dirPath, name).length) return { verified: false, header: null, aux: true };
    const header = readHeader(file);
    if (!header || !header.rollback) return { verified: false, header, aux: false };
    const sizeBefore = file.size;
    let conn = null;
    let visible = 0;
    try {
        conn = await SQLite.openDatabaseAsync(name, { useNewConnection: true }, dirPath);
        for (const t of ['users', 'legacy_users']) {
            const exists = await conn.getFirstAsync("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [t]);
            if (!exists) continue;
            const cols = (await conn.getAllAsync(`PRAGMA table_info(${t})`)).map((c) => c.name);
            if (!cols.includes('password')) continue;
            const r = await conn.getFirstAsync(`SELECT COUNT(*) AS n FROM ${t} WHERE password IS NOT NULL AND password <> '' AND password <> ?`, [PLACEHOLDER]);
            visible += r ? r.n : 0;
        }
    } catch {
        return { verified: false, header, aux: auxPresent(dirPath, name).length > 0 };
    } finally {
        try { if (conn) await conn.closeAsync(); } catch { /* nada */ }
    }
    const changed = auxPresent(dirPath, name).length > 0 || new File(toFileUri(`${dirPath}/${name}`)).size !== sizeBefore;
    return { verified: true, password: visible > 0, header, aux: changed };
}

async function inspectJson(dirPath, name) {
    try {
        const text = await new File(toFileUri(`${dirPath}/${name}`)).text();
        const json = JSON.parse(text);
        let visible = 0;
        for (const rows of Object.values((json && json.data) || {})) {
            for (const r of rows || []) {
                if (r && typeof r === 'object' && 'password' in r && r.password !== null && r.password !== '' && r.password !== PLACEHOLDER) visible++;
            }
        }
        return { verified: true, password: visible > 0, header: null, aux: false };
    } catch {
        return { verified: false, header: null, aux: false };
    }
}

// Sin verificación: cabecera (user_version <= 2) o, si no hay cabecera, la fecha del nombre.
const fallbackHasPassword = (name, header) => {
    if (header && typeof header.userVersion === 'number') return header.userVersion <= 2;
    const stamp = stampOf(name);
    return !!stamp && stamp < PASSWORD_CUTOFF_STAMP;
};

// Ruta segura para borrar: nombre reconocido, sin separadores ni "..", dentro de respaldos/ y
// distinta de la BD principal.
export function safeBackupPath(dirPath, databasePath, name) {
    if (typeof name !== 'string' || !SAFE_NAME.test(name) || name.includes('..') || !isKnownBackupName(name)) return null;
    const dir = stripUri(dirPath).replace(/\/+$/, '');
    if (!dir.endsWith('/respaldos')) return null;
    const full = `${dir}/${name}`;
    if (full === stripUri(databasePath)) return null;
    if (dirname(full) !== dir) return null;
    return full;
}

// ¿Existe la carpeta respaldos/ junto a la BD? (sin ella no hay nada que limpiar).
export function hasBackupDir(databasePath) {
    try {
        return !!databasePath && new Directory(toFileUri(`${dirname(stripUri(databasePath))}/respaldos`)).exists;
    } catch {
        return false;
    }
}

export async function cleanupBackupDir({ databasePath, keepBackups = 10, protectKeys = [] } = {}) {
    const summary = { deleted: 0, deletedBytes: 0, kept: 0, unknown: 0, failed: 0, verified: 0, unverified: 0, withPassword: 0, auxFiles: 0 };
    try {
        if (!databasePath) return summary;
        const dirPath = `${dirname(stripUri(databasePath))}/respaldos`;
        const dir = new Directory(toFileUri(dirPath));
        if (!dir.exists) return summary;
        const files = listBackupDirFiles(stripUri(databasePath));
        const passwordFiles = new Set();
        const checked = new Set();
        const blocked = new Set(); // .db con auxiliares: nunca se borran
        // Verifica lo que se conservaría; si aparece una contraseña, el plan cambia y se verifica lo nuevo.
        for (let round = 0; round < 20; round++) {
            const plan = planRetention(files, { keepBackups, passwordFiles, protectKeys });
            const pending = plan.keep.filter((f) => !checked.has(f.name));
            if (!pending.length) break;
            for (const f of pending) {
                checked.add(f.name);
                const r = f.name.endsWith('.json') ? await inspectJson(dirPath, f.name) : await inspectDb(dirPath, f.name);
                if (r.verified) summary.verified++; else summary.unverified++;
                if (r.aux) { blocked.add(f.name); summary.auxFiles++; }
                const has = r.verified ? r.password : fallbackHasPassword(f.name, r.header);
                if (has) { passwordFiles.add(f.name); summary.withPassword++; }
            }
        }
        // Un respaldo protegido (el recién creado) nunca entra en la lista de contraseñas.
        const protect = new Set(protectKeys);
        for (const name of [...passwordFiles]) if (protect.has(backupPairKey(name))) passwordFiles.delete(name);
        const plan = planRetention(files, { keepBackups, passwordFiles, protectKeys });
        summary.unknown = plan.unknown.length;
        summary.kept = plan.keep.length + plan.unknown.length;
        for (const f of plan.remove) {
            const path = safeBackupPath(dirPath, databasePath, f.name);
            if (!path || blocked.has(f.name) || protect.has(backupPairKey(f.name))) { summary.kept++; continue; }
            try {
                const file = new File(toFileUri(path));
                if (!file.exists) continue;
                const size = file.size;
                file.delete();
                summary.deleted++;
                summary.deletedBytes += size;
            } catch {
                summary.failed++;
            }
        }
    } catch {
        summary.failed++;
    }
    return summary;
}
