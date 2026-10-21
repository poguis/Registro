---
description: Cómo generar un APK localmente en Windows
---

Para generar un nuevo APK en el futuro sin usar los créditos de EAS (Expo Cloud), sigue estos pasos:

1. **Asegúrate de que el código esté listo**: Guarda todos tus cambios.

2. **Prepara el entorno (Solo si borraste la carpeta android)**:
   ⚠️ `npx expo prebuild` regenera `android/` y pierde el `signingConfig release` de `android/app/build.gradle` (git no lo guarda). Después hay que reaplicarlo (ver paso 3; pendiente: moverlo a un config plugin).
   ```bash
   npx expo prebuild
   ```

3. **Verifica las configuraciones manuales** (Esto ya lo hicimos, pero es bueno recordarlo si regeneras la carpeta):
   - **Firma (obligatoria)**: el release se firma con el keystore de EAS (perfil preview), SHA-256 `31:32:DE:…:3E:52`, el mismo del APK del celular. `android/app/build.gradle` debe tener el `signingConfig release` que lee `REGISTRO_UPLOAD_STORE_FILE`, `REGISTRO_UPLOAD_STORE_PASSWORD`, `REGISTRO_UPLOAD_KEY_ALIAS` y `REGISTRO_UPLOAD_KEY_PASSWORD` de `%USERPROFILE%\.gradle\gradle.properties`, y que hace fallar el release si falta alguna. El `buildType release` usa `signingConfigs.release`, nunca `signingConfigs.debug`.
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
   Antes de instalar, verifica la firma: `apksigner verify --print-certs` debe mostrar SHA-256 `3132ded2…3e52`. Si no coincide, NO instales ni desinstales.
   Instálalo encima (`adb install -r` o copiándolo al teléfono). Nunca desinstalar: los cambios de esquema van como migración versionada; instalar encima con el mismo keystore.
