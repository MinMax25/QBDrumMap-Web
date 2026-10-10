import { kitAt, type KitRef } from './exportCommon';
import type { MapData } from './model';
import type { ArticulationMap } from './resolver';

/**
 * Windows版 ConvertMidiViewModel.GetPitch: 入力Pitchが Base Kit の「直接割当（!IsSub）」にある場合だけ Articulation を判定し、
 * 対象KitのResolverで同じIDのItemの代表Pitchを返す。直接割当でない（補間された）Pitchは変換しない。見つからなければ -1。
 * Unload / Duplicate の Pitch も有効な直接割当として扱う（除外しない）。
 */
export function mapPitch(baseMap: ArticulationMap, dstMap: ArticulationMap, basePitch: number): number {
  const baseItem = baseMap.Items.find((i) => !i.IsSub && i.Pitches.includes(basePitch));
  if (baseItem) {
    const dstItem = dstMap.Items.find((i) => i.ID === baseItem.ID);
    if (dstItem) return dstItem.Pitches[0] ?? -1;
  }
  return -1;
}

/** 選択Kitを Plugin.DisplayOrder → Kit.DisplayOrder の順（同値は渡された順）に並べる */
export function orderedTargets(map: MapData, refs: KitRef[]): string[] {
  return refs
    .flatMap((r, i) => {
      const plugin = map.Plugins[r.pluginIndex];
      const kit = kitAt(map, r);
      return plugin && kit ? [{ name: kit.Name, po: plugin.DisplayOrder, ko: kit.DisplayOrder, i }] : [];
    })
    .sort((a, b) => a.po - b.po || a.ko - b.ko || a.i - b.i)
    .map((x) => x.name);
}
