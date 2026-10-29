import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const MANIFEST = 'SOURCE_HASHES.json';

type Blob = { path: string; oid: string };

function git(root: string, args: string[], input?: string): Buffer {
 return execFileSync('git', ['-C', root, ...args], { input, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

/** Stage-zero index blobs by default; a revision reads its tree instead. Never hashes checkout bytes. */
function blobs(root: string, revision?: string): Blob[] {
 const entries = git(root, revision ? ['ls-tree', '-rz', '--full-tree', revision] : ['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
 return entries.map((entry) => {
  const match = revision ? /^\d{6} (blob) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry) : /^\d{6} ([a-f0-9]+) (0)\t([\s\S]+)$/.exec(entry);
  if (!match) throw new Error('Expected an unambiguous tracked blob: ' + entry);
  return { path: match[3]!, oid: match[revision ? 2 : 1]! };
 }).filter(({ path }) => path !== MANIFEST).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Exact SHA-256 of every tracked Git blob, except the manifest itself. Includes new staged files. */
export function sourceHashes(root: string, revision?: string): Record<string, string> {
 const files = blobs(root, revision);
 if (files.length === 0) throw new Error('No tracked source blobs');
 const bytes = git(root, ['cat-file', '--batch'], files.map(({ oid }) => oid).join('\n') + '\n');
 const hashes: Record<string, string> = {};
 let offset = 0;
 for (const { path, oid } of files) {
  const end = bytes.indexOf(10, offset);
  if (end < offset) throw new Error('Missing blob header: ' + path);
  const header = bytes.subarray(offset, end).toString('ascii').split(' ');
  const size = Number(header[2]);
  if (header[0] !== oid || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid blob header: ' + path);
  offset = end + 1;
  if (offset + size >= bytes.length || bytes[offset + size] !== 10) throw new Error('Truncated blob: ' + path);
  hashes[path] = createHash('sha256').update(bytes.subarray(offset, offset + size)).digest('hex');
  offset += size + 1;
 }
 if (offset !== bytes.length) throw new Error('Unexpected trailing Git batch bytes');
 return hashes;
}

export function checkSourceHashes(root: string, revision?: string): number {
 const expected = sourceHashes(root, revision);
 const declared: unknown = JSON.parse(git(root, ['show', revision ? revision + ':' + MANIFEST : ':' + MANIFEST]).toString('utf8'));
 if (!declared || typeof declared !== 'object' || Array.isArray(declared)) throw new Error('Invalid source hash manifest');
 const recorded = declared as Record<string, unknown>;
 const missing = Object.keys(expected).filter((path) => !(path in recorded));
 const extra = Object.keys(recorded).filter((path) => !(path in expected));
 const mismatched = Object.keys(expected).filter((path) => path in recorded && expected[path] !== recorded[path]);
 if (missing.length || extra.length || mismatched.length) throw new Error(JSON.stringify({ missing, extra, mismatched }));
 return Object.keys(expected).length;
}

if (import.meta.main) {
 const args = process.argv.slice(2);
 const mode = args.shift();
 const revision = args.shift();
 if ((mode !== '--json' && mode !== '--check') || args.length || revision?.startsWith('-')) throw new Error('Usage: bun scripts/source-hashes.ts <--json|--check> [revision]');
 const root = resolve(import.meta.dir, '..');
 if (mode === '--json') console.log(JSON.stringify(sourceHashes(root, revision), null, 2));
 else console.log('Source hashes verified: ' + checkSourceHashes(root, revision) + ' Git blobs (' + (revision ?? 'index') + ')');
}
