// Instante actual en ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SS.sssZ', el formato de
// created_at / updated_at / deleted_at. En SQL el equivalente es
// strftime('%Y-%m-%dT%H:%M:%fZ','now'); ambos ordenan igual como texto.
export const nowIso = (): string => new Date().toISOString();
