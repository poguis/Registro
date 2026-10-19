// Banderas SOLO para pruebas de desarrollo. En un build release (__DEV__ = false)
// nunca tienen efecto, aunque queden en true por error.
// Para probar: cambiar a true, recargar la app en el emulador y volver a false al terminar.
export const DEV_FLAGS = {
    // Lanza un error a mitad de cada operación transaccional de db.js (criterio 7).
    DEV_FAIL_TX: false,
    // Lanza un error dentro de la migración, antes de fijar user_version (criterio del respaldo).
    DEV_FAIL_MIGRATION: false,
};

export const maybeFail = (flag, step) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && DEV_FLAGS[flag]) {
        throw new Error(`[DEV] Fallo simulado (${flag}) en: ${step}`);
    }
};
