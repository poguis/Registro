# Registro

Aplicación móvil construida con Expo/React Native para gestión personal:
- Finanzas y balance
- Deudas/préstamos
- Series/Anime/Lectura
- Backlog
- Trabajo/Servicios/Tarjetas

## Requisitos
- Node.js LTS
- npm
- Expo CLI vía `npx`

## Ejecución local
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
La app usa una arquitectura por pantallas con estado de navegación en `App.js` y acceso a datos centralizado en SQLite:

- Entrada: `index.js` -> `App.js`
- Navegación principal: estado local en `App.js` (`currentView` + historial)
- UI: `src/screens/`
- Tema global: `src/contexts/ThemeContext.js`
- Base de datos y reglas de negocio: `src/services/db.js`
- Utilidades de cálculo backlog: `src/services/backlogUtils.js`

## Notas de mantenimiento
- Se removió la capa MVC antigua (`src/views`, `src/controllers`, `src/database`, `src/models`) porque no estaba conectada al flujo principal.
- Si se desea reintroducir MVC, conviene hacerlo en un módulo nuevo y migrar gradualmente desde `src/services/db.js`.