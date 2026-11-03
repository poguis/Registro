// Configuración dinámica por variante (patrón "multiple app variants" de Expo).
// app.json conserva los valores estáticos; aquí se sobrescribe lo que cambia por variante.
//   Producción (sin APP_VARIANT): com.poguis.Registro, "Registro", scheme poguis-registro.
//   APP_VARIANT=development:      com.poguis.Registro.dev, "Registro Dev", scheme poguis-registro-dev.
// Las dos se instalan una al lado de la otra; cada una tiene su sandbox y su propia BD.
// El retorno de OAuth es EXACTAMENTE `<scheme>://auth/callback` (Redirect URLs de Supabase).
//
// Proyecto de Supabase por variante (Fase 4): cada APK lleva SOLO el suyo en
// extra.supabase (la app no lee process.env), así el release nunca contiene el proyecto de
// desarrollo ni al revés. Valores de .env (Expo CLI lo carga antes de evaluar este archivo):
//   producción: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//   desarrollo: EXPO_PUBLIC_SUPABASE_DEV_URL / EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY
// extra.syncEnabled: la sincronización está ENCENDIDA en las dos variantes desde la Fase 5
// (cada una contra su proyecto). Apagado de emergencia: false aquí + versionCode nuevo.
const VARIANTS = {
    production: {
        name: 'Registro', package: 'com.poguis.Registro', scheme: 'poguis-registro', signing: 'eas',
        urlVar: 'EXPO_PUBLIC_SUPABASE_URL', keyVar: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', syncEnabled: true,
    },
    development: {
        name: 'Registro Dev', package: 'com.poguis.Registro.dev', scheme: 'poguis-registro-dev', signing: 'debug',
        urlVar: 'EXPO_PUBLIC_SUPABASE_DEV_URL', keyVar: 'EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY', syncEnabled: true,
    },
};

module.exports = ({ config }) => {
    const variantName = process.env.APP_VARIANT || 'production';
    const variant = VARIANTS[variantName];
    if (!variant) {
        throw new Error(`APP_VARIANT desconocida: "${variantName}" (usa development o déjala vacía).`);
    }
    return {
        ...config,
        name: variant.name,
        scheme: variant.scheme,
        android: { ...config.android, package: variant.package },
        extra: {
            ...config.extra,
            variant: variantName,
            syncEnabled: variant.syncEnabled,
            supabase: { url: process.env[variant.urlVar] || null, key: process.env[variant.keyVar] || null },
        },
        plugins: [...(config.plugins || []), ['./plugins/withReleaseSigning', { mode: variant.signing }]],
    };
};
module.exports.VARIANTS = VARIANTS;
