---
description: Cómo generar un APK localmente en Windows
---

Para generar un APK sin usar los créditos de EAS (Expo Cloud). Un comando por variante (`scripts/build-apk.mjs`):

| Variante | Comando | Package / nombre | Firma | Supabase | Sync |
|---|---|---|---|---|---|
| Producción | `npm run build:release` | `com.poguis.Registro` / "Registro" | keystore de EAS, SHA-256 `3132ded2…3e52` | proyecto de producción | apagada (`syncEnabled: false`) |
| Desarrollo | `npm run build:dev` | `com.poguis.Registro.dev` / "Registro Dev" | `debug.keystore` (`fac61745…`) | solo Registro Dev | encendida |

Las dos se instalan lado a lado, cada una con su BD.

1. **Antes de compilar**
   - Código guardado. Si el APK se va a instalar sobre una versión anterior con cambios, sube `version` y `android.versionCode` en `app.json`.
   - `.env` con las 4 variables de `.env.example`: `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (producción) y `EXPO_PUBLIC_SUPABASE_DEV_URL` / `EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY` (Registro Dev). Solo claves publishable (`sb_publishable_…`), nunca `sb_secret_`/`service_role`. `app.config.js` pone en `extra.supabase` solo el proyecto de la variante.
   - Firma de producción: 4 propiedades en `%USERPROFILE%\.gradle\gradle.properties` (fuera del repo): `REGISTRO_UPLOAD_STORE_FILE`, `REGISTRO_UPLOAD_STORE_PASSWORD`, `REGISTRO_UPLOAD_KEY_ALIAS`, `REGISTRO_UPLOAD_KEY_PASSWORD`. Nunca leerlas, mostrarlas ni copiarlas; nunca borrar ni regenerar el keystore en EAS.
   - JDK 17 (`C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`, o `REGISTRO_JAVA_HOME`): Gradle 8.14.3 no corre con el Java 25 que trae Android Studio.

// turbo
2. **Compilar**
   ```powershell
   npm run build:release
   npm run build:dev
   ```
   El script hace todo:
   - detiene el daemon de Gradle (en Windows bloquea `android/app/build` y `--clean` falla con EBUSY);
   - `npx expo prebuild -p android --clean` con `APP_VARIANT` (`android/` es generado e ignorado por git: nunca editarlo a mano);
   - el config plugin `plugins/withReleaseSigning.js` escribe la firma en `android/app/build.gradle` en cada prebuild: modo `eas` en producción (si falta una propiedad o el keystore, el release FALLA, nunca cae al `debug.keystore`) y modo `debug` solo en la variante dev;
   - asegura `sdk.dir` en `android/local.properties` (SDK en `D:\Users\Carlos\AppData\Local\Android\Sdk`);
   - `gradlew assembleRelease` con JDK 17 (JS embebido: no usa Metro, sirve para probar en modo avión);
   - copia el APK a `.local-data/apk/registro-<release|dev>-<versión>-vc<versionCode>-<commit>[-mod-<fecha>].apk` (`-mod` = había cambios sin commitear);
   - imprime applicationId, versionName/versionCode (aapt2) y la huella SHA-256 del certificado (apksigner);
   - corre `node scripts/verificar-secretos.mjs --apk <apk>`: sin secretos, la URL y la clave del proyecto correcto, y que no traiga la del otro; el release debe tener `syncEnabled: false`.

   **El release de producción falla si la huella no es `3132ded2…3e52`: no lo instales.**

3. **Instalar**
   - Antes de instalar compara el SHA-256 del archivo (`Get-FileHash`) y la huella del certificado (`apksigner verify --print-certs`).
   - Siempre encima: `adb -s <dispositivo> install -r <apk>`, con la misma firma. Nunca desinstalar ni borrar datos: los cambios de esquema van como migración versionada.
   - Emulador de pruebas: AVD `Registro_GoogleAPIs_36`, siempre `adb -s emulator-5554`. El celular solo lo maneja el usuario.
