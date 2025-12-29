---
description: Cómo generar un APK localmente en Windows
---

Para generar un nuevo APK en el futuro sin usar los créditos de EAS (Expo Cloud), sigue estos pasos:

1. **Asegúrate de que el código esté listo**: Guarda todos tus cambios.

2. **Prepara el entorno (Solo si borraste la carpeta android)**:
   ```bash
   npx expo prebuild
   ```

3. **Verifica las configuraciones manuales** (Esto ya lo hicimos, pero es bueno recordarlo si regeneras la carpeta):
   - **`android/local.properties`**: Debe tener `sdk.dir=...`
   - **`android/settings.gradle`**: Debe tener el bloque de *Autolinking*.
   - **`android/app/build.gradle`**: Debe tener `ndkVersion "27.1.12297006"`.

// turbo
4. **Limpia y Compila**:
   ```powershell
   cd android
   ./gradlew clean
   ./gradlew assembleRelease
   ```

5. **Localiza tu APK**:
   El archivo generado estará en:
   `android/app/build/outputs/apk/release/app-release.apk`

6. **Instalación**:
   Copia ese archivo a tu teléfono e instálalo. (Recuerda borrar la versión anterior para evitar conflictos de base de datos si hiciste cambios estructurales).
