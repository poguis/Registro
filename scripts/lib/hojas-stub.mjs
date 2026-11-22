// Dirección visual (O6): las pantallas ya no llaman al diálogo del sistema; usan las hojas propias
// de useSheet: `confirm` (promesa con la clave elegida), `informar` (hoja con "OK") y `avisar`
// (aviso). Este adaptador traduce esas tres llamadas al stub de Alert que cada suite ya tenía, para
// que el REGISTRO sea el mismo que antes (título, mensaje, botones [texto, estilo]) y los casos
// esperados (CASOS de probar-fase7-2, tablas de 7-4a/7-4b, equivalencia de 7-3) no cambien:
//   - informar(t, m) y avisar({ titulo, mensaje }) ≡ una alerta sin botones;
//   - confirm({ titulo, mensaje, acciones }) ≡ una alerta con los mismos botones en el mismo orden;
//     variante → estilo: cancelar → 'cancel', destructiva → 'destructive', primaria y secundaria →
//     sin estilo (como los botones de antes). Pulsar un botón resuelve su clave; si el stub no
//     pulsa ninguno, la hoja se descarta y resuelve null (como cerrar con Atrás: no hace nada).
// Solo para pruebas en Node; no entra en la app.
const ESTILO = { cancelar: 'cancel', destructiva: 'destructive' };

export function hojasDesdeAlert(Alert) {
    const informar = (titulo, mensaje) => { Alert.alert(titulo, mensaje); };
    const avisar = ({ titulo, mensaje } = {}) => { Alert.alert(titulo, mensaje); };
    const confirm = ({ titulo, mensaje, acciones = [] } = {}) => new Promise((resolve) => {
        let elegida = false;
        Alert.alert(titulo, mensaje, acciones.map((a) => {
            const boton = { text: a.texto, onPress: () => { elegida = true; resolve(a.clave); } };
            if (ESTILO[a.variante]) boton.style = ESTILO[a.variante];
            return boton;
        }));
        if (!elegida) resolve(null);
    });
    return { confirm, informar, avisar };
}
