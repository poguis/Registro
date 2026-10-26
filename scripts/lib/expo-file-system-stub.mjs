// Stub de expo-file-system (API File/Directory de SDK 54) sobre node:fs,
// SOLO para probar src/services/backup.js en PC.
import { existsSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
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
    create() {
        if (this.exists) throw new Error(`El archivo ya existe: ${this.uri}`);
        writeFileSync(toPath(this.uri), '');
    }
    write(content) { writeFileSync(toPath(this.uri), content); }
}
