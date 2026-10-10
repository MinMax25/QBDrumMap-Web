import type { Kit, MapData } from './model';
import { separatorValue } from './separator';
import { noteName } from './noteName';
import { fail, ok, type Result } from './result';

/**
 * Windows版 ArticulationMapItem 相当。
 * - Order は Articulation.DisplayOrder（DrumMapOrderではない）。
 * - IsSub は補間前の確定値（その Kit で Pitch が直接割り当てられていない Articulation）。
 */
export interface ArticulationMapItem {
  ID: number;
  Name: string;
  IsSub: boolean;
  PartID: number;
  Order: number;
  Complement: number;
  Pitches: number[];
}

export interface ArticulationMap {
  Name: string;
  Items: ArticulationMapItem[];
}

/** 代表Pitch（先頭のPitch。無ければ -1） */
export const representativePitch = (item: ArticulationMapItem): number => item.Pitches[0] ?? -1;

/** 代表PitchのNote名（YAMAHA式。Pitchが無い場合は空文字） */
export const representativeNote = (item: ArticulationMapItem): string => noteName(representativePitch(item));

/** Windows版 PitchesText: ", " 区切り */
export const pitchesText = (item: ArticulationMapItem): string => item.Pitches.join(', ');

/** Kit名で検索する。Windows版同様、Plugin→Kitの配列順で最初に一致したもの（全Plugin横断）。 */
export function findKitByName(map: MapData, kitName: string): Kit | undefined {
  return map.Plugins.flatMap((p) => p.Kits).find((k) => k.Name === kitName);
}

/** 安定ソートした新しい配列（C#の OrderBy / OrderByDescending 相当。Array.sortは安定） */
const orderBy = <T>(items: readonly T[], key: (x: T) => number, desc = false): T[] =>
  [...items].sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));

/**
 * Windows版 ArticulationMap.GetArticulationMap の再現。
 *
 * 1. Parts→Articulations の配列順で Item を作る（Order = Articulation.DisplayOrder, PartID = Part.ID）。
 * 2. Kit の KitPitch を Separator 順（None, Separate, Unload, Duplicate。同値は配列順）に走査し、
 *    ArticulationID が一致する最初の Item へ Pitch を追加する（Nameが空の行も含む。ID=0はID=0のItemにも一致する）。
 * 3. IsSub を確定する（この時点でPitchが無い = IsSub）。以降の補間でIsSubは変わらない。
 * 4. PartID ごとに Order(DisplayOrder)昇順で、Pitchの無い Item へ直前の代表Pitchを補間する（前方）。
 * 5. 同様に Order 降順で補間する（後方。前方で埋まらなかった先頭側の Item 用）。
 * 6. なお Pitch の無い Item で Complement != 0 のものは、Item配列順に Complement 先の代表Pitch を補間する。
 *    Complement先が存在しなければエラー（Windows版は InvalidOperationException）。
 *    Complement先は逐次更新後の状態を参照する（配列順が前のItemの補間結果が後続の参照に反映される）。
 */
export function getArticulationMap(map: MapData, kitName: string): Result<ArticulationMap> {
  const kit = findKitByName(map, kitName);
  if (!kit) return fail('kit-not-found', `Kit '${kitName}' not found.`);

  const items: ArticulationMapItem[] = [];
  for (const part of map.Parts) {
    for (const a of part.Articulations) {
      items.push({
        ID: a.ID, Name: a.Name, IsSub: false, PartID: part.ID, Order: a.DisplayOrder,
        Complement: a.Complement, Pitches: [],
      });
    }
  }

  for (const kp of orderBy(kit.Pitches, (x) => separatorValue(x.Separator))) {
    items.find((x) => x.ID === kp.ArticulationID)?.Pitches.push(kp.Pitch);
  }

  for (const item of items) item.IsSub = item.Pitches.length === 0;

  // PartID単位のグループ（Windows版 GroupBy: 初出順、グループ内は元の配列順）
  const groups = new Map<number, ArticulationMapItem[]>();
  for (const item of items) {
    const g = groups.get(item.PartID);
    if (g) g.push(item);
    else groups.set(item.PartID, [item]);
  }
  for (const desc of [false, true]) {
    for (const g of groups.values()) {
      let pitch = -1;
      for (const item of orderBy(g, (x) => x.Order, desc)) {
        if (item.Pitches.length > 0) pitch = item.Pitches[0]!;
        else if (pitch > -1) item.Pitches.push(pitch);
      }
    }
  }

  for (const item of items) {
    if (item.Pitches.length > 0 || item.Complement === 0) continue;
    const target = items.find((x) => x.ID === item.Complement);
    if (!target) {
      return fail(
        'complement-not-found',
        `Complement Articulation ID '${item.Complement}' not found.`,
      );
    }
    if (target.Pitches.length > 0) item.Pitches.push(target.Pitches[0]!);
  }

  return ok({ Name: kitName, Items: items });
}
