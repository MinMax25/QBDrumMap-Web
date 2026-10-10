// 無圧縮（stored）ZIPの作成。依存を追加せず、ブラウザAPIにも依存しない（純粋関数）。
// 仕様: 各エントリのファイル名はUTF-8（汎用ビット11を設定）、パス区切りは '/'、CRC-32付き、ZIP64は使わない。

export interface ZipEntry {
  /** アーカイブ内のパス。区切りは '/'（呼び出し側で安全化済みであること） */
  path: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
/** MS-DOS 日時の固定値（1980-01-01 00:00。出力を再現可能にするため現在時刻を使わない） */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export class ZipTooLargeError extends Error {}

/** ZIP（stored）のバイト列を作る。エントリ数が65535超、またはサイズが4GiB超ならエラー（ZIP64は非対応） */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new ZipTooLargeError('ファイル数が多すぎます');
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = encoder.encode(e.path);
    const crc = crc32(e.bytes);
    const size = e.bytes.length;
    if (size > 0xfffffffe || offset > 0xfffffffe) throw new ZipTooLargeError('ZIPのサイズが上限を超えます');
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // 展開に必要なバージョン
    local.setUint16(6, 0x0800, true); // UTF-8 ファイル名
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, e.bytes);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, DOS_TIME, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  if (offset + cdSize > 0xfffffffe) throw new ZipTooLargeError('ZIPのサイズが上限を超えます');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}
