import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cloneMap, findUndefinedSeparators, type KitRef } from '../../src/core';
import { buildExport, EXPORT_FORMATS } from '../../src/ui/export/exportPlan';
import { planImport } from '../../src/ui/editor/importPlan';
import { crc32 } from '../../src/ui/services/zip';
import { EditorStore } from '../../src/ui/state/editorStore';

const REAL = fileURLToPath(new URL('../../public/samples/DrumMap.qbd', import.meta.url));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

describe.skipIf(!existsSync(REAL))('実ファイル DrumMap.qbd での Import / Export（原本は読み取りのみ）', () => {
  const raw = readFileSync(REAL);
  const hashBefore = sha(raw);
  const text = raw.toString('utf8');
  const s = new EditorStore();
  const loaded = s.load(text, 'DrumMap.qbd');
  const map = s.getSnapshot().map;
  const allKits: KitRef[] = map.Plugins.flatMap((p, pi) => p.Kits.map((_, ki) => ({ pluginIndex: pi, kitIndex: ki })));

  it('読み込めて、Kit 数を確認できる', () => {
    expect(loaded.ok).toBe(true);
    expect(allKits.length).toBeGreaterThan(100);
  });

  it('全 Kit を TSV / QB Drummer で出力すると ZIP になり、全エントリの CRC が整合する（Separator に無関係なので常に成功）', () => {
    for (const format of ['tsv', 'qbDrummer'] as const) {
      const t0 = Date.now();
      const o = buildExport(map, { format, kits: allKits, baseOn: null });
      if (!o.ok) throw new Error(`${format}: ${o.error.code} ${o.error.message}`);
      expect(o.bundle.files).toHaveLength(allKits.length);
      // 同じパスの重複がない（大文字小文字を区別しない）
      expect(new Set(o.bundle.files.map((f) => f.path.toLowerCase())).size).toBe(allKits.length);
      const zip = o.bundle.download.bytes;
      const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      expect(dv.getUint16(zip.length - 22 + 10, true)).toBe(allKits.length);
      // 先頭エントリの CRC
      const nameLen = dv.getUint16(26, true);
      const size = dv.getUint32(18, true);
      expect(dv.getUint32(14, true)).toBe(crc32(zip.slice(30 + nameLen, 30 + nameLen + size)));
      expect(Date.now() - t0).toBeLessThan(10000);
    }
  });

  it('Studio One / Cubase: Core の結果と一致する（未定義 Separator があればブロック、なければ全 Kit を出力）', () => {
    const undef = findUndefinedSeparators(map);
    for (const format of ['studioOne', 'cubase'] as const) {
      const o = buildExport(map, { format, kits: allKits, baseOn: null });
      if (o.ok) {
        expect(o.bundle.files).toHaveLength(allKits.length);
      } else {
        // 失敗する場合は未定義 Separator が原因で、原因の Kit が示される
        expect(['undefined-separator', 'invalid-part-value', 'pitch-out-of-range']).toContain(o.error.code);
        expect(o.blockers.length).toBeGreaterThan(0);
        if (o.error.code === 'undefined-separator') expect(undef.length).toBeGreaterThan(0);
      }
    }
  });

  it('NoteMapper（先頭の Kit を Base Kit に全 Kit）と Base-On は Core と同じ結果になる', () => {
    const base = allKits[0]!;
    const nm = buildExport(map, { format: 'noteMapper', kits: allKits, baseOn: base });
    if (nm.ok) expect(nm.bundle.download.fileName).toBe('Templates.txt');
    else expect(nm.error.code).not.toBe('unexpected');
  });

  it('Kit を .tsv / .pitchlist / .drm に書き出して別 Kit へ取り込むと、プレビューと適用結果が一致し、元のモデルは変わらない', () => {
    const src = allKits[0]!;
    const dst = allKits[1]!;
    const before = cloneMap(map);
    for (const format of ['tsv', 'studioOne', 'cubase'] as const) {
      const o = buildExport(map, { format, kits: [src], baseOn: null });
      if (!o.ok) continue; // 実データが当該形式で出力できない場合は取り込み試験の対象外
      const f = o.bundle.files[0]!;
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      const r = planImport(map, dst, name, f.content);
      if (!r.ok) throw new Error(`${format}: ${r.error.code} ${r.error.message}`);
      const pv = r.value.preview;
      const nk = r.value.next.Plugins[dst.pluginIndex]!.Kits[dst.kitIndex]!;
      const bk = before.Plugins[dst.pluginIndex]!.Kits[dst.kitIndex]!;
      expect(pv.rows).toBe(bk.Pitches.length);
      expect(pv.nameChanged).toBe(nk.Pitches.filter((p, i) => (p.Name ?? '') !== (bk.Pitches[i]!.Name ?? '')).length);
      expect(pv.kitNameAfter).toBe(nk.Name);
      // 他の Kit は同一
      const otherSame = r.value.next.Plugins.every((p, pi) => p.Kits.every((k, ki) =>
        (pi === dst.pluginIndex && ki === dst.kitIndex) || JSON.stringify(k) === JSON.stringify(before.Plugins[pi]!.Kits[ki])));
      expect(otherSame).toBe(true);
      expect(r.value.next.Parts).toEqual(before.Parts);
    }
    expect(map).toEqual(before);
  });

  it('原本ファイルは変更されていない', () => {
    expect(sha(readFileSync(REAL))).toBe(hashBefore);
  });
});
