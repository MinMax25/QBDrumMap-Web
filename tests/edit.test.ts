import { describe, expect, it } from 'vitest';
import {
  addKit, addPlugin, clearKitPitches, deleteKits, deletePlugins, filterKitPitchIndices, findUndefinedSeparators, getNewId,
  moveKitPitches, moveKitPitchesTo, moveKits, movePlugins, movePluginsTo, normalizeIds, parseQbd, reorderIndices, reorderTo,
  serializeQbd, setArticulationForSameName, updateKit, updateKitPitch, updatePlugin, validateNames,
  type EditResult, type MapData, type Result,
} from '../src/core';
import { complex, gmSmall } from './fixtures';

const load = (t: string): MapData => {
  const r = parseQbd(t);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

/** 入力を深く凍結し、操作が入力を変更しない（変更すると strict モードで例外）ことを保証する */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}
const frozen = (t: string): MapData => deepFreeze(load(t));
const ok = (r: Result<EditResult>): EditResult => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const REF = { pluginIndex: 0, kitIndex: 0 };

/** 不変条件: 各配列は DisplayOrder = 1..n の昇順 */
function expectOrdered(map: MapData): void {
  const seq = (a: { DisplayOrder: number }[]) => expect(a.map((x) => x.DisplayOrder)).toEqual(a.map((_, i) => i + 1));
  seq(map.Plugins);
  map.Plugins.forEach((p) => { seq(p.Kits); p.Kits.forEach((k) => seq(k.Pitches)); });
}

/** 3 Plugin × (Plugin A: 3 Kit)。名前は一意 */
function multi(): MapData {
  let m = load(gmSmall);
  m = ok(addPlugin(m)).map; // Plugin2
  m = ok(addPlugin(m)).map; // Plugin3
  m = ok(addKit(m, 0)).map;
  m = ok(addKit(m, 0)).map;
  return m;
}

describe('getNewId（Windows版 ExModel.GetNewID）', () => {
  it('空は1、連番なら max+1、欠番があれば最小の欠番', () => {
    expect(getNewId([])).toBe(1);
    expect(getNewId([1, 2, 3])).toBe(4);
    expect(getNewId([1, 2, 4])).toBe(3);
    expect(getNewId([2, 3])).toBe(1); // Windows版: Range(1, max-min+1) の欠番
    expect(getNewId([5])).toBe(1);
  });
});

describe('Plugin の追加・削除・編集', () => {
  it('追加: ID は欠番の最小値、名前は Plugin{ID}、末尾、既定値。入力は不変', () => {
    const m = frozen(gmSmall);
    const r = ok(addPlugin(m));
    expect(r.changed).toBe(true);
    expect(r.indices).toEqual([1]);
    const p = r.map.Plugins[1]!;
    expect(p).toMatchObject({ ID: 2, Name: 'Plugin2', PluginType: 'None', SoundCheckChannel: 'Channel10', Kits: [], DisplayOrder: 2 });
    expect(r.map.Plugins[0]).toBe(m.Plugins[0]); // 構造共有
    expect(m.Plugins).toHaveLength(1);
  });

  it('空データへの追加（ID=1）と、欠番IDの再利用', () => {
    const empty = load('{"AppName":"QBDrumMap","ModelVersion":"1.0.0","Plugins":[],"Parts":[]}');
    expect(ok(addPlugin(empty)).map.Plugins[0]!.ID).toBe(1);
    let m = multi(); // ID 1,2,3
    m = ok(deletePlugins(m, [1])).map; // ID 2 を削除
    expect(ok(addPlugin(m)).map.Plugins.at(-1)!.ID).toBe(2);
  });

  it('削除: 複数選択で削除し、残りの DisplayOrder を振り直す。選択は空', () => {
    const m = deepFreeze(multi());
    const r = ok(deletePlugins(m, [0, 2]));
    expect(r.map.Plugins.map((p) => p.Name)).toEqual(['Plugin2']);
    expect(r.indices).toEqual([]);
    expectOrdered(r.map);
  });

  it('削除: 空選択は変更なし（同じモデル）、範囲外はエラーで何も変えない', () => {
    const m = frozen(gmSmall);
    expect(ok(deletePlugins(m, [])).map).toBe(m);
    expect(ok(deletePlugins(m, [])).changed).toBe(false);
    const r = deletePlugins(m, [5]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('index-out-of-range');
  });

  it('名前・PluginType の編集。同じ値は変更なし。他のフィールド（Extra・Kits）は保持', () => {
    const m = frozen(gmSmall);
    const r = ok(updatePlugin(m, 0, { Name: 'X', PluginType: 'GM2' }));
    expect(r.map.Plugins[0]).toMatchObject({ Name: 'X', PluginType: 'GM2', ID: 1 });
    expect(r.map.Plugins[0]!.Kits).toBe(m.Plugins[0]!.Kits);
    expect(ok(updatePlugin(m, 0, { Name: 'GM' })).changed).toBe(false);
    expect(updatePlugin(m, 3, { Name: 'x' }).ok).toBe(false);
  });
});

describe('並べ替え（Windows版 ExModel.Move* と同じ規則）', () => {
  it('reorderIndices: 先頭／末尾／上へ／下へ。端での移動は変化なし(null)', () => {
    expect(reorderIndices(5, [2], 'top')).toEqual({ order: [2, 0, 1, 3, 4], moved: [0] });
    expect(reorderIndices(5, [2], 'bottom')).toEqual({ order: [0, 1, 3, 4, 2], moved: [4] });
    expect(reorderIndices(5, [2], 'up')).toEqual({ order: [0, 2, 1, 3, 4], moved: [1] });
    expect(reorderIndices(5, [2], 'down')).toEqual({ order: [0, 1, 3, 2, 4], moved: [3] });
    expect(reorderIndices(5, [0], 'up')).toBeNull();
    expect(reorderIndices(5, [4], 'down')).toBeNull();
    expect(reorderIndices(5, [0], 'top')).toBeNull();
    expect(reorderIndices(5, [], 'top')).toBeNull();
  });

  it('連続した複数選択はブロックのまま1つ動く。離れた選択は上へ／下へで1つのブロックにまとまる（Windows版と同じ）', () => {
    expect(reorderIndices(6, [2, 3], 'up')?.order).toEqual([0, 2, 3, 1, 4, 5]);
    expect(reorderIndices(6, [2, 3], 'down')?.order).toEqual([0, 1, 4, 2, 3, 5]);
    expect(reorderIndices(8, [3, 6], 'up')?.order).toEqual([0, 1, 3, 6, 2, 4, 5, 7]);
    expect(reorderIndices(8, [1, 4], 'down')?.order).toEqual([0, 2, 3, 5, 1, 4, 6, 7]);
  });

  it('選択の指定順に依存しない（Windows版は選択順依存で要素が重複し得る。意図的な差異）。重複・範囲外は無効', () => {
    expect(reorderIndices(6, [3, 2], 'down')).toEqual(reorderIndices(6, [2, 3], 'down'));
    expect(reorderIndices(4, [9], 'top')).toBeNull();
    const order = reorderIndices(8, [6, 1], 'down')!.order;
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // 順列（重複なし）
  });

  it('reorderTo: ドロップ先の直前へ。自分の位置・隣接位置への移動は変化なし', () => {
    expect(reorderTo(5, [0], 3)?.order).toEqual([1, 2, 0, 3, 4]);
    expect(reorderTo(5, [3], 0)?.order).toEqual([3, 0, 1, 2, 4]);
    expect(reorderTo(5, [1], 5)?.order).toEqual([0, 2, 3, 4, 1]);
    expect(reorderTo(5, [2], 2)).toBeNull();
    expect(reorderTo(5, [2], 3)).toBeNull();
    expect(reorderTo(5, [1, 2], 4)?.order).toEqual([0, 3, 1, 2, 4]);
    expect(reorderTo(5, [1], 9)).toBeNull();
  });

  it('movePlugins / movePluginsTo: DisplayOrder が 1..n に振り直され、選択の新しい添字が返る', () => {
    const m = deepFreeze(multi());
    const r = ok(movePlugins(m, [2], 'top'));
    expect(r.map.Plugins.map((p) => p.Name)).toEqual(['Plugin3', 'GM', 'Plugin2']);
    expect(r.indices).toEqual([0]);
    expectOrdered(r.map);
    const d = ok(movePluginsTo(m, [0], 3));
    expect(d.map.Plugins.map((p) => p.Name)).toEqual(['Plugin2', 'Plugin3', 'GM']);
    expect(ok(movePlugins(m, [0], 'top')).changed).toBe(false);
  });

  it('IDは並べ替えで変わらない（ID採番は保存時の正規化のみ）', () => {
    const m = multi();
    const r = ok(movePlugins(m, [2], 'top'));
    expect(r.map.Plugins.map((p) => p.ID)).toEqual([3, 1, 2]);
  });
});

describe('Kit の追加・削除・編集・並べ替え', () => {
  it('追加: ID は全Plugin横断の欠番、名前は「{Plugin名} Kit{件数+1}」、128行、末尾', () => {
    const m = frozen(gmSmall);
    const r = ok(addKit(m, 0));
    const k = r.map.Plugins[0]!.Kits[1]!;
    expect(k).toMatchObject({ ID: 2, Name: 'GM Kit2', DisplayOrder: 2 });
    expect(k.Pitches).toHaveLength(128);
    expect(k.Pitches[127]).toMatchObject({ Pitch: 127, Name: null, ArticulationID: 0, Separator: 'None', DisplayOrder: 128 });
    expect(r.indices).toEqual([1]);
    expect(addKit(m, 9).ok).toBe(false);
  });

  it('同名になり得る新規Kit名は検証エラーとして検出される（編集は許可、保存前に指摘）', () => {
    let m = ok(addKit(load(gmSmall), 0)).map;
    m = ok(updateKit(m, { pluginIndex: 0, kitIndex: 1 }, { Name: 'GM Kit' })).map;
    expect(validateNames(m).filter((i) => i.kind === 'duplicate').map((i) => i.path)).toEqual(['Plugins[0].Kits[0]', 'Plugins[0].Kits[1]']);
  });

  it('削除・移動・名前変更は他Pluginに影響しない', () => {
    const m = deepFreeze(multi());
    const del = ok(deleteKits(m, 0, [0, 1]));
    expect(del.map.Plugins[0]!.Kits).toHaveLength(1);
    expectOrdered(del.map);
    expect(del.map.Plugins[1]).toBe(m.Plugins[1]);
    const mv = ok(moveKits(m, 0, [2], 'top'));
    expect(mv.map.Plugins[0]!.Kits.map((k) => k.ID)).toEqual([3, 1, 2]);
    const rn = ok(updateKit(m, { pluginIndex: 0, kitIndex: 1 }, { Name: 'Renamed' }));
    expect(rn.map.Plugins[0]!.Kits[1]!.Name).toBe('Renamed');
    expect(rn.map.Plugins[0]!.Kits[1]!.Pitches).toBe(m.Plugins[0]!.Kits[1]!.Pitches);
  });
});

describe('KitPitch の編集（128行）', () => {
  const kitMap = (): MapData => ok(addKit(load(gmSmall), 0)).map; // Kit2 は128行すべて空

  it('Name を設定しても ArticulationID / Separator は変わらない（既存値の保持）', () => {
    const m = frozen(gmSmall); // Pitch1行目(index 1): Kick, Articulation 1
    const r = ok(updateKitPitch(m, REF, 1, { Name: 'Kick 2' }));
    expect(r.map.Plugins[0]!.Kits[0]!.Pitches[1]).toMatchObject({ Name: 'Kick 2', ArticulationID: 1 });
  });

  it('Name を空（null・空文字・空白のみ）にすると ArticulationID=0・Separator=None に連動してクリア（1操作）', () => {
    const m = frozen(gmSmall); // index 3: Closed HH / Articulation 3 / Separate
    for (const empty of ['', '  ', '\t', null]) {
      const r = ok(updateKitPitch(m, REF, 3, { Name: empty }));
      expect(r.map.Plugins[0]!.Kits[0]!.Pitches[3]).toMatchObject({ Name: empty === null ? null : '', ArticulationID: 0, Separator: 'None' }); // 空白のみは確定時の Trim で空文字になる（UI Phase 4）
    }
  });

  it('空Nameの行へ ArticulationID / Separator は設定できない。存在しないArticulation IDも拒否。0は可', () => {
    const m = frozen(gmSmall);
    const blank = updateKitPitch(m, REF, 0, { ArticulationID: 1 });
    expect(!blank.ok && blank.error.code).toBe('empty-name-row');
    const sep = updateKitPitch(m, REF, 0, { Separator: 'Separate' });
    expect(!sep.ok && sep.error.code).toBe('empty-name-row');
    const bad = updateKitPitch(m, REF, 1, { ArticulationID: 99 });
    expect(!bad.ok && bad.error.code).toBe('articulation-not-found');
    expect(ok(updateKitPitch(m, REF, 1, { ArticulationID: 0 })).map.Plugins[0]!.Kits[0]!.Pitches[1]!.ArticulationID).toBe(0);
    expect(ok(updateKitPitch(m, REF, 1, { ArticulationID: 2 })).map.Plugins[0]!.Kits[0]!.Pitches[1]!.ArticulationID).toBe(2);
  });

  it('Name を空にする操作と同時に Articulation を指定した場合は、空Nameの規則が優先して拒否される', () => {
    const m = frozen(gmSmall);
    expect(updateKitPitch(m, REF, 1, { Name: '', ArticulationID: 2 }).ok).toBe(false);
  });

  it('Separator の編集（4値）と、未定義値を持つ行の保持。同じ値は変更なし', () => {
    const m = frozen(gmSmall);
    for (const s of ['None', 'Separate', 'Unload', 'Duplicate'] as const) {
      const r = ok(updateKitPitch(m, REF, 1, { Separator: s }));
      expect(r.map.Plugins[0]!.Kits[0]!.Pitches[1]!.Separator).toBe(s);
    }
    expect(ok(updateKitPitch(m, REF, 3, { Separator: 'Separate' })).changed).toBe(false);
    const withUndef = ok(updateKitPitch(m, REF, 1, { Separator: 99 })).map; // 未定義値は数値のまま保持
    expect(withUndef.Plugins[0]!.Kits[0]!.Pitches[1]!.Separator).toBe(99);
    expect(ok(updateKitPitch(withUndef, REF, 1, { Name: 'Kick!' })).map.Plugins[0]!.Kits[0]!.Pitches[1]!.Separator).toBe(99);
  });

  it('範囲外の行・Kit はエラー。他の行は構造共有される', () => {
    const m = deepFreeze(kitMap());
    expect(updateKitPitch(m, { pluginIndex: 0, kitIndex: 1 }, 200, { Name: 'x' }).ok).toBe(false);
    expect(updateKitPitch(m, { pluginIndex: 5, kitIndex: 0 }, 0, { Name: 'x' }).ok).toBe(false);
    const r = ok(updateKitPitch(m, { pluginIndex: 0, kitIndex: 1 }, 10, { Name: 'x' }));
    const before = m.Plugins[0]!.Kits[1]!.Pitches;
    const after = r.map.Plugins[0]!.Kits[1]!.Pitches;
    expect(after.filter((p, i) => p !== before[i])).toHaveLength(1);
  });

  it('同名の行への一括設定（Windows版 OnSearchArticulation の確認で「はい」）', () => {
    let m = kitMap();
    const ref = { pluginIndex: 0, kitIndex: 1 };
    for (const i of [36, 37, 38]) m = ok(updateKitPitch(m, ref, i, { Name: i === 38 ? 'Other' : 'Kick' })).map;
    const r = ok(setArticulationForSameName(m, ref, 36, 1));
    expect(r.indices).toEqual([36, 37]);
    expect(r.map.Plugins[0]!.Kits[1]!.Pitches.map((p) => p.ArticulationID).filter((a) => a === 1)).toHaveLength(2);
    expect(r.map.Plugins[0]!.Kits[1]!.Pitches[38]!.ArticulationID).toBe(0);
    expect(setArticulationForSameName(m, ref, 0, 1).ok).toBe(false); // 空Name行
  });

  it('選択行のクリア: Name=null・ID=0・Separator=None。行自体は残る。クリア済みの行は変更なし', () => {
    const m = deepFreeze(load(gmSmall));
    const r = ok(clearKitPitches(m, REF, [1, 3]));
    const rows = r.map.Plugins[0]!.Kits[0]!.Pitches;
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({ Name: null, ArticulationID: 0, Separator: 'None', Pitch: 36 });
    expect(rows[3]).toMatchObject({ Name: null, ArticulationID: 0, Separator: 'None' });
    expect(rows[2]!.Name).toBe('Snare');
    expect(ok(clearKitPitches(r.map, REF, [1, 3])).changed).toBe(false);
  });

  it('行の並べ替え: DisplayOrder は 1..n、配列順＝表示順。保存すると並びが出力順に反映される', () => {
    const m = deepFreeze(load(gmSmall));
    const r = ok(moveKitPitches(m, REF, [3], 'top'));
    expect(r.map.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.Name)).toEqual(['Closed HH', '', 'Kick', 'Snare']);
    expectOrdered(r.map);
    const d = ok(moveKitPitchesTo(m, REF, [0], 3));
    expect(d.map.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.Name)).toEqual(['Kick', 'Snare', '', 'Closed HH']);
    const saved = serializeQbd(r.map);
    expect(saved.ok && JSON.parse(saved.value.text).Plugins[0].Kits[0].Pitches[0].Name).toBe('Closed HH');
  });
});

describe('フィルタ（Web版: Name と Articulation の部分一致 AND）', () => {
  const m = load(gmSmall);
  const kit = m.Plugins[0]!.Kits[0]!;
  it('空の条件は全行。部分一致・大文字小文字を区別しない（Windows版は全体一致＋*。意図的な差異）', () => {
    expect(filterKitPitchIndices(m, kit, {})).toEqual([0, 1, 2, 3]);
    expect(filterKitPitchIndices(m, kit, { name: '' })).toEqual([0, 1, 2, 3]);
    expect(filterKitPitchIndices(m, kit, { name: 'ick' })).toEqual([1]);
    expect(filterKitPitchIndices(m, kit, { name: 'KICK' })).toEqual([1]);
    expect(filterKitPitchIndices(m, kit, { name: 'closed' })).toEqual([3]);
    expect(filterKitPitchIndices(m, kit, { name: 'zzz' })).toEqual([]);
  });
  it('Articulation 名の部分一致。Name との AND。未割当行は Articulation 条件に一致しない', () => {
    expect(filterKitPitchIndices(m, kit, { articulation: 'sna' })).toEqual([2]);
    expect(filterKitPitchIndices(m, kit, { articulation: 'o' })).toEqual([3]); // "Closed"（Kick/Snare に o は無い）
    expect(filterKitPitchIndices(m, kit, { name: 'c', articulation: 'c' })).toEqual([1, 3]); // Kick/Closed HH × Kick/Closed
    expect(filterKitPitchIndices(m, kit, { name: 'snare', articulation: 'kick' })).toEqual([]);
    expect(filterKitPitchIndices(m, kit, { articulation: 'x' })).toEqual([]);
  });
  it('ワイルドカード * は特別扱いしない（文字として扱う）', () => {
    expect(filterKitPitchIndices(m, kit, { name: 'k*' })).toEqual([]);
  });
});

describe('findUndefinedSeparators（読み取り専用の検査）', () => {
  it('未定義値を全件列挙（Plugin／Kit／Pitch／行位置／値）。正常値は含めない。データは変更しない', () => {
    let m = multi();
    const kitRef = { pluginIndex: 0, kitIndex: 1 };
    m = ok(updateKitPitch(m, kitRef, 5, { Name: 'A' })).map;
    m = ok(updateKitPitch(m, kitRef, 5, { Separator: 99 })).map;
    m = ok(updateKitPitch(m, kitRef, 9, { Name: 'B' })).map;
    m = ok(updateKitPitch(m, kitRef, 9, { Separator: -1 })).map;
    m = ok(updateKitPitch(m, { pluginIndex: 0, kitIndex: 0 }, 1, { Separator: 4 })).map;
    deepFreeze(m);
    const found = findUndefinedSeparators(m);
    expect(found.map((f) => [f.pluginIndex, f.kitIndex, f.pitchIndex, f.value])).toEqual([[0, 0, 1, 4], [0, 1, 5, 99], [0, 1, 9, -1]]);
    expect(found[1]).toMatchObject({ pluginName: 'GM', kitName: 'GM Kit2', pitch: 5, name: 'A', hasName: true });
    expect(findUndefinedSeparators(m)).toEqual(found); // 副作用なし・再実行で同じ
  });
  it('正常なデータ・空データでは空。名前のない行の未定義値は hasName=false で列挙される', () => {
    expect(findUndefinedSeparators(load(gmSmall))).toEqual([]);
    expect(findUndefinedSeparators(load(complex))).toEqual([]);
    const raw = JSON.parse(gmSmall);
    raw.Plugins[0].Kits[0].Pitches[0].Separator = 7;
    const m = load(JSON.stringify(raw));
    const f = findUndefinedSeparators(m);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ pitchIndex: 0, hasName: false, value: 7 });
  });
  it('既存の Export のエラー挙動は変えない（検査関数は Export を呼ばない純粋な読み取り）', async () => {
    const { exportKits, defaultExportSettings } = await import('../src/core');
    const raw = JSON.parse(gmSmall);
    raw.Plugins[0].Kits[0].Pitches[2].Separator = 9;
    const m = load(JSON.stringify(raw));
    const before = exportKits(m, 'studioOne', [REF], defaultExportSettings);
    findUndefinedSeparators(m);
    const after = exportKits(m, 'studioOne', [REF], defaultExportSettings);
    expect(before.ok).toBe(false);
    expect(after).toEqual(before);
  });
});

describe('参照整合性と保存（ID正規化）', () => {
  it('編集後のモデルは保存でき、再読込すると同じ内容になる（Plugin／Kit 追加・移動・削除・行編集の組み合わせ）', () => {
    let m = multi();
    m = ok(updateKitPitch(m, { pluginIndex: 0, kitIndex: 1 }, 40, { Name: 'Tom' })).map;
    m = ok(moveKits(m, 0, [2], 'top')).map;
    m = ok(deletePlugins(m, [1])).map;
    const s = serializeQbd(m);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const re = load(s.value.text);
    expect(re.Plugins.map((p) => p.Name)).toEqual(['GM', 'Plugin3']);
    expect(re.Plugins[0]!.Kits.map((k) => k.Name)).toEqual(['GM Kit3', 'GM Kit', 'GM Kit2']);
    expect(validateNames(re)).toEqual([]);
  });

  it('保存時の正規化は Kit ID を 1..n に振り直すが、Articulation の参照は壊れない', () => {
    let m = multi();
    m = ok(deleteKits(m, 0, [0])).map; // Kit ID 1 を削除 → 残りは 2, 3
    const n = normalizeIds(m);
    expect(n.ok && n.value.Plugins[0]!.Kits.map((k) => k.ID)).toEqual([1, 2]);
  });
});
