import { containsIgnoreCase, trimDotNet } from './dotnetString';
import { findArticulation, type KitRef } from './exportCommon';
import { isNullOrWhiteSpace } from './kitPitchOrder';
import type { EnumValue } from './enums';
import {
  createKit, type Kit, type KitPitch, type MapData, type Plugin, type PluginType, type Separator,
} from './model';
import { fail, ok, type Result } from './result';

/**
 * 編集操作（Windows版の ViewModel／ExModel／各モデルの変更時処理に相当する、参照整合性を含むモデル変更）。
 * すべて純粋関数: 入力モデルを変更せず、変更した経路だけを複製した新しいモデルを返す（変更のない部分は参照を共有する。
 * 履歴のスナップショットが構造共有でき、メモリを節約できる）。失敗時は何も変更しない。
 *
 * 前提（不変条件）: Plugin / Kit / KitPitch / Part / Articulation の各配列は DisplayOrder 昇順に並び、DisplayOrder は 1..n。
 * Load は DisplayOrder = 配列位置+1 で復元するため、読み込み直後はこれが成り立つ。本モジュールの操作は、変更した配列について
 * この不変条件を保つ（削除後も 1..n に振り直す。Windows版は削除で欠番を残し、保存時の FixID で振り直す。保存結果は同じ）。
 * 要素は配列の添字（= 表示順）で指定する。
 *
 * 結果の `changed` が false のときは入力と同じモデルを返す（履歴に積まない）。`indices` は結果で対象になる要素の添字。
 */
export interface EditResult {
  map: MapData;
  changed: boolean;
  indices?: number[];
}

export type MoveDirection = 'top' | 'up' | 'down' | 'bottom';

export const unchanged = (map: MapData): Result<EditResult> => ok({ map, changed: false });
export const outOfRange = (what: string): Result<EditResult> => fail('index-out-of-range', `${what} の指定が範囲外です`);

/** 表示順の振り直し（DisplayOrder = 位置+1）。値が同じ要素は同じ参照を保つ */
export function renumber<T extends { DisplayOrder: number }>(items: T[]): T[] {
  return items.map((x, i) => (x.DisplayOrder === i + 1 ? x : { ...x, DisplayOrder: i + 1 }));
}

/** Windows版 ExModel.GetNewID: min..max の範囲で最初の欠番、無ければ max+1（空なら1） */
export function getNewId(ids: readonly number[]): number {
  if (ids.length === 0) return 1;
  const min = Math.min(...ids);
  const max = Math.max(...ids);
  const have = new Set(ids);
  for (let n = 1; n <= max - min + 1; n++) if (!have.has(n)) return n;
  return max + 1;
}

export function normalizeSelection(len: number, selected: readonly number[]): number[] | null {
  const uniq = [...new Set(selected)].sort((a, b) => a - b);
  if (uniq.some((i) => !Number.isInteger(i) || i < 0 || i >= len)) return null;
  return uniq;
}

/**
 * 並べ替え後の並び（元の添字の列）と、選択要素の新しい添字を返す。変化しなければ null。
 * Windows版 ExModel.MoveTop/Up/Down/Bottom: 選択を表示順に並べて扱い、Up は先頭の選択の1つ前、Down は末尾の選択の1つ後ろへ
 * ブロックとして寄せる（離れた選択は1つのブロックにまとまる）。Windows版は選択コレクションの並び順に依存して要素が重複し得る
 * （Down）が、Web版は選択を表示順に整列して適用する（意図的な差異）。
 */
export function reorderIndices(
  len: number, selected: readonly number[], dir: MoveDirection,
): { order: number[]; moved: number[] } | null {
  const sel = normalizeSelection(len, selected);
  if (!sel || sel.length === 0) return null;
  const rest = Array.from({ length: len }, (_, i) => i).filter((i) => !sel.includes(i));
  let order: number[];
  if (dir === 'top') order = [...sel, ...rest];
  else if (dir === 'bottom') order = [...rest, ...sel];
  else if (dir === 'up') {
    const p = sel[0]! - 1;
    if (p < 0) return null;
    order = [...rest.filter((i) => i < p), ...sel, ...rest.filter((i) => i >= p)];
  } else {
    const p = sel[sel.length - 1]! + 1;
    if (p > len - 1) return null;
    order = [...rest.filter((i) => i <= p), ...sel, ...rest.filter((i) => i > p)];
  }
  if (order.every((v, i) => v === i)) return null;
  return { order, moved: sel.map((s) => order.indexOf(s)) };
}

/** D&D 用: 選択ブロックを、元の添字 `to`（0..len）の要素の直前へ移す（to=len は末尾） */
export function reorderTo(
  len: number, selected: readonly number[], to: number,
): { order: number[]; moved: number[] } | null {
  const sel = normalizeSelection(len, selected);
  if (!sel || sel.length === 0 || !Number.isInteger(to) || to < 0 || to > len) return null;
  const rest = Array.from({ length: len }, (_, i) => i).filter((i) => !sel.includes(i));
  const order = [...rest.filter((i) => i < to), ...sel, ...rest.filter((i) => i >= to)];
  if (order.every((v, i) => v === i)) return null;
  return { order, moved: sel.map((s) => order.indexOf(s)) };
}

type Place = { order: number[]; moved: number[] } | null;
const place = (items: readonly { DisplayOrder: number }[], op: Place): boolean => op !== null && items.length > 0;

export function applyOrder<T extends { DisplayOrder: number }>(items: T[], op: { order: number[] }): T[] {
  return renumber(op.order.map((i) => items[i]!));
}

// ---------- Plugin ----------

const withPlugins = (map: MapData, plugins: Plugin[]): MapData => ({ ...map, Plugins: plugins });
const withPlugin = (map: MapData, pi: number, plugin: Plugin): MapData =>
  withPlugins(map, map.Plugins.map((p, i) => (i === pi ? plugin : p)));

/** Windows版 PluginViewModel.OnAdd: ID は欠番の最小値（無ければ max+1）、名前は Plugin{ID}、末尾に追加 */
export function addPlugin(map: MapData): Result<EditResult> {
  const id = getNewId(map.Plugins.map((p) => p.ID));
  const plugin: Plugin = {
    ID: id, Name: `Plugin${id}`, PluginType: 'None', MidiOutDevice: '', SoundCheckChannel: 'Channel10',
    Kits: [], DisplayOrder: map.Plugins.length + 1, Extra: {},
  };
  return ok({ map: withPlugins(map, [...map.Plugins, plugin]), changed: true, indices: [map.Plugins.length] });
}

export function deletePlugins(map: MapData, indices: readonly number[]): Result<EditResult> {
  const sel = normalizeSelection(map.Plugins.length, indices);
  if (!sel) return outOfRange('Plugin');
  if (sel.length === 0) return unchanged(map);
  return ok({ map: withPlugins(map, renumber(map.Plugins.filter((_, i) => !sel.includes(i)))), changed: true, indices: [] });
}

export function movePlugins(map: MapData, indices: readonly number[], dir: MoveDirection): Result<EditResult> {
  if (!normalizeSelection(map.Plugins.length, indices)) return outOfRange('Plugin');
  const op = reorderIndices(map.Plugins.length, indices, dir);
  if (!place(map.Plugins, op)) return unchanged(map);
  return ok({ map: withPlugins(map, applyOrder(map.Plugins, op!)), changed: true, indices: op!.moved });
}

export function movePluginsTo(map: MapData, indices: readonly number[], to: number): Result<EditResult> {
  if (!normalizeSelection(map.Plugins.length, indices)) return outOfRange('Plugin');
  const op = reorderTo(map.Plugins.length, indices, to);
  if (!place(map.Plugins, op)) return unchanged(map);
  return ok({ map: withPlugins(map, applyOrder(map.Plugins, op!)), changed: true, indices: op!.moved });
}

export interface PluginPatch {
  Name?: string;
  PluginType?: EnumValue<PluginType>;
}

export function updatePlugin(map: MapData, pluginIndex: number, patch: PluginPatch): Result<EditResult> {
  const plugin = map.Plugins[pluginIndex];
  if (!plugin) return outOfRange('Plugin');
  const next: Plugin = { ...plugin };
  if (patch.Name !== undefined) next.Name = trimDotNet(patch.Name); // 編集確定時のみ前後の空白を除く（読込時は変更しない）
  if (patch.PluginType !== undefined) next.PluginType = patch.PluginType;
  if (next.Name === plugin.Name && next.PluginType === plugin.PluginType) return unchanged(map);
  return ok({ map: withPlugin(map, pluginIndex, next), changed: true, indices: [pluginIndex] });
}

// ---------- Kit ----------

const withKits = (map: MapData, pi: number, kits: Kit[]): MapData => withPlugin(map, pi, { ...map.Plugins[pi]!, Kits: kits });
const withKit = (map: MapData, ref: KitRef, kit: Kit): MapData =>
  withKits(map, ref.pluginIndex, map.Plugins[ref.pluginIndex]!.Kits.map((k, i) => (i === ref.kitIndex ? kit : k)));

/** Windows版 KitPanelViewModel.OnAdd: ID は全Plugin横断の欠番の最小値、名前は「{Plugin名} Kit{件数+1}」、Pitch 0–127 の128行 */
export function addKit(map: MapData, pluginIndex: number): Result<EditResult> {
  const plugin = map.Plugins[pluginIndex];
  if (!plugin) return outOfRange('Plugin');
  const id = getNewId(map.Plugins.flatMap((p) => p.Kits.map((k) => k.ID)));
  const kit = createKit(id, `${plugin.Name} Kit${plugin.Kits.length + 1}`, plugin.Kits.length + 1);
  return ok({ map: withKits(map, pluginIndex, [...plugin.Kits, kit]), changed: true, indices: [plugin.Kits.length] });
}

export function deleteKits(map: MapData, pluginIndex: number, indices: readonly number[]): Result<EditResult> {
  const plugin = map.Plugins[pluginIndex];
  if (!plugin) return outOfRange('Plugin');
  const sel = normalizeSelection(plugin.Kits.length, indices);
  if (!sel) return outOfRange('Kit');
  if (sel.length === 0) return unchanged(map);
  return ok({ map: withKits(map, pluginIndex, renumber(plugin.Kits.filter((_, i) => !sel.includes(i)))), changed: true, indices: [] });
}

export function moveKits(map: MapData, pluginIndex: number, indices: readonly number[], dir: MoveDirection): Result<EditResult> {
  const plugin = map.Plugins[pluginIndex];
  if (!plugin) return outOfRange('Plugin');
  if (!normalizeSelection(plugin.Kits.length, indices)) return outOfRange('Kit');
  const op = reorderIndices(plugin.Kits.length, indices, dir);
  if (!place(plugin.Kits, op)) return unchanged(map);
  return ok({ map: withKits(map, pluginIndex, applyOrder(plugin.Kits, op!)), changed: true, indices: op!.moved });
}

export function moveKitsTo(map: MapData, pluginIndex: number, indices: readonly number[], to: number): Result<EditResult> {
  const plugin = map.Plugins[pluginIndex];
  if (!plugin) return outOfRange('Plugin');
  if (!normalizeSelection(plugin.Kits.length, indices)) return outOfRange('Kit');
  const op = reorderTo(plugin.Kits.length, indices, to);
  if (!place(plugin.Kits, op)) return unchanged(map);
  return ok({ map: withKits(map, pluginIndex, applyOrder(plugin.Kits, op!)), changed: true, indices: op!.moved });
}

export interface KitPatch {
  Name?: string;
}

export function updateKit(map: MapData, ref: KitRef, patch: KitPatch): Result<EditResult> {
  const kit = map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
  if (!kit) return outOfRange('Kit');
  const name = patch.Name === undefined ? undefined : trimDotNet(patch.Name); // 編集確定時のみ前後の空白を除く
  if (name === undefined || name === kit.Name) return unchanged(map);
  return ok({ map: withKit(map, ref, { ...kit, Name: name }), changed: true, indices: [ref.kitIndex] });
}

// ---------- KitPitch ----------

const withPitches = (map: MapData, ref: KitRef, pitches: KitPitch[]): MapData =>
  withKit(map, ref, { ...map.Plugins[ref.pluginIndex]!.Kits[ref.kitIndex]!, Pitches: pitches });

/** 指定 Kit の Pitches を差し替えたモデルを返す（他の経路は参照を共有する）。編集補助（editAssist.ts）が使う */
export const applyKitPitches = withPitches;

export interface KitPitchPatch {
  Name?: string | null;
  ArticulationID?: number;
  Separator?: EnumValue<Separator>;
}

/**
 * 1行の編集。Windows版 KitPitch.OnNameChanged: Name が空白になると ArticulationID=0・Separator=None に連動してクリアする（1操作）。
 * 空白Nameの行への ArticulationID / Separator の設定は拒否する（Windows版UIは無効化。仕様 §6.1）。
 * 存在しない Articulation ID の設定は拒否する（不正参照を作らない。0 は未割当）。
 */
export function updateKitPitch(map: MapData, ref: KitRef, pitchIndex: number, patch: KitPitchPatch): Result<EditResult> {
  const kit = map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
  const row = kit?.Pitches[pitchIndex];
  if (!kit || !row) return outOfRange('KitPitch');
  const next: KitPitch = { ...row };
  if (patch.Name !== undefined) {
    next.Name = patch.Name === null ? null : trimDotNet(patch.Name); // 編集確定時のみ前後の空白を除く
    if (isNullOrWhiteSpace(next.Name)) {
      next.ArticulationID = 0;
      next.Separator = 'None';
    }
  }
  if (patch.ArticulationID !== undefined || patch.Separator !== undefined) {
    if (isNullOrWhiteSpace(next.Name)) return fail('empty-name-row', 'Name が空の行には Articulation / Separator を設定できません');
    if (patch.ArticulationID !== undefined) {
      if (patch.ArticulationID !== 0 && !findArticulation(map, patch.ArticulationID)) {
        return fail('articulation-not-found', `Articulation ID ${patch.ArticulationID} が存在しません`);
      }
      next.ArticulationID = patch.ArticulationID;
    }
    if (patch.Separator !== undefined) next.Separator = patch.Separator;
  }
  if (next.Name === row.Name && next.ArticulationID === row.ArticulationID && next.Separator === row.Separator) return unchanged(map);
  return ok({
    map: withPitches(map, ref, kit.Pitches.map((p, i) => (i === pitchIndex ? next : p))), changed: true, indices: [pitchIndex],
  });
}

/** Windows版 OnClearSelectedPitches: 選択行の Name を消し（連動で ArticulationID=0・Separator=None）、行自体は残す */
export function clearKitPitches(map: MapData, ref: KitRef, indices: readonly number[]): Result<EditResult> {
  const kit = map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
  if (!kit) return outOfRange('Kit');
  const sel = normalizeSelection(kit.Pitches.length, indices);
  if (!sel) return outOfRange('KitPitch');
  let changed = false;
  const pitches = kit.Pitches.map((p, i) => {
    if (!sel.includes(i)) return p;
    if (p.Name === null && p.ArticulationID === 0 && p.Separator === 'None') return p;
    changed = true;
    return { ...p, Name: null, ArticulationID: 0, Separator: 'None' as const };
  });
  return changed ? ok({ map: withPitches(map, ref, pitches), changed: true, indices: [...sel] }) : unchanged(map);
}

export function moveKitPitches(map: MapData, ref: KitRef, indices: readonly number[], dir: MoveDirection): Result<EditResult> {
  const kit = map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
  if (!kit) return outOfRange('Kit');
  if (!normalizeSelection(kit.Pitches.length, indices)) return outOfRange('KitPitch');
  const op = reorderIndices(kit.Pitches.length, indices, dir);
  if (!place(kit.Pitches, op)) return unchanged(map);
  return ok({ map: withPitches(map, ref, applyOrder(kit.Pitches, op!)), changed: true, indices: op!.moved });
}

export function moveKitPitchesTo(map: MapData, ref: KitRef, indices: readonly number[], to: number): Result<EditResult> {
  const kit = map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
  if (!kit) return outOfRange('Kit');
  if (!normalizeSelection(kit.Pitches.length, indices)) return outOfRange('KitPitch');
  const op = reorderTo(kit.Pitches.length, indices, to);
  if (!place(kit.Pitches, op)) return unchanged(map);
  return ok({ map: withPitches(map, ref, applyOrder(kit.Pitches, op!)), changed: true, indices: op!.moved });
}

// ---------- Pitch 表のフィルタ ----------

export interface KitPitchFilter {
  name?: string;
  articulation?: string;
}

/**
 * Web版のフィルタ: Name と Articulation 名の**部分一致**の AND（大文字小文字を区別しない）。空の条件は無視する。
 * Windows版は全体一致＋`*` ワイルドカード（StringExtensions.Like）で、意図的に異なる。
 * 戻り値は条件に合う行の添字（表示順＝配列順）。
 */
export function filterKitPitchIndices(map: MapData, kit: Kit, filter: KitPitchFilter): number[] {
  const name = filter.name ?? '';
  const artic = filter.articulation ?? '';
  const result: number[] = [];
  kit.Pitches.forEach((p, i) => {
    if (name !== '' && !containsIgnoreCase(p.Name ?? '', name)) return;
    if (artic !== '') {
      const a = findArticulation(map, p.ArticulationID);
      if (!a || !containsIgnoreCase(a.Name, artic)) return;
    }
    result.push(i);
  });
  return result;
}

/**
 * Windows版 OnSearchArticulation の「同名の行すべてに設定」: 指定行と Name が完全に等しい全行へ ArticulationID を設定する
 * （1操作）。Name が空白の行は対象外（拒否）。確認ダイアログはUIの責務。
 */
export function setArticulationForSameName(map: MapData, ref: KitRef, pitchIndex: number, articulationId: number): Result<EditResult> {
  const kit = map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
  const row = kit?.Pitches[pitchIndex];
  if (!kit || !row) return outOfRange('KitPitch');
  if (isNullOrWhiteSpace(row.Name)) return fail('empty-name-row', 'Name が空の行には Articulation を設定できません');
  if (articulationId !== 0 && !findArticulation(map, articulationId)) {
    return fail('articulation-not-found', `Articulation ID ${articulationId} が存在しません`);
  }
  const targets: number[] = [];
  const pitches = kit.Pitches.map((p, i) => {
    if (p.Name !== row.Name) return p;
    targets.push(i);
    return p.ArticulationID === articulationId ? p : { ...p, ArticulationID: articulationId };
  });
  const changed = pitches.some((p, i) => p !== kit.Pitches[i]);
  return changed ? ok({ map: withPitches(map, ref, pitches), changed: true, indices: targets }) : unchanged(map);
}
