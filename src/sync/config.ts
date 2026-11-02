import Constants from 'expo-constants';

// Configuración de la sincronización. `enabled` viene de app.config.js (extra.syncEnabled):
// false en producción hasta la Fase 5, true solo en la variante dev. Las pruebas en PC pasan
// su propia configuración al motor.
export type SyncConfig = {
    enabled: boolean;
    pageSize: number; // filas por página del pull
    batchSize: number; // filas por upsert del push
    // Ventana de solapamiento del pull: el rol authenticated tiene statement_timeout de 8 s en
    // Supabase y cada petición de PostgREST es una transacción, así que ningún commit llega más
    // de ~8 s fuera de orden; 60 s da 7× de margen (docs/MAPEO-SYNC.md).
    overlapMs: number;
    maxPushRounds: number; // rondas de push por ciclo (padres encolados por 23503, fusiones)
    changeDebounceMs: number; // antirrebote de la sync tras un cambio local (autoSync.ts)
    periodicMs: number; // intervalo de la sync periódica en primer plano (autoSync.ts)
};

export const DEFAULT_SYNC_CONFIG: Omit<SyncConfig, 'enabled'> = {
    pageSize: 500,
    batchSize: 100,
    overlapMs: 60_000,
    maxPushRounds: 5,
    changeDebounceMs: 3_000,
    periodicMs: 120_000,
};

export function getAppSyncConfig(): SyncConfig {
    return { ...DEFAULT_SYNC_CONFIG, enabled: Constants.expoConfig?.extra?.syncEnabled === true };
}
