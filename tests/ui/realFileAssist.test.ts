import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyAutoAssign, compressForward, copyArticulations, defaultPartNameDictionary, parseQbd, resetOrderByPitch, serializeQbd,
  type KitRef, type MapData,
} from '../../src/core';
import { contentKey, EditorStore } from '../../src/ui/state/editorStore';

// Windows版アプリが保存した実ファイル（無ければスキップ）。編集補助の実データでの動作・保存・再読込を確認する。
const REAL = fileURLToPath(new URL('../../public/samples/DrumMap.qbd', import.meta.url));

describe.skipIf(!existsSync(REAL))('実ファイル DrumMap.qbd での編集補助', () => {
  const text = existsSync(REAL) ? readFileSync(REAL, 'utf8') : '';
  const refs = (m: MapData): KitRef[] => m.Plugins.flatMap((p, pi) => p.Kits.map((_, ki) => ({ pluginIndex: pi, kitIndex: ki })));
  const kitOf = (m: MapData, r: KitRef) => m.Plugins[r.pluginIndex]!.Kits[r.kitIndex]!;

  function loaded() {
    const s = new EditorStore();
    expect(s.load(text, 'DrumMap.qbd').ok).toBe(true);
    return s;
  }

  it('全 Kit に Reset Order → Compress Forward を適用しても、行の内容（Pitch・Name・割当・Separator・Extra）は失われない', () => {
    const s = loaded();
    const before = s.getSnapshot().map;
    const t0 = performance.now();
    for (const r of refs(before)) {
      expect(s.edit('reset', (m) => resetOrderByPitch(m, r)).ok).toBe(true);
      expect(s.edit('compress', (m) => compressForward(m, r)).ok).toBe(true);
    }
    const ms = performance.now() - t0;
    const after = s.getSnapshot().map;
    const key = (m: MapData, r: KitRef) => kitOf(m, r).Pitches.map((p) => JSON.stringify({ ...p, DisplayOrder: 0 })).sort();
    for (const r of refs(before)) {
      expect(key(after, r)).toEqual(key(before, r));
      expect(kitOf(after, r).Pitches.map((p) => p.DisplayOrder)).toEqual(kitOf(after, r).Pitches.map((_, i) => i + 1));
    }
    console.log(`[Phase4 実ファイル] ${refs(before).length} Kit に Reset Order＋Compress Forward: 合計 ${ms.toFixed(1)} ms`);
  }, 15000); // 約 4〜5 秒かかり、既定の 5 秒では負荷で不安定なため、このテストだけ延長する

  it('Reset Order は Pitch 昇順になり、保存→再読込で同じ順序と内容になる', () => {
    const s = loaded();
    const r = refs(s.getSnapshot().map)[0]!;
    s.edit('move', (m) => compressForward(m, r));
    s.edit('reset', (m) => resetOrderByPitch(m, r));
    const pitches = kitOf(s.getSnapshot().map, r).Pitches.map((p) => p.Pitch);
    expect([...pitches].sort((a, b) => a - b)).toEqual(pitches);
    const saved = serializeQbd(s.getSnapshot().map);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const re = parseQbd(saved.value.text);
    expect(re.ok).toBe(true);
    if (re.ok) expect(kitOf(re.value, r).Pitches.map((p) => p.Pitch)).toEqual(pitches);
  });

  it('Auto Assign: 実データで Kit ごとに1操作で適用でき、Undo で完全に戻り、保存→再読込で割当が保たれる', () => {
    const s = loaded();
    const base = s.getSnapshot().map;
    const dict = defaultPartNameDictionary();
    let totalAssigned = 0;
    let applied = 0;
    const t0 = performance.now();
    const targets = refs(base).slice(0, 10); // 履歴上限（30）を超えないよう先頭の10 Kit に適用する
    for (const r of targets) {
      const before = s.getSnapshot().historyLength;
      const res = s.edit('auto', (m) => applyAutoAssign(m, r, dict));
      expect(res.ok).toBe(true);
      if (res.ok && res.value.changed) {
        applied++;
        totalAssigned += (res.value as unknown as { assigned: number }).assigned;
        expect(s.getSnapshot().historyLength).toBe(Math.min(before + 1, 30));
      }
    }
    console.log(`[Phase4 実ファイル] Auto Assign: ${targets.length} Kit 中 ${applied} Kit に適用、割当 ${totalAssigned} 行、${(performance.now() - t0).toFixed(1)} ms`);
    const after = s.getSnapshot().map;
    // 他の Kit と Parts は不変（対象 Kit の行だけが変わる）
    expect(after.Parts).toBe(base.Parts);
    const saved = serializeQbd(after);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const re = parseQbd(saved.value.text);
    expect(re.ok).toBe(true);
    if (re.ok) {
      const a = serializeQbd(re.value);
      expect(a.ok && JSON.parse(a.value.text)).toEqual(JSON.parse(saved.value.text));
    }
    while (s.undo());
    expect(contentKey(s.getSnapshot().map)).toBe(contentKey(base));
    expect(s.getSnapshot().dirty).toBe(false);
  });

  it('Copy Articulation: 実データの Kit 間コピーが Pitch 番号で行われ、Undo で戻る（曖昧なデータは失敗として扱う）', () => {
    const s = loaded();
    const all = refs(s.getSnapshot().map);
    const src = all.find((r) => kitOf(s.getSnapshot().map, r).Pitches.some((p) => p.ArticulationID !== 0));
    if (!src) return; // 割当のある Kit がなければ対象外
    const dst = all.find((r) => r.pluginIndex !== src.pluginIndex || r.kitIndex !== src.kitIndex)!;
    const base = s.getSnapshot().map;
    const res = s.edit('copy', (m) => copyArticulations(m, src, dst));
    if (!res.ok) {
      expect(['ambiguous-pitch', 'articulation-not-found']).toContain(res.error.code);
      expect(s.getSnapshot().map).toBe(base);
      return;
    }
    const sPitch = new Map(kitOf(base, src).Pitches.map((p) => [p.Pitch, p]));
    for (const row of kitOf(s.getSnapshot().map, dst).Pitches) {
      const orig = sPitch.get(row.Pitch);
      if (row.Name && row.Name.trim() !== '' && orig) expect(row.ArticulationID).toBe(orig.ArticulationID);
    }
    s.undo();
    expect(s.getSnapshot().map).toBe(base);
  });
});
