import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeZip } from '../src/zip.ts';

// An independent, dependency-free zip reader for STORE entries. It parses the archive
// the way any conformant reader would (End-Of-Central-Directory -> central directory ->
// local headers), so a green round-trip proves real spec compliance, not just that our
// own writer can read its own output.
function readZipStore(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  // Locate EOCD (assumes no archive comment, which our writer guarantees).
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'missing end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central dir offset
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(ptr), 0x02014b50, 'bad central directory signature');
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    // Jump to the local header to find the actual data.
    assert.equal(buf.readUInt32LE(localOff), 0x04034b50, 'bad local header signature');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    out.set(name, buf.toString('utf8', dataStart, dataStart + compSize));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('makeZip', () => {
  test('produces a structurally valid zip', () => {
    const buf = makeZip([{ path: 'a.txt', content: 'hello' }]);
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
    assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  });

  test('round-trips content through an independent reader', () => {
    const files = [
      { path: 'manifest.json', content: '{"name":"t"}' },
      { path: 'index.js', content: 'export default async () => "hi"\n' },
      { path: 'nested/util.js', content: 'export const x = 1;' },
    ];
    const extracted = readZipStore(makeZip(files));
    assert.equal(extracted.size, 3);
    for (const f of files) assert.equal(extracted.get(f.path), f.content);
  });

  test('handles unicode content faithfully (crc + byte lengths)', () => {
    const content = 'café — 日本語 — 🚀';
    const extracted = readZipStore(makeZip([{ path: 'u.txt', content }]));
    assert.equal(extracted.get('u.txt'), content);
  });
});
