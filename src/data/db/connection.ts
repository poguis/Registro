import type { SQLiteDatabase } from 'expo-sqlite';
import { maybeFail } from '../../services/devFlags';

// Conexión de la app, cola de escrituras y transacciones, compartidas por todos
// los repositorios. db.js (init) abre la BD, corre las migraciones y registra la
// conexión aquí con setConnection.
//
// Reglas:
// - Toda mutación de dominio corre con `mutate` = cola serializada + transacción.
// - Una mutación encolada NUNCA llama a otra mutación encolada (bloquearía la cola):
//   para reutilizar lógica se llaman funciones de repositorio directamente.

export type Row = Record<string, any>;

let connection: SQLiteDatabase | null = null;

export const setConnection = (db: SQLiteDatabase | null) => {
    connection = db;
};

export const getConnection = (): SQLiteDatabase => {
    if (!connection) throw new Error('La base de datos no está inicializada');
    return connection;
};

// Estado de la transacción en curso (la cola garantiza que hay una sola a la vez).
// `touched` evita encolar dos veces el mismo registro en la outbox dentro de una operación.
type TxState = { touched: Set<string> };
let currentTx: TxState | null = null;
export const getCurrentTx = (): TxState => {
    if (!currentTx) throw new Error('Escritura de dominio fuera de una transacción');
    return currentTx;
};

let writeQueue: Promise<unknown> = Promise.resolve();

// Cola serializada: cada tarea espera a que termine la anterior.
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task);
    writeQueue = run.catch(() => undefined);
    return run;
}

// Transacción (withTransactionAsync, no exclusiva). Llamar solo dentro de `enqueue`.
// Con DEV_FAIL_TX (solo __DEV__) falla justo antes de confirmar, para probar el rollback.
export async function tx<T>(task: () => Promise<T>): Promise<T> {
    const db = getConnection();
    let result: T | undefined;
    currentTx = { touched: new Set() };
    try {
        await db.withTransactionAsync(async () => {
            result = await task();
            maybeFail('DEV_FAIL_TX', 'antes de confirmar la transacción');
        });
    } finally {
        currentTx = null;
    }
    return result as T;
}

// Mutación de dominio: cola + transacción.
export const mutate = <T>(task: () => Promise<T>): Promise<T> => enqueue(() => tx(task));
