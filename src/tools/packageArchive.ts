import * as fs from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';

/** Extract regular files from a bounded ustar archive. Links and special entries are rejected. */
export async function extractPackageArchive(archive: string, destination: string): Promise<void> {
    const bytes = await fs.promises.readFile(archive);
    if (bytes.length > 64 * 1024 * 1024) throw new Error('Package archive exceeds 64 MiB');
    const data = /\.(tgz|gz)$/i.test(archive) ? gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }) : bytes;
    if (data.length > 128 * 1024 * 1024) throw new Error('Expanded package exceeds 128 MiB');
    const entries: { target: string; data?: Buffer }[] = [];
    for (let offset = 0; offset + 512 <= data.length;) {
        const header = data.subarray(offset, offset + 512);
        if (header.every(byte => byte === 0)) break;
        const field = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
        const checksum = parseInt(field(148, 8).trim(), 8);
        const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
        if (actual !== checksum) throw new Error('Invalid tar header checksum');
        const sizeText = field(124, 12).trim();
        if (!/^[0-7]+$/.test(sizeText)) throw new Error('Unsupported tar size encoding');
        const size = parseInt(sizeText, 8);
        const name = [field(345, 155), field(0, 100)].filter(Boolean).join('/');
        const normalized = name.replace(/^\.\//, '');
        if (path.posix.isAbsolute(normalized) || normalized.includes('\\') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
            throw new Error('Archive contains a path outside its destination');
        }
        const type = field(156, 1);
        if (!['', '0', '5'].includes(type)) throw new Error('Only regular files and directories are supported in package archives');
        if (offset + 512 + size > data.length) throw new Error('Truncated package archive');
        const target = path.resolve(destination, normalized);
        if (target !== path.resolve(destination) && !target.startsWith(path.resolve(destination) + path.sep)) throw new Error('Unsafe archive path');
        entries.push({ target, data: type === '5' ? undefined : data.subarray(offset + 512, offset + 512 + size) });
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (!entries.length) throw new Error('Empty or unsupported package archive');
    // Validate every entry before creating any file.
    for (const entry of entries) {
        if (entry.data) {
            await fs.promises.mkdir(path.dirname(entry.target), { recursive: true });
            await fs.promises.writeFile(entry.target, entry.data, { flag: 'wx' });
        } else await fs.promises.mkdir(entry.target, { recursive: true });
    }
}
