// Stubs en memoria para cargar src/auth/ en Node (scripts/probar-fase3.mjs).
// Nunca se empaquetan en la app. Exponen su estado para que las pruebas lo inspeccionen.
import { webcrypto, randomUUID } from 'node:crypto';

export const asyncStore = new Map();
export const secureStore = new Map();

export const AsyncStorageStub = {
    getItem: async (k) => (asyncStore.has(k) ? asyncStore.get(k) : null),
    setItem: async (k, v) => { asyncStore.set(k, String(v)); },
    removeItem: async (k) => { asyncStore.delete(k); },
};

const SECURE_KEY_RE = /^[A-Za-z0-9._-]+$/;
export const SecureStoreStub = {
    getItemAsync: async (k) => { if (!SECURE_KEY_RE.test(k)) throw new Error('clave SecureStore inválida'); return secureStore.has(k) ? secureStore.get(k) : null; },
    setItemAsync: async (k, v) => { if (!SECURE_KEY_RE.test(k)) throw new Error('clave SecureStore inválida'); secureStore.set(k, String(v)); },
    deleteItemAsync: async (k) => { secureStore.delete(k); },
};

export const CryptoStub = {
    randomUUID: () => randomUUID(),
    getRandomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
    getRandomValues: (a) => webcrypto.getRandomValues(a),
    digest: async (_alg, data) => webcrypto.subtle.digest('SHA-256', data),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
};

// expo-constants: la prueba fija la configuración de la variante.
export const constantsState = { expoConfig: null };
