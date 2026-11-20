// Historial de ritmo (Fase 7.4b). Motor puro: sin React, SQLite, Alert ni db, y sin reloj (`today`
// entra como parámetro, 'YYYY-MM-DD' local). Devuelve las acciones que el repositorio ejecuta en
// la misma transacción (rows.ts → outbox).
//
// Reglas (claude/DISENO-ENTRETENIMIENTO.md, Cuotas y cambios de ritmo):
// - Ritmo = cuotas por día (video y lectura) + frecuencia (solo lectura). Nombre, descripción,
//   tipo y límite no crean períodos.
// - Todo cambio de ritmo rige DESDE MAÑANA y nunca recalcula el pasado: el período vigente cierra
//   con end_date = hoy y se abre uno nuevo desde mañana.
// - R10: si ya hay un período que empieza mañana (o después), se actualiza en su lugar; si con eso
//   queda igual al anterior, se borra y se reabre el anterior. Nunca queda fin < inicio.
// - R11: la comparación es por contenido (cuotas normalizadas a los 7 días, sin depender del orden
//   de las claves, más la frecuencia en lectura). Sin cambios → ninguna acción.
// - Un período de lectura con frequency NULL (de antes de la 7.4b) usa la frecuencia de la
//   categoría; al cerrarlo se congela con ese valor, para que un cambio posterior no lo recalcule.

type Row = Record<string, any>;

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export type Rhythm = { quotas: Record<string, number>; frequency: number | null };
export type RhythmAction =
    | { kind: 'update'; id: string; values: Row }
    | { kind: 'insert'; values: Row }
    | { kind: 'delete'; id: string };

// 'YYYY-MM-DD' ± n días, en hora local (sin UTC).
export function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + n, 12, 0, 0, 0);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${mm}-${dd}`;
}

// Cuotas normalizadas: los 7 días, como número (las claves que faltan valen 0). El array legado
// de días toma `legacyValue` en los días listados, como getQuotasForDate.
export function normalizeQuotas(value: any, legacyValue = 0): Record<string, number> {
    let parsed = value;
    if (typeof value === 'string') {
        try { parsed = JSON.parse(value); } catch { parsed = null; }
    }
    const out: Record<string, number> = {};
    for (const day of DAYS) {
        const v = Array.isArray(parsed) ? (parsed.includes(day) ? legacyValue : 0) : parsed && typeof parsed === 'object' ? parsed[day] : 0;
        const n = Number(v);
        out[day] = Number.isFinite(n) ? n : 0;
    }
    return out;
}

// Frecuencia efectiva de un período: la suya o, si es NULL, la de la categoría (solo lectura).
export function effectiveFrequency(period: Row, category: Row): number | null {
    if (category.type !== 'reading') return null;
    const own = period ? period.frequency : null;
    if (own !== null && own !== undefined) return Number(own);
    const cat = category.frequency;
    return cat === null || cat === undefined ? null : Number(cat);
}

const rhythmOf = (period: Row, category: Row): Rhythm => ({
    quotas: normalizeQuotas(period.quotas, Number(category.frequency) || 0),
    frequency: effectiveFrequency(period, category),
});

// R11: mismo ritmo por contenido (la frecuencia cuenta solo en lectura).
export function sameRhythm(a: Rhythm, b: Rhythm, type: string): boolean {
    if (DAYS.some((d) => (a.quotas[d] || 0) !== (b.quotas[d] || 0))) return false;
    if (type === 'reading' && (a.frequency ?? null) !== (b.frequency ?? null)) return false;
    return true;
}

const byStart = (periods: Row[]) => [...periods].sort((x, y) => (x.start_date < y.start_date ? -1 : x.start_date > y.start_date ? 1 : 0));
const covers = (p: Row, date: string) => p.start_date <= date && (!p.end_date || p.end_date >= date);

// Cambio de ritmo al guardar la categoría. `periods`: los períodos VIVOS de la categoría;
// `category`: la fila guardada ANTES del cambio (type, frequency, days_of_week, start_date);
// `next`: { quotas, frequency } del formulario.
export function planRhythmChange(args: { periods: Row[]; category: Row; next: { quotas: any; frequency: any }; today: string }): RhythmAction[] {
    const { category, next, today } = args;
    const type = category.type;
    const tomorrow = addDays(today, 1);
    const periods = byStart(args.periods);
    const nextFrequency = type === 'reading' && next.frequency !== null && next.frequency !== undefined ? Number(next.frequency) : null;
    const nextRhythm: Rhythm = { quotas: normalizeQuotas(next.quotas), frequency: nextFrequency };
    const stored = { quotas: JSON.stringify(next.quotas), frequency: nextFrequency };

    // Sin períodos (no debería pasar: la categoría nace con uno): se conserva el ritmo anterior
    // hasta hoy y el nuevo rige desde mañana.
    if (periods.length === 0) {
        const start = category.start_date || today;
        const before: Rhythm = { quotas: normalizeQuotas(category.days_of_week, Number(category.frequency) || 0), frequency: effectiveFrequency({}, category) };
        if (sameRhythm(before, nextRhythm, type)) return [];
        if (start >= tomorrow) return [{ kind: 'insert', values: { ...stored, start_date: start, end_date: null } }];
        return [
            { kind: 'insert', values: { quotas: typeof category.days_of_week === 'string' ? category.days_of_week : JSON.stringify(category.days_of_week ?? {}), frequency: before.frequency, start_date: start, end_date: today } },
            { kind: 'insert', values: { ...stored, start_date: tomorrow, end_date: null } },
        ];
    }

    const target = periods.find((p) => covers(p, tomorrow))
        ?? [...periods].reverse().find((p) => !p.end_date)
        ?? periods[periods.length - 1];
    if (sameRhythm(rhythmOf(target, category), nextRhythm, type)) return [];

    if (target.start_date >= tomorrow) {
        // R10: otra edición de hoy (o una categoría que empieza en el futuro): se actualiza en su
        // lugar. Si así queda igual al período anterior (que termina el día antes), se deshace.
        const previous = periods.find((p) => p.end_date && p.end_date === addDays(target.start_date, -1));
        if (previous && sameRhythm(rhythmOf(previous, category), nextRhythm, type)) {
            return [{ kind: 'delete', id: target.id }, { kind: 'update', id: previous.id, values: { end_date: null } }];
        }
        return [{ kind: 'update', id: target.id, values: { ...stored } }];
    }

    // El período vigente cierra hoy (congelando su frecuencia NULL) y el nuevo rige desde mañana.
    const close: Row = { end_date: today };
    if (type === 'reading' && (target.frequency === null || target.frequency === undefined)) close.frequency = effectiveFrequency(target, category);
    return [
        { kind: 'update', id: target.id, values: close },
        { kind: 'insert', values: { ...stored, start_date: tomorrow, end_date: null } },
    ];
}

// Fecha de inicio editada SIN registros (decisión 5): el primer período se mueve con ella. Hacia
// atrás, el primero empieza en la fecha nueva; hacia adelante, los períodos que terminan antes de
// ella se borran (nunca rigieron un día con registros) y el que la contiene empieza en ella.
export function planStartDateChange(args: { periods: Row[]; newStart: string }): RhythmAction[] {
    const { newStart } = args;
    const periods = byStart(args.periods);
    if (periods.length === 0 || !newStart) return [];
    if (newStart < periods[0].start_date) return [{ kind: 'update', id: periods[0].id, values: { start_date: newStart } }];
    const actions: RhythmAction[] = [];
    const remaining: Row[] = [];
    for (const p of periods) {
        if (p.end_date && p.end_date < newStart) actions.push({ kind: 'delete', id: p.id });
        else remaining.push(p);
    }
    if (remaining.length && remaining[0].start_date !== newStart) actions.push({ kind: 'update', id: remaining[0].id, values: { start_date: newStart } });
    return actions;
}
