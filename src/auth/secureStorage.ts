import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import aesjs from 'aes-js';

// Storage cifrado para la sesión de Supabase. Patrón `LargeSecureStore` de la guía oficial
// "Build a User Management App with Expo React Native" (supabase.com/docs/guides/getting-started/
// tutorials/with-expo-react-native): SecureStore (Android Keystore) no admite valores grandes,
// así que ahí solo va la llave AES-256 y la sesión va cifrada (AES-CTR) en AsyncStorage.
//   - En cada setItem se genera una llave NUEVA de 256 bits (expo-crypto.getRandomBytes): con
//     llave única por valor, el contador fijo de CTR no se reutiliza.
//   - Protege la confidencialidad (no la integridad), igual que el patrón oficial.
//   - Auto Backup de Android: el config plugin de expo-secure-store excluye SecureStore del
//     respaldo (configureAndroidBackup: true, docs de expo-secure-store), pero AsyncStorage sí se
//     respalda. Tras restaurar en otro equipo queda el cifrado sin llave: se trata como "sin
//     sesión" y se borra el residuo.

const toHex = (bytes: Uint8Array) => aesjs.utils.hex.fromBytes(bytes);
const fromHex = (hex: string) => aesjs.utils.hex.toBytes(hex);

export function encrypt(value: string, key: Uint8Array): string {
    const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(1));
    return toHex(cipher.encrypt(aesjs.utils.utf8.toBytes(value)));
}

export function decrypt(hex: string, key: Uint8Array): string {
    const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(fromHex(hex)));
}

// SecureStore solo acepta claves con letras, dígitos, '.', '-' y '_'.
const secureKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const LargeSecureStore = {
    async getItem(key: string): Promise<string | null> {
        const hex = await AsyncStorage.getItem(key);
        if (!hex) return null;
        const keyHex = await SecureStore.getItemAsync(secureKey(key));
        if (!keyHex) {
            // Cifrado sin llave (p. ej., restaurado por Auto Backup): no hay sesión.
            await AsyncStorage.removeItem(key);
            return null;
        }
        try {
            return decrypt(hex, fromHex(keyHex));
        } catch {
            return null;
        }
    },
    async setItem(key: string, value: string): Promise<void> {
        const k = Crypto.getRandomBytes(32);
        const hex = encrypt(value, k);
        await SecureStore.setItemAsync(secureKey(key), toHex(k));
        await AsyncStorage.setItem(key, hex);
    },
    async removeItem(key: string): Promise<void> {
        await AsyncStorage.removeItem(key);
        await SecureStore.deleteItemAsync(secureKey(key));
    },
};
