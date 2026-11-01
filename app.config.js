// Configuración dinámica por variante (patrón "multiple app variants" de Expo).
// app.json conserva los valores estáticos; aquí se sobrescribe lo que cambia por variante.
//   Producción (sin APP_VARIANT): com.poguis.Registro, "Registro", scheme poguis-registro.
//   APP_VARIANT=development:      com.poguis.Registro.dev, "Registro Dev", scheme poguis-registro-dev.
// Las dos se instalan una al lado de la otra; cada una tiene su sandbox y su propia BD.
// El retorno de OAuth es EXACTAMENTE `<scheme>://auth/callback` (Redirect URLs de Supabase).
const VARIANTS = {
    production: { name: 'Registro', package: 'com.poguis.Registro', scheme: 'poguis-registro', signing: 'eas' },
    development: { name: 'Registro Dev', package: 'com.poguis.Registro.dev', scheme: 'poguis-registro-dev', signing: 'debug' },
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
        extra: { ...config.extra, variant: variantName },
        plugins: [...(config.plugins || []), ['./plugins/withReleaseSigning', { mode: variant.signing }]],
    };
};
module.exports.VARIANTS = VARIANTS;
