// Config plugin: firma del build release en android/app/build.gradle (Fase 3).
// `npx expo prebuild` regenera android/ (ignorado por git); este plugin vuelve a poner
// la firma en cada prebuild, sin ningún valor secreto en el repo.
//
// Modos (los elige app.config.js según APP_VARIANT):
//   'eas'   (producción, com.poguis.Registro): keystore de EAS. Lee las 4 propiedades
//           REGISTRO_UPLOAD_* de ~/.gradle/gradle.properties. Si falta alguna, o el
//           keystore no existe, cualquier tarea release FALLA: nunca cae al debug.keystore.
//   'debug' (solo variante dev, com.poguis.Registro.dev): el release se firma con
//           debug.keystore. Sirve para probar el JS embebido (sin Metro) sin tocar la
//           llave de producción; ese APK no puede reemplazar a la app real (otro package).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// [withReleaseSigning]';

const EAS_PRELUDE = `${MARKER} Firma del release con el keystore de EAS (perfil preview), el mismo del APK
// instalado en el celular. Las 4 propiedades viven en ~/.gradle/gradle.properties
// (fuera del repo). Si falta alguna, cualquier tarea release FALLA: nunca se cae
// al debug.keystore, porque un APK con otra firma no se puede instalar encima.
def releaseSigningPropNames = [
    'REGISTRO_UPLOAD_STORE_FILE',
    'REGISTRO_UPLOAD_STORE_PASSWORD',
    'REGISTRO_UPLOAD_KEY_ALIAS',
    'REGISTRO_UPLOAD_KEY_PASSWORD',
]
def missingReleaseSigningProps = releaseSigningPropNames.findAll { name ->
    !project.hasProperty(name) || project.property(name).toString().trim().isEmpty()
}
def releaseStoreFile = missingReleaseSigningProps.isEmpty() ? file(project.property('REGISTRO_UPLOAD_STORE_FILE')) : null

`;

const EAS_SIGNING_CONFIG = `
        release {
            if (releaseStoreFile != null) {
                storeFile releaseStoreFile
                storePassword project.property('REGISTRO_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('REGISTRO_UPLOAD_KEY_ALIAS')
                keyPassword project.property('REGISTRO_UPLOAD_KEY_PASSWORD')
            }
        }`;

const EAS_GUARD = `

${MARKER} Si se va a construir algo release y la firma de EAS no está completa, falla antes de compilar.
gradle.taskGraph.whenReady { graph ->
    def buildsRelease = graph.allTasks.any { t -> t.project == project && t.name.toLowerCase().contains('release') }
    if (!buildsRelease) return
    if (!missingReleaseSigningProps.isEmpty()) {
        throw new GradleException(
            "Firma release: faltan \${missingReleaseSigningProps.join(', ')} en ~/.gradle/gradle.properties. " +
            "El release solo se firma con el keystore de EAS; no se usa debug.keystore."
        )
    }
    if (!releaseStoreFile.exists()) {
        throw new GradleException("Firma release: no existe el keystore indicado en REGISTRO_UPLOAD_STORE_FILE.")
    }
}
`;

const replaceOnce = (src, pattern, replacement, what) => {
    if (!pattern.test(src)) {
        throw new Error(`withReleaseSigning: no encontré ${what} en android/app/build.gradle; revisa la plantilla de prebuild.`);
    }
    return src.replace(pattern, replacement);
};

function applySigning(src, mode) {
    if (src.includes(MARKER)) return src; // ya aplicado
    // buildTypes.release usa signingConfigs.debug en la plantilla de Expo.
    const releaseTypeRe = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (mode === 'debug') {
        return replaceOnce(src, releaseTypeRe,
            `$1${MARKER} Variante dev: release firmado con debug.keystore (nunca la app real).\n            signingConfig signingConfigs.debug`,
            'buildTypes.release');
    }
    if (mode !== 'eas') throw new Error(`withReleaseSigning: modo desconocido "${mode}"`);
    let out = replaceOnce(src, /^android\s*\{/m, `${EAS_PRELUDE}android {`, 'el bloque android {');
    out = replaceOnce(out, /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?keyPassword 'android'\s*\})/,
        `$1${EAS_SIGNING_CONFIG}`, 'signingConfigs.debug');
    out = replaceOnce(out, releaseTypeRe,
        `$1${MARKER} Keystore de EAS. NUNCA signingConfigs.debug.\n            signingConfig signingConfigs.release`,
        'buildTypes.release');
    return out + EAS_GUARD;
}

const withReleaseSigning = (config, { mode = 'eas' } = {}) =>
    withAppBuildGradle(config, (cfg) => {
        if (cfg.modResults.language !== 'groovy') {
            throw new Error('withReleaseSigning: build.gradle no es Groovy.');
        }
        cfg.modResults.contents = applySigning(cfg.modResults.contents, mode);
        return cfg;
    });

module.exports = withReleaseSigning;
module.exports.applySigning = applySigning;
