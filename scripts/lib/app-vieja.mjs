// Código real de una versión anterior de la app (src/ completo de un commit, con `git show` por
// archivo, a un temporal con package.json {"type":"module"}), para las pruebas de compatibilidad y
// de migración (mismo patrón que probar-fase7-4b con 47f358c). Los hooks de test-hooks.mjs (que el
// llamador importa antes) resuelven expo-sqlite, './backup', etc. sin depender de la ruta.
// Solo lectura del repositorio; nunca toca un proyecto remoto ni datos reales.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const quiet = async (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try { return await fn(); } finally { console.log = log; console.error = error; }
};

export async function cargarAppVieja(ref, workDir) {
    const dir = `${workDir}/app-${ref}`;
    const archivos = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'src'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const f of [...archivos, 'app.json']) {
        const destino = `${dir}/${f}`;
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(destino, execFileSync('git', ['show', `${ref}:${f}`], { maxBuffer: 64 * 1024 * 1024 }));
    }
    writeFileSync(`${dir}/package.json`, '{"type":"module"}');
    const url = (p) => pathToFileURL(`${dir}/${p}`).href;
    const app = {
        ref,
        archivos: archivos.length,
        DatabaseService: (await import(url('src/services/db.js'))).DatabaseService,
        conn: await import(url('src/data/db/connection.ts')),
        engine: await import(url('src/sync/engine.ts')),
        config: await import(url('src/sync/config.ts')),
        mapping: await import(url('src/sync/mapping.ts')),
        migrations: await import(url('src/services/migrations.js')),
    };
    let n = 0;
    // Un dispositivo con la app vieja: BD propia en workDir, init() real de esa versión y la cuenta
    // vinculada al uid SINTÉTICO que se pase.
    app.dispositivo = async (uid, setDatabasePath) => {
        const path = `${workDir}/viejo-${ref}-${++n}/app_registro_v3.db`;
        mkdirSync(dirname(path), { recursive: true });
        setDatabasePath(path);
        const svc = new app.DatabaseService();
        if (!(await quiet(() => svc.init()))) throw new Error(`la app ${ref} no abrió su BD`);
        const usar = () => app.conn.setConnection(svc.db);
        usar();
        const r = await quiet(() => svc.createLinkedUser(uid, 'prueba@ejemplo.test'));
        if (!r.success) throw new Error(`createLinkedUser (${ref}) falló`);
        return { svc, path, usar };
    };
    return app;
}
