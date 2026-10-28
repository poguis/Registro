// Mapeador SQLite → Postgres según docs/MAPEO-SYNC.md (prototipo de las reglas de la Fase 4).
// Lo usa scripts/probar-fase2.mjs para cargar BD reales en PGlite. No se empaqueta en la app.
// Devuelve valores en texto (o null) listos para parámetros de INSERT: Postgres los convierte
// al tipo de la columna destino.

// Tipos por columna (las comunes: id/user_id uuid; created_at/updated_at/deleted_at iso).
const COMMON = { id: 'uuid', user_id: 'uuid', created_at: 'iso', updated_at: 'iso', deleted_at: 'iso' };
export const COLUMNS = {
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
// Padres antes que hijos.
export const TABLES = Object.keys(COLUMNS);
export const columnsOf = (table) => ({ ...COMMON, ...COLUMNS[table] });

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class MappingError extends Error {}

// Redondeo a centavos idéntico a numeric(14,2) de Postgres: sobre la representación
// decimal más corta del número (la que envía JSON.stringify), con empates "alejándose
// de cero" y aritmética entera (BigInt). Nunca Math.round(x * 100): 1.005 * 100 = 100.4999…
export function toCents(value) {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
    if (!m) throw new MappingError(`monto no numérico: ${typeof value}`);
    const [, sign, intPart, fracPart = '', expPart = '0'] = m;
    let digits = intPart + fracPart;
    let scale = fracPart.length - Number(expPart); // valor = digits × 10^-scale
    if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
    let n = BigInt(digits);
    if (scale > 2) {
        const div = 10n ** BigInt(scale - 2);
        const q = n / div;
        n = (n % div) * 2n >= div ? q + 1n : q; // empate (resto = div/2) → se aleja de cero
    } else {
        n *= 10n ** BigInt(2 - scale);
    }
    return sign && n !== 0n ? -n : n;
}
export const centsToText = (cents) => {
    const neg = cents < 0n;
    const abs = (neg ? -cents : cents).toString().padStart(3, '0');
    return `${neg ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
};
export const roundMoney = (value) => centsToText(toCents(value));
// ¿Cambia el valor al redondear a 2 decimales?
export const changesWhenRounded = (value) => Number(roundMoney(value)) !== Number(value);

// days_of_week legado (array de días) → objeto, igual que getQuotasForDate en backlogUtils.js.
const legacyDaysToObject = (days, frequency) =>
    Object.fromEntries(DAYS.map((d) => [d, days.includes(d) ? (frequency || 0) : 0]));

export function mapValue(kind, value, row) {
    if (value === null || value === undefined) return null;
    switch (kind) {
        case 'uuid':
        case 'text':
            return String(value);
        case 'int':
            if (!Number.isInteger(value)) throw new MappingError('entero no válido');
            return String(value);
        case 'money':
            return roundMoney(value);
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
            if (Array.isArray(parsed)) return JSON.stringify(legacyDaysToObject(parsed, row.frequency));
            if (parsed && typeof parsed === 'object') return JSON.stringify(parsed);
            throw new MappingError('days_of_week con forma no válida');
        }
        case 'json_object': {
            const parsed = JSON.parse(value);
            // quotas en forma array no existe en los datos: se rechaza y se reporta, no se adivina.
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return JSON.stringify(parsed);
            throw new MappingError('JSON objeto esperado');
        }
        case 'json_array': {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return JSON.stringify(parsed);
            throw new MappingError('JSON array esperado');
        }
        default:
            throw new MappingError(`tipo desconocido: ${kind}`);
    }
}

// Fila SQLite → { columns, values } para INSERT en Postgres.
export function mapRow(table, row) {
    const cols = columnsOf(table);
    const columns = Object.keys(cols);
    return { columns, values: columns.map((c) => mapValue(cols[c], row[c], row)) };
}
