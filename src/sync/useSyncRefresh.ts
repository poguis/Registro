import { useEffect, useRef } from 'react';
import { subscribeDataChanged } from './controller';

// Recarga los datos de una pantalla abierta cuando un ciclo de sync escribió datos locales
// (filas del servidor aplicadas o ids fusionados). `reload` debe solo volver a leer la BD y
// actualizar el estado de la lista: no reinicia formularios, filtros ni la posición del scroll.
// Siempre llama a la versión más reciente de `reload` (ref), sin volver a suscribirse.
export function useSyncRefresh(reload: () => unknown) {
    const ref = useRef(reload);
    ref.current = reload;
    useEffect(() => subscribeDataChanged(() => {
        try {
            const r = ref.current();
            if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
        } catch {
            // una recarga fallida no debe romper la pantalla
        }
    }), []);
}
