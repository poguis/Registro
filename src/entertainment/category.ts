// Validación pura del formulario de categoría (Fase 7.4a, O1). Sin React ni db: la pantalla
// traduce el código de error a su texto.

export type CategoryFormError = 'nombre' | 'limite';

// El límite de series/obras activas es obligatorio, en video y en lectura: un entero ≥ 1.
export function validateCategoryForm(form: { name: string; seriesCount: any }): { error: CategoryFormError } | { seriesCount: number } {
    if (!String(form.name ?? '').trim()) return { error: 'nombre' };
    const text = String(form.seriesCount ?? '').trim();
    if (!/^\d+$/.test(text)) return { error: 'limite' };
    const seriesCount = parseInt(text, 10);
    if (seriesCount < 1) return { error: 'limite' };
    return { seriesCount };
}

// Fase 7.4b (decisión 5): la fecha de inicio solo se edita mientras la categoría no tiene filas
// vivas de historial (totalWatched = filas vivas de watch_history + reading_history de sus series
// vivas; el historial de una serie borrada se borra en cascada).
export const canEditStartDate = (category: { totalWatched?: number } | null | undefined): boolean =>
    !category || (category.totalWatched || 0) === 0;

// Fase 7.4b (R12): reanudar una pausa. La pantalla reanuda con fecha de ayer; si la pausa empezó
// después (es decir, hoy: pausar y reanudar el mismo día), no tuvo efecto y se borra lógicamente
// en vez de dejar un fin anterior al inicio.
export function decideResume(pause: { pause_start: string }, resumeDate: string): 'delete' | 'close' {
    return pause.pause_start > resumeDate ? 'delete' : 'close';
}
