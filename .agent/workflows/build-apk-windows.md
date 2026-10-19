---
description: Cómo generar un APK localmente en Windows
---

Para generar un nuevo APK en el futuro sin usar los créditos de EAS (Expo Cloud), sigue estos pasos:

1. **Asegúrate de que el código esté listo**: Guarda todos tus cambios.

2. **Prepara el entorno (Solo si borraste la carpeta android)**:
   ⚠️ Antes de `npx expo prebuild` o de regenerar `android/`: respaldar el keystore que firma el release (hoy `android/app/debug.keystore`) fuera del repo. Después del build, comparar el certificado del APK nuevo con el instalado usando `apksigner verify --print-certs`. Si no coincide, NO instalar ni desinstalar.
   ```bash
   npx expo prebuild
   ```

3. **Verifica las configuraciones manuales** (Esto ya lo hicimos, pero es bueno recordarlo si regeneras la carpeta):
   ⚠️ Antes de `npx expo prebuild` o de regenerar `android/`: respaldar el keystore que firma el release (hoy `android/app/debug.keystore`) fuera del repo. Después del build, comparar el certificado del APK nuevo con el instalado usando `apksigner verify --print-certs`. Si no coincide, NO instalar ni desinstalar.
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
   Copia ese archivo a tu teléfono e instálalo. Nunca desinstalar: los cambios de esquema van como migración versionada; instalar encima con el mismo keystore.
