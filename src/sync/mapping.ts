// Mapeo SQLite ↔ Postgres de las 15 tablas sincronizables (docs/MAPEO-SYNC.md).
// Único lugar con estas reglas: lo usan el motor de sync, los repositorios (redondeo de
// dinero) y los scripts de prueba. Sin dependencias de React ni de SQLite.

export type Kind =
    | 'uuid' | 'text' | 'int' | 'money' | 'iso' | 'date'
    | 'epoch_ms' | 'epoch_ms_or_zero' | 'days_of_week' | 'json_object' | 'json_array';

// Tipos por columna (las comunes: id/user_id uuid; created_at/updated_at/deleted_at iso).
const COMMON: Record<string, Kind> = { id: 'uuid', user_id: 'uuid', created_at: 'iso', updated_at: 'iso', deleted_at: 'iso' };
export const COLUMNS: Record<string, Record<string, Kind>> = {
    finance_contacts: { name: 'text' },
    finance_transactions: { contact_id: 'uuid', type: 'text', amount: 'money', description: 'text' },
    balance_history: { amount: 'money', category: 'text', description: 'text' },
    finance_categories: { name: 'text', icon: 'text' },
    services: { name: 'text', type: 'text', status: 'text', original_value: 'money', additional_value: 'money', total_value: 'money' },
    entertainment_categories: { name: 'text', type: 'text', start_date: 'date', days_of_week: 'days_of_week', frequency: 'int', series_count: 'int', description: 'text' },
    entertainment_pauses: { category_id: 'uuid', pause_start: 'date', pause_end: 'date' },
    entertainment_quotas_history: { category_id: 'uuid', quotas: 'json_object', start_date: 'date', end_date: 'date' },
    series: {
        category_id: 'uuid', name: 'text', description: 'text', status: 'text', current_season: 'int', current_episode: 'int',
        initial_season: 'int', initial_episode: 'int', total_seasons: 'int', sort_order: 'int', cycle_offset: 'int',
        interleave_offset: 'int', last_watched_at: 'epoch_ms_or_zero',
    },
    seasons: { series_id: 'uuid', season_number: 'int', episode_count: 'int' },
    watch_history: { series_id: 'uuid', season_number: 'int', episode_number: 'int', watched_at: 'epoch_ms' },
    reading_history: { series_id: 'uuid', season_number: 'int', episode_number: 'int', read_at: 'epoch_ms' },
    backlog: { type: 'text', title: 'text', status: 'text', year: 'int', format: 'text', start_year: 'int', end_year: 'int', franchise: 'text' },
    work_people: { name: 'text', start_date: 'date', cycle: 'json_array', sort_order: 'int' },
    cards: { name: 'text', type: 'text', cutoff_date: 'int', payment_due_date: 'int', limit_amount: 'money' },
};
// Orden de dependencias: padres antes que hijos (push, pull y primera subida).
export const TABLES = Object.keys(COLUMNS);
export const columnsOf = (table: string): Record<string, Kind> => ({ ...COMMON, ...COLUMNS[table] });

export const MONEY_COLUMNS: Record<string, string[]> = Object.fromEntries(
    TABLES.map((t) => [t, Object.entries(COLUMNS[t]).filter(([, k]) => k === 'money').map(([c]) => c)])
);

// FK (compuestas en Postgres: (col, user_id) → padre(id, user_id)).
export const PARENT_FKS: Record<string, { column: string; parent: string }[]> = {
    finance_transactions: [{ column: 'contact_id', parent: 'finance_contacts' }],
    entertainment_pauses: [{ column: 'category_id', parent: 'entertainment_categories' }],
    entertainment_quotas_history: [{ column: 'category_id', parent: 'entertainment_categories' }],
    series: [{ column: 'category_id', parent: 'entertainment_categories' }],
    seasons: [{ column: 'series_id', parent: 'series' }],
    watch_history: [{ column: 'series_id', parent: 'series' }],
    reading_history: [{ column: 'series_id', parent: 'series' }],
};

// Claves naturales (UNIQUE en SQLite y en Postgres). Nada referencia estas filas por id
// (balance_history guarda la categoría como texto; los historiales usan series_id +
// season_number), así que su id se puede reemplazar al fusionar.
export const NATURAL_KEYS: Record<string, string[]> = {
    finance_categories: ['user_id', 'name'],
    seasons: ['series_id', 'season_number'],
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class MappingError extends Error {}

// ---------------------------------------------------------------- Dinero
// Redondeo a centavos idéntico a numeric(14,2) de Postgres: sobre la representación
// decimal más corta del número (la que envía JSON.stringify), empates alejándose de cero,
// con aritmética entera (BigInt). Nunca Math.round(x * 100): 1.005 * 100 = 100.4999…
export function toCents(value: number | string): bigint {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
    if (!m) throw new MappingError('monto no numérico');
    const [, sign, intPart, fracPart = '', expPart = '0'] = m;
    let digits = intPart + fracPart;
    let scale = fracPart.length - Number(expPart); // valor = digits × 10^-scale
    if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
    let n = BigInt(digits);
    if (scale > 2) {
        const div = 10n ** BigInt(scale - 2);
        const q = n / div;
        n = (n % div) * 2n >= div ? q + 1n : q; // empate → se aleja de cero
    } else {
        n *= 10n ** BigInt(2 - scale);
    }
    return sign && n !== 0n ? -n : n;
}
export const centsToText = (cents: bigint): string => {
    const neg = cents < 0n;
    const abs = (neg ? -cents : cents).toString().padStart(3, '0');
    return `${neg ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
};
export const roundMoney = (value: number | string): string => centsToText(toCents(value));
export const roundMoneyNumber = (value: number): number => Number(roundMoney(value));
export const changesWhenRounded = (value: number): boolean => roundMoneyNumber(value) !== Number(value);

// Redondea las columnas de dinero de una fila local antes de escribirla (repositorios).
export function roundMoneyColumns<T extends Record<string, any>>(table: string, values: T): T {
    const cols = MONEY_COLUMNS[table];
    if (!cols || cols.length === 0) return values;
    const out: Record<string, any> = { ...values };
    for (const c of cols) {
        if (typeof out[c] === 'number' && Number.isFinite(out[c])) out[c] = roundMoneyNumber(out[c]);
    }
    return out as T;
}

// ---------------------------------------------------------------- SQLite → Postgres
// days_of_week legado (array de días) → objeto, igual que getQuotasForDate en backlogUtils.js.
const legacyDaysToObject = (days: string[], frequency: number) =>
    Object.fromEntries(DAYS.map((d) => [d, days.includes(d) ? (frequency || 0) : 0]));

// Valor para el cuerpo JSON del upsert (PostgREST lo convierte al tipo de la columna).
export function toRemoteValue(kind: Kind, value: any, row: Record<string, any>): any {
    if (value === null || value === undefined) return null;
    switch (kind) {
        case 'uuid':
        case 'text':
            return String(value);
        case 'int':
            if (!Number.isInteger(value)) throw new MappingError('entero no válido');
            return value;
        case 'money':
            return roundMoney(value); // texto exacto: "11.99"
        case 'iso':
            if (!ISO_RE.test(value)) throw new MappingError('timestamp de sync no ISO');
            return value;
        case 'date':
            if (!DATE_RE.test(value)) throw new MappingError('fecha no YYYY-MM-DD');
            return value;
        case 'epoch_ms':
        case 'epoch_ms_or_zero':
            if (!Number.isInteger(value)) throw new MappingError('epoch no entero');
            if (value === 0) {
                if (kind === 'epoch_ms_or_zero') return null; // 0 = nunca
                throw new MappingError('epoch 0 en columna obligatoria');
            }
            return new Date(value).toISOString();
        case 'days_of_week': {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return legacyDaysToObject(parsed, row.frequency);
            if (parsed && typeof parsed === 'object') return parsed;
            throw new MappingError('days_of_week con forma no válida');
        }
        case 'json_object': {
            const parsed = JSON.parse(value);
            // quotas en forma array: se rechaza y se reporta (su significado depende del tipo de categoría).
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            throw new MappingError('JSON objeto esperado');
        }
        case 'json_array': {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed;
            throw new MappingError('JSON array esperado');
        }
        default:
            throw new MappingError(`tipo desconocido: ${kind}`);
    }
}

// Fila local → objeto para el upsert (sin server_updated_at: lo asigna el trigger).
export function toRemote(table: string, row: Record<string, any>): Record<string, any> {
    const cols = columnsOf(table);
    return Object.fromEntries(Object.keys(cols).map((c) => [c, toRemoteValue(cols[c], row[c], row)]));
}

// ---------------------------------------------------------------- Postgres → SQLite
// Fila del servidor (JSON de PostgREST) → valores locales. server_updated_at no se guarda.
export function fromRemoteValue(kind: Kind, value: any): any {
    if (value === null || value === undefined) {
        return kind === 'epoch_ms_or_zero' ? 0 : null; // NULL = nunca → 0 local
    }
    switch (kind) {
        case 'uuid':
        case 'text':
        case 'date':
            return String(value);
        case 'int':
            return Number(value);
        case 'money':
            return Number(value);
        case 'iso':
            return new Date(value).toISOString(); // µs → ms, siempre con Z
        case 'epoch_ms':
        case 'epoch_ms_or_zero':
            return Date.parse(value);
        case 'days_of_week':
        case 'json_object':
        case 'json_array':
            return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value);
        default:
            throw new MappingError(`tipo desconocido: ${kind}`);
    }
}

export function fromRemote(table: string, remote: Record<string, any>): Record<string, any> {
    const cols = columnsOf(table);
    return Object.fromEntries(Object.keys(cols).map((c) => [c, fromRemoteValue(cols[c], remote[c])]));
}

// ¿Los valores locales ya equivalen a los de la fila remota? (para no reescribir: la
// segunda sincronización no debe escribir nada). jsonb no conserva el orden de las
// claves: el JSON se compara normalizado.
const canonicalJson = (text: any): string => {
    if (text === null || text === undefined) return 'null';
    const sortDeep = (v: any): any => Array.isArray(v) ? v.map(sortDeep)
        : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v;
    try { return JSON.stringify(sortDeep(JSON.parse(text))); } catch { return String(text); }
};
export function sameAsLocal(table: string, local: Record<string, any>, remoteAsLocal: Record<string, any>): boolean {
    const cols = columnsOf(table);
    for (const [c, kind] of Object.entries(cols)) {
        const a = local[c] ?? null;
        const b = remoteAsLocal[c] ?? null;
        if (kind === 'days_of_week' || kind === 'json_object' || kind === 'json_array') {
            if (canonicalJson(a) !== canonicalJson(b)) return false;
        } else if (kind === 'money' || kind === 'int' || kind === 'epoch_ms' || kind === 'epoch_ms_or_zero') {
            if ((a === null) !== (b === null) || (a !== null && Number(a) !== Number(b))) return false;
        } else if (a !== b) {
            return false;
        }
    }
    return true;
}
