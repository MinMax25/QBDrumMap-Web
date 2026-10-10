import { getKitPitchOrder } from './kitPitchOrder';
import type { Articulation, Kit, KitPitch, MapData, Part } from './model';
import { fail, ok, type Result } from './result';

/** Windows版の設定のうち、出力に影響するもの（どちらも既定true） */
export interface ExportSettings {
  /** UseArticulation: Articulation順の並びと、Part属性（色・音符頭など）の出力 */
  useArticulation: boolean;
  /** UseArticulationPitchName: PitchNameをArticulation名で置き換える */
  useArticulationPitchName: boolean;
}

export const defaultExportSettings: ExportSettings = { useArticulation: true, useArticulationPitchName: true };

/** Kitの位置（Plugins[pluginIndex].Kits[kitIndex]）。名前が重複するKitも区別できる */
export interface KitRef {
  pluginIndex: number;
  kitIndex: number;
}

export function kitAt(map: MapData, ref: KitRef): Kit | undefined {
  return map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
}

/** ID一致の最初のArticulation（Windows版 FirstOrDefault。ID=0は ID=0 のArticulationに一致する） */
export const findArticulation = (map: MapData, id: number): Articulation | undefined =>
  map.Parts.flatMap((p) => p.Articulations).find((a) => a.ID === id);

/** そのArticulationIDを持つ最初のPart */
export const findPartOfArticulation = (map: MapData, id: number): Part | undefined =>
  map.Parts.find((p) => p.Articulations.some((a) => a.ID === id));

/** Windows版 UtilMap.GetKitPitches: 出力対象のKitPitchを出力順で返す（区切り行を含む） */
export function getKitPitches(map: MapData, kitName: string, settings: ExportSettings): Result<KitPitch[]> {
  return getKitPitchOrder(map, kitName, { useArticulation: settings.useArticulation });
}

export const failure = <T = never>(code: string, message: string): Result<T> => fail<T>(code, message);
export { ok };
