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
