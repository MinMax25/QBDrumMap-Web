import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { utf8Bytes } from '../src/core';
import { crc32, createZip, ZipTooLargeError } from '../src/ui/services/zip';

const u = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('標準のテストベクタ "123456789" = 0xCBF43926、空は 0', () => {
    expect(crc32(u('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('createZip: 構造', () => {
  const entries = [
    { path: 'Plugin/Kit.tsv', bytes: u('a\r\nb\r\n') },
    { path: '日本語/キット.pitchlist', bytes: utf8Bytes('<x/>', true) },
  ];
  const zip = createZip(entries);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  it('ローカルヘッダー・セントラルディレクトリ・終端が仕様どおり（stored・UTF-8フラグ・CRC・サイズ）', () => {
    // 終端レコード
    const eocd = zip.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 8, true)).toBe(2);
    expect(dv.getUint16(eocd + 10, true)).toBe(2);
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    expect(cdOffset + cdSize).toBe(eocd);
    let off = 0;
    let cd = cdOffset;
    for (const e of entries) {
      const name = u(e.path);
      expect(dv.getUint32(off, true)).toBe(0x04034b50);
      expect(dv.getUint16(off + 6, true) & 0x0800).toBe(0x0800); // UTF-8 ファイル名
      expect(dv.getUint16(off + 8, true)).toBe(0); // stored
      expect(dv.getUint32(off + 14, true)).toBe(crc32(e.bytes));
      expect(dv.getUint32(off + 18, true)).toBe(e.bytes.length);
      expect(dv.getUint32(off + 22, true)).toBe(e.bytes.length);
      expect(dv.getUint16(off + 26, true)).toBe(name.length);
      expect(zip.slice(off + 30, off + 30 + name.length)).toEqual(name);
      expect(zip.slice(off + 30 + name.length, off + 30 + name.length + e.bytes.length)).toEqual(e.bytes);
      // セントラルディレクトリ側
      expect(dv.getUint32(cd, true)).toBe(0x02014b50);
      expect(dv.getUint16(cd + 8, true) & 0x0800).toBe(0x0800);
      expect(dv.getUint32(cd + 16, true)).toBe(crc32(e.bytes));
      expect(dv.getUint32(cd + 42, true)).toBe(off);
      expect(zip.slice(cd + 46, cd + 46 + name.length)).toEqual(name);
      off += 30 + name.length + e.bytes.length;
      cd += 46 + name.length;
    }
    expect(off).toBe(cdOffset);
  });

  it('出力は再現可能（同じ入力で同じバイト列）', () => {
    expect(createZip(entries)).toEqual(zip);
  });

  it('空のZIPも作れる。65536件は拒否する', () => {
    expect(createZip([]).length).toBe(22);
    const many = Array.from({ length: 65536 }, (_, i) => ({ path: `f${i}`, bytes: new Uint8Array() }));
    expect(() => createZip(many)).toThrow(ZipTooLargeError);
  });
});

const python = spawnSync('python3', ['--version']).status === 0 ? 'python3' : spawnSync('python', ['--version']).status === 0 ? 'python' : null;

describe.skipIf(python === null)('createZip: 一般的なZIP展開処理（Python zipfile）での読み戻し', () => {
  it('CRC検証・UTF-8名・内容・BOMを含めて一致する', () => {
    const entries = [
      { path: 'Plugin A/Kit 1.pitchlist', bytes: utf8Bytes('<?xml?>日本語', true) },
      { path: 'Plugin A/Kit 1 (2).pitchlist', bytes: utf8Bytes('dup', true) },
      { path: 'プラグイン/キット.tsv', bytes: utf8Bytes('Pitch\tNote\r\n36\tC1\r\n', false) },
      { path: 'empty.csv', bytes: new Uint8Array() },
    ];
    const dir = mkdtempSync(join(tmpdir(), 'qbzip-'));
    try {
      const file = join(dir, 'a.zip');
      writeFileSync(file, createZip(entries));
      const script = [
        'import zipfile, json, sys',
        'z = zipfile.ZipFile(sys.argv[1])',
        'bad = z.testzip()',
        'out = {"bad": bad, "items": [{"name": i.filename, "utf8": bool(i.flag_bits & 0x800), "comp": i.compress_type, "data": z.read(i.filename).hex()} for i in z.infolist()]}',
        'sys.stdout.write(json.dumps(out))',
      ].join('\n');
      const r = spawnSync(python!, ['-I', '-c', script, file], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      const got = JSON.parse(r.stdout) as { bad: string | null; items: { name: string; utf8: boolean; comp: number; data: string }[] };
      expect(got.bad).toBeNull();
      expect(got.items.map((i) => i.name)).toEqual(entries.map((e) => e.path));
      expect(got.items.every((i) => i.utf8 && i.comp === 0)).toBe(true);
      got.items.forEach((i, n) => expect(i.data).toBe(Buffer.from(entries[n]!.bytes).toString('hex')));
      expect(got.items[0]!.data.startsWith('efbbbf')).toBe(true); // BOM が保たれる
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
