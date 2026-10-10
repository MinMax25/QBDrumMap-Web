import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { autoAssignArticulations, parseQbd, separatorToString, type MapData } from '../../src/core';
import { generateAutoAssignInputs } from './autoAssignInputs';

// autoAssignExpected.json: Windows版の UtilArticulationAutoAssign（無改変）を2回続けて実行した後の全Kitの状態。
// ※ Windows版アプリ本体(WPF)の実機実行ではない。辞書・GMDrumMap・割当ロジックはWindows版のソースそのもの。
const dir = dirname(fileURLToPath(import.meta.url));
interface Exp { error: string | null; a1: number; s1: number; st1: string | null; a2: number; s2: number; st2: string | null }
const expected = JSON.parse(readFileSync(`${dir}/autoAssignExpected.json`, 'utf8')) as Exp[];

/** ハーネスの AllState と同じ書式 */
const state = (m: MapData): string =>
  m.Plugins.flatMap((p) => p.Kits).map((k) =>
    `${k.Name}=${k.Pitches.map((x) => `${x.Pitch}:${x.ArticulationID}:${separatorToString(x.Separator)}`).join(';')}`).join('|');

describe('Auto Assign: Windows版C#コードの出力との照合', () => {
  const inputs = generateAutoAssignInputs(600);

  it('入力数が一致する', () => {
    expect(expected).toHaveLength(inputs.length);
  });

  it('全入力で 割当数・スキップ数・全Kitの状態が（1回目・2回目とも）一致する', () => {
    let assigned = 0, skipped = 0, changedKits = 0, gmKits = 0;
    inputs.forEach((inp, n) => {
      const exp = expected[n]!;
      const label = `${inp.tag}`;
      expect(exp.error, `${label}: C#が例外`).toBeNull();
      const parsed = parseQbd(JSON.stringify(inp.map));
      expect(parsed.ok, `${label}: 読み込み`).toBe(true);
      if (!parsed.ok) return;
      const before = state(parsed.value);
      const r1 = autoAssignArticulations(parsed.value, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary, { mode: 'windows' });
      expect(r1.ok, label).toBe(true);
      if (!r1.ok) return;
      expect(state(parsed.value), `${label}: 入力は変更されない`).toBe(before);
      expect({ a: r1.value.assigned, s: r1.value.skipped }, `${label} 1回目の件数`).toEqual({ a: exp.a1, s: exp.s1 });
      expect(state(r1.value.map), `${label} 1回目の状態`).toBe(exp.st1);
      const r2 = autoAssignArticulations(r1.value.map, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary, { mode: 'windows' });
      expect(r2.ok, label).toBe(true);
      if (!r2.ok) return;
      expect({ a: r2.value.assigned, s: r2.value.skipped }, `${label} 2回目の件数`).toEqual({ a: exp.a2, s: exp.s2 });
      expect(state(r2.value.map), `${label} 2回目の状態`).toBe(exp.st2);
      assigned += r1.value.assigned;
      skipped += r1.value.skipped;
      if (state(r1.value.map) !== before) changedKits++;
      if (before !== exp.st1) gmKits++;
    });
    // 網羅性: 割当・スキップ・変更ありの入力が十分に含まれている
    console.log('autoAssign stats', JSON.stringify({ assigned, skipped, changedKits, gmKits }));
    expect(assigned).toBeGreaterThan(300);
    expect(skipped).toBeGreaterThan(300);
    expect(changedKits).toBeGreaterThan(300);
  });
});
