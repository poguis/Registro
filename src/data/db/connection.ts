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

// Aviso tras confirmar una transacción que encoló algo en la outbox (lo usa la sync automática,
// src/sync/controller.ts). El motor de sync escribe la outbox fuera de tx(), así que no lo dispara.
let outboxCommitListener: (() => void) | null = null;
export const setOutboxCommitListener = (fn: (() => void) | null) => {
    outboxCommitListener = fn;
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
// `silent` (Fase 7.5): no avisa al listener de la outbox. Lo usa la reconciliación que corre la
// propia sync al terminar el pull (sube lo que encola en el mismo ciclo), así no dispara otro ciclo.
export async function tx<T>(task: () => Promise<T>, opts: { silent?: boolean } = {}): Promise<T> {
    const db = getConnection();
    let result: T | undefined;
    const state: TxState = { touched: new Set() };
    currentTx = state;
    try {
        await db.withTransactionAsync(async () => {
            result = await task();
            maybeFail('DEV_FAIL_TX', 'antes de confirmar la transacción');
        });
    } finally {
        currentTx = null;
    }
    if (state.touched.size > 0 && outboxCommitListener && !opts.silent) {
        try { outboxCommitListener(); } catch { /* la sync nunca rompe una escritura */ }
    }
    return result as T;
}

// Mutación de dominio: cola + transacción.
export const mutate = <T>(task: () => Promise<T>): Promise<T> => enqueue(() => tx(task));

// Mutación que lanza la propia sync (Fase 7.5): igual que `mutate` (cola + transacción + outbox),
// pero sin avisar al listener de la outbox, porque el motor sube lo encolado en el mismo ciclo.
export const mutateFromSync = <T>(task: () => Promise<T>): Promise<T> => enqueue(() => tx(task, { silent: true }));
