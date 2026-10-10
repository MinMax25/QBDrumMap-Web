import { describe, expect, it } from 'vitest';
import {
  DIVIDER_NAME, getArticulationMap, getKitPitchOrder, isNullOrWhiteSpace, normalizeIds, parseQbd, pitchesText,
  representativeNote, representativePitch, type MapData,
} from '../src/core';

const load = (o: unknown): MapData => {
  const r = parseQbd(JSON.stringify(o));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const kitOf = (pitches: object[], parts: object[]): MapData =>
  load({ Plugins: [{ ID: 1, Name: 'P', Kits: [{ ID: 1, Name: 'K', Pitches: pitches }] }], Parts: parts });
const amap = (m: MapData) => {
  const r = getArticulationMap(m, 'K');
  if (!r.ok) throw new Error(r.error.message);
  return r.value.Items;
};
const order = (m: MapData, useArticulation = true): string[] => {
  const r = getKitPitchOrder(m, 'K', { useArticulation });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.map((p) => p.Name ?? '');
};

describe('Articulation Resolver', () => {
  // Part1: Open(1) / Closed(2) / Pedal(3)（DisplayOrder 1,2,3）。Part2: Ride(4) / Bell(5)
  const parts = [
    { ID: 1, Name: 'HH', Articulations: [
      { ID: 1, Name: 'Open', DrumMapOrder: 1 }, { ID: 2, Name: 'Closed', DrumMapOrder: 2 }, { ID: 3, Name: 'Pedal', DrumMapOrder: 3 }] },
    { ID: 2, Name: 'Ride', Articulations: [
      { ID: 4, Name: 'Ride', DrumMapOrder: 4 }, { ID: 5, Name: 'Bell', DrumMapOrder: 5 }] },
  ];

  it('直接割当・IsSubは補間前に確定し、補間後も変わらない', () => {
    // ClosedだけにPitch 42を割り当てる。Open(前)・Pedal(後)は補間される
    const items = amap(kitOf([{ Pitch: 42, Name: 'c', ArticulationID: 2 }], parts));
    const by = Object.fromEntries(items.map((i) => [i.Name, i]));
    expect(by['Closed']).toMatchObject({ Pitches: [42], IsSub: false });
    // 前方補間: Closed(42)→Pedal。後方補間: Closed→Open。いずれもIsSub=true のまま
    expect(by['Pedal']).toMatchObject({ Pitches: [42], IsSub: true });
    expect(by['Open']).toMatchObject({ Pitches: [42], IsSub: true });
    // 別Part(Ride)は割当が無く、補間元も無いので空のまま
    expect(by['Ride']).toMatchObject({ Pitches: [], IsSub: true });
  });

  it('補間はPart内のDisplayOrder順（DrumMapOrderではない）', () => {
    // DrumMapOrderを逆転させても、補間方向はDisplayOrder基準
    const p = JSON.parse(JSON.stringify(parts));
    p[0].Articulations[0].DrumMapOrder = 3;
    p[0].Articulations[2].DrumMapOrder = 1;
    // Open(DisplayOrder1)にPitch 40、Pedal(DisplayOrder3)にPitch 44。Closedは前方補間で40になる
    const items = amap(kitOf([
      { Pitch: 40, Name: 'o', ArticulationID: 1 }, { Pitch: 44, Name: 'p', ArticulationID: 3 }], p));
    expect(items.find((i) => i.Name === 'Closed')!.Pitches).toEqual([40]);
    expect(items.find((i) => i.Name === 'Closed')!.Order).toBe(2);
  });

  it('複数Pitch: Separator順（None→Separate→Unload→Duplicate）、同値は配列順で追加し、代表Pitchは先頭', () => {
    const items = amap(kitOf([
      { Pitch: 50, Name: 'a', ArticulationID: 4, Separator: 'Duplicate' },
      { Pitch: 51, Name: 'b', ArticulationID: 4 },
      { Pitch: 52, Name: 'c', ArticulationID: 4, Separator: 'Unload' },
      { Pitch: 53, Name: 'd', ArticulationID: 4 },
    ], parts));
    const ride = items.find((i) => i.Name === 'Ride')!;
    expect(ride.Pitches).toEqual([51, 53, 52, 50]);
    expect(representativePitch(ride)).toBe(51);
    expect(representativeNote(ride)).toBe('D#2'); // 51 → D#2
    expect(pitchesText(ride)).toBe('51, 53, 52, 50');
    // 同Partの後続Bellには前方補間で代表Pitch(51)が入る。IsSubはtrue
    expect(items.find((i) => i.Name === 'Bell')).toMatchObject({ Pitches: [51], IsSub: true });
  });

  it('Name空の行や存在しないIDでもArticulationIDが一致すればPitchが入る（Windows版は行のNameを見ない）', () => {
    const items = amap(kitOf([
      { Pitch: 60, Name: '', ArticulationID: 4 }, { Pitch: 61, Name: 'x', ArticulationID: 777 }], parts));
    expect(items.find((i) => i.Name === 'Ride')!.Pitches).toEqual([60]);
    expect(items.flatMap((i) => i.Pitches)).not.toContain(61);
  });

  it('Complement: 補間されなかったItemにだけ適用し、逐次更新後の状態を参照する', () => {
    // Part1 には割当なし。Part2のRideにPitch 70。Open→Closed、Closed→Ride のComplement連鎖
    const p = JSON.parse(JSON.stringify(parts));
    p[0].Articulations[0].Complement = 2; // Open → Closed
    p[0].Articulations[1].Complement = 4; // Closed → Ride
    const items = amap(kitOf([{ Pitch: 70, Name: 'r', ArticulationID: 4 }], p));
    const by = Object.fromEntries(items.map((i) => [i.Name, i]));
    // Itemの配列順は Open, Closed, Pedal, Ride, Bell。Openを先に処理する時点でClosedは未補間のため、Openは空のまま
    expect(by['Closed']!.Pitches).toEqual([70]);
    expect(by['Open']!.Pitches).toEqual([]);
    expect(by['Pedal']!.Pitches).toEqual([]);
    expect(by['Open']!.IsSub && by['Closed']!.IsSub).toBe(true);
  });

  it('Complement先が存在しない場合は（補間されなかったItemに限り）エラー', () => {
    const p = JSON.parse(JSON.stringify(parts));
    p[0].Articulations[0].Complement = 999;
    const m = kitOf([{ Pitch: 70, Name: 'r', ArticulationID: 4 }], p);
    const r = getArticulationMap(m, 'K');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('complement-not-found');
      expect(r.error.message).toBe("Complement Articulation ID '999' not found.");
    }
    // Pitchが補間されて埋まるItemのComplementは検査されない
    const ok = kitOf([{ Pitch: 42, Name: 'c', ArticulationID: 2 }], p);
    expect(getArticulationMap(ok, 'K').ok).toBe(true);
  });

  it('存在しないKit名はエラー', () => {
    const r = getArticulationMap(kitOf([], parts), 'NoKit');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('kit-not-found');
  });

  it('回帰: ID=0のArticulationは、ArticulationID=0の行（割当なし行）のPitchを受け取る（Windows版の挙動）', () => {
    const m = kitOf(
      [{ Pitch: 30, Name: 'unassigned' }, { Pitch: 31, Name: 'x', ArticulationID: 5 }],
      [{ ID: 1, Name: 'P', Articulations: [{ Name: 'zero' }, { ID: 5, Name: 'five', DrumMapOrder: 1 }] }],
    );
    const items = amap(m);
    expect(items.find((i) => i.Name === 'zero')).toMatchObject({ ID: 0, Pitches: [30], IsSub: false });
  });

  it('回帰: ID=0のArticulationは正規化(FixID)後もID=0のまま、採番枠だけ消費する', () => {
    const m = kitOf(
      [{ Pitch: 31, Name: 'x', ArticulationID: 7 }],
      [{ ID: 1, Name: 'P', Articulations: [{ Name: 'zero' }, { ID: 7, Name: 'seven', DrumMapOrder: 1 }] }],
    );
    const n = normalizeIds(m);
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.value.Parts[0]!.Articulations.map((a) => a.ID)).toEqual([0, 2]);
    expect(n.value.Plugins[0]!.Kits[0]!.Pitches[0]!.ArticulationID).toBe(2);
  });

  it('PartIDが重複していると、同じPartIDのItemは1グループとして補間される（Windows版 GroupBy の挙動）', () => {
    const m = kitOf([{ Pitch: 10, Name: 'a', ArticulationID: 1 }], [
      { ID: 1, Name: 'A', Articulations: [{ ID: 1, Name: 'a1', DrumMapOrder: 1 }] },
      { ID: 1, Name: 'B', Articulations: [{ ID: 2, Name: 'b1', DrumMapOrder: 2 }] },
    ]);
    // 両Partが同じPartID=1。Orderはどちらも1。a1(割当)の後にb1が前方補間される
    expect(amap(m).find((i) => i.Name === 'b1')!.Pitches).toEqual([10]);
  });
});

describe('DAW表示順 (GetKitPitches)', () => {
  const parts = [
    { ID: 1, Name: 'A', Articulations: [
      { ID: 1, Name: 'a1', DrumMapOrder: 3 }, { ID: 2, Name: 'a2', DrumMapOrder: 1 }] },
    { ID: 2, Name: 'B', Articulations: [{ ID: 3, Name: 'b1', DrumMapOrder: 2 }] },
  ];

  it('割当あり・区切りなしはDrumMapOrder順（DisplayOrderではない）', () => {
    const m = kitOf([
      { Pitch: 1, Name: 'a1', ArticulationID: 1 }, { Pitch: 2, Name: 'a2', ArticulationID: 2 },
      { Pitch: 3, Name: 'b1', ArticulationID: 3 },
    ], parts);
    expect(order(m)).toEqual(['a2', 'b1', 'a1']); // DrumMapOrder 1,2,3
    expect(order(m, false)).toEqual(['a1', 'a2', 'b1']); // 設定OFF: 行のDisplayOrder順
  });

  it('割当なしの行はKitPitchのDisplayOrder→Pitch順。区切り行は空きPitchの最小値に挿入される', () => {
    const m = kitOf([
      { Pitch: 0, Name: 'n0' }, // 割当なし・区切りなし
      { Pitch: 1, Name: 'a1', ArticulationID: 1 },
      { Pitch: 2, Name: 's', ArticulationID: 2, Separator: 'Separate' },
    ], parts);
    const r = getKitPitchOrder(m, 'K', { useArticulation: true });
    expect(r.ok && r.value.map((p) => [p.Name, p.Pitch])).toEqual([
      ['a1', 1], [DIVIDER_NAME, 3], ['n0', 0], ['s', 2],
    ]);
    // 区切り行は新規オブジェクトで、元の行は変更されない
    expect(m.Plugins[0]!.Kits[0]!.Pitches).toHaveLength(3);
  });

  it('区切りあり&割当なしの行がある場合、割当なし・区切りなしの行は先頭ブロックに入る', () => {
    const m = kitOf([
      { Pitch: 5, Name: 'a1', ArticulationID: 1 },
      { Pitch: 6, Name: 'free' },
      { Pitch: 7, Name: 'sepFree', Separator: 'Unload' },
    ], parts);
    // 先頭: a1, free → 区切り行条件: (hasNoSep) && (hasAndSep || noArticNoSep) → 区切り行 → sepFree
    expect(order(m)).toEqual(['a1', 'free', DIVIDER_NAME, 'sepFree']);
  });

  it('Separatorは None を除き Separate→Unload→Duplicate の順。割当ありはDrumMapOrder順', () => {
    const m = kitOf([
      { Pitch: 1, Name: 'dup', ArticulationID: 1, Separator: 'Duplicate' },
      { Pitch: 2, Name: 'unl', ArticulationID: 2, Separator: 'Unload' },
      { Pitch: 3, Name: 'sep1', ArticulationID: 1, Separator: 'Separate' },
      { Pitch: 4, Name: 'sep2', ArticulationID: 2, Separator: 'Separate' },
      { Pitch: 5, Name: 'plain', ArticulationID: 3 },
    ], parts);
    // sep1(DrumMapOrder3)・sep2(1) → Separate内はsep2,sep1 / Unload / Duplicate
    expect(order(m)).toEqual(['plain', DIVIDER_NAME, 'sep2', 'sep1', 'unl', 'dup']);
  });

  it('Pitchが負、Nameが空白のみ（.NETの空白定義）の行は除外される。空きPitchが無ければ区切り行は入らない', () => {
    const m = kitOf([
      { Pitch: 1, Name: 'a1', ArticulationID: 1 },
      { Pitch: 2, Name: '  ', ArticulationID: 2 },
      { Pitch: -1, Name: 'neg', ArticulationID: 2 },
      { Pitch: 4, Name: 'free' },
    ], parts);
    expect(order(m)).toEqual(['a1', DIVIDER_NAME, 'free']); // 区切り行条件は成立するため挿入される(空きPitch 0)
    expect(isNullOrWhiteSpace(' 　\t')).toBe(true);
    expect(isNullOrWhiteSpace('﻿')).toBe(false); // .NETはU+FEFFを空白としない（JSのtrimとの差）

    const full = kitOf([
      ...Array.from({ length: 128 }, (_, p) => (p === 0
        ? { Pitch: p, Name: 'a1', ArticulationID: 1 }
        : { Pitch: p, Name: `f${p}`, Separator: p === 1 ? 'Separate' : undefined })),
    ], parts);
    expect(order(full).includes(DIVIDER_NAME)).toBe(false);
  });

  it('Articulationを使わない場合/Articulation割当が無いKitは、Nameが空白でない行をDisplayOrder順に並べるだけ', () => {
    const m = kitOf([
      { Pitch: 9, Name: 'z' }, { Pitch: 3, Name: '' }, { Pitch: 1, Name: 'y', Separator: 'Separate' },
    ], parts);
    expect(order(m)).toEqual(['z', 'y']);
  });

  it('存在しないKit名はエラー', () => {
    expect(getKitPitchOrder(kitOf([], parts), 'X', { useArticulation: true }).ok).toBe(false);
  });
});
