import { cloneMap, type MapData } from './model';
import { fail, ok, type Result } from './result';

const byDisplayOrder = <T extends { DisplayOrder: number }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.DisplayOrder - b.DisplayOrder); // Array.sortは安定ソート（C#のOrderByと同じ）

/**
 * Windows版 MapData.FixID の再現。入力は変更せず、正規化済みの新しいモデルを返す。
 * ID採番と参照追随は一体で行う。
 * - Plugin/Part ID・DisplayOrder: DisplayOrder順に1から。Kit IDはPlugin横断で1から、Kit DisplayOrderはPlugin内で1から。
 * - Articulation: DisplayOrderはPart内で1から。IDは Part順→Part内DisplayOrder順に1から（旧ID→新IDの対応で参照を追随）。
 * - KitPitch.ArticulationID / Articulation.Complement: 非0なら新IDへ。存在しない参照先は0。
 * - DrumMapOrder: 全Articulationを旧DrumMapOrder順（同値は配列順）に1から。
 * - KitPitch.DisplayOrderは再採番しない。
 * - 旧Articulation IDの重複（0の重複を含む）は、Windows版同様にエラーとする（参照先を推測して修復しない）。
 * - 旧ID=0のArticulationは、Windows版同様に新ID採番枠だけを消費しIDは0のまま残る。
 */
export function normalizeIds(input: MapData): Result<MapData> {
  const map = cloneMap(input);

  let kitId = 1;
  byDisplayOrder(map.Plugins).forEach((plugin, pi) => {
    plugin.ID = pi + 1;
    plugin.DisplayOrder = pi + 1;
    byDisplayOrder(plugin.Kits).forEach((kit, ki) => {
      kit.ID = kitId++;
      kit.DisplayOrder = ki + 1;
    });
  });

  const newIds = new Map<number, number>();
  const allArtics = map.Parts.flatMap((p) => p.Articulations);
  let articId = 1;
  const parts = byDisplayOrder(map.Parts);
  for (const [pi, part] of parts.entries()) {
    part.ID = pi + 1;
    part.DisplayOrder = pi + 1;
    for (const [ai, a] of byDisplayOrder(part.Articulations).entries()) {
      a.DisplayOrder = ai + 1;
      if (newIds.has(a.ID)) {
        return fail('duplicate-articulation-id', `Articulation IDが重複しているため保存できません: ID=${a.ID}`);
      }
      newIds.set(a.ID, articId++);
    }
  }
  const remap = (oldId: number): number => newIds.get(oldId) ?? 0;

  [...allArtics]
    .sort((a, b) => a.DrumMapOrder - b.DrumMapOrder)
    .forEach((a, i) => {
      a.DrumMapOrder = i + 1;
    });

  for (const plugin of map.Plugins) {
    for (const kit of plugin.Kits) {
      for (const kp of kit.Pitches) {
        if (kp.ArticulationID !== 0) kp.ArticulationID = remap(kp.ArticulationID);
      }
    }
  }
  for (const a of allArtics) {
    if (a.ID !== 0) a.ID = remap(a.ID);
    if (a.Complement !== 0) a.Complement = remap(a.Complement);
  }
  return ok(map);
}
