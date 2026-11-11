// Stub de expo-file-system (API File/Directory de SDK 54) sobre node:fs,
// SOLO para probar src/services/backup.js en PC.
import { existsSync, statSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename } from 'node:path';

const toPath = (uri) => uri.replace(/^file:\/\//, '');

export class Directory {
    constructor(uri) { this.uri = uri; }
    get exists() { return existsSync(toPath(this.uri)); }
    get name() { return basename(toPath(this.uri)); }
    create({ intermediates = false } = {}) { mkdirSync(toPath(this.uri), { recursive: intermediates }); }
    list() {
        const base = toPath(this.uri).replace(/\/$/, '');
        return readdirSync(base).map((n) => {
            const uri = `file://${base}/${n}`;
            return statSync(`${base}/${n}`).isDirectory() ? new Directory(uri) : new File(uri);
        });
    }
}

export class File {
    constructor(uri) { this.uri = uri; }
    get exists() { return existsSync(toPath(this.uri)); }
    get name() { return basename(toPath(this.uri)); }
    get size() { return this.exists ? statSync(toPath(this.uri)).size : 0; }
    // Como File.modificationTime de expo-file-system 19: ms desde la época, o null si no existe.
    get modificationTime() { return this.exists ? statSync(toPath(this.uri)).mtimeMs : null; }
    create() {
        if (this.exists) throw new Error(`El archivo ya existe: ${this.uri}`);
        writeFileSync(toPath(this.uri), '');
    }
    write(content) { writeFileSync(toPath(this.uri), content); }
    // Fase 6.7 (limpieza de respaldos/): texto, lectura de los primeros bytes y borrado.
    async text() { return readFileSync(toPath(this.uri), 'utf8'); }
    open() {
        const buf = readFileSync(toPath(this.uri));
        let pos = 0;
        return { readBytes: (n) => { const out = new Uint8Array(buf.subarray(pos, pos + n)); pos += out.length; return out; }, close() {} };
    }
    delete() {
        if (globalThis.__fsStubDeleteFails && globalThis.__fsStubDeleteFails(this.uri)) throw new Error('borrado simulado que falla');
        unlinkSync(toPath(this.uri));
    }
}
