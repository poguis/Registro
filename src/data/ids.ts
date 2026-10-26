import { randomUUID } from 'expo-crypto';

// ID de registro: UUID v4 generado en el cliente (DECISIONES.md, Modelo de datos).
export const newId = (): string => randomUUID();

export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
