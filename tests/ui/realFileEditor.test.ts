import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addKit, cloneMap, findUndefinedSeparators, moveKitPitches, moveKits, normalizeIds, updateKitPitch, updatePlugin,
} from '../../src/core';
import { dirtyKey, EditorStore } from '../../src/ui/state/editorStore';

// Windows版アプリが保存した実ファイル（無ければスキップ）。性能・メモリは参考値として標準出力に出し、緩い上限だけを検証する。
const REAL = fileURLToPath(new URL('../../public/samples/DrumMap.qbd', import.meta.url));

describe.skipIf(!existsSync(REAL))('実ファイル DrumMap.qbd での編集・履歴・保存', () => {
  const text = existsSync(REAL) ? readFileSync(REAL, 'utf8') : '';

  it('編集30回の履歴: 応答時間・メモリ（構造共有）と、Undo/Redo・保存をまたぐ整合性', () => {
    const s = new EditorStore();
    expect(s.load(text, 'DrumMap.qbd').ok).toBe(true);
    const kits = s.getSnapshot().map.Plugins.reduce((a, p) => a + p.Kits.length, 0);
    const heap = () => { (globalThis as { gc?: () => void }).gc?.(); return process.memoryUsage().heapUsed; };

    const h0 = heap();
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) {
      const r = s.edit(`e${i}`, (m) => updateKitPitch(m, { pluginIndex: 0, kitIndex: 0 }, i % 128, { Name: `Edited ${i}` }));
      expect(r.ok).toBe(true);
    }
    const perEditMs = (performance.now() - t0) / 30;
    const sharedKB = (heap() - h0) / 1024;
    expect(s.getSnapshot().historyLength).toBe(30);

    // 比較: 全複製(apply)で30回積んだ場合のメモリ
    const s2 = new EditorStore();
    s2.load(text, 'DrumMap.qbd');
    const h1 = heap();
    const t1 = performance.now();
    for (let i = 0; i < 30; i++) {
      s2.apply(`e${i}`, (m) => {
        const r = updateKitPitch(m, { pluginIndex: 0, kitIndex: 0 }, i % 128, { Name: `Edited ${i}` });
        return r.ok ? { ok: true as const, value: cloneMap(r.value.map) } : r;
      });
    }
    const perApplyMs = (performance.now() - t1) / 30;
    const fullKB = (heap() - h1) / 1024;

    let undoMs = 0;
    const t2 = performance.now();
    while (s.undo()) undoMs++;
    const undoAvg = (performance.now() - t2) / Math.max(undoMs, 1);
    expect(s.getSnapshot().dirty).toBe(false);

    // 保存（正規化）にかかる時間と Dirty 判定の時間
    const t3 = performance.now();
    const p = s.prepareSave('x.qbd');
    const saveMs = performance.now() - t3;
    expect(p.ok).toBe(true);
    const t4 = performance.now();
    dirtyKey(s.getSnapshot().map);
    const dirtyMs = performance.now() - t4;

    // eslint-disable-next-line no-console
    console.info(`[実測] Kit=${kits} 構造共有: 1編集=${perEditMs.toFixed(1)}ms 30件で約${sharedKB.toFixed(0)}KB / 全複製: 1編集=${perApplyMs.toFixed(1)}ms 30件で約${fullKB.toFixed(0)}KB / Undo=${undoAvg.toFixed(1)}ms / prepareSave=${saveMs.toFixed(0)}ms / dirtyKey=${dirtyMs.toFixed(0)}ms`);
    expect(perEditMs).toBeLessThan(500); // 緩い上限（応答性の目安）
    // メモリの比較は GC を強制できる場合（node --expose-gc）だけ検証する（通常実行ではヒープの揺らぎで不安定なため）
    if ((globalThis as { gc?: unknown }).gc) expect(sharedKB).toBeLessThan(fullKB);
  });

  it('実データで Plugin/Kit の編集関数が成功し、保存して再読込できる。未定義Separatorは無い', () => {
    const s = new EditorStore();
    s.load(text, 'DrumMap.qbd');
    const before = s.getSnapshot().map;
    expect(findUndefinedSeparators(before)).toEqual([]);
    expect(s.edit('Plugin名', (m) => updatePlugin(m, 0, { Name: 'Edited Plugin' })).ok).toBe(true);
    expect(s.edit('Kit追加', (m) => addKit(m, 0)).ok).toBe(true);
    expect(s.edit('Kit移動', (m) => moveKits(m, 0, [s.getSnapshot().map.Plugins[0]!.Kits.length - 1], 'top')).ok).toBe(true);
    expect(s.edit('行移動', (m) => moveKitPitches(m, { pluginIndex: 0, kitIndex: 1 }, [5], 'top')).ok).toBe(true);
    expect(normalizeIds(s.getSnapshot().map).ok).toBe(true);
    const p = s.prepareSave('x.qbd');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const s3 = new EditorStore();
    expect(s3.load(p.value.text, 'x.qbd').ok).toBe(true);
    expect(s3.getSnapshot().map.Plugins[0]!.Name).toBe('Edited Plugin');
    // 元のモデルは変更されていない（履歴のスナップショットが共有していても壊れない）
    expect(s.undo() && s.undo() && s.undo() && s.undo()).toBe(true);
    expect(s.getSnapshot().map).toBe(before);
  });
});
