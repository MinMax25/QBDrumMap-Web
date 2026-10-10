import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cloneMap, convertMidi, exportKits, type KitRef, type MidiConvertFormat } from '../../src/core';
import { planConvert } from '../../src/ui/convertMidi/convertPlan';
import { buildExport } from '../../src/ui/export/exportPlan';
import { EditorStore } from '../../src/ui/state/editorStore';

const REAL = fileURLToPath(new URL('../../public/samples/DrumMap.qbd', import.meta.url));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

const vl = (n: number): number[] => {
  const o = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) o.unshift((n & 0x7f) | 0x80);
  return o;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function smf(notes: number[]): Uint8Array {
  const ev: [number, number[]][] = notes.flatMap((p, i) => [[i * 240, [0x99, p, 100]], [i * 240 + 120, [0x89, p, 0]]] as [number, number[]][]);
  let last = 0;
  const body = ev.flatMap(([t, b]) => { const d = vl(t - last); last = t; return [...d, ...b]; });
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body]);
}

describe.skipIf(!existsSync(REAL))('実ファイル DrumMap.qbd での MIDI 変換と設定（原本は読み取りのみ）', () => {
  const raw = readFileSync(REAL);
  const hashBefore = sha(raw);
  const s = new EditorStore();
  s.load(raw.toString('utf8'), 'DrumMap.qbd');
  const map = s.getSnapshot().map;
  const refs: KitRef[] = map.Plugins.flatMap((p, pi) => p.Kits.map((_, ki) => ({ pluginIndex: pi, kitIndex: ki })));
  const baseRef = refs.find((r) => map.Plugins[r.pluginIndex]!.Kits[r.kitIndex]!.Pitches.filter((p) => p.ArticulationID !== 0).length >= 3)!;
  const baseKit = map.Plugins[baseRef.pluginIndex]!.Kits[baseRef.kitIndex]!;
  const notes = baseKit.Pitches.filter((p) => p.ArticulationID !== 0 && p.Pitch >= 0 && p.Pitch <= 127).slice(0, 8).map((p) => p.Pitch);
  const midi = smf(notes);
  // 同名 Kit を避けて、一意な名前の Kit だけを変換先にする（先頭の Kit を Base にした場合の一意性も確認）
  const names = refs.map((r) => map.Plugins[r.pluginIndex]!.Kits[r.kitIndex]!.Name);
  const unique = refs.filter((_, i) => names.filter((n) => n === names[i]).length === 1 && !(refs[i] === baseRef));
  const targets = unique.slice(0, 6);

  it('Format 0/1 の両方で、Core の出力と一致する（変換先 6 Kit）', () => {
    expect(targets.length).toBeGreaterThan(1);
    const t0 = performance.now();
    for (const format of [0, 1] as MidiConvertFormat[]) {
      {
        const o = planConvert(map, { input: midi, fileName: 'real.mid', baseOn: baseRef, targets, format });
        const core = convertMidi(map, baseRef, targets, midi, 'real.mid', { format });
        if (!o.ok || !core.ok) throw new Error(`${format}: ${o.ok ? '' : o.error.code}`);
        expect(o.result.inZip).toBe(format === 0);
        expect(o.result.files).toEqual(core.value.files.map((f) => f.path));
        if (format === 1) expect(o.result.download.bytes).toEqual(core.value.files[0]!.bytes);
      }
    }
    expect(performance.now() - t0).toBeLessThan(10000);
  });

  it('設定の 4 通りで 全 Kit の Studio One / Cubase 出力が Core に同じ設定を渡した結果と一致する', () => {
    for (const useArticulation of [true, false]) {
      for (const useArticulationPitchName of [true, false]) {
        const st = { useArticulation, useArticulationPitchName };
        for (const format of ['studioOne', 'cubase'] as const) {
          const o = buildExport(map, { format, kits: refs, baseOn: null }, st);
          const core = exportKits(map, format, refs, st);
          if (!o.ok || !core.ok) { expect(o.ok).toBe(core.ok); continue; }
          expect(o.bundle.files).toEqual(core.value);
        }
      }
    }
  }, 30000);

  it('モデルは変換・出力で変化せず、原本ファイルも不変', () => {
    const before = cloneMap(map);
    planConvert(map, { input: midi, fileName: 'real.mid', baseOn: baseRef, targets, format: 0 });
    expect(map).toEqual(before);
    expect(s.getSnapshot().dirty).toBe(false);
    expect(sha(readFileSync(REAL))).toBe(hashBefore);
  });
});
