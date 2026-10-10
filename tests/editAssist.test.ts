import { describe, expect, it } from 'vitest';
import {
  applyAutoAssign, autoAssignArticulations, compressForward, copyArticulations, defaultPartNameDictionary, moveKitPitches, parseQbd,
  resetOrderByPitch, updateArticulation, updateKit, updateKitPitch, updatePart, updatePlugin, serializeQbd,
  type EditResult, type KitRef, type MapData, type Result,
} from '../src/core';
import { contentKey } from '../src/ui/state/editorStore';

/** 深く凍結する（編集関数が入力を書き換えれば TypeError になる） */
function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}

interface RowDef { Pitch: number; Name: string | null; ArticulationID?: number; Separator?: string; X?: unknown }
type Rows = { k1?: RowDef[]; k2?: RowDef[]; k3?: RowDef[] };

/** Part: Kick(ID1: Kick/Kick2) / Snare(ID2: Snare)。Kit は Plugin 'P'（GM）に K1・K2、Plugin 'Q'（None）に K3 */
function buildObject(rows: Rows = {}) {
  const mk = (defs: RowDef[]) => defs.map((r) => ({ ...r, ArticulationID: r.ArticulationID ?? 0 }));
  return {
    AppName: 'QBDrumMap', ModelVersion: '1.0.0',
    Plugins: [
      {
        ID: 1, Name: 'P', PluginType: 'GM', MidiOutDevice: '', SoundCheckChannel: 'Channel10', FuturePluginField: 1,
        Kits: [
          { ID: 1, Name: 'K1', Pitches: mk(rows.k1 ?? []) },
          { ID: 2, Name: 'K2', Pitches: mk(rows.k2 ?? []) },
        ],
      },
      { ID: 2, Name: 'Q', PluginType: 'None', MidiOutDevice: '', SoundCheckChannel: 'Channel10', Kits: [{ ID: 3, Name: 'K3', Pitches: mk(rows.k3 ?? []) }] },
    ],
    Parts: [
      { ID: 1, Name: 'Kick', ScorePitch: 36, Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }, { ID: 2, Name: 'Kick2', DrumMapOrder: 2 }] },
      { ID: 2, Name: 'Snare', ScorePitch: 38, Articulations: [{ ID: 3, Name: 'Snare', DrumMapOrder: 3 }] },
    ],
  };
}

function loadObject(o: unknown, freeze = true): MapData {
  const r = parseQbd(JSON.stringify(o));
  if (!r.ok) throw new Error(r.error.message);
  return freeze ? deepFreeze(r.value) : r.value;
}
const load = (rows?: Rows): MapData => loadObject(buildObject(rows));
const must = <T extends EditResult>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const K1: KitRef = { pluginIndex: 0, kitIndex: 0 };
const K2: KitRef = { pluginIndex: 0, kitIndex: 1 };
const K3: KitRef = { pluginIndex: 1, kitIndex: 0 };
const rowsOf = (m: MapData, r: KitRef) => m.Plugins[r.pluginIndex]!.Kits[r.kitIndex]!.Pitches;
const pitchesOf = (m: MapData, r: KitRef) => rowsOf(m, r).map((p) => p.Pitch);

describe('Reset Order（Pitch 順に整列）', () => {
  const rows: RowDef[] = [
    { Pitch: 40, Name: 'c', X: 'keep-c' }, { Pitch: 36, Name: 'a', ArticulationID: 1, Separator: 'Separate' },
    { Pitch: 38, Name: null }, { Pitch: 37, Name: 'b' },
  ];

  it('Pitch 昇順に整列し、DisplayOrder を 1..n に振り直す。Name が空の行も対象。他の値・Extra は保つ', () => {
    const m = load({ k1: rows });
    const r = must(resetOrderByPitch(m, K1));
    expect(r.changed).toBe(true);
    expect(pitchesOf(r.map, K1)).toEqual([36, 37, 38, 40]);
    expect(rowsOf(r.map, K1).map((p) => p.DisplayOrder)).toEqual([1, 2, 3, 4]);
    expect(rowsOf(r.map, K1)[0]).toMatchObject({ Name: 'a', ArticulationID: 1, Separator: 'Separate' });
    expect(rowsOf(r.map, K1)[3]!.Extra).toEqual({ X: 'keep-c' });
    expect(rowsOf(r.map, K1)[2]!.Name).toBeNull();
  });

  it('他の Kit・Parts は同じ参照を共有し、入力は変更しない（凍結）', () => {
    const m = load({ k1: rows, k2: rows });
    const r = must(resetOrderByPitch(m, K1));
    expect(r.map.Plugins[0]!.Kits[1]).toBe(m.Plugins[0]!.Kits[1]);
    expect(r.map.Plugins[1]).toBe(m.Plugins[1]);
    expect(r.map.Parts).toBe(m.Parts);
    expect(pitchesOf(m, K1)).toEqual([40, 36, 38, 37]);
  });

  it('既に Pitch 順なら変更なし（同じモデル）', () => {
    const m = load({ k1: [{ Pitch: 1, Name: 'a' }, { Pitch: 2, Name: null }] });
    const r = must(resetOrderByPitch(m, K1));
    expect(r.changed).toBe(false);
    expect(r.map).toBe(m);
  });

  it('同じ Pitch の行が複数あるときは現在の順序を保つ（安定）。欠番があっても DisplayOrder は 1..n', () => {
    const m = load({ k1: [{ Pitch: 5, Name: 'x1' }, { Pitch: 2, Name: 'y' }, { Pitch: 5, Name: 'x2' }] });
    const r = must(resetOrderByPitch(m, K1));
    expect(rowsOf(r.map, K1).map((p) => p.Name)).toEqual(['y', 'x1', 'x2']);
    expect(rowsOf(r.map, K1).map((p) => p.DisplayOrder)).toEqual([1, 2, 3]);
  });

  it('空の Kit は変更なし。存在しない Kit は失敗', () => {
    const m = load();
    expect(must(resetOrderByPitch(m, K1)).changed).toBe(false);
    expect(resetOrderByPitch(m, { pluginIndex: 9, kitIndex: 0 }).ok).toBe(false);
  });

  it('並べ替えた後に Reset Order すると元の Pitch 順へ戻る', () => {
    const base = load({ k1: [{ Pitch: 0, Name: 'a' }, { Pitch: 1, Name: 'b' }, { Pitch: 2, Name: 'c' }] });
    const moved = must(moveKitPitches(base, K1, [0], 'bottom')).map;
    expect(pitchesOf(moved, K1)).toEqual([1, 2, 0]);
    expect(pitchesOf(must(resetOrderByPitch(moved, K1)).map, K1)).toEqual([0, 1, 2]);
  });
});

describe('Compress Forward（前詰め）', () => {
  it('Name のある行を前に、空（null・空文字・空白のみ）の行を後ろに。それぞれ現在の順序を保つ', () => {
    const m = load({
      k1: [
        { Pitch: 0, Name: null }, { Pitch: 1, Name: 'a' }, { Pitch: 2, Name: '' }, { Pitch: 3, Name: 'b' },
        { Pitch: 4, Name: ' 　' }, { Pitch: 5, Name: 'c' },
      ],
    });
    const r = must(compressForward(m, K1));
    expect(r.changed).toBe(true);
    expect(pitchesOf(r.map, K1)).toEqual([1, 3, 5, 0, 2, 4]);
    expect(rowsOf(r.map, K1).map((p) => p.DisplayOrder)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('行の Pitch 値は変更しない（表示順だけが変わる）。Articulation・Separator・Extra も保つ', () => {
    const m = load({ k1: [{ Pitch: 7, Name: null }, { Pitch: 9, Name: 'a', ArticulationID: 3, Separator: 'Duplicate', X: 1 }] });
    const r = must(compressForward(m, K1));
    expect(rowsOf(r.map, K1)[0]).toMatchObject({ Pitch: 9, Name: 'a', ArticulationID: 3, Separator: 'Duplicate', Extra: { X: 1 } });
    expect(rowsOf(r.map, K1)[1]).toMatchObject({ Pitch: 7, Name: null });
  });

  it('既に詰まっている・全行が空・全行に名前がある・行がない場合は変更なし', () => {
    const named = load({ k1: [{ Pitch: 0, Name: 'a' }, { Pitch: 1, Name: 'b' }, { Pitch: 2, Name: null }] });
    expect(must(compressForward(named, K1)).map).toBe(named);
    const empty = load({ k1: [{ Pitch: 0, Name: null }, { Pitch: 1, Name: '' }] });
    expect(must(compressForward(empty, K1)).changed).toBe(false);
    expect(must(compressForward(load(), K1)).changed).toBe(false);
  });

  it('Pitch の重複があっても順序の規則は同じ。他の Kit は共有', () => {
    const m = load({ k1: [{ Pitch: 3, Name: null }, { Pitch: 3, Name: 'dup1' }, { Pitch: 3, Name: 'dup2' }], k2: [{ Pitch: 1, Name: null }, { Pitch: 2, Name: 'z' }] });
    const r = must(compressForward(m, K1));
    expect(rowsOf(r.map, K1).map((p) => p.Name)).toEqual(['dup1', 'dup2', null]);
    expect(r.map.Plugins[0]!.Kits[1]).toBe(m.Plugins[0]!.Kits[1]);
  });

  it('存在しない Kit は失敗', () => {
    expect(compressForward(load(), { pluginIndex: 0, kitIndex: 5 }).ok).toBe(false);
  });
});

describe('Copy Articulation（Pitch 番号で対応づけ）', () => {
  const src: RowDef[] = [
    { Pitch: 38, Name: 'Snare', ArticulationID: 3, Separator: 'Separate' }, { Pitch: 36, Name: 'Kick', ArticulationID: 1 },
    { Pitch: 37, Name: 'Kick2', ArticulationID: 2, Separator: 'Duplicate' },
  ];

  it('添字ではなく Pitch 番号で対応づける（コピー先の並びがコピー元と違っても同じ Pitch の行へ入る）', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a' }, { Pitch: 37, Name: 'b' }, { Pitch: 38, Name: 'c' }], k2: src });
    const r = must(copyArticulations(m, K2, K1));
    expect(r.changed).toBe(true);
    expect(rowsOf(r.map, K1).map((p) => [p.Pitch, p.ArticulationID, p.Separator])).toEqual([
      [36, 1, 'None'], [37, 2, 'Duplicate'], [38, 3, 'Separate'],
    ]);
    expect(r).toMatchObject({ copied: 3, cleared: 0, missingInSource: 0 });
    expect(rowsOf(r.map, K1).map((p) => p.Name)).toEqual(['a', 'b', 'c']); // Name・Pitch・順序は変更しない
  });

  it('コピー先の並びを入れ替えても結果は Pitch で決まる', () => {
    const m = load({ k1: [{ Pitch: 38, Name: 'c' }, { Pitch: 36, Name: 'a' }], k2: src });
    const r = must(copyArticulations(m, K2, K1));
    expect(rowsOf(r.map, K1).map((p) => [p.Pitch, p.ArticulationID])).toEqual([[38, 3], [36, 1]]);
  });

  it('既存の割当は上書きする。コピー先の Name が空の行は ArticulationID=0・Separator=None にする（Windows版）', () => {
    const m = load({
      k1: [{ Pitch: 36, Name: 'a', ArticulationID: 2, Separator: 'Unload' }, { Pitch: 37, Name: null, ArticulationID: 1, Separator: 'Separate' }],
      k2: src,
    });
    const r = must(copyArticulations(m, K2, K1));
    expect(rowsOf(r.map, K1).map((p) => [p.ArticulationID, p.Separator])).toEqual([[1, 'None'], [0, 'None']]);
    expect(r).toMatchObject({ copied: 1, cleared: 1 });
  });

  it('コピー元に同じ Pitch の行がない（Name のある）行は変更せず、missingInSource に数える', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a' }, { Pitch: 60, Name: 'keep', ArticulationID: 3, Separator: 'Separate' }], k2: src });
    const r = must(copyArticulations(m, K2, K1));
    expect(rowsOf(r.map, K1)[1]).toMatchObject({ ArticulationID: 3, Separator: 'Separate' });
    expect(r).toMatchObject({ copied: 1, missingInSource: 1 });
  });

  it('コピー元の行が未割当ならコピー先の割当も外れる（Windows版は値をそのまま写す）', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a', ArticulationID: 1 }], k2: [{ Pitch: 36, Name: null }] });
    const r = must(copyArticulations(m, K2, K1));
    expect(rowsOf(r.map, K1)[0]).toMatchObject({ ArticulationID: 0, Separator: 'None' });
  });

  it('変更がなければ changed:false で同じモデル', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a', ArticulationID: 1 }], k2: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }] });
    const r = must(copyArticulations(m, K2, K1));
    expect(r.changed).toBe(false);
    expect(r.map).toBe(m);
  });

  it('別 Plugin の Kit からもコピーできる。コピー先以外の Kit・Parts は共有し、Extra は保つ', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a', X: 'e' }], k3: [{ Pitch: 36, Name: 'k', ArticulationID: 2 }], k2: src });
    const r = must(copyArticulations(m, K3, K1));
    expect(rowsOf(r.map, K1)[0]).toMatchObject({ ArticulationID: 2, Extra: { X: 'e' } });
    expect(r.map.Plugins[1]).toBe(m.Plugins[1]);
    expect(r.map.Plugins[0]!.Kits[1]).toBe(m.Plugins[0]!.Kits[1]);
    expect(r.map.Parts).toBe(m.Parts);
  });

  it('曖昧なケースは何も変更せず失敗する: 同じ Kit', () => {
    const r = copyArticulations(load({ k1: src }), K1, K1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('same-kit');
  });

  it('曖昧なケースは何も変更せず失敗する: コピー元／コピー先に同じ Pitch の行が複数ある', () => {
    const dupSrc = load({ k1: [{ Pitch: 36, Name: 'a' }], k2: [{ Pitch: 36, Name: 'x', ArticulationID: 1 }, { Pitch: 36, Name: 'y', ArticulationID: 2 }] });
    const a = copyArticulations(dupSrc, K2, K1);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error.code).toBe('ambiguous-pitch');
    const dupDst = load({ k1: [{ Pitch: 36, Name: 'a' }, { Pitch: 36, Name: 'b' }], k2: src });
    const b = copyArticulations(dupDst, K2, K1);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.code).toBe('ambiguous-pitch');
  });

  it('曖昧なケースは何も変更せず失敗する: 存在しない Articulation を指す割当', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a' }], k2: [{ Pitch: 36, Name: 'x', ArticulationID: 99 }] });
    const r = copyArticulations(m, K2, K1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('articulation-not-found');
  });

  it('曖昧なケースは何も変更せず失敗する: ID が重複した Articulation を指す割当', () => {
    const o = buildObject({ k1: [{ Pitch: 36, Name: 'a' }], k2: [{ Pitch: 36, Name: 'x', ArticulationID: 1 }] });
    o.Parts[1]!.Articulations[0]!.ID = 1;
    expect(copyArticulations(loadObject(o), K2, K1).ok).toBe(false);
  });

  it('存在しない Kit は失敗', () => {
    const m = load({ k2: src });
    expect(copyArticulations(m, { pluginIndex: 7, kitIndex: 0 }, K1).ok).toBe(false);
    expect(copyArticulations(m, K2, { pluginIndex: 0, kitIndex: 9 }).ok).toBe(false);
  });
});

describe('Auto Assign の編集関数（applyAutoAssign）', () => {
  const rows = (): Rows => ({
    k2: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }, { Pitch: 38, Name: 'Snare', ArticulationID: 3 }],
    k1: [{ Pitch: 36, Name: 'Kick' }, { Pitch: 38, Name: 'Snare', X: 'x' }, { Pitch: 41, Name: 'zzz unknown' }, { Pitch: 50, Name: null }],
  });

  it('autoAssignArticulations（web）と同じ結果・件数。対象 Kit 以外は同じ参照を共有し、Extra を保つ', () => {
    const m = load(rows());
    const r = must(applyAutoAssign(m, K1, defaultPartNameDictionary()));
    const direct = autoAssignArticulations(m, K1, defaultPartNameDictionary());
    if (!direct.ok) throw new Error('direct');
    expect(contentKey(r.map)).toBe(contentKey(direct.value.map));
    expect([r.assigned, r.skipped]).toEqual([direct.value.assigned, direct.value.skipped]);
    expect(r).toMatchObject({ changed: true, assigned: 2, skipped: 1 });
    expect(rowsOf(r.map, K1)[1]).toMatchObject({ ArticulationID: 3, Extra: { X: 'x' } });
    expect(rowsOf(r.map, K1)[2]).toMatchObject({ ArticulationID: 0, Separator: 'Separate' });
    expect(r.map.Plugins[0]!.Kits[1]).toBe(m.Plugins[0]!.Kits[1]);
    expect(r.map.Plugins[1]).toBe(m.Plugins[1]);
    expect(r.map.Parts).toBe(m.Parts);
  });

  it('既定は mode:web: Unload の行は Separate で上書きしない（件数は skipped）。mode:windows は上書きする', () => {
    const m = load({ k1: [{ Pitch: 41, Name: 'zzz', Separator: 'Unload' }] });
    const web = must(applyAutoAssign(m, K1, defaultPartNameDictionary()));
    expect(rowsOf(web.map, K1)[0]!.Separator).toBe('Unload');
    expect(web).toMatchObject({ changed: false, skipped: 1 });
    const win = must(applyAutoAssign(m, K1, defaultPartNameDictionary(), { mode: 'windows' }));
    expect(rowsOf(win.map, K1)[0]!.Separator).toBe('Separate');
  });

  it('割当も Separator も変わらなければ changed:false で同じモデル', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }, { Pitch: 40, Name: null }] });
    const r = must(applyAutoAssign(m, K1, defaultPartNameDictionary()));
    expect(r.changed).toBe(false);
    expect(r.map).toBe(m);
  });

  it('存在しない Kit は失敗（何も変更しない）', () => {
    expect(applyAutoAssign(load(rows()), { pluginIndex: 5, kitIndex: 0 }, defaultPartNameDictionary()).ok).toBe(false);
  });

  it('未定義の Separator 値の行は自動修正しない', () => {
    const o = buildObject({ k1: [{ Pitch: 36, Name: 'Kick' }, { Pitch: 41, Name: 'zzz' }] });
    (o.Plugins[0]!.Kits[0]!.Pitches[0] as { Separator?: unknown }).Separator = 9;
    const r = must(applyAutoAssign(loadObject(o), K1, defaultPartNameDictionary()));
    expect(rowsOf(r.map, K1)[0]!.Separator).toBe(9);
  });
});

describe('Name の Trim（編集確定時のみ）', () => {
  it('Plugin / Kit / KitPitch / Part / Articulation の更新は前後の空白（全角を含む）を除く', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a' }] });
    expect(must(updatePlugin(m, 0, { Name: '  　New  ' })).map.Plugins[0]!.Name).toBe('New');
    expect(must(updateKit(m, K1, { Name: ' Kx\t' })).map.Plugins[0]!.Kits[0]!.Name).toBe('Kx');
    expect(rowsOf(must(updateKitPitch(m, K1, 0, { Name: ' b ' })).map, K1)[0]!.Name).toBe('b');
    expect(must(updatePart(m, 0, { Name: ' Pn ' })).map.Parts[0]!.Name).toBe('Pn');
    expect(must(updateArticulation(m, 0, 0, { Name: ' An ' })).map.Parts[0]!.Articulations[0]!.Name).toBe('An');
  });

  it('途中の空白は残す。Trim の結果が現在の名前と同じなら変更なし（履歴を積まない）', () => {
    const m = load();
    expect(must(updatePlugin(m, 0, { Name: ' a  b ' })).map.Plugins[0]!.Name).toBe('a  b');
    const same = must(updatePlugin(m, 0, { Name: ' P ' }));
    expect(same.changed).toBe(false);
    expect(same.map).toBe(m);
  });

  it('Trim 後に空になる Plugin / Part の名前は空文字になる（検証側で長さエラーを表示する）', () => {
    const m = load();
    expect(must(updatePlugin(m, 0, { Name: '   ' })).map.Plugins[0]!.Name).toBe('');
    expect(must(updatePart(m, 0, { Name: '　' })).map.Parts[0]!.Name).toBe('');
  });

  it('KitPitch の Name が Trim 後に空になると、Articulation・Separator も連動してクリアする（Windows版の Name 空白時の連動）', () => {
    const m = load({ k1: [{ Pitch: 36, Name: 'a', ArticulationID: 1, Separator: 'Separate' }] });
    const r = must(updateKitPitch(m, K1, 0, { Name: '   ' }));
    expect(rowsOf(r.map, K1)[0]).toMatchObject({ Name: '', ArticulationID: 0, Separator: 'None' });
  });

  it('読込では Name を変更しない（前後の空白を含む既存の名前がそのまま残り、保存しても同じ）', () => {
    const o = buildObject({ k1: [{ Pitch: 36, Name: ' a ' }] });
    o.Plugins[0]!.Name = ' P ';
    const m = loadObject(o);
    expect(m.Plugins[0]!.Name).toBe(' P ');
    expect(rowsOf(m, K1)[0]!.Name).toBe(' a ');
    const s = serializeQbd(m);
    expect(s.ok).toBe(true);
    if (s.ok) expect(JSON.parse(s.value.text).Plugins[0].Name).toBe(' P ');
  });
});
