# Registro

Aplicaci�n m�vil construida con Expo/React Native para gesti�n personal:
- Finanzas y balance
- Deudas/pr�stamos
- Series/Anime/Lectura
- Backlog
- Trabajo/Servicios/Tarjetas

## Requisitos
- Node.js LTS
- npm
- Expo CLI v�a `npx`

## Ejecuci�n local
```bash
npm install
npx expo start
```

## Build Android (EAS)
```bash
npm install -g eas-cli
set EAS_NO_VCS=1 && eas build --profile preview --platform android
# alternativa
set EAS_NO_VCS=1 && npx eas-cli build --profile preview --platform android
```

## Arquitectura actual
La app usa una arquitectura por pantallas con estado de navegaci�n en `App.js` y acceso a datos centralizado en SQLite:

- Entrada: `index.js` -> `App.js`
- Navegaci�n principal: estado local en `App.js` (`currentView` + historial)
- UI: `src/screens/`
- Tema global: `src/contexts/ThemeContext.js`
- Base de datos y reglas de negocio: `src/services/db.js`
- Utilidades de c�lculo backlog: `src/services/backlogUtils.js`

## Notas de mantenimiento
- Se removi� la capa MVC antigua (`src/views`, `src/controllers`, `src/database`, `src/models`) porque no estaba conectada al flujo principal.
- Si se desea reintroducir MVC, conviene hacerlo en un m�dulo nuevo y migrar gradualmente desde `src/services/db.js`.


## Generar apk localmente
npm install
npx expo prebuild -p android

## cd android
.\gradlew.bat assembleDebug

