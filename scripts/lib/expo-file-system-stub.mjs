// Stub de expo-file-system (API File/Directory de SDK 54) sobre node:fs,
// SOLO para probar src/services/backup.js en PC.
import { existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';

const toPath = (uri) => uri.replace(/^file:\/\//, '');

export class Directory {
    constructor(uri) { this.uri = uri; }
    get exists() { return existsSync(toPath(this.uri)); }
    create({ intermediates = false } = {}) { mkdirSync(toPath(this.uri), { recursive: intermediates }); }
}

export class File {
    constructor(uri) { this.uri = uri; }
    get exists() { return existsSync(toPath(this.uri)); }
    get size() { return this.exists ? statSync(toPath(this.uri)).size : 0; }
    create() {
        if (this.exists) throw new Error(`El archivo ya existe: ${this.uri}`);
        writeFileSync(toPath(this.uri), '');
    }
    write(content) { writeFileSync(toPath(this.uri), content); }
}
