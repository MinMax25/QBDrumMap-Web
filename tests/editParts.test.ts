import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addArticulation, addPart, deleteArticulations, deleteParts, formatStudioOneColor, listDrumMapOrder, moveArticulations,
  moveArticulationsTo, moveDrumMapOrder, moveDrumMapOrderTo, moveParts, movePartsTo, normalizeIds, parseQbd, parseStudioOneColor,
  serializeQbd, studioOneColorToCss, studioOneColorToHex, updateArticulation, updatePart, type MapData, type Result,
  type EditResult,
} from '../src/core';

/** 深く凍結する（編集関数が入力を書き換えれば TypeError になる） */
function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}

interface ArtDef { ID: number; Name: string; Complement?: number; DrumMapOrder: number; X?: unknown }
interface PartDef { ID: number; Name: string; arts: ArtDef[]; Color?: string }

/** Part 3件: A(Kick, Kick2) / B(Snare) / C(HH, HH2)。DrumMapOrder は配列順と異なる */
function buildJson(over?: { parts?: PartDef[]; pitchArts?: [number, string?][] }): string {
  const parts: PartDef[] = over?.parts ?? [
    { ID: 1, Name: 'A', Color: 'FF0000FF', arts: [{ ID: 1, Name: 'Kick', DrumMapOrder: 5, Complement: 3 }, { ID: 2, Name: 'Kick2', DrumMapOrder: 1 }] },
    { ID: 2, Name: 'B', arts: [{ ID: 3, Name: 'Snare', DrumMapOrder: 4, Complement: 5 }] },
    { ID: 3, Name: 'C', arts: [{ ID: 4, Name: 'HH', DrumMapOrder: 2 }, { ID: 5, Name: 'HH2', DrumMapOrder: 3, Complement: 4 }] },
  ];
  const refs = over?.pitchArts ?? [[1], [2], [3], [4], [5]];
  return JSON.stringify({
    AppName: 'QBDrumMap', ModelVersion: '1.0.0',
    Plugins: [
      {
        ID: 1, Name: 'P', PluginType: 'GM', MidiOutDevice: '', SoundCheckChannel: 'Channel10',
        Kits: [
          { ID: 1, Name: 'K1', Pitches: refs.map(([id], i) => ({ Pitch: 36 + i, Name: `n${i}`, ArticulationID: id, Separator: i === 1 ? 'Separate' : 'None' })) },
          { ID: 2, Name: 'K2', Pitches: [{ Pitch: 36, Name: 'other', ArticulationID: 0 }, { Pitch: 37, Name: 'keep', ArticulationID: 2 }] },
        ],
      },
    ],
    Parts: parts.map((p) => ({
      ID: p.ID, Name: p.Name, ScorePitch: 38, Color: p.Color, InstrumentEntityID: 'inst', TechniqueEntityID: 'tech', NoteHeadSet: 2,
      FuturePartField: { keep: true },
      Articulations: p.arts.map((a) => ({ ID: a.ID, Name: a.Name, Complement: a.Complement, DrumMapOrder: a.DrumMapOrder })),
    })),
  });
}

function load(json = buildJson(), freeze = true): MapData {
  const r = parseQbd(json);
  if (!r.ok) throw new Error(r.error.message);
  return freeze ? deepFreeze(r.value) : r.value;
}
const must = (r: Result<EditResult>): EditResult => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const pitchRefs = (m: MapData): number[][] => m.Plugins[0]!.Kits.map((k) => k.Pitches.map((p) => p.ArticulationID)).flat().map((x) => [x]);
const k1 = (m: MapData) => m.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.ArticulationID);
const partNames = (m: MapData) => m.Parts.map((p) => p.Name);
const orderNames = (m: MapData) => listDrumMapOrder(m).map((r) => m.Parts[r.partIndex]!.Articulations[r.articulationIndex]!.Name);
const dmo = (m: MapData) => m.Parts.flatMap((p) => p.Articulations.map((a) => a.DrumMapOrder));
const unique = (a: number[]) => new Set(a).size === a.length;

describe('Part: 追加・編集・並べ替え', () => {
  it('追加: ID は欠番の最小値、名前は Part{ID}、Windows版の既定値、末尾。入力は変更しない', () => {
    const m = load(buildJson({ parts: [{ ID: 1, Name: 'A', arts: [] }, { ID: 3, Name: 'C', arts: [] }], pitchArts: [] }));
    const r = must(addPart(m));
    expect(r.changed).toBe(true);
    expect(r.indices).toEqual([2]);
    expect(r.map.Parts[2]).toMatchObject({
      ID: 2, Name: 'Part2', ScorePitch: 0, Color: null, NoteHead: 'None', Technique: 'None', InstrumentEntityID: '', NoteHeadSet: 0,
      Voice: 'Up1', TechniqueEntityID: '', Articulations: [], DisplayOrder: 3, Extra: {},
    });
    expect(r.map.Parts[0]).toBe(m.Parts[0]); // 構造共有
    expect(addPart(load(buildJson({ parts: [], pitchArts: [] }))).ok).toBe(true);
  });

  it('属性の編集: すべての属性が変わり、他の属性・Articulation・Extra は保たれる（構造共有）', () => {
    const m = load();
    const r = must(updatePart(m, 1, {
      Name: 'B2', ScorePitch: 40, Color: '80102030', NoteHead: 'nhTr', Technique: 'plus', InstrumentEntityID: 'x.y', NoteHeadSet: 7,
      Voice: 'Down2', TechniqueEntityID: 'tt',
    }));
    expect(r.map.Parts[1]).toMatchObject({
      ID: 2, Name: 'B2', ScorePitch: 40, Color: '80102030', NoteHead: 'nhTr', Technique: 'plus', InstrumentEntityID: 'x.y', NoteHeadSet: 7,
      Voice: 'Down2', TechniqueEntityID: 'tt',
    });
    expect(r.map.Parts[1]!.Articulations).toBe(m.Parts[1]!.Articulations);
    expect(r.map.Parts[1]!.Extra).toEqual({ FuturePartField: { keep: true } });
    expect(r.map.Parts[0]).toBe(m.Parts[0]);
    expect(r.map.Plugins).toBe(m.Plugins);
    expect(m.Parts[1]!.Name).toBe('B');
  });

  it('未定義の enum 値（数値）も保持できる。Color を null に戻せる', () => {
    const m = load();
    const r = must(updatePart(m, 0, { NoteHead: 42, Voice: 9, Color: null }));
    expect(r.map.Parts[0]).toMatchObject({ NoteHead: 42, Voice: 9, Color: null });
  });

  it('変化なしは changed:false で同じモデル。不正な値・範囲外は拒否し何も変えない', () => {
    const m = load();
    const same = must(updatePart(m, 0, { Name: 'A', ScorePitch: 38 }));
    expect(same.changed).toBe(false);
    expect(same.map).toBe(m);
    for (const bad of [{ ScorePitch: 1.5 }, { NoteHeadSet: Number.NaN }, { ScorePitch: 2 ** 31 }]) {
      const r = updatePart(m, 0, bad);
      expect(r.ok).toBe(false);
    }
    const oob = updatePart(m, 9, { Name: 'x' });
    expect(oob.ok).toBe(false);
  });

  it('並べ替え: 先頭／上／下／末尾と D&D。DisplayOrder が 1..n で、対象の新しい位置を返す', () => {
    const m = load();
    expect(partNames(must(moveParts(m, [2], 'top')).map)).toEqual(['C', 'A', 'B']);
    expect(partNames(must(moveParts(m, [0], 'bottom')).map)).toEqual(['B', 'C', 'A']);
    expect(partNames(must(moveParts(m, [1], 'up')).map)).toEqual(['B', 'A', 'C']);
    expect(partNames(must(moveParts(m, [1], 'down')).map)).toEqual(['A', 'C', 'B']);
    const d = must(movePartsTo(m, [0, 1], 3));
    expect(partNames(d.map)).toEqual(['C', 'A', 'B']);
    expect(d.indices).toEqual([1, 2]);
    expect(d.map.Parts.map((p) => p.DisplayOrder)).toEqual([1, 2, 3]);
    expect(must(moveParts(m, [0], 'top')).changed).toBe(false);
    expect(moveParts(m, [5], 'top').ok).toBe(false);
  });
});

describe('Part 削除と参照整合性', () => {
  it('配下 Articulation を参照する全 KitPitch の ArticulationID を 0 にする（Name・Separator は変更しない）', () => {
    const m = load();
    const r = must(deleteParts(m, [0])); // A: Articulation ID 1, 2 を削除
    expect(partNames(r.map)).toEqual(['B', 'C']);
    expect(r.map.Parts.map((p) => p.DisplayOrder)).toEqual([1, 2]);
    expect(k1(r.map)).toEqual([0, 0, 3, 4, 5]);
    expect(r.map.Plugins[0]!.Kits[1]!.Pitches.map((p) => p.ArticulationID)).toEqual([0, 0]); // 別 Kit の参照(ID 2)も解除
    const rows = r.map.Plugins[0]!.Kits[0]!.Pitches;
    expect(rows.map((p) => p.Name)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(rows[1]!.Separator).toBe('Separate'); // 参照を解除しても Separator は自動で変えない
  });

  it('削除対象を指す他の Articulation の Complement も 0 にする。無関係な Complement は保つ', () => {
    const m = load();
    const r = must(deleteParts(m, [1])); // B: Articulation 3（A の Kick の Complement が 3 を指す）
    expect(r.map.Parts[0]!.Articulations.map((a) => a.Complement)).toEqual([0, 0]);
    expect(r.map.Parts[1]!.Articulations.map((a) => a.Complement)).toEqual([0, 4]); // C: HH2 → HH は無関係
  });

  it('1操作で完全に復元できる: 入力モデルは変更されず、変更のない部分は参照を共有する', () => {
    const m = load(); // 凍結済み。書き換えれば例外
    const r = must(deleteParts(m, [1]));
    expect(r.map).not.toBe(m);
    expect(r.map.Parts[2]).not.toBe(m.Parts[2]); // DisplayOrder が変わる
    expect(r.map.Plugins[0]!.Kits[1]).toBe(m.Plugins[0]!.Kits[1]); // 参照が無関係の Kit は共有
    expect(r.map.Plugins[0]!.Kits[0]).not.toBe(m.Plugins[0]!.Kits[0]);
    expect(k1(m)).toEqual([1, 2, 3, 4, 5]); // 元のモデルは完全に保たれる（Undo はこのスナップショットへ戻る）
    expect(m.Parts[0]!.Articulations[0]!.Complement).toBe(3);
  });

  it('複数 Part の削除、Articulation を持たない Part、空の選択、範囲外', () => {
    const m = load();
    const r = must(deleteParts(m, [0, 2]));
    expect(partNames(r.map)).toEqual(['B']);
    expect(k1(r.map)).toEqual([0, 0, 3, 0, 0]);
    const empty = must(addPart(m));
    const e = must(deleteParts(empty.map, [3]));
    expect(e.map.Plugins).toBe(m.Plugins); // 参照の解除が無ければ Plugins に触れない
    expect(must(deleteParts(m, [])).changed).toBe(false);
    expect(deleteParts(m, [3]).ok).toBe(false);
    expect(deleteParts(m, [-1]).ok).toBe(false);
  });

  it('ID が重複する異常データ: 残る要素と同じ ID を持つ削除対象の参照には作用しない（安全側）', () => {
    // Part B の Articulation ID を 1（Part A の Kick と重複）にする
    const m = load(buildJson({
      parts: [
        { ID: 1, Name: 'A', arts: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] },
        { ID: 2, Name: 'B', arts: [{ ID: 1, Name: 'Dup', DrumMapOrder: 2 }, { ID: 7, Name: 'Seven', DrumMapOrder: 3 }] },
      ],
      pitchArts: [[1], [7]],
    }));
    const r = must(deleteParts(m, [1]));
    expect(k1(r.map)).toEqual([1, 0]); // ID 1 は残る Kick も持つため解除しない。ID 7 は解除
  });

  it('ID 0 の Articulation（未割当と同じ値）は参照の解除対象にならない', () => {
    const m = load(buildJson({
      parts: [{ ID: 1, Name: 'A', arts: [{ ID: 0, Name: 'Zero', DrumMapOrder: 1 }] }, { ID: 2, Name: 'B', arts: [{ ID: 2, Name: 'Two', DrumMapOrder: 2 }] }],
      pitchArts: [[0], [2]],
    }));
    const r = must(deleteParts(m, [0]));
    expect(k1(r.map)).toEqual([0, 2]);
    expect(r.map.Plugins).toBe(m.Plugins);
  });
});

describe('Articulation: 追加・削除・並べ替え・編集', () => {
  it('追加: ID は全 Part 横断の欠番、名前は {Part名} {件数+1}、DrumMapOrder は全体の最大+1（一意）', () => {
    const m = load(buildJson({
      parts: [{ ID: 1, Name: 'A', arts: [{ ID: 1, Name: 'a', DrumMapOrder: 9 }, { ID: 3, Name: 'c', DrumMapOrder: 2 }] }, { ID: 2, Name: 'B', arts: [] }],
      pitchArts: [],
    }));
    const r = must(addArticulation(m, 1));
    expect(r.indices).toEqual([0]);
    expect(r.map.Parts[1]!.Articulations[0]).toMatchObject({ ID: 2, Name: 'B 1', Complement: 0, DrumMapOrder: 10, DisplayOrder: 1, Extra: {} });
    const r2 = must(addArticulation(r.map, 0));
    expect(r2.map.Parts[0]!.Articulations.at(-1)).toMatchObject({ ID: 4, Name: 'A 3', DrumMapOrder: 11, DisplayOrder: 3 });
    expect(unique(dmo(r2.map))).toBe(true);
    expect(addArticulation(m, 5).ok).toBe(false);
    const empty = load(buildJson({ parts: [{ ID: 1, Name: 'A', arts: [] }], pitchArts: [] }));
    expect(must(addArticulation(empty, 0)).map.Parts[0]!.Articulations[0]).toMatchObject({ ID: 1, DrumMapOrder: 1 });
  });

  it('削除: KitPitch の参照と他の Complement を解除し、DisplayOrder を 1..n に振り直す。DrumMapOrder は変えない', () => {
    const m = load();
    const r = must(deleteArticulations(m, 0, [0])); // Kick (ID 1)。Snare(ID 3) の Complement は 5 のまま
    expect(r.map.Parts[0]!.Articulations.map((a) => [a.Name, a.DisplayOrder, a.DrumMapOrder])).toEqual([['Kick2', 1, 1]]);
    expect(k1(r.map)).toEqual([0, 2, 3, 4, 5]);
    expect(r.map.Parts[1]).toBe(m.Parts[1]);
    const c = must(deleteArticulations(m, 1, [0])); // Snare (ID 3)。Kick の Complement(3) が解除される
    expect(c.map.Parts[0]!.Articulations[0]!.Complement).toBe(0);
    expect(k1(c.map)).toEqual([1, 2, 0, 4, 5]);
    expect(deleteArticulations(m, 0, [2]).ok).toBe(false);
    expect(deleteArticulations(m, 9, [0]).ok).toBe(false);
    expect(must(deleteArticulations(m, 0, [])).changed).toBe(false);
  });

  it('並べ替え（Part 内 DisplayOrder）: ボタンと D&D', () => {
    const m = load();
    expect(must(moveArticulations(m, 2, [1], 'top')).map.Parts[2]!.Articulations.map((a) => a.Name)).toEqual(['HH2', 'HH']);
    const d = must(moveArticulationsTo(m, 0, [0], 2));
    expect(d.map.Parts[0]!.Articulations.map((a) => [a.Name, a.DisplayOrder])).toEqual([['Kick2', 1], ['Kick', 2]]);
    expect(d.indices).toEqual([1]);
    expect(must(moveArticulations(m, 0, [0], 'top')).changed).toBe(false);
    expect(moveArticulations(m, 0, [4], 'top').ok).toBe(false);
  });

  it('Name と Complement の編集。Complement は存在する ID か 0。存在しない・重複 ID は拒否', () => {
    const m = load();
    const r = must(updateArticulation(m, 2, 0, { Name: 'HH-new', Complement: 3 }));
    expect(r.map.Parts[2]!.Articulations[0]).toMatchObject({ ID: 4, Name: 'HH-new', Complement: 3, DrumMapOrder: 2 });
    expect(must(updateArticulation(m, 0, 0, { Complement: 0 })).map.Parts[0]!.Articulations[0]!.Complement).toBe(0);
    expect(must(updateArticulation(m, 0, 0, { Complement: 1 })).map.Parts[0]!.Articulations[0]!.Complement).toBe(1); // 自分自身（Windows版も選べる）
    expect(updateArticulation(m, 0, 0, { Complement: 99 })).toMatchObject({ ok: false, error: { code: 'articulation-not-found' } });
    expect(updateArticulation(m, 0, 0, { Complement: 1.5 }).ok).toBe(false);
    expect(must(updateArticulation(m, 0, 0, { Name: 'Kick' })).changed).toBe(false);
    expect(updateArticulation(m, 0, 7, { Name: 'x' }).ok).toBe(false);
    const dup = load(buildJson({
      parts: [{ ID: 1, Name: 'A', arts: [{ ID: 1, Name: 'a', DrumMapOrder: 1 }, { ID: 1, Name: 'b', DrumMapOrder: 2 }] }], pitchArts: [],
    }));
    expect(updateArticulation(dup, 0, 0, { Complement: 1 })).toMatchObject({ ok: false, error: { code: 'ambiguous-articulation-id' } });
  });
});

describe('DrumMap Order（全 Part 横断）', () => {
  it('一覧は DrumMapOrder 昇順。同値は Part 順→Part 内の順で安定', () => {
    const m = load();
    expect(orderNames(m)).toEqual(['Kick2', 'HH', 'HH2', 'Snare', 'Kick']);
    const tie = load(buildJson({
      parts: [{ ID: 1, Name: 'A', arts: [{ ID: 1, Name: 'a1', DrumMapOrder: 3 }, { ID: 2, Name: 'a2', DrumMapOrder: 3 }] }, { ID: 2, Name: 'B', arts: [{ ID: 3, Name: 'b1', DrumMapOrder: 3 }] }],
      pitchArts: [],
    }));
    expect(orderNames(tie)).toEqual(['a1', 'a2', 'b1']);
  });

  it('並べ替え（先頭／上／下／末尾）: 一覧の順が変わり、DrumMapOrder は 1..n で一意。Part 内の順（DisplayOrder）は変わらない', () => {
    const m = load();
    const top = must(moveDrumMapOrder(m, [4], 'top')); // Kick
    expect(orderNames(top.map)).toEqual(['Kick', 'Kick2', 'HH', 'HH2', 'Snare']);
    expect(top.indices).toEqual([0]);
    expect(dmo(top.map).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(top.map.Parts.map((p) => p.Articulations.map((a) => a.DisplayOrder))).toEqual([[1, 2], [1], [1, 2]]);
    expect(orderNames(must(moveDrumMapOrder(m, [0], 'bottom')).map)).toEqual(['HH', 'HH2', 'Snare', 'Kick', 'Kick2']);
    expect(orderNames(must(moveDrumMapOrder(m, [2], 'up')).map)).toEqual(['Kick2', 'HH2', 'HH', 'Snare', 'Kick']);
    expect(orderNames(must(moveDrumMapOrder(m, [1], 'down')).map)).toEqual(['Kick2', 'HH2', 'HH', 'Snare', 'Kick']);
    expect(must(moveDrumMapOrder(m, [0], 'top')).changed).toBe(false);
    expect(moveDrumMapOrder(m, [5], 'top').ok).toBe(false);
  });

  it('非連続の複数選択と D&D（直前へ）。選択は表示順に整列して適用', () => {
    const m = load();
    const r = must(moveDrumMapOrder(m, [3, 0], 'top')); // Snare, Kick2
    expect(orderNames(r.map)).toEqual(['Kick2', 'Snare', 'HH', 'HH2', 'Kick']);
    expect(r.indices).toEqual([0, 1]);
    const d = must(moveDrumMapOrderTo(m, [0, 2], 4)); // Kick2, HH2 を Kick の直前へ
    expect(orderNames(d.map)).toEqual(['HH', 'Snare', 'Kick2', 'HH2', 'Kick']);
    expect(unique(dmo(d.map))).toBe(true);
    expect(must(moveDrumMapOrderTo(m, [4], 5)).changed).toBe(false);
  });

  it('連続して並べ替えても一意性が保たれ、保存・再読込後も順序が安定する', () => {
    let m = load();
    for (const [pos, dir] of [[4, 'top'], [2, 'down'], [0, 'bottom'], [1, 'up']] as const) m = must(moveDrumMapOrder(m, [pos], dir)).map;
    expect(unique(dmo(m))).toBe(true);
    const before = orderNames(m);
    const saved = serializeQbd(m);
    if (!saved.ok) throw new Error('save');
    const re = load(saved.value.text, false);
    expect(orderNames(re)).toEqual(before);
    const n = normalizeIds(m);
    if (!n.ok) throw new Error('n');
    expect(orderNames(n.value)).toEqual(before);
  });

  it('同値・欠番の DrumMapOrder（異常データ）でも、並べ替え後は 1..n に整う', () => {
    const m = load(buildJson({
      parts: [{ ID: 1, Name: 'A', arts: [{ ID: 1, Name: 'a1', DrumMapOrder: 10 }, { ID: 2, Name: 'a2', DrumMapOrder: 10 }] }, { ID: 2, Name: 'B', arts: [{ ID: 3, Name: 'b1', DrumMapOrder: 99 }] }],
      pitchArts: [],
    }));
    const r = must(moveDrumMapOrder(m, [2], 'top'));
    expect(orderNames(r.map)).toEqual(['b1', 'a1', 'a2']);
    expect(dmo(r.map)).toEqual([2, 3, 1]);
  });
});

describe('Part Color', () => {
  it('AABBGGRR の変換（Windows版 StudioOneColorConverter）', () => {
    expect(parseStudioOneColor('FF00008B')).toEqual({ a: 255, b: 0, g: 0, r: 0x8b });
    expect(parseStudioOneColor('80112233')).toEqual({ a: 0x80, b: 0x11, g: 0x22, r: 0x33 });
    expect(parseStudioOneColor('ff')).toEqual({ a: 0, b: 0, g: 0, r: 255 }); // 短い値は左を 0 で埋める
    for (const bad of [null, undefined, '', 'zz', '#FF0000']) expect(parseStudioOneColor(bad)).toEqual({ a: 0, b: 0, g: 0, r: 0 });
    expect(formatStudioOneColor({ a: 255, r: 0x33, g: 0x22, b: 0x11 })).toBe('FF112233');
    expect(studioOneColorToHex('FF00008B')).toBe('#8b0000');
    expect(studioOneColorToCss('80112233')).toBe('rgba(51, 34, 17, 0.502)');
  });
});

const WIN_QBD = fileURLToPath(new URL('../public/samples/DrumMap.qbd', import.meta.url));
describe.skipIf(!existsSync(WIN_QBD))('実ファイル DrumMap.qbd（39 Part / 199 Articulation）', () => {
  const real = (): MapData => load(readFileSync(WIN_QBD, 'utf8'));

  it('Part 削除で、その Articulation を参照する全 KitPitch が 0 になり、それ以外は変わらない。入力は不変', () => {
    const m = real();
    const part = m.Parts[5]!;
    const ids = new Set(part.Articulations.map((a) => a.ID));
    const countBefore = m.Plugins.flatMap((p) => p.Kits.flatMap((k) => k.Pitches)).filter((p) => ids.has(p.ArticulationID)).length;
    const r = must(deleteParts(m, [5]));
    const after = r.map.Plugins.flatMap((p) => p.Kits.flatMap((k) => k.Pitches));
    expect(after.filter((p) => ids.has(p.ArticulationID))).toHaveLength(0);
    const before = m.Plugins.flatMap((p) => p.Kits.flatMap((k) => k.Pitches));
    let cleared = 0;
    before.forEach((b, i) => {
      const a = after[i]!;
      if (ids.has(b.ArticulationID)) { cleared++; expect(a).toMatchObject({ ArticulationID: 0, Name: b.Name, Separator: b.Separator, Pitch: b.Pitch }); }
      else expect(a).toBe(b);
    });
    expect(cleared).toBe(countBefore);
    expect(r.map.Parts).toHaveLength(38);
    // 保存 → 再読込
    const s = serializeQbd(r.map);
    expect(s.ok).toBe(true);
  });

  it('DrumMap Order の連続並べ替え後も一意で、保存・再読込後に同じ順序', () => {
    let m = real();
    const n = listDrumMapOrder(m).length;
    expect(n).toBe(199);
    for (const [pos, dir] of [[198, 'top'], [10, 'bottom'], [50, 'up'], [3, 'down']] as const) m = must(moveDrumMapOrder(m, [pos], dir)).map;
    m = must(moveDrumMapOrderTo(m, [0, 5, 120], 77)).map;
    expect(unique(dmo(m))).toBe(true);
    expect(Math.max(...dmo(m))).toBe(199);
    const names = orderNames(m);
    const saved = serializeQbd(m);
    if (!saved.ok) throw new Error('save');
    expect(orderNames(load(saved.value.text, false))).toEqual(names);
  });

  it('保存・再読込で Part 属性（Color／ScorePitch／Entity ID）が失われない', () => {
    const m = real();
    const r = must(updatePart(m, 0, { Name: m.Parts[0]!.Name + '!' }));
    const saved = serializeQbd(r.map);
    if (!saved.ok) throw new Error('save');
    const re = load(saved.value.text, false);
    expect(re.Parts[0]).toMatchObject({ Color: m.Parts[0]!.Color, ScorePitch: m.Parts[0]!.ScorePitch, InstrumentEntityID: m.Parts[0]!.InstrumentEntityID });
    expect(pitchRefs(re).length).toBeGreaterThan(0);
  });
});
