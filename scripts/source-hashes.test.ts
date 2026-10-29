import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSourceHashes, MANIFEST, sourceHashes } from './source-hashes.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { windowsHide: true, stdio: 'pipe' });
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
 const root = mkdtempSync(join(tmpdir(), 'source-hashes-'));
 roots.push(root);
 git(root, 'init', '-q');
 git(root, 'config', 'core.autocrlf', 'false');
 writeFileSync(join(root, '.gitattributes'), '*.txt text eol=lf\n');
 writeFileSync(join(root, 'source.txt'), 'first\r\nsecond\r\n');
 writeFileSync(join(root, 'untracked.txt'), 'not source');
 git(root, 'add', '.gitattributes', 'source.txt');
 return root;
}
function manifest(root: string, hashes: Record<string, string>) {
 writeFileSync(join(root, MANIFEST), JSON.stringify(hashes, null, 2) + '\n');
 git(root, 'add', MANIFEST);
}

test('hashes staged Git bytes, not CRLF checkout bytes, and excludes only the manifest', () => {
 const root = fixture();
 const hashes = sourceHashes(root);
 expect(hashes['source.txt']).toBe(sha('first\nsecond\n'));
 expect(readFileSync(join(root, 'source.txt'), 'utf8')).toBe('first\r\nsecond\r\n');
 expect(Object.keys(hashes)).toEqual(['.gitattributes', 'source.txt']);
 manifest(root, hashes);
 expect(checkSourceHashes(root)).toBe(2);
 expect(sourceHashes(root)).toEqual(hashes);
 writeFileSync(join(root, 'source.txt'), 'unstaged');
 expect(sourceHashes(root)).toEqual(hashes);
});

test('detects missing new tracked paths, extra paths and wrong digests', () => {
 const root = fixture();
 const hashes = sourceHashes(root);
 manifest(root, hashes);
 writeFileSync(join(root, 'new.ts'), 'export const n = 1;\n');
 git(root, 'add', 'new.ts');
 expect(() => checkSourceHashes(root)).toThrow('new.ts');
 const current = sourceHashes(root);
 manifest(root, { ...current, extra: sha('extra') });
 expect(() => checkSourceHashes(root)).toThrow('extra');
 manifest(root, { ...current, 'source.txt': sha('CRLF or stale bytes') });
 expect(() => checkSourceHashes(root)).toThrow('source.txt');
 manifest(root, current);
 expect(checkSourceHashes(root)).toBe(3);
});
