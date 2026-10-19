import { Alert } from 'react-native';
import { backupResultAlert, shareBackup } from '../services/backup';

// Aviso final del respaldo, común a HomeScreen y DatabaseErrorScreen.
// Si los archivos se crearon pero no se pudieron compartir, ofrece volver a abrir
// el menú de compartir (los archivos siguen guardados en el teléfono).
export const showBackupResult = (summary, closingAdvice) => {
    const { title, message, canRetryShare } = backupResultAlert(summary, closingAdvice);
    const buttons = [{ text: 'OK' }];
    if (canRetryShare) {
        buttons.unshift({
            text: 'Compartir de nuevo',
            onPress: () => shareBackup(summary.backup).catch((error) => {
                console.error('Error re-sharing backup:', error);
                Alert.alert('Error', `No se pudo compartir el respaldo.\n\n${error.message}`);
            }),
        });
    }
    Alert.alert(title, message, buttons);
};
