// Retención de la carpeta respaldos/ (Fase 6.7). Función PURA: sin React, sin SQLite y sin
// sistema de archivos; recibe el listado y las reglas y devuelve qué conservar y qué borrar, con el
// motivo de cada archivo. El ejecutor (backupCleanup.js) verifica las contraseñas y borra.
//
// Solo reconoce estos nombres (el sufijo -N lo añade backup.js si dos sellos coinciden):
//   registro_respaldo_YYYYMMDD-HHMMSS[-N].(db|json)       respaldo manual ("Respaldar datos"); .db + .json = par
//   registro_pre-migracion-vN_YYYYMMDD-HHMMSS[-N].db      copia previa a una migración
//   registro_pre-vinculacion_YYYYMMDD-HHMMSS[-N].db       copia previa a vincular la cuenta
// Cualquier otro nombre (incluida la BD principal o archivos -journal/-wal/-shm) se CONSERVA y se
// informa como desconocido.
//
// Reglas, en este orden:
//   1. Un par de respaldo con algún archivo con la contraseña antigua se borra ENTERO y no ocupa
//      ninguno de los puestos (DECISIONES.md, 6.7, regla 3: nunca se conserva una copia con la contraseña).
//   2. De los pares restantes se conservan los `keepBackups` más recientes (por sello y sufijo); los
//      pares protegidos (el respaldo recién creado) se conservan siempre.
//   3. De las copias pre-migración sin contraseña se conserva la más reciente.
//   4. Todo lo demás que coincida con los patrones (respaldos viejos, pre-migraciones viejas,
//      pre-vinculación, copias con contraseña) se borra.

export type BackupFile = { name: string; size: number; modifiedAt?: string | null };
export type RetentionItem = { name: string; size: number; reason: string };
export type RetentionPlan = { keep: RetentionItem[]; remove: RetentionItem[]; unknown: RetentionItem[] };
export type RetentionOptions = {
    keepBackups?: number;
    passwordFiles?: Iterable<string>;
    protectKeys?: Iterable<string>; // claves de par ("YYYYMMDD-HHMMSS" o "YYYYMMDD-HHMMSS-N") que nunca se borran
};

export const RE_BACKUP = /^registro_respaldo_(\d{8}-\d{6})(?:-(\d+))?\.(db|json)$/;
export const RE_PRE_MIGRATION = /^registro_pre-migracion-v(\d+)_(\d{8}-\d{6})(?:-(\d+))?\.db$/;
export const RE_PRE_LINK = /^registro_pre-vinculacion_(\d{8}-\d{6})(?:-(\d+))?\.db$/;

export const isKnownBackupName = (name: string) => RE_BACKUP.test(name) || RE_PRE_MIGRATION.test(name) || RE_PRE_LINK.test(name);

// Clave de par de un respaldo manual: sello + sufijo (si lo hay).
export function backupPairKey(name: string): string | null {
    const m = RE_BACKUP.exec(name);
    return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : null;
}
// Sello (YYYYMMDD-HHMMSS) de cualquier nombre reconocido.
export function stampOf(name: string): string | null {
    let m = RE_BACKUP.exec(name);
    if (m) return m[1];
    m = RE_PRE_MIGRATION.exec(name);
    if (m) return m[2];
    m = RE_PRE_LINK.exec(name);
    return m ? m[1] : null;
}

// Orden: sello, luego sufijo numérico (sin sufijo = 0).
const orderKey = (stamp: string, suffix: string | undefined) => `${stamp}#${String(Number(suffix || 0)).padStart(6, '0')}`;

export function planRetention(files: BackupFile[], opts: RetentionOptions = {}): RetentionPlan {
    const keepBackups = opts.keepBackups ?? 10;
    const pw = new Set(opts.passwordFiles ?? []);
    const protect = new Set(opts.protectKeys ?? []);
    const plan: RetentionPlan = { keep: [], remove: [], unknown: [] };
    const item = (f: BackupFile, reason: string): RetentionItem => ({ name: f.name, size: f.size, reason });

    // Pares de respaldo manual.
    const pairs = new Map<string, { order: string; files: BackupFile[] }>();
    const preMigrations: { f: BackupFile; order: string }[] = [];
    for (const f of files) {
        const b = RE_BACKUP.exec(f.name);
        if (b) {
            const key = b[2] ? `${b[1]}-${b[2]}` : b[1];
            const p = pairs.get(key) ?? { order: orderKey(b[1], b[2]), files: [] };
            p.files.push(f);
            pairs.set(key, p);
            continue;
        }
        const m = RE_PRE_MIGRATION.exec(f.name);
        if (m) {
            preMigrations.push({ f, order: `${orderKey(m[2], m[3])}#v${m[1].padStart(4, '0')}` });
            continue;
        }
        if (RE_PRE_LINK.test(f.name)) {
            plan.remove.push(item(f, pw.has(f.name) ? 'contiene la contraseña antigua' : 'copia pre-vinculación (no se conserva)'));
            continue;
        }
        plan.unknown.push(item(f, 'nombre desconocido: se conserva'));
    }

    // 1–2. Respaldos manuales.
    const clean: [string, { order: string; files: BackupFile[] }][] = [];
    for (const [key, p] of pairs) {
        if (p.files.some((f) => pw.has(f.name))) {
            for (const f of p.files) plan.remove.push(item(f, pw.has(f.name) ? 'contiene la contraseña antigua' : 'par de una copia con la contraseña antigua'));
        } else {
            clean.push([key, p]);
        }
    }
    clean.sort((a, b) => (a[1].order < b[1].order ? 1 : a[1].order > b[1].order ? -1 : 0));
    const kept = new Set(clean.slice(0, keepBackups).map(([key]) => key));
    for (const key of protect) if (pairs.has(key) && clean.some(([k]) => k === key)) kept.add(key);
    for (const [key, p] of clean) {
        for (const f of p.files) {
            if (protect.has(key)) plan.keep.push(item(f, 'respaldo recién creado (protegido)'));
            else if (kept.has(key)) plan.keep.push(item(f, `entre los ${keepBackups} respaldos más recientes`));
            else plan.remove.push(item(f, `respaldo fuera de los ${keepBackups} más recientes`));
        }
    }

    // 3. Copias pre-migración.
    const cleanPre = preMigrations.filter((p) => !pw.has(p.f.name)).sort((a, b) => (a.order < b.order ? 1 : a.order > b.order ? -1 : 0));
    const keepPre = cleanPre.length ? cleanPre[0].f.name : null;
    for (const p of preMigrations) {
        if (pw.has(p.f.name)) plan.remove.push(item(p.f, 'contiene la contraseña antigua'));
        else if (p.f.name === keepPre) plan.keep.push(item(p.f, 'copia pre-migración más reciente'));
        else plan.remove.push(item(p.f, 'copia pre-migración no más reciente'));
    }
    return plan;
}
