import { useContext } from 'react';
import { SheetContext, okSheet } from '../contexts/SheetContext';

// Hook de la UI para las hojas inferiores y los avisos (O6). Uso:
//   const { confirm, informar, avisar } = useSheet();
//   const clave = await confirm({ titulo, mensaje, acciones: [...] });   // null = cancelado
//   await informar('Error', 'El nombre es obligatorio');                 // hoja de solo "OK"
//   avisar({ titulo: 'Éxito', mensaje: 'Guardado correctamente' });     // aviso breve
export function useSheet() {
    const ctx = useContext(SheetContext);
    if (!ctx) throw new Error('useSheet necesita SheetProvider en la raíz (App.js).');
    return { confirm: ctx.confirm, avisar: ctx.avisar, informar: (titulo, mensaje) => okSheet(ctx.confirm, titulo, mensaje) };
}
