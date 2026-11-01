import * as Crypto from 'expo-crypto';

// supabase-js (auth-js, lib/helpers.js) genera el verificador PKCE con
// crypto.getRandomValues y el reto con crypto.subtle.digest('SHA-256'). En React Native
// (Hermes) no existe `crypto` global: auth-js caería a Math.random() para el verificador
// y a code_challenge_method 'plain'. Este shim mínimo los provee con expo-crypto
// (getRandomValues y digest, ambos nativos) para que el flujo use S256.
// Se instala ANTES de crear el cliente (ver supabase.ts). No reemplaza nada existente.

type Shim = {
    getRandomValues: typeof Crypto.getRandomValues;
    subtle: { digest: (algorithm: string | { name: string }, data: BufferSource) => Promise<ArrayBuffer> };
};

export function installCryptoShim(): void {
    const g = globalThis as unknown as { crypto?: Partial<Shim> };
    if (!g.crypto) g.crypto = {};
    const c = g.crypto;
    if (typeof c.getRandomValues !== 'function') {
        c.getRandomValues = Crypto.getRandomValues;
    }
    if (!c.subtle || typeof c.subtle.digest !== 'function') {
        c.subtle = {
            digest: async (algorithm, data) => {
                const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
                if (name.toUpperCase() !== 'SHA-256') throw new Error(`digest no soportado: ${name}`);
                return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as any);
            },
        };
    }
}
