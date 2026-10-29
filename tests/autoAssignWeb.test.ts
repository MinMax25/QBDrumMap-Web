import { describe, expect, it } from 'vitest';
import {
  autoAssignArticulations, defaultPartNameDictionary, enumName, isNullOrWhiteSpace, parseQbd, PLUGIN_TYPES, separatorToString,
  type KitRef, type MapData, type PartNameAlias,
} from '../src/core';
import { generateAutoAssignInputs } from './golden/autoAssignInputs';

// Auto Assign の Web改善モード（既定）のテスト。Windows互換モード（mode: 'windows'）は autoAssign.test.ts と C# 照合テスト。
// 改善は2点だけ: ①Unload / Duplicate を Separate で上書きしない ②ID=0 への一致を割当成功に数えない。
// （Parts に存在しない ArticulationID を未割当・候補外として扱う動作は、Windows版 v2.1.0 と同じ挙動で、改善ではない）

type Row = [pitch: number, name: string | null, art?: number, sep?: string | number];
const build = (plugins: { type?: string; kits: { name: string; rows: Row[] }[] }[], parts: object[]): MapData => {
  const r = parseQbd(JSON.stringify({
    Plugins: plugins.map((p, pi) => ({
      ID: pi + 1, Name: `P${pi}`, ...(p.type ? { PluginType: p.type } : {}),
      Kits: p.kits.map((k, ki) => ({
        ID: pi * 10 + ki + 1, Name: k.name,
        Pitches: k.rows.map(([Pitch, Name, ArticulationID, Separator]) => ({
          Pitch, ...(Name !== null ? { Name } : {}), ...(ArticulationID !== undefined ? { ArticulationID } : {}),
          ...(Separator !== undefined ? { Separator } : {}),
        })),
      })),
    })),
    Parts: parts,
  }));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const part = (id: number, name: string, arts: [number, string][]): object => ({
  ID: id, Name: name, Articulations: arts.map(([ID, Name], i) => ({ ID, Name, DrumMapOrder: id * 100 + i })),
});
const DICT = defaultPartNameDictionary();
const at = (pi: number, ki: number): KitRef => ({ pluginIndex: pi, kitIndex: ki });
const run = (m: MapData, ref: KitRef, mode?: 'web' | 'windows', dict: readonly PartNameAlias[] = DICT) => {
  const r = autoAssignArticulations(m, ref, dict, mode ? { mode } : {});
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const rowsOf = (m: MapData, pi: number, ki: number): string[] =>
  m.Plugins[pi]!.Kits[ki]!.Pitches.map((p) => `${p.Pitch}:${p.ArticulationID}:${separatorToString(p.Separator)}`);
const KICK = part(1, 'Kick', [[1, 'Kick']]);

describe('Web改善 ①: 割当先が見つからない行の Unload / Duplicate を保持する', () => {
  const m = build([{ kits: [{ name: 'T', rows: [
    [10, 'zzz', 0, 'Unload'], [11, 'zzz', 0, 'Duplicate'], [12, 'zzz', 0, 'None'], [13, 'zzz', 0, 'Separate'], [14, 'zzz', 0, 99], [15, 'zzz'],
  ] }] }], [KICK]);

  it('Unload / Duplicate は保持し、それ以外（None・Separate・未定義値・未設定）は従来どおり Separate。件数は skipped', () => {
    const r = run(m, at(0, 0));
    expect(rowsOf(r.map, 0, 0)).toEqual(['10:0:Unload', '11:0:Duplicate', '12:0:Separate', '13:0:Separate', '14:0:Separate', '15:0:Separate']);
    expect([r.assigned, r.skipped]).toEqual([0, 6]);
  });

  it('Windows互換モードでは従来どおり全て Separate（対比）', () => {
    const r = run(m, at(0, 0), 'windows');
    expect(rowsOf(r.map, 0, 0).map((x) => x.split(':')[2])).toEqual(Array(6).fill('Separate'));
  });

  it('未承認の挙動は変更しない: GM パーカッション域は Unload でも Separate に上書きする（Windows版と同じ）', () => {
    const g = build([{ type: 'GM', kits: [{ name: 'T', rows: [[60, 'Bongo', 0, 'Unload']] }] }], [KICK]);
    expect(rowsOf(run(g, at(0, 0)).map, 0, 0)).toEqual(['60:0:Separate']);
  });

  it('割り当てられた行の Separator の扱いは従来どおり（単独なら保持、重複時は整理）', () => {
    const t = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'T', rows: [[36, 'Kick', 0, 'Unload'], [35, 'Kick', 0, 'Duplicate']] }] }], [KICK]);
    // 両方とも今回割り当て。標準ドラムノートの先頭 36 が代表(None)、35 は Duplicate
    expect(rowsOf(run(t, at(0, 1)).map, 0, 1)).toEqual(['36:1:None', '35:1:Duplicate']);
  });
});

describe('Windows版と共通: Parts に存在しない ArticulationID を候補にしない', () => {
  const parts = [part(1, 'Kick', [[1, 'Kick'], [5, 'Kick5']])];

  it('存在しないIDの行はスキップして、次の候補（同じPluginの次の行、他のPlugin）を探す', () => {
    const m = build([{ kits: [
      { name: 'X', rows: [[36, 'Kick', 8888], [37, 'Kick', 5]] },
      { name: 'T', rows: [[36, 'Kick']] },
    ] }], parts);
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual(['36:5:None']);
    expect(rowsOf(run(m, at(0, 1), 'windows').map, 0, 1)).toEqual(['36:5:None']); // Windows互換モードも同じ
  });

  it('同じPluginの候補が全て不正なら、他のPluginの有効な候補を使う', () => {
    const m = build([
      { kits: [{ name: 'X', rows: [[36, 'Kick', 5]] }] },
      { kits: [{ name: 'Y', rows: [[36, 'Kick', 8888]] }, { name: 'T', rows: [[36, 'Kick']] }] },
    ], parts);
    expect(rowsOf(run(m, at(1, 1)).map, 1, 1)).toEqual(['36:5:None']);
  });

  it('他Kitの候補が全て不正なら、辞書照合へ進む', () => {
    const m = build([{ kits: [{ name: 'X', rows: [[36, 'Kick', 8888]] }, { name: 'T', rows: [[36, 'Kick']] }] }], parts);
    const r = run(m, at(0, 1));
    expect(rowsOf(r.map, 0, 1)).toEqual(['36:1:None']);
    expect([r.assigned, r.skipped]).toEqual([1, 0]);
    // 辞書が空でも、Part 名と入力名の語が一致すれば割り当てる
    const r2 = run(m, at(0, 1), undefined, []);
    expect(rowsOf(r2.map, 0, 1)).toEqual(['36:1:None']);
    expect([r2.assigned, r2.skipped]).toEqual([1, 0]);
  });

  it('Duplicate / Unload の行や、ID=0 を除く有効なIDは従来どおり候補になる', () => {
    const m = build([{ kits: [{ name: 'X', rows: [[36, 'Kick', 5, 'Duplicate']] }, { name: 'T', rows: [[36, 'Kick']] }] }], parts);
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual(['36:5:None']);
  });
});

describe('Web改善 ②: ID=0 の Articulation に一致しても割当成功に数えない', () => {
  const parts = [part(1, 'Kick', [[0, 'Kick']])];

  it('assigned に数えず skipped に数える。ArticulationID は 0 のまま、Separator は「見つからない」と同じ扱い', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[36, 'Kick'], [37, 'Kick', 0, 'Unload'], [38, 'Kick', 0, 'Duplicate']] }] }], parts);
    const r = run(m, at(0, 0));
    expect(rowsOf(r.map, 0, 0)).toEqual(['36:0:Separate', '37:0:Unload', '38:0:Duplicate']);
    expect([r.assigned, r.skipped]).toEqual([0, 3]);
  });

  it('Windows互換モードでは従来どおり assigned に数える（対比）', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[36, 'Kick']] }] }], parts);
    const r = run(m, at(0, 0), 'windows');
    expect([r.assigned, r.skipped]).toEqual([1, 0]);
    expect(rowsOf(r.map, 0, 0)).toEqual(['36:0:None']);
  });

  it('ID=0 の行は重複の整理の対象にならない', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[36, 'Kick'], [35, 'Kick']] }] }], parts);
    expect(rowsOf(run(m, at(0, 0)).map, 0, 0)).toEqual(['36:0:Separate', '35:0:Separate']);
  });

  it('他Kitの割当元が ID=0 の行は従来どおり対象外（候補にならない）', () => {
    const m = build([{ kits: [{ name: 'X', rows: [[36, 'Kick', 0]] }, { name: 'T', rows: [[36, 'Kick']] }] }], [part(1, 'Kick', [[1, 'Kick']])]);
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual(['36:1:None']);
  });
});

describe('Web改善モードが既定である', () => {
  it('mode を省略すると Web 版の挙動', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[10, 'zzz', 0, 'Unload']] }] }], [KICK]);
    expect(rowsOf(run(m, at(0, 0)).map, 0, 0)).toEqual(['10:0:Unload']);
    expect(rowsOf(run(m, at(0, 0), 'web').map, 0, 0)).toEqual(['10:0:Unload']);
  });
});

describe('Web改善モード: 600 入力に対する不変条件', () => {
  const inputs = generateAutoAssignInputs(600);

  it('割当は Parts に存在する非0のID、件数は結果と一致、他の行・他のKitは不変、入力は不変、2回目は何も割り当てない', () => {
    let assignedTotal = 0, skippedTotal = 0, preserved = 0, zeroSkipped = 0;
    inputs.forEach((inp) => {
      const parsed = parseQbd(JSON.stringify(inp.map));
      if (!parsed.ok) throw new Error(inp.tag);
      const m = parsed.value;
      const snapshot = JSON.stringify(m);
      const ref: KitRef = { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] };
      const validIds = new Set(m.Parts.flatMap((p) => p.Articulations.map((a) => a.ID)));
      const r = autoAssignArticulations(m, ref, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      expect(JSON.stringify(m), `${inp.tag} 入力不変`).toBe(snapshot);

      let assigned = 0, considered = 0;
      m.Plugins.forEach((pl, pi) => pl.Kits.forEach((k, ki) => {
        const after = r.value.map.Plugins[pi]!.Kits[ki]!;
        expect(after.Pitches.length).toBe(k.Pitches.length);
        k.Pitches.forEach((p, i) => {
          const q = after.Pitches[i]!;
          expect([q.Pitch, q.Name, q.DisplayOrder], `${inp.tag} 不変の項目`).toEqual([p.Pitch, p.Name, p.DisplayOrder]);
          if (pi !== ref.pluginIndex || ki !== ref.kitIndex) {
            expect([q.ArticulationID, q.Separator]).toEqual([p.ArticulationID, p.Separator]);
            return;
          }
          if (p.ArticulationID !== 0 && validIds.has(p.ArticulationID)) {
            expect([q.ArticulationID, q.Separator], `${inp.tag} 割当済みの行は不変`).toEqual([p.ArticulationID, p.Separator]);
            return;
          }
          if (q.ArticulationID !== p.ArticulationID) {
            assigned++;
            considered++;
            expect(validIds.has(q.ArticulationID), `${inp.tag} 割り当てたIDが Parts に存在する`).toBe(true);
          } else if (!isNullOrWhiteSpace(q.Name)) {
            // 割り当てられなかった名前付きの行: GM パーカッション域か、skipped の行
            const sepBefore = separatorToString(p.Separator);
            const sepAfter = separatorToString(q.Separator);
            const tn = enumName(PLUGIN_TYPES, 0, pl.PluginType);
            const gmPerc = ['GM', 'GM2', 'GS', 'XG'].includes(tn ?? '') && [54, 56, 58, ...Array.from({ length: 22 }, (_, j) => 60 + j)].includes(p.Pitch);
            if (gmPerc) {
              expect(sepAfter).toBe('Separate');
            } else {
              considered++;
              if (sepBefore === 'Unload' || sepBefore === 'Duplicate') { expect(sepAfter, `${inp.tag} 保持`).toBe(sepBefore); preserved++; }
              else expect(sepAfter, `${inp.tag} Separate`).toBe('Separate');
            }
          }
        });
      }));
      expect(r.value.assigned, `${inp.tag} assigned`).toBe(assigned);
      expect(r.value.assigned + r.value.skipped, `${inp.tag} assigned + skipped = 対象の行数`).toBe(considered);
      assignedTotal += r.value.assigned;
      skippedTotal += r.value.skipped;
      if (r.value.skipped > 0) zeroSkipped++;
      const again = autoAssignArticulations(r.value.map, ref, inp.dictionary);
      if (!again.ok) throw new Error(inp.tag);
      expect(again.value.assigned, `${inp.tag} 2回目`).toBe(0);
      expect(JSON.stringify(again.value.map.Plugins), `${inp.tag} 2回目で割当済みは変わらない`).toBe(JSON.stringify(r.value.map.Plugins));
    });
    expect(assignedTotal).toBeGreaterThan(300);
    expect(skippedTotal).toBeGreaterThan(300);
    expect(preserved).toBeGreaterThan(5);
    expect(zeroSkipped).toBeGreaterThan(100);
  });
});
