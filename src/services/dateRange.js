// Conversión de rangos de días LOCALES a límites UTC para filtrar `created_at`.
// Funciones puras: sin React ni SQLite (se prueban con scripts/test-date-range.mjs).
//
// `created_at` lo escribe SQLite con CURRENT_TIMESTAMP: UTC en formato 'YYYY-MM-DD HH:MM:SS'.
// Este es el ÚNICO punto donde se convierte un día local a ese formato; si el formato
// de `created_at` cambia (Fase 1), solo se toca formatSqliteUtc.

const pad = (n) => String(n).padStart(2, '0');

// Date → 'YYYY-MM-DD HH:MM:SS' en UTC (mismo formato que CURRENT_TIMESTAMP).
export const formatSqliteUtc = (date) =>
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;

// Medianoche local del día de `date`.
const startOfLocalDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Rango [primer día, último día] (ambos incluidos, en hora local) → límites UTC.
// Inicio = 00:00:00 local del primer día; fin = 1 s antes de las 00:00 local del día
// siguiente al último (los `created_at` tienen precisión de segundos).
export const localDaysToUtcRange = (firstDay, lastDay) => {
    const start = startOfLocalDay(firstDay);
    const last = startOfLocalDay(lastDay);
    const endExclusive = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    const end = new Date(endExclusive.getTime() - 1000);
    return { startDate: formatSqliteUtc(start), endDate: formatSqliteUtc(end) };
};

// period: 'all' | 'today' | 'week' (lunes a domingo) | 'month' | 'year' | 'custom'
// customRange: { start: Date, end: Date } (solo para 'custom')
// Devuelve { startDate, endDate } en UTC, o nulls para 'all' / periodo desconocido.
export const getUtcRange = (period, now = new Date(), customRange = null) => {
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();

    switch (period) {
        case 'today':
            return localDaysToUtcRange(now, now);
        case 'week': {
            const day = now.getDay();
            const monday = new Date(y, m, d - day + (day === 0 ? -6 : 1));
            const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
            return localDaysToUtcRange(monday, sunday);
        }
        case 'month':
            return localDaysToUtcRange(new Date(y, m, 1), new Date(y, m + 1, 0));
        case 'year':
            return localDaysToUtcRange(new Date(y, 0, 1), new Date(y, 11, 31));
        case 'custom':
            if (!customRange || !customRange.start || !customRange.end) {
                return { startDate: null, endDate: null };
            }
            return localDaysToUtcRange(customRange.start, customRange.end);
        default:
            return { startDate: null, endDate: null };
    }
};
