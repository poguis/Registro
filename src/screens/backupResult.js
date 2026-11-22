import { backupResultAlert, shareBackup } from '../services/backup';
import { okSheet } from '../contexts/SheetContext';

// Aviso final del respaldo, común a HomeScreen y DatabaseErrorScreen (hoja inferior; `confirm` es
// el de useSheet de la pantalla). Si los archivos se crearon pero no se pudieron compartir,
// ofrece volver a abrir el menú de compartir (los archivos siguen guardados en el teléfono).
export const showBackupResult = async (confirm, summary, closingAdvice) => {
    const { title, message, canRetryShare } = backupResultAlert(summary, closingAdvice);
    const acciones = [{ clave: 'ok', texto: 'OK', variante: canRetryShare ? 'secundaria' : 'primaria' }];
    if (canRetryShare) acciones.unshift({ clave: 'compartir', texto: 'Compartir de nuevo', variante: 'primaria' });
    const clave = await confirm({ titulo: title, mensaje: message, acciones });
    if (clave === 'compartir') {
        shareBackup(summary.backup).catch((error) => {
            console.error('Error re-sharing backup:', error);
            okSheet(confirm, 'Error', `No se pudo compartir el respaldo.\n\n${error.message}`);
        });
    }
};
