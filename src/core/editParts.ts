import { trimDotNet } from './dotnetString';
import type { EnumValue } from './enums';
import {
  applyOrder, getNewId, normalizeSelection, outOfRange, renumber, reorderIndices, reorderTo, unchanged,
  type EditResult, type MoveDirection,
} from './edit';
import type { Articulation, MapData, NoteHead, Part, Technique, Voice } from './model';
import { fail, ok, type Result } from './result';

/**
 * Part / Articulation の編集操作（Windows版 PartsViewModel / PartPanelViewModel / ArticulationsViewModel に相当）。
 * edit.ts と同じく純粋関数: 入力を変更せず、変更した経路だけを複製した新しいモデルを返し（変更のない部分は参照を共有）、
 * 失敗時は何も変更しない。要素は配列の添字（= 表示順）で指定し、`changed:false` のときは入力と同じモデルを返す。
 *
 * 参照整合性（UI Phase 3 で承認された Web版の改善。Windows版との差異は仕様書 v0.11.0 §19）:
 * - Part の削除・Articulation の削除は、削除する Articulation を参照する全 KitPitch の ArticulationID を 0 にし、
 *   他の Articulation の Complement が削除対象を指していれば 0 にする。**同じ1操作**で行い、Undo 1回で完全に戻る。
 *   KitPitch の Separator・Name 等は変更しない。
 * - 削除対象の ID を、削除されずに残る別の Articulation も持つ（ID 重複の異常データ）場合は、その ID を参照する
 *   KitPitch・Complement には作用しない（どちらを指していたか断定できないため。安全側）。ID 0 は「未割当」なので対象外。
 */

export interface PartPatch {
  Name?: string;
  ScorePitch?: number;
  /** Windows版は `AABBGGRR` の16進文字列。null は未設定 */
  Color?: string | null;
  NoteHead?: EnumValue<NoteHead>;
  Technique?: EnumValue<Technique>;
  InstrumentEntityID?: string;
  NoteHeadSet?: number;
  Voice?: EnumValue<Voice>;
  TechniqueEntityID?: string;
}

export interface ArticulationPatch {
  Name?: string;
  /** 0 = 解除。0 以外は、存在する（一意な）Articulation の ID */
  Complement?: number;
}

/** DrumMap Order の一覧の要素（Part と Articulation の位置） */
export interface ArticulationRef {
  partIndex: number;
  articulationIndex: number;
}

const isInt32 = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

// ---------- 参照の解除（Part／Articulation 削除の共通処理） ----------

/** 削除後のモデルから、`ids` を参照する KitPitch.ArticulationID と Articulation.Complement を 0 にする（変更した経路だけ複製） */
function clearArticulationReferences(map: MapData, ids: ReadonlySet<number>): MapData {
  if (ids.size === 0) return map;
  let plugins = map.Plugins;
  const pluginList = map.Plugins.map((pl) => {
    let kitsChanged = false;
    const kits = pl.Kits.map((k) => {
      let changed = false;
      const pitches = k.Pitches.map((p) => {
        if (p.ArticulationID === 0 || !ids.has(p.ArticulationID)) return p;
        changed = true;
        return { ...p, ArticulationID: 0 };
      });
      if (!changed) return k;
      kitsChanged = true;
      return { ...k, Pitches: pitches };
    });
    return kitsChanged ? { ...pl, Kits: kits } : pl;
  });
  if (pluginList.some((pl, i) => pl !== map.Plugins[i])) plugins = pluginList;

  const parts = map.Parts.map((part) => {
    let changed = false;
    const articulations = part.Articulations.map((a) => {
      if (a.Complement === 0 || !ids.has(a.Complement)) return a;
      changed = true;
      return { ...a, Complement: 0 };
    });
    return changed ? { ...part, Articulations: articulations } : part;
  });
  const partsChanged = parts.some((p, i) => p !== map.Parts[i]);
  return plugins === map.Plugins && !partsChanged ? map : { ...map, Plugins: plugins, Parts: partsChanged ? parts : map.Parts };
}

/** 削除対象の Articulation から「参照を解除してよい ID」を求める（ID 0 と、残る要素と重複する ID は除く） */
function releasableIds(removed: readonly Articulation[], survivors: readonly Articulation[]): Set<number> {
  const keep = new Set(survivors.map((a) => a.ID));
  const ids = new Set<number>();
  for (const a of removed) if (a.ID !== 0 && !keep.has(a.ID)) ids.add(a.ID);
  return ids;
}

const allArticulations = (map: MapData): Articulation[] => map.Parts.flatMap((p) => p.Articulations);

// ---------- Part ----------

const withParts = (map: MapData, parts: Part[]): MapData => ({ ...map, Parts: parts });
const withPart = (map: MapData, pi: number, part: Part): MapData => withParts(map, map.Parts.map((p, i) => (i === pi ? part : p)));

/**
 * Windows版 PartsViewModel.OnAdd: ID は全 Part の欠番の最小値（無ければ max+1）、名前は `Part{ID}`、末尾に追加。
 * 属性は Windows版の `new Part()` の既定値（ScorePitch 0、Color なし、NoteHead／Technique は先頭値、Voice は Up1、NoteHeadSet 0、
 * Entity ID は空）。Articulation は空。
 */
export function addPart(map: MapData): Result<EditResult> {
  const id = getNewId(map.Parts.map((p) => p.ID));
  const part: Part = {
    ID: id, Name: `Part${id}`, ScorePitch: 0, Color: null, NoteHead: 'None', Technique: 'None', InstrumentEntityID: '',
    NoteHeadSet: 0, Voice: 'Up1', TechniqueEntityID: '', Articulations: [], DisplayOrder: map.Parts.length + 1, Extra: {},
  };
  return ok({ map: withParts(map, [...map.Parts, part]), changed: true, indices: [map.Parts.length] });
}

/** Part の削除。配下の Articulation を参照する KitPitch.ArticulationID と他の Complement を 0 にする（同じ1操作） */
export function deleteParts(map: MapData, indices: readonly number[]): Result<EditResult> {
  const sel = normalizeSelection(map.Parts.length, indices);
  if (!sel) return outOfRange('Part');
  if (sel.length === 0) return unchanged(map);
  const removed = sel.flatMap((i) => map.Parts[i]!.Articulations);
  const remaining = renumber(map.Parts.filter((_, i) => !sel.includes(i)));
  const survivors = remaining.flatMap((p) => p.Articulations);
  const next = clearArticulationReferences(withParts(map, remaining), releasableIds(removed, survivors));
  return ok({ map: next, changed: true, indices: [] });
}

export function moveParts(map: MapData, indices: readonly number[], dir: MoveDirection): Result<EditResult> {
  if (!normalizeSelection(map.Parts.length, indices)) return outOfRange('Part');
  const op = reorderIndices(map.Parts.length, indices, dir);
  if (!op) return unchanged(map);
  return ok({ map: withParts(map, applyOrder(map.Parts, op)), changed: true, indices: op.moved });
}

export function movePartsTo(map: MapData, indices: readonly number[], to: number): Result<EditResult> {
  if (!normalizeSelection(map.Parts.length, indices)) return outOfRange('Part');
  const op = reorderTo(map.Parts.length, indices, to);
  if (!op) return unchanged(map);
  return ok({ map: withParts(map, applyOrder(map.Parts, op)), changed: true, indices: op.moved });
}

const PART_KEYS = [
  'Name', 'ScorePitch', 'Color', 'NoteHead', 'Technique', 'InstrumentEntityID', 'NoteHeadSet', 'Voice', 'TechniqueEntityID',
] as const;

/**
 * Part の属性の編集。ScorePitch・NoteHeadSet は int32 の整数のみ（それ以外は拒否）。Name の長さ・重複は編集を拒否せず、
 * 検証（validateNames）で表示する（Plugin／Kit と同じ）。Part の ID・Articulation・Extra は変更しない。
 */
export function updatePart(map: MapData, partIndex: number, patch: PartPatch): Result<EditResult> {
  const part = map.Parts[partIndex];
  if (!part) return outOfRange('Part');
  if (patch.ScorePitch !== undefined && !isInt32(patch.ScorePitch)) return fail('invalid-value', 'ScorePitch は整数で指定してください');
  if (patch.NoteHeadSet !== undefined && !isInt32(patch.NoteHeadSet)) return fail('invalid-value', 'NoteHeadSet は整数で指定してください');
  const next: Part = { ...part };
  let changed = false;
  for (const key of PART_KEYS) {
    const raw = patch[key];
    // Name は編集確定時のみ前後の空白を除く（読込時は変更しない）
    const v = key === 'Name' && typeof raw === 'string' ? trimDotNet(raw) : raw;
    if (v === undefined || v === part[key]) continue;
    (next as unknown as Record<string, unknown>)[key] = v;
    changed = true;
  }
  return changed ? ok({ map: withPart(map, partIndex, next), changed: true, indices: [partIndex] }) : unchanged(map);
}

// ---------- Articulation ----------

const withArticulations = (map: MapData, pi: number, articulations: Articulation[]): MapData =>
  withPart(map, pi, { ...map.Parts[pi]!, Articulations: articulations });

/**
 * Windows版 PartPanelViewModel.OnAdd: ID は全 Articulation の欠番の最小値、名前は `{Part名} {件数+1}`、Part 内の末尾に追加。
 * DrumMapOrder は、Windows版が「全 Articulation の DisplayOrder の最大+1」（Part 内の表示順を使っており、他の Part の
 * DrumMapOrder と重複し得る）であるのに対し、Web版は**全 Articulation の DrumMapOrder の最大+1**（常に一意な末尾。意図的な差異）。
 */
export function addArticulation(map: MapData, partIndex: number): Result<EditResult> {
  const part = map.Parts[partIndex];
  if (!part) return outOfRange('Part');
  const all = allArticulations(map);
  const articulation: Articulation = {
    ID: getNewId(all.map((a) => a.ID)),
    Name: `${part.Name} ${part.Articulations.length + 1}`,
    Complement: 0,
    DrumMapOrder: all.length === 0 ? 1 : Math.max(...all.map((a) => a.DrumMapOrder)) + 1,
    DisplayOrder: part.Articulations.length + 1,
    Extra: {},
  };
  return ok({
    map: withArticulations(map, partIndex, [...part.Articulations, articulation]), changed: true, indices: [part.Articulations.length],
  });
}

/**
 * Articulation の削除（Part 内の添字）。Windows版と同じく参照する KitPitch の ArticulationID を 0 にし、さらに Web版は
 * 他の Articulation の Complement も 0 にする（同じ1操作）。残りの Articulation の DisplayOrder は 1..n に振り直す。
 * DrumMapOrder は変更しない（欠番は許容。保存時の ID 正規化で振り直される）。
 */
export function deleteArticulations(map: MapData, partIndex: number, indices: readonly number[]): Result<EditResult> {
  const part = map.Parts[partIndex];
  if (!part) return outOfRange('Part');
  const sel = normalizeSelection(part.Articulations.length, indices);
  if (!sel) return outOfRange('Articulation');
  if (sel.length === 0) return unchanged(map);
  const removed = sel.map((i) => part.Articulations[i]!);
  const remaining = renumber(part.Articulations.filter((_, i) => !sel.includes(i)));
  const base = withArticulations(map, partIndex, remaining);
  const next = clearArticulationReferences(base, releasableIds(removed, allArticulations(base)));
  return ok({ map: next, changed: true, indices: [] });
}

export function moveArticulations(map: MapData, partIndex: number, indices: readonly number[], dir: MoveDirection): Result<EditResult> {
  const part = map.Parts[partIndex];
  if (!part) return outOfRange('Part');
  if (!normalizeSelection(part.Articulations.length, indices)) return outOfRange('Articulation');
  const op = reorderIndices(part.Articulations.length, indices, dir);
  if (!op) return unchanged(map);
  return ok({ map: withArticulations(map, partIndex, applyOrder(part.Articulations, op)), changed: true, indices: op.moved });
}

export function moveArticulationsTo(map: MapData, partIndex: number, indices: readonly number[], to: number): Result<EditResult> {
  const part = map.Parts[partIndex];
  if (!part) return outOfRange('Part');
  if (!normalizeSelection(part.Articulations.length, indices)) return outOfRange('Articulation');
  const op = reorderTo(part.Articulations.length, indices, to);
  if (!op) return unchanged(map);
  return ok({ map: withArticulations(map, partIndex, applyOrder(part.Articulations, op)), changed: true, indices: op.moved });
}

/**
 * Articulation の編集（Name・Complement）。Complement は 0（解除）か、存在する Articulation の ID（Windows版の選択ダイアログと
 * 同じく全 Part の全 Articulation から選べ、自分自身も選べる）。存在しない ID、および ID が複数の Articulation に重複していて
 * 参照先を断定できない場合は拒否する。DrumMapOrder・ID は変更しない。
 */
export function updateArticulation(
  map: MapData, partIndex: number, articulationIndex: number, patch: ArticulationPatch,
): Result<EditResult> {
  const articulation = map.Parts[partIndex]?.Articulations[articulationIndex];
  if (!articulation) return outOfRange('Articulation');
  if (patch.Complement !== undefined && patch.Complement !== 0) {
    if (!isInt32(patch.Complement)) return fail('invalid-value', 'Complement は整数で指定してください');
    const hits = allArticulations(map).filter((a) => a.ID === patch.Complement).length;
    if (hits === 0) return fail('articulation-not-found', `Articulation ID ${patch.Complement} が存在しません`);
    if (hits > 1) return fail('ambiguous-articulation-id', `Articulation ID ${patch.Complement} が複数あるため、参照先を特定できません`);
  }
  const next: Articulation = { ...articulation };
  if (patch.Name !== undefined) next.Name = trimDotNet(patch.Name); // 編集確定時のみ前後の空白を除く
  if (patch.Complement !== undefined) next.Complement = patch.Complement;
  if (next.Name === articulation.Name && next.Complement === articulation.Complement) return unchanged(map);
  return ok({
    map: withArticulations(map, partIndex, map.Parts[partIndex]!.Articulations.map((a, i) => (i === articulationIndex ? next : a))),
    changed: true, indices: [articulationIndex],
  });
}

// ---------- DrumMap Order（全 Part 横断の DrumMapOrder） ----------

/**
 * 全 Part の全 Articulation を DrumMapOrder 昇順に並べた一覧（Windows版 ArticulationsViewModel と同じ）。
 * DrumMapOrder が同値（異常データ）の要素は、Part 順 → Part 内の順（配列順）で安定に並べる。
 */
export function listDrumMapOrder(map: MapData): ArticulationRef[] {
  const refs: ArticulationRef[] = [];
  map.Parts.forEach((part, partIndex) => part.Articulations.forEach((_, articulationIndex) => refs.push({ partIndex, articulationIndex })));
  return refs
    .map((r, k) => ({ r, k, order: map.Parts[r.partIndex]!.Articulations[r.articulationIndex]!.DrumMapOrder }))
    .sort((a, b) => a.order - b.order || a.k - b.k)
    .map((x) => x.r);
}

/** 並べ替え後の一覧の順に DrumMapOrder を 1..n へ振り直す（値が同じ要素は同じ参照を保つ） */
function applyDrumMapOrder(map: MapData, ordered: readonly ArticulationRef[]): MapData {
  const next = new Map<Articulation, number>();
  ordered.forEach((r, k) => next.set(map.Parts[r.partIndex]!.Articulations[r.articulationIndex]!, k + 1));
  const parts = map.Parts.map((part) => {
    let changed = false;
    const articulations = part.Articulations.map((a) => {
      const order = next.get(a);
      if (order === undefined || order === a.DrumMapOrder) return a;
      changed = true;
      return { ...a, DrumMapOrder: order };
    });
    return changed ? { ...part, Articulations: articulations } : part;
  });
  return withParts(map, parts);
}

/**
 * DrumMap Order の並べ替え。`positions` は {@link listDrumMapOrder} の一覧内の位置（表示順）。Windows版 ArticulationsViewModel の
 * MoveTop/Up/Down/Bottom（DrumMapOrder による並べ替え）と同じ規則（選択を表示順に整列し、離れた選択は1つのブロックにまとまる）で、
 * 結果の全 Articulation の DrumMapOrder を 1..n（一意）に振り直す。`indices` は結果の一覧内での選択要素の位置。
 */
export function moveDrumMapOrder(map: MapData, positions: readonly number[], dir: MoveDirection): Result<EditResult> {
  const list = listDrumMapOrder(map);
  if (!normalizeSelection(list.length, positions)) return outOfRange('Articulation');
  const op = reorderIndices(list.length, positions, dir);
  if (!op) return unchanged(map);
  return ok({ map: applyDrumMapOrder(map, op.order.map((i) => list[i]!)), changed: true, indices: op.moved });
}

/** D&D 用: 選択ブロックを、一覧内の位置 `to`（0..件数）の要素の直前へ移す */
export function moveDrumMapOrderTo(map: MapData, positions: readonly number[], to: number): Result<EditResult> {
  const list = listDrumMapOrder(map);
  if (!normalizeSelection(list.length, positions)) return outOfRange('Articulation');
  const op = reorderTo(list.length, positions, to);
  if (!op) return unchanged(map);
  return ok({ map: applyDrumMapOrder(map, op.order.map((i) => list[i]!)), changed: true, indices: op.moved });
}

/**
 * 編集の前後で解除された参照の件数（削除の確認メッセージ用。`before` と `after` の差から数えるため、削除処理と必ず一致する）。
 * kitPitches: ArticulationID が 0 になった KitPitch、complements: Complement が 0 になった Articulation。
 */
export function countClearedReferences(before: MapData, after: MapData): { kitPitches: number; complements: number } {
  let kitPitches = 0;
  const pitchesAfter = after.Plugins.flatMap((pl) => pl.Kits.flatMap((k) => k.Pitches));
  before.Plugins.flatMap((pl) => pl.Kits.flatMap((k) => k.Pitches)).forEach((p, i) => {
    if (p.ArticulationID !== 0 && pitchesAfter[i]?.ArticulationID === 0) kitPitches++;
  });
  const complementsAfter = new Map(allArticulations(after).map((a) => [a.ID, a.Complement] as const));
  let complements = 0;
  for (const a of allArticulations(before)) {
    if (a.Complement !== 0 && complementsAfter.has(a.ID) && complementsAfter.get(a.ID) === 0) complements++;
  }
  return { kitPitches, complements };
}
