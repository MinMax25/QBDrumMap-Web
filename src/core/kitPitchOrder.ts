import type { Articulation, Kit, KitPitch, MapData } from './model';
import { separatorValue } from './separator';
import { findKitByName } from './resolver';
import { fail, ok, type Result } from './result';

/** 区切り行の名前（Windows版 GetKitPitchesHasArticulation が挿入するダミー行） */
export const DIVIDER_NAME = '==========';

export interface KitPitchOrderOptions {
  /** Windows版の設定 UseArticulation（既定true）。falseなら Articulation を使わない並びになる */
  useArticulation: boolean;
}

/** .NET の string.IsNullOrWhiteSpace 相当（JSのtrimとは空白の定義が異なる: U+FEFFは空白ではない） */
export const isNullOrWhiteSpace = (s: string | null): boolean =>
  s === null || /^[\p{Zs}\p{Zl}\p{Zp}\t-\r\u0085]*$/u.test(s);

const sepIndex = (p: KitPitch): number => separatorValue(p.Separator);

/** 複数キーの辞書式比較（C#の OrderBy().ThenBy() 相当）。Array.sortは安定。 */
const sortBy = <T>(items: readonly T[], ...keys: ((x: T) => number)[]): T[] =>
  [...items].sort((a, b) => {
    for (const k of keys) {
      const d = k(a) - k(b);
      if (d !== 0) return d;
    }
    return 0;
  });

interface Row {
  p: KitPitch;
  a: Articulation;
}

const noArticulation: Articulation = {
  ID: 0, Name: '', Complement: 0, DrumMapOrder: 0, DisplayOrder: 0, Extra: {},
};

function hasArticulationOrder(map: MapData, kit: Kit): KitPitch[] {
  const allArtics = map.Parts.flatMap((p) => p.Articulations);
  // Pitch>=0 かつ Name が空白でない行だけが対象。Articulationが見つからなければ既定値(DrumMapOrder=0)
  const all: Row[] = kit.Pitches
    .filter((x) => x.Pitch >= 0 && !isNullOrWhiteSpace(x.Name))
    .map((p) => ({ p, a: allArtics.find((a) => a.ID === p.ArticulationID) ?? noArticulation }));

  const hasNoSep = sortBy(
    all.filter((x) => x.p.ArticulationID !== 0 && separatorValue(x.p.Separator) === 0),
    (x) => x.a.DrumMapOrder,
  );
  const noArticNoSep = sortBy(
    all.filter((x) => x.p.ArticulationID === 0 && separatorValue(x.p.Separator) === 0),
    (x) => x.p.DisplayOrder, (x) => x.p.Pitch,
  );
  const hasAndSep = sortBy(
    all.filter((x) => x.p.ArticulationID !== 0 && separatorValue(x.p.Separator) !== 0),
    (x) => sepIndex(x.p), (x) => x.a.DrumMapOrder,
  );
  const noArticAndSep = sortBy(
    all.filter((x) => x.p.ArticulationID === 0 && separatorValue(x.p.Separator) !== 0),
    (x) => sepIndex(x.p), (x) => x.p.DisplayOrder, (x) => x.p.Pitch,
  );

  const result: KitPitch[] = [];

  // 割当なし・区切りなしの行は、区切りあり&割当なしの行が「ある」場合は先頭ブロック、ない場合は区切り行の後ろに置く
  if (noArticAndSep.length > 0) {
    result.push(...hasNoSep.map((x) => x.p), ...noArticNoSep.map((x) => x.p));
  } else {
    result.push(...hasNoSep.map((x) => x.p));
  }

  if (
    (hasNoSep.length > 0 || noArticAndSep.length > 0) &&
    (hasAndSep.length > 0 || noArticNoSep.length > 0)
  ) {
    const used = new Set(all.map((x) => x.p.Pitch));
    let blank = -1;
    for (let i = 0; i < 128; i++) {
      if (!used.has(i)) {
        blank = i;
        break;
      }
    }
    if (blank >= 0) {
      result.push({
        Pitch: blank, Name: DIVIDER_NAME, ArticulationID: 0, Separator: 'None', DisplayOrder: 0, Extra: {},
      });
    }
  }

  if (noArticAndSep.length === 0) result.push(...noArticNoSep.map((x) => x.p));
  result.push(...hasAndSep.map((x) => x.p), ...noArticAndSep.map((x) => x.p));
  return result;
}

function noArticulationOrder(kit: Kit): KitPitch[] {
  return sortBy(
    kit.Pitches.filter((p) => !isNullOrWhiteSpace(p.Name)),
    (p) => p.DisplayOrder,
  );
}

/**
 * Windows版 UtilMap.GetKitPitches（DAW表示順）の再現。返す行は元のKitPitchオブジェクト（区切り行のみ新規）。
 * - Kit内にArticulationID!=0の行があり、かつ useArticulation の場合のみ「Articulation順」。
 *   そうでなければ Name が空白でない行を DisplayOrder 順に並べるだけ。
 * - Articulation順の並び: [割当あり・区切りなし(DrumMapOrder順)] →（区切りあり&割当なしの行が存在する場合のみ
 *   [割当なし・区切りなし] をここに置く）→ 区切り行（条件あり）→（上記の場合以外は [割当なし・区切りなし]）→
 *   [割当あり・区切りあり(Separator→DrumMapOrder順)] → [割当なし・区切りあり(Separator→DisplayOrder→Pitch順)]。
 * - DrumMapOrder（全Articulation通しの並び）とDisplayOrder（KitPitch行の表示順）は別物。割当ありの行はDrumMapOrder、
 *   割当なしの行はKitPitch.DisplayOrder で整列する。
 */
export function getKitPitchOrder(
  map: MapData, kitName: string, options: KitPitchOrderOptions,
): Result<KitPitch[]> {
  const kit = findKitByName(map, kitName);
  if (!kit) return fail('kit-not-found', `Kit '${kitName}' not found.`);
  if (kit.Pitches.some((x) => x.ArticulationID !== 0) && options.useArticulation) {
    return ok(hasArticulationOrder(map, kit));
  }
  return ok(noArticulationOrder(kit));
}
