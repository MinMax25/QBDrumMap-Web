import { describe, expect, it } from 'vitest';
import {
  autoAssignArticulations, defaultPartNameDictionary, equalsIgnoreCase, indexOfIgnoreCase, parseQbd, toLowerInvariant, trimDotNet,
  type KitRef, type MapData, type PartNameAlias,
} from '../src/core';

// ---- 準備 ----
type Row = [pitch: number, name: string | null, art?: number, sep?: string | number];
interface KitSpec { name: string; rows: Row[] }
interface PluginSpec { type?: string | number; kits: KitSpec[] }

const build = (plugins: PluginSpec[], parts: object[]): MapData => {
  const r = parseQbd(JSON.stringify({
    Plugins: plugins.map((p, pi) => ({
      ID: pi + 1,
      Name: `P${pi}`,
      ...(p.type !== undefined ? { PluginType: p.type } : {}),
      Kits: p.kits.map((k, ki) => ({
        ID: pi * 10 + ki + 1,
        Name: k.name,
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
const KICK = part(1, 'Kick', [[1, 'Kick']]);
const DICT = defaultPartNameDictionary();
const run = (map: MapData, kit: KitRef, dict: readonly PartNameAlias[] = DICT) => {
  const r = autoAssignArticulations(map, kit, dict, { mode: 'windows' });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const at = (pi: number, ki: number): KitRef => ({ pluginIndex: pi, kitIndex: ki });
/** Kit の行を [pitch, ArticulationID, Separator] で取得 */
const rowsOf = (m: MapData, pi: number, ki: number): [number, number, string | number][] =>
  m.Plugins[pi]!.Kits[ki]!.Pitches.map((p) => [p.Pitch, p.ArticulationID, p.Separator]);

// このファイルは Windows互換モード（mode: 'windows'）のテスト。Web改善モードは autoAssignWeb.test.ts
describe('Auto Assign: 通常の割当', () => {
  it('他のKitの同名の行から割り当て、見つからない行は Separate にする', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'B', rows: [[36, 'Kick'], [38, 'Unknown Thing']] }] }], [KICK]);
    const r = run(m, at(0, 1));
    expect(r.assigned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(rowsOf(r.map, 0, 1)).toEqual([[36, 1, 'None'], [38, 0, 'Separate']]);
  });

  it('Kit名の別名は辞書で正規化して照合する（BD = Bass Drum = Kick）', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Bass Drum', 1]] }, { name: 'B', rows: [[35, 'bd'], [36, 'KICK']] }] }], [KICK]);
    const r = run(m, at(0, 1));
    expect(r.assigned).toBe(2);
    // どちらも新規割当で同じIDが2行 → 標準ドラムノート(35, 36)のうち先頭(35)が代表、36は Duplicate
    expect(rowsOf(r.map, 0, 1)).toEqual([[35, 1, 'None'], [36, 1, 'Duplicate']]);
  });

  it('対象Kit自身の行は割当元にしない（今回割り当てた行から別の行へは伝播しない）', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1], [37, 'Snare']] }] }], [KICK, part(2, 'Snare', [[2, 'Snare']])]);
    const r = run(m, at(0, 0));
    // 37 は辞書で Snare の Part を特定して割り当て（他Kitは無い）
    expect(rowsOf(r.map, 0, 0)).toEqual([[36, 1, 'None'], [37, 2, 'None']]);
  });
});

describe('Auto Assign: 割当元の優先順位', () => {
  const parts = [part(1, 'Kick', [[1, 'Kick'], [5, 'Kick Alt'], [6, 'Kick Alt2']])];

  it('同じPluginのKitを優先し、なければPlugin順・Kit順・行順で最初のもの', () => {
    const m = build([
      { kits: [{ name: 'X', rows: [[36, 'Kick', 5]] }] },
      { kits: [{ name: 'Y', rows: [[36, 'Kick', 6]] }, { name: 'Z', rows: [[36, 'Kick']] }] },
    ], parts);
    expect(rowsOf(run(m, at(1, 1)).map, 1, 1)).toEqual([[36, 6, 'None']]);
    // 同じPluginに候補が無ければ、Plugin順で最初の候補
    const m2 = build([
      { kits: [{ name: 'X', rows: [[36, 'Kick', 5]] }] },
      { kits: [{ name: 'Y', rows: [[36, 'Kick', 6]] }] },
      { kits: [{ name: 'Z', rows: [[36, 'Kick']] }] },
    ], parts);
    expect(rowsOf(run(m2, at(2, 0)).map, 2, 0)).toEqual([[36, 5, 'None']]);
  });

  it('同じPlugin内に同名が複数あるときは、Kit順→行順で最初のもの', () => {
    const m = build([{ kits: [
      { name: 'X', rows: [[40, 'Kick', 6], [36, 'Kick', 5]] },
      { name: 'Y', rows: [[36, 'Kick', 1]] },
      { name: 'T', rows: [[36, 'Kick']] },
    ] }], parts);
    expect(rowsOf(run(m, at(0, 2)).map, 0, 2)).toEqual([[36, 6, 'None']]);
  });

  it('割当元の行は Separator や Articulation の実在を問わない（Duplicate / Unload の行、Partに無いIDも対象）', () => {
    const m = build([{ kits: [{ name: 'X', rows: [[36, 'Kick', 8888, 'Duplicate']] }, { name: 'T', rows: [[36, 'Kick']] }] }], parts);
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual([[36, 8888, 'None']]);
  });

  it('割当元の行は ArticulationID=0 または名前が空白だと対象外', () => {
    const m = build([{ kits: [{ name: 'X', rows: [[36, 'Kick', 0], [37, '  ', 5]] }, { name: 'T', rows: [[36, 'Kick'], [37, '  ']] }] }], parts);
    // 36 は Kick の Part (辞書) の完全一致で ID=1
    const r = run(m, at(0, 1));
    expect(rowsOf(r.map, 0, 1)).toEqual([[36, 1, 'None'], [37, 0, 'None']]);
    expect(r.assigned).toBe(1);
    expect(r.skipped).toBe(0); // 空白名の行は対象外
  });

  it('他Kitの照合が辞書の正規化後の名前で一致しなければ、辞書のPartによる照合に進む', () => {
    const m = build([{ kits: [{ name: 'X', rows: [[36, 'Kick Alt', 5]] }, { name: 'T', rows: [[36, 'Kick Alt2']] }] }], parts);
    // 'Kick Alt2' は X の 'Kick Alt' と一致しない → 辞書で Kick Part → 完全一致なし → 類似度 {kick,alt2} vs {kick,alt2}=1.0 の Kick Alt2(6)
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual([[36, 6, 'None']]);
  });
});

describe('Auto Assign: 辞書による照合（Part の特定・完全一致・類似度）', () => {
  it('行の名前に含まれる最も長い辞書の名前の Part を使う（Hi-Hat と Hat、Floor Tom と Tom）', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[42, 'Floor Tom 2'], [44, 'Pedal Hat']] }] }], [
      part(1, 'Tom', [[10, 'Tom 1'], [11, 'Floor Tom 2']]), part(2, 'Hi-Hat', [[20, 'Hi-Hat Pedal'], [21, 'Open']]),
    ]);
    const r = run(m, at(0, 0));
    expect(rowsOf(r.map, 0, 0)).toEqual([[42, 11, 'None'], [44, 20, 'None']]);
  });

  it('Part名の比較は大文字小文字を区別しない', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[36, 'kick']] }] }], [part(1, 'KICK', [[1, 'kick']])]);
    expect(run(m, at(0, 0)).assigned).toBe(1);
  });

  it('類似度の閾値は 0.6 以上（ちょうど 0.6 は割り当てる、0.5 は割り当てない）', () => {
    const dict = [{ CanonicalName: 'x', Aliases: '' }];
    const parts = [part(1, 'x', [[1, 'x b c d e'], [2, 'x y z w v u']])];
    // {x,b,c} vs {x,b,c,d,e} = 3/5 = 0.6
    const m = build([{ kits: [{ name: 'T', rows: [[10, 'x b c']] }] }], parts);
    expect(rowsOf(run(m, at(0, 0), dict).map, 0, 0)).toEqual([[10, 1, 'None']]);
    // {x,b} vs {x,b,c,d} = 2/4 = 0.5
    const m2 = build([{ kits: [{ name: 'T', rows: [[10, 'x b']] }] }], [part(1, 'x', [[1, 'x b c d']])]);
    const r2 = run(m2, at(0, 0), dict);
    expect(rowsOf(r2.map, 0, 0)).toEqual([[10, 0, 'Separate']]);
    expect(r2.skipped).toBe(1);
  });

  it('類似度が同点のときは Part 内で先の Articulation', () => {
    const dict = [{ CanonicalName: 'x', Aliases: '' }];
    const m = build([{ kits: [{ name: 'T', rows: [[10, 'x a b c']] }] }], [part(1, 'x', [[7, 'x a b d'], [8, 'x a b e'], [9, 'x a b c q']])]);
    // 7: {x,a,b,c}∩{x,a,b,d}=3/5=0.6, 8: 0.6, 9: 4/5=0.8 → 9
    expect(rowsOf(run(m, at(0, 0), dict).map, 0, 0)).toEqual([[10, 9, 'None']]);
    const m2 = build([{ kits: [{ name: 'T', rows: [[10, 'x a b c']] }] }], [part(1, 'x', [[7, 'x a b d'], [8, 'x a b e']])]);
    expect(rowsOf(run(m2, at(0, 0), dict).map, 0, 0)).toEqual([[10, 7, 'None']]);
  });

  it('辞書が空なら辞書による照合は行わず、他Kitの同名だけを使う', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'T', rows: [[36, 'Kick'], [38, 'Snare']] }] }], [KICK]);
    const r = run(m, at(0, 1), []);
    expect(rowsOf(r.map, 0, 1)).toEqual([[36, 1, 'None'], [38, 0, 'Separate']]);
    expect(r.skipped).toBe(1);
  });

  it('別名の置換は長い別名が先（Hi Hat と Hat）、置換結果に後続の置換が掛かる', () => {
    const dict = [{ CanonicalName: 'Hat', Aliases: 'Hi Hat' }, { CanonicalName: 'Closed', Aliases: 'Hat Closed' }];
    // 'Hi Hat' (長さ6) → 'Hat'、続いて 'Hat Closed'(10) は先に処理済み。'hi hat closed' → 長い順: 'Hat Closed'(10) は 'hi hat closed' に含まれる → 'hi Closed'
    const m = build([{ kits: [{ name: 'A', rows: [[42, 'hi Closed', 3]] }, { name: 'T', rows: [[42, 'Hi Hat Closed']] }] }], [part(1, 'Hat', [[3, 'x']])]);
    expect(rowsOf(run(m, at(0, 1), dict).map, 0, 1)).toEqual([[42, 3, 'None']]);
  });
});

describe('Auto Assign: ID=0 の扱い', () => {
  it('ArticulationID=0 の行だけが対象。割当済みの行・名前が空白/無しの行は Separator も含め変更しない', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'T', rows: [
      [30, 'Kick', 1, 'Unload'], [31, null, 0, 'Unload'], [32, '   ', 0, 'Duplicate'], [33, 'Kick', 0, 'Unload'],
    ] }] }], [KICK]);
    const r = run(m, at(0, 1));
    // 33 は今回割り当てた行。30（既存・Unload）と同じIDなので、既存に None の行が無く、今回の行 33 が代表(None)になる
    expect(rowsOf(r.map, 0, 1)).toEqual([[30, 1, 'Unload'], [31, 0, 'Unload'], [32, 0, 'Duplicate'], [33, 1, 'None']]);
    expect(r.assigned).toBe(1);
  });

  it('ID=0 の Articulation に一致した場合は割り当て済みとして数えるが、ArticulationID は 0 のまま（Windows版の挙動）', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[36, 'Kick']] }] }], [part(1, 'Kick', [[0, 'Kick']])]);
    const r = run(m, at(0, 0));
    expect(r.assigned).toBe(1);
    expect(r.skipped).toBe(0);
    expect(rowsOf(r.map, 0, 0)).toEqual([[36, 0, 'None']]);
  });
});

describe('Auto Assign: Separator の扱い', () => {
  it('見つからない行は Separate にする（既存の Unload / Duplicate / 未定義値も上書きされる）', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[10, 'zzz', 0, 'Unload'], [11, 'zzz', 0, 'Duplicate'], [12, 'zzz', 0, 99], [13, 'zzz']] }] }], [KICK]);
    const r = run(m, at(0, 0));
    expect(rowsOf(r.map, 0, 0).map((x) => x[2])).toEqual(['Separate', 'Separate', 'Separate', 'Separate']);
    expect(r.skipped).toBe(4);
  });

  it('割り当てた行の Separator は、同じIDの行が他に無ければそのまま（Unload が残る）', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'T', rows: [[36, 'Kick', 0, 'Unload']] }] }], [KICK]);
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual([[36, 1, 'Unload']]);
  });

  it('同じIDの行が複数: 既存の None 行があればそれが代表、今回割り当てた行は Duplicate', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'T', rows: [[40, 'Kick', 1], [35, 'Kick', 0, 'Unload']] }] }], [KICK]);
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual([[40, 1, 'None'], [35, 1, 'Duplicate']]);
  });

  it('既存の行が None でない場合は、今回割り当てた行から代表を選ぶ（標準ドラムノートを優先）', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'T', rows: [
      [20, 'Kick', 1, 'Duplicate'], [30, 'Kick'], [35, 'Kick'],
    ] }] }], [KICK]);
    // 既存(20)は Duplicate で代表になれない。新規 30(標準外) と 35(標準) → 35 が代表(None)、30 は Duplicate。既存の20は変更しない
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual([[20, 1, 'Duplicate'], [30, 1, 'Duplicate'], [35, 1, 'None']]);
  });

  it('標準ドラムノートが無ければ今回割り当てた行の先頭（行の並び順）が代表', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick', 1]] }, { name: 'T', rows: [[90, 'Kick'], [30, 'Kick']] }] }], [KICK]);
    expect(rowsOf(run(m, at(0, 1)).map, 0, 1)).toEqual([[90, 1, 'None'], [30, 1, 'Duplicate']]);
  });

  it('GM / GM2 / GS / XG のPluginでは、パーカッション域(54, 56, 58, 60–81)を Separate にして割り当てない（件数にも数えない）', () => {
    for (const type of ['GM', 'GM2', 'GS', 'XG', 'gm', 1, 2, 3, 4]) {
      const m = build([{ type, kits: [{ name: 'T', rows: [[60, 'Bongo'], [81, 'Open Triangle'], [58, 'Vibraslap'], [59, 'Kick'], [53, 'Kick']] }] }], [KICK]);
      const r = run(m, at(0, 0));
      expect(rowsOf(r.map, 0, 0).map((x) => x.join(':')), String(type)).toEqual(['60:0:Separate', '81:0:Separate', '58:0:Separate', '59:1:None', '53:1:Duplicate']);
      expect([r.assigned, r.skipped], String(type)).toEqual([2, 0]);
    }
  });

  it('GM でないPlugin（None、未定義の値 9、省略）ではパーカッション域も通常どおり扱う（見つからなければ skipped）', () => {
    for (const type of ['None', 0, 9, undefined]) {
      const m = build([{ ...(type === undefined ? {} : { type }), kits: [{ name: 'T', rows: [[60, 'Bongo']] }] }], [KICK]);
      const r = run(m, at(0, 0));
      expect([r.assigned, r.skipped], String(type)).toEqual([0, 1]);
    }
  });

  it('パーカッション域でも割当済みの行は変更しない', () => {
    const m = build([{ type: 'GM', kits: [{ name: 'T', rows: [[60, 'Bongo', 1, 'Unload']] }] }], [KICK]);
    expect(rowsOf(run(m, at(0, 0)).map, 0, 0)).toEqual([[60, 1, 'Unload']]);
  });
});

describe('Auto Assign: 複数Kit・Plugin、順序、繰り返し', () => {
  const parts = [part(1, 'Kick', [[1, 'Kick']]), part(2, 'Snare', [[2, 'Snare']])];
  const mk = (): MapData => build([
    { kits: [{ name: 'A', rows: [[36, 'Kick', 1], [38, 'Snare', 2]] }, { name: 'B', rows: [[36, 'Kick'], [38, 'SD'], [39, 'Mystery']] }] },
    { type: 'GM', kits: [{ name: 'C', rows: [[36, 'BD'], [60, 'Mystery']] }] },
  ], parts);

  it('指定したKit以外は変更しない', () => {
    const m = mk();
    const r = run(m, at(0, 1));
    expect(rowsOf(r.map, 0, 0)).toEqual(rowsOf(m, 0, 0));
    expect(rowsOf(r.map, 1, 0)).toEqual(rowsOf(m, 1, 0));
    expect(rowsOf(r.map, 0, 1)).toEqual([[36, 1, 'None'], [38, 2, 'None'], [39, 0, 'Separate']]);
  });

  it('入力のMapDataは変更されない（複製を返す）', () => {
    const m = mk();
    const snapshot = JSON.stringify(m);
    const r = run(m, at(0, 1));
    expect(JSON.stringify(m)).toBe(snapshot);
    expect(r.map).not.toBe(m);
    expect(r.map.Plugins[0]!.Kits[1]).not.toBe(m.Plugins[0]!.Kits[1]);
  });

  it('割当後にもう一度実行しても、割当済みの行は変わらない（件数は割当のみ0になる）', () => {
    const r1 = run(mk(), at(0, 1));
    const r2 = run(r1.map, at(0, 1));
    expect(r2.assigned).toBe(0);
    expect(r2.skipped).toBe(1); // 見つからない行は毎回 skipped
    expect(rowsOf(r2.map, 0, 1)).toEqual(rowsOf(r1.map, 0, 1));
    // 3回目以降も同じ
    expect(rowsOf(run(r2.map, at(0, 1)).map, 0, 1)).toEqual(rowsOf(r1.map, 0, 1));
  });

  it('同じ入力から何度実行しても同じ結果になる', () => {
    const m = mk();
    const a = JSON.stringify(run(m, at(0, 1)));
    for (let i = 0; i < 3; i++) expect(JSON.stringify(run(m, at(0, 1)))).toBe(a);
  });

  it('DisplayOrder（表示順）は結果に影響しない。行の配列順は影響する', () => {
    const m = mk();
    const shuffled = JSON.parse(JSON.stringify(m)) as MapData;
    shuffled.Plugins.forEach((p) => p.DisplayOrder = 9 - p.DisplayOrder);
    shuffled.Plugins.forEach((p) => p.Kits.forEach((k) => { k.DisplayOrder = 100 - k.DisplayOrder; k.Pitches.forEach((x, i) => { x.DisplayOrder = (i * 7919) % 31; }); }));
    expect(rowsOf(run(shuffled, at(0, 1)).map, 0, 1)).toEqual(rowsOf(run(m, at(0, 1)).map, 0, 1));
    // 割当元の候補の順序は配列順（DisplayOrderではない）: Plugin の配列順を入れ替えると候補が変わる
    const a = build([
      { kits: [{ name: 'X', rows: [[36, 'Kick', 5]] }] }, { kits: [{ name: 'Y', rows: [[36, 'Kick', 6]] }] }, { kits: [{ name: 'T', rows: [[36, 'Kick']] }] },
    ], parts);
    const b = build([
      { kits: [{ name: 'Y', rows: [[36, 'Kick', 6]] }] }, { kits: [{ name: 'X', rows: [[36, 'Kick', 5]] }] }, { kits: [{ name: 'T', rows: [[36, 'Kick']] }] },
    ], parts);
    expect(rowsOf(run(a, at(2, 0)).map, 2, 0)).toEqual([[36, 5, 'None']]);
    expect(rowsOf(run(b, at(2, 0)).map, 2, 0)).toEqual([[36, 6, 'None']]);
  });

  it('同名のKitが複数あっても、指定した位置（KitRef）のKitだけが対象', () => {
    const m = build([{ kits: [{ name: 'S', rows: [[36, 'Kick', 1]] }, { name: 'S', rows: [[36, 'Kick']] }, { name: 'S', rows: [[36, 'Kick']] }] }], [KICK]);
    const r = run(m, at(0, 2));
    expect(rowsOf(r.map, 0, 1)).toEqual([[36, 0, 'None']]);
    expect(rowsOf(r.map, 0, 2)).toEqual([[36, 1, 'None']]);
  });

  it('Kit以外のデータ（Plugin・Part・未知のフィールド）は保持される', () => {
    const base = JSON.parse(JSON.stringify({ AppName: 'QBDrumMap', ModelVersion: '1.0.0', Zzz: { a: 1 }, Plugins: [{ ID: 1, Name: 'P', Yyy: 2, Kits: [{ ID: 1, Name: 'K', Pitches: [{ Pitch: 36, Name: 'Kick', Www: [1] }] }] }], Parts: [KICK] })) as object;
    const p = parseQbd(JSON.stringify(base));
    if (!p.ok) throw new Error('parse');
    const r = run(p.value, at(0, 0));
    expect(r.map.Extra).toEqual({ Zzz: { a: 1 } });
    expect(r.map.Plugins[0]!.Extra).toEqual({ Yyy: 2 });
    expect(r.map.Plugins[0]!.Kits[0]!.Pitches[0]!.Extra).toEqual({ Www: [1] });
    expect(r.map.Parts).toEqual(p.value.Parts);
  });
});

describe('Auto Assign: 空データ・不正な参照', () => {
  it('Kitの参照が不正ならエラー（何も返さない）', () => {
    const m = build([{ kits: [{ name: 'A', rows: [[36, 'Kick']] }] }], [KICK]);
    for (const ref of [at(1, 0), at(0, 1), at(-1, 0), at(0, -1), at(0.5, 0)]) {
      const r = autoAssignArticulations(m, ref, DICT, { mode: 'windows' });
      expect(r.ok, JSON.stringify(ref)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('kit-not-found');
    }
    const empty = parseQbd(JSON.stringify({ Plugins: [], Parts: [] }));
    if (!empty.ok) throw new Error('parse');
    expect(autoAssignArticulations(empty.value, at(0, 0), DICT).ok).toBe(false);
  });

  it('行が無いKit、Partが無いデータ、辞書が空: 何も変わらずエラーにならない', () => {
    const none = build([{ kits: [{ name: 'A', rows: [] }] }], []);
    const r = run(none, at(0, 0));
    expect([r.assigned, r.skipped]).toEqual([0, 0]);
    const noParts = build([{ kits: [{ name: 'A', rows: [[36, 'Kick']] }] }], []);
    const r2 = run(noParts, at(0, 0));
    expect([r2.assigned, r2.skipped]).toEqual([0, 1]);
    expect(rowsOf(r2.map, 0, 0)).toEqual([[36, 0, 'Separate']]);
  });

  it('辞書の名前が Part に存在しない／Part に Articulation が無い場合は割り当てない', () => {
    const m = build([{ kits: [{ name: 'T', rows: [[36, 'Kick'], [38, 'Snare']] }] }], [part(2, 'Snare', [])]);
    const r = run(m, at(0, 0));
    expect([r.assigned, r.skipped]).toEqual([0, 2]);
  });

  it('辞書の不正な値（正規名が空、別名が空白・カンマだけ）でも例外にならない', () => {
    const dict = [{ CanonicalName: '', Aliases: ' , ,' }, { CanonicalName: '  ', Aliases: '' }, { CanonicalName: 'Kick', Aliases: ',,BD,,' }];
    const m = build([{ kits: [{ name: 'T', rows: [[36, 'BD']] }] }], [KICK]);
    expect(run(m, at(0, 0), dict).assigned).toBe(1);
  });
});

describe('Auto Assign: 名前の照合は .NET の文字列規則（JS標準との違い）', () => {
  const parts = [part(1, 'Kick', [[1, 'Kick']])];
  const other = (name: string, target: string): number => {
    const m = build([{ kits: [{ name: 'X', rows: [[36, name, 7]] }, { name: 'T', rows: [[36, target]] }] }], parts);
    return rowsOf(run(m, at(0, 1), []).map, 0, 1)[0]![1];
  };

  it('前後の空白は .NET の定義で除去する（U+0085 は空白、U+FEFF は空白ではない）', () => {
    expect(other('Kick', '\u0085Kick\u0085')).toBe(7);
    expect(other('\u0085Kick', 'Kick')).toBe(7);
    expect(other('Kick', '﻿Kick')).toBe(0);
  });

  it('小文字化は ToLowerInvariant（İ は i̇ にならない。ẞ は ß、全角同士は大小を区別しない）', () => {
    expect(other('i̇', 'İ')).toBe(0);
    expect(other('ß', 'ẞ')).toBe(7);
    expect(other('ＫＩＣＫ', 'ｋｉｃｋ')).toBe(7);
    expect(other('Kick', 'ＫＩＣＫ')).toBe(0);
    expect(other('\u{10428}', '\u{10400}')).toBe(7);
  });
});

describe('Auto Assign: 初期辞書', () => {
  it('Windows版の初期値と同じ', () => {
    expect(defaultPartNameDictionary()).toEqual([
      { CanonicalName: 'Kick', Aliases: 'Bass Drum,BD' }, { CanonicalName: 'Snare', Aliases: 'SD' },
      { CanonicalName: 'Hi-Hat', Aliases: 'HiHat,HH,Hat' }, { CanonicalName: 'Tom', Aliases: 'Floor Tom' },
      { CanonicalName: 'Ride', Aliases: 'Ride Cymbal' }, { CanonicalName: 'Crash', Aliases: 'Crash Cymbal' },
      { CanonicalName: 'Cymbal', Aliases: '' },
    ]);
    const a = defaultPartNameDictionary();
    a[0]!.Aliases = 'x';
    expect(defaultPartNameDictionary()[0]!.Aliases).toBe('Bass Drum,BD'); // 呼ぶたびに新しい配列
  });
});

describe('.NET の文字列操作の再現（.NET の実測値）', () => {
  it('ToLowerInvariant: JS標準と異なる文字（İ は変換されない、ẞ は ß）', () => {
    expect(toLowerInvariant('İ')).toBe('İ');
    expect(toLowerInvariant('ẞ')).toBe('ß');
    expect(toLowerInvariant('ǅ')).toBe('ǆ');
    expect(toLowerInvariant('ＫＩＣＫ')).toBe('ｋｉｃｋ');
    expect(toLowerInvariant('\u{10400}')).toBe('\u{10428}'); // サロゲートペア（Deseret）
    expect(toLowerInvariant('😀')).toBe('😀');
    expect('İ'.toLowerCase()).not.toBe('İ'); // JS標準とは異なることの確認
  });

  it('OrdinalIgnoreCase: ß ≠ SS、ı ≠ I、ſ ≠ S、İ ≠ i、ǅ = ǆ = Ǆ、ς = σ = Σ、サロゲートペアも比較', () => {
    expect(equalsIgnoreCase('ß', 'SS')).toBe(false);
    expect(equalsIgnoreCase('ı', 'I')).toBe(false);
    expect(equalsIgnoreCase('ſ', 'S')).toBe(false);
    expect(equalsIgnoreCase('İ', 'i')).toBe(false);
    expect(equalsIgnoreCase('ǅ', 'ǆ')).toBe(true);
    expect(equalsIgnoreCase('ǅ', 'Ǆ')).toBe(true);
    expect(equalsIgnoreCase('ς', 'σ')).toBe(true);
    expect(equalsIgnoreCase('ς', 'Σ')).toBe(true);
    expect(equalsIgnoreCase('ÿ', 'Ÿ')).toBe(true);
    expect(equalsIgnoreCase('\u{10400}', '\u{10428}')).toBe(true);
    expect(indexOfIgnoreCase('xǅ', 'ǆ')).toBe(1);
    expect(indexOfIgnoreCase('xß', 'SS')).toBe(-1);
    expect(indexOfIgnoreCase('Hello World', 'WORLD')).toBe(6);
  });

  it('Trim: U+0085 は空白（JS標準では除去されない）、U+FEFF・U+180E・U+200B は空白ではない', () => {
    expect(trimDotNet('\u0085a\u0085')).toBe('a');
    expect(trimDotNet('﻿a')).toBe('﻿a');
    expect(trimDotNet('᠎a᠎')).toBe('᠎a᠎');
    expect(trimDotNet('​a')).toBe('​a');
    expect(trimDotNet(' \t\r\n 　a ')).toBe('a');
  });
});
