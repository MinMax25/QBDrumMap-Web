import { listDrumMapOrder, type Articulation, type Kit, type MapData, type Part, type Plugin } from '../../core';
import type { Selection } from './editorStore';

/**
 * 選択の同一性保持（UI Phase 2b）。モデルが変わる（編集・Undo・Redo）たびに、変更前の選択を
 * 「同じ要素」を基準に変更後のモデルへ写し直す単一のルール。画面ごとに補正を散在させない。
 *
 * 同一性のキー（保存QBDの形式・IDは変更しない。キーはその場で導出し、モデルにもストアにも保持しない）:
 * - Plugin   : Plugin.ID
 * - Kit      : Kit.ID（所属は主選択のPlugin内に限る。Kitは別Pluginへ移動できない）
 * - KitPitch : 所属Kit内の Pitch 番号（0〜127）。配列位置・DisplayOrder は同一性に使わない
 * - Part     : Part.ID
 * - Articulation : Articulation.ID（Parts タブでは主選択の Part 内で一意に見つかること。DrumMap Order では全 Part 横断で一意に見つかること）。
 *   DrumMapOrder・配列位置は同一性に使わない
 *
 * 追従の条件: キーが**変更前のモデルでも変更後のモデルでも一意**に見つかる要素だけを追従する。
 * 変更後に見つからない（削除された）、またはキーが重複していて同じ要素と断定できない場合は選択を解除する
 * （別要素への黙った付け替えをしない。安全側）。親（Plugin／Kit）が解除されたら配下の選択も解除する。
 *
 * 前提と限界: 1回の編集は要素の追加または削除を同時に行わない（同じIDの削除と再追加が1操作に含まれない）。
 * Core の現行の編集操作はすべてこれを満たす。この前提を破る操作を追加する場合は、この規則の見直しが必要。
 * ID の欠番再利用（GetNewID）は、削除と追加が別操作であり、削除の時点で選択が解除されるため誤認しない。
 *
 * 親子関係: 主選択の Part が解除されると、その配下の Articulation の選択（Parts タブ）も解除される。DrumMap Order タブの選択は
 * 親（Part）に依存せず、Articulation 自身の存在で決まる（Part を削除すれば配下の Articulation が消え、選択も解除される）。
 */

/** 配列内でキーが一意に見つかるときだけ添字を返す（見つからない・重複は -1） */
function uniqueIndex<T>(items: readonly T[], keyOf: (x: T) => number, key: number): number {
  let found = -1;
  for (let i = 0; i < items.length; i++) {
    if (keyOf(items[i]!) !== key) continue;
    if (found >= 0) return -1;
    found = i;
  }
  return found;
}

/**
 * 旧添字の列を、新しい配列の添字の列へ写す。順序（クリック順。Shiftの基点は末尾）は保持し、重複は除く。
 * 旧・新どちらでもキーが一意でないものは落とす。
 */
function remapList<T>(
  oldItems: readonly T[], newItems: readonly T[], keyOf: (x: T) => number, oldIndices: readonly number[],
): number[] {
  const out: number[] = [];
  for (const oi of oldIndices) {
    const o = oldItems[oi];
    if (o === undefined) continue;
    const key = keyOf(o);
    if (uniqueIndex(oldItems, keyOf, key) !== oi) continue;
    const ni = uniqueIndex(newItems, keyOf, key);
    if (ni >= 0 && !out.includes(ni)) out.push(ni);
  }
  return out;
}

const remapOne = <T>(oldItems: readonly T[], newItems: readonly T[], keyOf: (x: T) => number, oldIndex: number | null): number | null =>
  oldIndex === null ? null : (remapList(oldItems, newItems, keyOf, [oldIndex])[0] ?? null);

const pluginKey = (p: Plugin): number => p.ID;
const kitKey = (k: Kit): number => k.ID;
const pitchKey = (p: { Pitch: number }): number => p.Pitch;
const partKey = (p: Part): number => p.ID;
const articulationKey = (a: Articulation): number => a.ID;

/** DrumMap Order の一覧（表示順の Articulation）。選択の位置はこの一覧内の位置 */
const orderedArticulations = (map: MapData): Articulation[] =>
  listDrumMapOrder(map).map((r) => map.Parts[r.partIndex]!.Articulations[r.articulationIndex]!);

/** 変更前の選択（oldMap の添字）を、変更後のモデル（newMap の添字）へ同じ要素で写し直す */
export function remapSelection(oldMap: MapData, newMap: MapData, s: Selection): Selection {
  if (oldMap === newMap) return s;
  const pluginIndices = remapList(oldMap.Plugins, newMap.Plugins, pluginKey, s.pluginIndices);
  const pluginIndex = remapOne(oldMap.Plugins, newMap.Plugins, pluginKey, s.pluginIndex);

  let kitIndices: number[] = [];
  let kitIndex: number | null = null;
  let pitchIndices: number[] = [];
  const oldPlugin = s.pluginIndex !== null ? oldMap.Plugins[s.pluginIndex] : undefined;
  const newPlugin = pluginIndex !== null ? newMap.Plugins[pluginIndex] : undefined;
  if (oldPlugin && newPlugin) {
    kitIndices = remapList(oldPlugin.Kits, newPlugin.Kits, kitKey, s.kitIndices);
    kitIndex = remapOne(oldPlugin.Kits, newPlugin.Kits, kitKey, s.kitIndex);
    const oldKit = s.kitIndex !== null ? oldPlugin.Kits[s.kitIndex] : undefined;
    const newKit = kitIndex !== null ? newPlugin.Kits[kitIndex] : undefined;
    if (oldKit && newKit) pitchIndices = remapList(oldKit.Pitches, newKit.Pitches, pitchKey, s.pitchIndices);
  }

  const partIndices = remapList(oldMap.Parts, newMap.Parts, partKey, s.partIndices);
  const partIndex = remapOne(oldMap.Parts, newMap.Parts, partKey, s.partIndex);
  let articulationIndices: number[] = [];
  let articulationIndex: number | null = null;
  const oldPart = s.partIndex !== null ? oldMap.Parts[s.partIndex] : undefined;
  const newPart = partIndex !== null ? newMap.Parts[partIndex] : undefined;
  if (oldPart && newPart) {
    articulationIndices = remapList(oldPart.Articulations, newPart.Articulations, articulationKey, s.articulationIndices);
    articulationIndex = remapOne(oldPart.Articulations, newPart.Articulations, articulationKey, s.articulationIndex);
  }
  const orderIndices = s.orderIndices.length === 0
    ? []
    : remapList(orderedArticulations(oldMap), orderedArticulations(newMap), articulationKey, s.orderIndices);
  return {
    pluginIndex, pluginIndices, kitIndex, kitIndices, pitchIndices, partIndex, partIndices, articulationIndex, articulationIndices, orderIndices,
  };
}
