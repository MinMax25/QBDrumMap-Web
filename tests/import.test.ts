import { describe, expect, it } from 'vitest';
import {
  CRLF, cloneMap, fileNameWithoutExtension, importDrm, importPitchlist, importTsv, normalizeIds, parseQbd,
  serializeQbd, type KitRef, type MapData, type Result,
} from '../src/core';

const load = (o: unknown): MapData => {
  const r = parseQbd(JSON.stringify(o));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const T: KitRef = { pluginIndex: 0, kitIndex: 0 };
const value = <A>(r: Result<A>): A => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};

const base = (): MapData => load({
  Plugins: [
    { ID: 1, Name: 'P1', Kits: [{ ID: 1, Name: 'Target', Pitches: [
      { Pitch: 36, Name: 'old36', ArticulationID: 1, Separator: 'Separate' }, { Pitch: 38, Name: 'old38' }, { Pitch: 40, Name: 'old40' }] }] },
    { ID: 2, Name: 'P2', Kits: [{ ID: 2, Name: 'Other', Pitches: [{ Pitch: 1, Name: 'keep', ArticulationID: 2 }] }] },
  ],
  Parts: [{ ID: 1, Name: 'Part', Articulations: [{ ID: 1, Name: 'Kick' }, { ID: 2, Name: 'Snare' }] }],
});

const pl = (items: [number, string][], title = 'Imported'): string =>
  [`<?xml version="1.0" encoding="utf-8"?>`, `<Music.PitchNameList title="${title}">`,
    ...items.map(([p, n]) => `\t<Music.PitchName pitch="${p}" name="${n}"/>`), '</Music.PitchNameList>', ''].join(CRLF);

describe('取り込み共通: 既存QBDの不要な変更を防ぐ', () => {
  it('入力モデルは変更せず、対象Kit以外は完全に同一のまま', () => {
    const m = base();
    const before = cloneMap(m);
    const r = value(importPitchlist(m, T, pl([[38, 'Snare']]), 'x.pitchlist'));
    expect(m).toEqual(before); // 元のモデルは不変
    expect(r.Plugins[1]).toEqual(before.Plugins[1]); // 他Plugin/他Kitは不変
    expect(r.Parts).toEqual(before.Parts);
    expect(r.Plugins[0]!.Kits[0]!.Name).toBe('Imported');
  });

  it('失敗時は何も変更しない（Windows版は部分更新が残り得る）', () => {
    const m = base();
    const before = cloneMap(m);
    expect(importTsv(m, T, ['Pitch\tNote\tName\tArticulation\tSeparator', '36\tC1\tx\t\t', '999\t\ty\t\t'].join(CRLF), 'a.tsv').ok).toBe(false);
    expect(importPitchlist(m, T, '<oops', 'a.pitchlist').ok).toBe(false);
    expect(importDrm(m, T, '<Other/>').ok).toBe(false);
    expect(m).toEqual(before);
  });

  it('存在しないKit位置はエラー', () => {
    expect(importTsv(base(), { pluginIndex: 5, kitIndex: 0 }, '', 'a.tsv').ok).toBe(false);
  });
});

describe('Studio One .pitchlist 取り込み', () => {
  it('Kit名=title、一致するPitchのNameを適用しArticulation/Separatorを初期化、ファイル順がDisplayOrder', () => {
    const r = value(importPitchlist(base(), T, pl([[40, 'B'], [36, 'A']]), 'f.pitchlist'));
    const k = r.Plugins[0]!.Kits[0]!;
    expect(k.Pitches.map((p) => [p.Pitch, p.Name, p.ArticulationID, p.Separator, p.DisplayOrder])).toEqual([
      [36, 'A', 0, 'None', 2], // ファイル内2番目
      [38, '', 0, 'None', 3], // ファイルに無いPitchはNameが空、末尾側
      [40, 'B', 0, 'None', 1],
    ]);
    // 配列順は変えない（Windows版の SortRefresh は表示用のビュー並びのみ）
    expect(k.Pitches.map((p) => p.Pitch)).toEqual([36, 38, 40]);
  });

  it('titleが空白ならファイル名（拡張子なし）。64文字を超えるNameは切り詰める', () => {
    const long = 'あ'.repeat(70);
    const r = value(importPitchlist(base(), T, pl([[36, long]], '  '), 'My.Kit.pitchlist'));
    expect(r.Plugins[0]!.Kits[0]!.Name).toBe('My.Kit');
    expect(r.Plugins[0]!.Kits[0]!.Pitches[0]!.Name).toBe('あ'.repeat(64));
  });

  it('同じpitchが複数あれば最初の項目を使う。未知の要素・属性は無視する', () => {
    const t = [`<Music.PitchNameList title="T">`, `<Music.PitchName pitch="36" name="first" extra="1"/>`,
      `<Music.PitchName pitch="36" name="second"/>`, `<Unknown/>`, `</Music.PitchNameList>`].join('\n');
    const r = value(importPitchlist(base(), T, t, 'f.pitchlist'));
    expect(r.Plugins[0]!.Kits[0]!.Pitches[0]).toMatchObject({ Pitch: 36, Name: 'first', DisplayOrder: 1 });
  });

  it.each([
    ['ルート名が違う', '<Other title="x"/>'], ['pitchが数値でない', pl([[1, 'a']]).replace('pitch="1"', 'pitch="x"')],
    ['pitchが範囲外', pl([[300, 'a']])], ['XMLが壊れている', '<Music.PitchNameList>'],
  ])('エラー: %s', (_n, text) => {
    expect(importPitchlist(base(), T, text, 'f.pitchlist').ok).toBe(false);
  });
});

describe('Cubase .drm 取り込み', () => {
  const drm = (name: string, items: [number, string][], order: number[]): string => {
    const maps = items.map(([n, nm]) => `<item><int name="INote" value="${n}"/><string name="Name" value="${nm}"/></item>`).join('');
    return `<DrumMap><string name="Name" value="${name}"/><list name="Map" type="list">${maps}</list>` +
      `<list name="Order" type="int">${order.map((o) => `<item value="${o}"/>`).join('')}</list></DrumMap>`;
  };

  it('INoteが一致するMap項目のNameを適用。DisplayOrderはOrder内の位置（Orderに無ければ0＝先頭側）', () => {
    const r = value(importDrm(base(), T, drm('DrmKit', [[36, 'A'], [38, 'B']], [38, 36])));
    const k = r.Plugins[0]!.Kits[0]!;
    expect(k.Name).toBe('DrmKit');
    // 40 はMapに無い: Name空・1000+Pitch。最終的に 1.. へ詰める
    expect(k.Pitches.map((p) => [p.Pitch, p.Name, p.DisplayOrder])).toEqual([[36, 'A', 2], [38, 'B', 1], [40, '', 3]]);
    // Order に無いPitchは DisplayOrder=0 となり先頭側に並ぶ（Windows版 IndexOf+1 の挙動）
    const r2 = value(importDrm(base(), T, drm('D', [[36, 'A'], [38, 'B']], [38])));
    expect(r2.Plugins[0]!.Kits[0]!.Pitches.map((p) => [p.Pitch, p.DisplayOrder])).toEqual([[36, 1], [38, 2], [40, 3]]);
  });

  it('整数でない値はエラー', () => {
    expect(importDrm(base(), T, drm('D', [[36, 'A']], [1]).replace('value="36"', 'value="x"')).ok).toBe(false);
  });
});

describe('TSV 取り込み', () => {
  const H = 'Pitch\tNote\tName\tArticulation\tSeparator';
  const tsv = (...rows: string[]): string => [H, ...rows].join(CRLF) + CRLF;

  it('Pitch番号で対応づける（Note列は無視）。Articulation名→ID、Separator、行順がDisplayOrder', () => {
    const r = value(importTsv(base(), T, tsv('40\tZZZ\tB\tSnare\tUnload', '36\t?\tA\tKick\tSeparate'), 'My Kit.tsv'));
    const k = r.Plugins[0]!.Kits[0]!;
    expect(k.Name).toBe('My Kit');
    expect(k.Pitches.map((p) => [p.Pitch, p.Name, p.ArticulationID, p.Separator, p.DisplayOrder])).toEqual([
      [36, 'A', 1, 'Separate', 2], [38, 'old38', 0, 'None', 3], [40, 'B', 2, 'Unload', 1],
    ]);
  });

  it('Separatorの解釈: 大文字小文字は区別、数値文字列・"A,B"（OR）可、未定義の整数は数値のまま保持、解釈不能はNone', () => {
    const r = value(importTsv(base(), T, tsv('36\t\ta\t\tseparate', '38\t\tb\t\t2', '40\t\tc\t\t99'), 'a.tsv'));
    expect(r.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.Separator)).toEqual(['None', 'Unload', 99]);
    const r2 = value(importTsv(base(), T, tsv('36\t\ta\t\tSeparate,Unload', '38\t\tb\t\t Duplicate '), 'a.tsv'));
    expect(r2.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.Separator).slice(0, 2)).toEqual(['Duplicate', 'Duplicate']);
  });

  it('Nameが空白ならArticulation/Separatorは無視（空の名前は未割当として扱う）', () => {
    const r = value(importTsv(base(), T, tsv('36\t\t \tSnare\tUnload'), 'a.tsv'));
    expect(r.Plugins[0]!.Kits[0]!.Pitches[0]).toMatchObject({ Name: ' ', ArticulationID: 0, Separator: 'None' });
  });

  it('LF改行も受け付ける（Web版の差異。Windows版はCRLFのみ）。BOMは無視する', () => {
    const lf = ['﻿' + H, '36\t\ta\t\t'].join('\n');
    expect(value(importTsv(base(), T, lf, 'a.tsv')).Plugins[0]!.Kits[0]!.Pitches[0]!.Name).toBe('a');
  });

  it.each([
    ['ヘッダーが違う', ['Pitch\tNote\tName\tArticulation', '36\t\ta\t\t'].join(CRLF)],
    ['列数が違う', tsv('36\t\ta')], ['Pitchが整数でない', tsv('x\t\ta\t\t')], ['Kitに無いPitch', tsv('99\t\ta\t\t')], ['空', ''],
  ])('エラー: %s', (_n, text) => {
    expect(importTsv(base(), T, text, 'a.tsv').ok).toBe(false);
  });

  it('保存してもIDが壊れない: 取り込み → ID正規化 → 保存が成功する', () => {
    const r = value(importTsv(base(), T, tsv('36\t\tA\tKick\t'), 'a.tsv'));
    expect(normalizeIds(r).ok).toBe(true);
    expect(serializeQbd(r).ok).toBe(true);
  });

  it('fileNameWithoutExtension', () => {
    expect(fileNameWithoutExtension('a.b.tsv')).toBe('a.b');
    expect(fileNameWithoutExtension('dir/x.pitchlist')).toBe('x');
    expect(fileNameWithoutExtension('noext')).toBe('noext');
  });
});
