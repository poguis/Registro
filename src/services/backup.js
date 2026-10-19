import * as SQLite from 'expo-sqlite';
import { File, Directory } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import appConfig from '../../app.json';
import { DB_NAME } from './dbConfig';

// Respaldo de la base de datos. Es SOLO LECTURA sobre la BD:
// abre su propia conexión (no pasa por db.init() ni por las migraciones),
// así que funciona aunque la migración haya fallado.
// Genera dos archivos con la misma marca de tiempo:
//   - copia física (.db) con VACUUM INTO: conserva todo, incluidas las contraseñas;
//   - JSON con todas las tablas y metadatos: users.password va reemplazado por un marcador.

export const PASSWORD_PLACEHOLDER = '[OCULTO]';
const BACKUP_FORMAT = 'registro-respaldo';
const BACKUP_FORMAT_VERSION = 1;

const pad = (n) => String(n).padStart(2, '0');

// Marca de tiempo local legible para el nombre del archivo: YYYYMMDD-HHmmss
const fileStamp = (date = new Date()) =>
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

const dirname = (path) => path.substring(0, path.lastIndexOf('/'));
const toFileUri = (path) => (path.startsWith('file://') ? path : `file://${path}`);
const quoteSqlString = (value) => `'${value.replace(/'/g, "''")}'`;

// Conexión propia, separada de la de db.js.
const openBackupConnection = () => SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true });

const ensureBackupDir = (databasePath) => {
    const dirPath = `${dirname(databasePath)}/respaldos`;
    const dir = new Directory(toFileUri(dirPath));
    if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
    }
    return dirPath;
};

const withConnection = async (task) => {
    const conn = await openBackupConnection();
    try {
        return await task(conn);
    } finally {
        await conn.closeAsync();
    }
};

// Copia física con VACUUM INTO hacia una ruta absoluta junto a la BD.
export async function createPhysicalCopy(label = 'respaldo', stamp = fileStamp()) {
    return withConnection(async (conn) => {
        const dirPath = ensureBackupDir(conn.databasePath);
        const path = `${dirPath}/registro_${label}_${stamp}.db`;
        await conn.execAsync(`VACUUM INTO ${quoteSqlString(path)}`);
        const file = new File(toFileUri(path));
        if (!file.exists || file.size === 0) {
            throw new Error('La copia física no se creó o quedó vacía');
        }
        return { path, uri: file.uri, size: file.size };
    });
}

// JSON con todas las tablas y un bloque de metadatos.
export async function createJsonBackup(stamp = fileStamp()) {
    return withConnection(async (conn) => {
        const versionRow = await conn.getFirstAsync('SELECT sqlite_version() AS v');
        const userVersionRow = await conn.getFirstAsync('PRAGMA user_version');
        const tables = await conn.getAllAsync(
            `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
        );
        const indexes = await conn.getAllAsync(
            `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`
        );

        const data = {};
        const counts = {};
        for (const { name } of tables) {
            let rows = await conn.getAllAsync(`SELECT * FROM "${name}"`);
            if (name === 'users') {
                rows = rows.map((row) => ({ ...row, password: PASSWORD_PLACEHOLDER }));
            }
            data[name] = rows;
            counts[name] = rows.length;
        }

        const meta = {
            format: BACKUP_FORMAT,
            formatVersion: BACKUP_FORMAT_VERSION,
            createdAt: new Date().toISOString(),
            appVersion: appConfig.expo.version,
            databaseFile: DB_NAME,
            sqliteVersion: versionRow ? versionRow.v : null,
            userVersion: userVersionRow ? userVersionRow.user_version : null,
            passwordsReplacedWith: PASSWORD_PLACEHOLDER,
            counts,
            schema: tables,
            indexes,
        };

        const dirPath = ensureBackupDir(conn.databasePath);
        const path = `${dirPath}/registro_respaldo_${stamp}.json`;
        const file = new File(toFileUri(path));
        file.create();
        file.write(JSON.stringify({ meta, data }));
        return { path, uri: file.uri, size: file.size, meta };
    });
}

// Genera ambos archivos con la misma marca de tiempo.
export async function createBackup() {
    const stamp = fileStamp();
    const physical = await createPhysicalCopy('respaldo', stamp);
    const json = await createJsonBackup(stamp);
    return { stamp, physical, json };
}

// Abre el menú de compartir de Android para sacar cada archivo del teléfono
// (Drive, correo, Archivos...). expo-sharing comparte un archivo por llamada.
export async function shareBackup(backup) {
    if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Este dispositivo no permite compartir archivos');
    }
    await shareWhenFree(backup.physical.uri, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Guardar copia de la base de datos (.db)',
    });
    await shareWhenFree(backup.json.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Guardar respaldo en JSON',
    });
}

// En Android, al cerrar un menú de compartir la promesa puede resolverse antes de que
// expo-sharing libere su estado interno, y la siguiente llamada falla con
// "Another share request is being processed". Se reintenta unos segundos.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function shareWhenFree(uri, options, attempts = 20) {
    for (let i = 1; ; i++) {
        try {
            return await Sharing.shareAsync(uri, options);
        } catch (error) {
            const busy = String(error && error.message).includes('Another share request');
            if (!busy || i >= attempts) throw error;
            await sleep(300);
        }
    }
}

// Flujo completo para la UI: genera los dos archivos y abre el menú de compartir.
// Si falla la GENERACIÓN, lanza el error. Si los archivos se crearon pero falla el
// COMPARTIR, no lanza: devuelve shareError para que la UI ofrezca compartir de nuevo.
// Devuelve un resumen (sin datos personales) para mostrar al usuario.
export async function backupAndShare() {
    const backup = await createBackup();
    const totalRows = Object.values(backup.json.meta.counts).reduce((acc, n) => acc + n, 0);
    let shareError = null;
    try {
        await shareBackup(backup);
    } catch (error) {
        console.error('Error sharing backup:', error);
        shareError = error.message;
    }
    return {
        backup,
        shareError,
        stamp: backup.stamp,
        tables: Object.keys(backup.json.meta.counts).length,
        totalRows,
        dbFile: backup.physical.path.split('/').pop(),
        jsonFile: backup.json.path.split('/').pop(),
    };
}

// Texto y botones del aviso final, comunes a HomeScreen y DatabaseErrorScreen.
export function backupResultAlert(summary, closingAdvice) {
    const files = `${summary.dbFile}
${summary.jsonFile}`;
    if (!summary.shareError) {
        return {
            title: 'Respaldo listo',
            message: `Se generaron 2 archivos (${summary.tables} tablas, ${summary.totalRows} filas):
${files}

${closingAdvice}`,
            canRetryShare: false,
        };
    }
    return {
        title: 'Respaldo creado, falta compartirlo',
        message: `Los 2 archivos se generaron (${summary.tables} tablas, ${summary.totalRows} filas), pero no se pudieron compartir:
${summary.shareError}

${files}`,
        canRetryShare: true,
    };
}
