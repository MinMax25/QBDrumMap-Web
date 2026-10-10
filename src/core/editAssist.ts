import { kitAt, type KitRef } from './exportCommon';
import { autoAssignArticulations, type AutoAssignOptions, type PartNameAlias } from './autoAssign';
import { applyKitPitches, renumber, unchanged, type EditResult } from './edit';
import { isNullOrWhiteSpace } from './kitPitchOrder';
import type { KitPitch, MapData } from './model';
import { fail, ok, type Result } from './result';
import { separatorValue } from './separator';

/**
 * 編集補助（Kit の Pitch 表に対する一括操作）。UI Phase 4。いずれも純粋関数: 入力を変更せず、変更した経路だけを複製した
 * 新しいモデルを返す。1回の呼び出し = 1回の取り消し単位。失敗時・変更なし（changed:false）のときは入力と同じモデルを返す／何も変更しない。
 *
 * Windows版の根拠（KitPitchesPanelViewModel.cs）:
 * - OnResetOrdrByPitch : 全 KitPitch の DisplayOrder = Pitch + 1 にして DisplayOrder 順に整列（空白Nameの行も対象）。
 * - OnCompressForward  : Name が空白でない行を現在の DisplayOrder 順に 1.. と振り、続けて Name が空白の行を現在の DisplayOrder 順に続ける。
 * - OnCopyArticulation : コピー元 Kit の 128 行を、**コレクションの添字**で対応づけて ArticulationID・Separator をコピーする
 *   （Name が空白の行は ArticulationID=0・Separator=None にする）。Web版は添字ではなく **Pitch 番号**で対応づける（承認済みの改善）。
 */

/** Pitch 順の整列（Windows版 ResetOrderByPitch）。同じ Pitch の行は現在の順序を保つ（安定整列）。順序が既に Pitch 順で DisplayOrder が 1..n なら変更なし */
export function resetOrderByPitch(map: MapData, ref: KitRef): Result<EditResult> {
  const kit = kitAt(map, ref);
  if (!kit) return fail('kit-not-found', 'Kit not found.');
  // 配列位置を第2キーにして安定性を保証する（DisplayOrder ではなく現在の並びを保つ）
  const sorted = kit.Pitches.map((p, i) => ({ p, i })).sort((a, b) => a.p.Pitch - b.p.Pitch || a.i - b.i).map((x) => x.p);
  const next = renumber(sorted);
  if (next.every((p, i) => p === kit.Pitches[i])) return unchanged(map);
  return ok({ map: applyKitPitches(map, ref, next), changed: true, indices: [] });
}

/** 前詰め（Windows版 CompressForward）: Name が空白でない行を先に、空白の行を後ろに。それぞれ現在の順序を保つ */
export function compressForward(map: MapData, ref: KitRef): Result<EditResult> {
  const kit = kitAt(map, ref);
  if (!kit) return fail('kit-not-found', 'Kit not found.');
  const named = kit.Pitches.filter((p) => !isNullOrWhiteSpace(p.Name));
  const blank = kit.Pitches.filter((p) => isNullOrWhiteSpace(p.Name));
  const next = renumber([...named, ...blank]);
  if (next.every((p, i) => p === kit.Pitches[i])) return unchanged(map);
  return ok({ map: applyKitPitches(map, ref, next), changed: true, indices: [] });
}

export interface CopyArticulationResult extends EditResult {
  /** コピー元の ArticulationID・Separator を書いた行数（値が変わった行だけ） */
  copied: number;
  /** コピー先の Name が空白のため ArticulationID=0・Separator=None にした行数（値が変わった行だけ） */
  cleared: number;
  /** コピー元に同じ Pitch 番号の行がなく、変更しなかった（Name のある）行数。黙って割り当てず、結果として報告する */
  missingInSource: number;
}

const duplicatePitches = (rows: readonly KitPitch[]): number[] => {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const r of rows) (seen.has(r.Pitch) ? dup : seen).add(r.Pitch);
  return [...dup];
};

/**
 * Articulation のコピー（Windows版 CopyArticulation の Web版）。コピー先の各行について、**同じ Pitch 番号**のコピー元の行から
 * ArticulationID・Separator をコピーする。Name のない（空白の）コピー先の行は ArticulationID=0・Separator=None にする（Windows版と同じ）。
 * Name・Pitch・DisplayOrder・Extra は変更しない。曖昧なケースは**何も変更せず失敗**にする（黙って割り当てない）:
 * - コピー元とコピー先が同じ Kit、いずれかの Kit で同じ Pitch 番号の行が複数ある、コピー元の割当が存在しない・重複した Articulation を指す。
 * コピー元に同じ Pitch の行がない（Name のある）コピー先の行は変更せず、missingInSource に数える。
 */
export function copyArticulations(map: MapData, source: KitRef, target: KitRef): Result<CopyArticulationResult> {
  const src = kitAt(map, source);
  const dst = kitAt(map, target);
  if (!src || !dst) return fail('kit-not-found', 'Kit not found.');
  if (source.pluginIndex === target.pluginIndex && source.kitIndex === target.kitIndex) {
    return fail('same-kit', 'コピー元とコピー先が同じ Kit です');
  }
  const dupSrc = duplicatePitches(src.Pitches);
  const dupDst = duplicatePitches(dst.Pitches);
  if (dupSrc.length > 0 || dupDst.length > 0) {
    const which = [dupSrc.length > 0 ? `コピー元（Pitch ${dupSrc.join(', ')}）` : '', dupDst.length > 0 ? `コピー先（Pitch ${dupDst.join(', ')}）` : '']
      .filter((x) => x !== '').join('、');
    return fail('ambiguous-pitch', `同じ Pitch 番号の行が複数あるため、対応づけを特定できません: ${which}`);
  }
  const byPitch = new Map(src.Pitches.map((p) => [p.Pitch, p]));
  const idCount = new Map<number, number>();
  for (const pt of map.Parts) for (const a of pt.Articulations) idCount.set(a.ID, (idCount.get(a.ID) ?? 0) + 1);
  // 事前検証: コピーする割当が存在しない・重複した Articulation を指す場合は、何も変更せず失敗にする
  for (const d of dst.Pitches) {
    if (isNullOrWhiteSpace(d.Name)) continue;
    const s = byPitch.get(d.Pitch);
    if (s && s.ArticulationID !== 0 && idCount.get(s.ArticulationID) !== 1) {
      return fail('articulation-not-found', `コピー元の Pitch ${s.Pitch} の Articulation ID ${s.ArticulationID} が存在しない、または重複しています`);
    }
  }
  let copied = 0;
  let cleared = 0;
  let missing = 0;
  const changedIdx: number[] = [];
  const rows = dst.Pitches.map((d, i) => {
    const blank = isNullOrWhiteSpace(d.Name);
    const s = blank ? undefined : byPitch.get(d.Pitch);
    if (!blank && !s) {
      missing++;
      return d;
    }
    const id = s ? s.ArticulationID : 0;
    const sep = s ? s.Separator : 'None';
    if (d.ArticulationID === id && separatorValue(d.Separator) === separatorValue(sep)) return d;
    if (blank) cleared++;
    else copied++;
    changedIdx.push(i);
    return { ...d, ArticulationID: id, Separator: sep };
  });
  if (changedIdx.length === 0) return ok({ map, changed: false, copied: 0, cleared: 0, missingInSource: missing });
  return ok({
    map: applyKitPitches(map, target, rows), changed: true, indices: changedIdx, copied, cleared, missingInSource: missing,
  });
}

export interface AutoAssignEditResult extends EditResult {
  assigned: number;
  skipped: number;
}

/**
 * Auto Assign（Core の autoAssignArticulations）を編集関数として適用する。対象は指定 Kit の行のみ（他の Kit・Parts は同じ参照を共有する）。
 * 割当・Separator のいずれも変わらなければ changed:false（履歴を積まない）。結果の assigned / skipped は Core の値。
 * 既定は mode:'web'（Windows版互換の 'windows' は検証用）。辞書は呼び出し側が渡す。
 */
export function applyAutoAssign(
  map: MapData, ref: KitRef, dictionary: readonly PartNameAlias[], options: AutoAssignOptions = {},
): Result<AutoAssignEditResult> {
  const r = autoAssignArticulations(map, ref, dictionary, options);
  if (!r.ok) return r;
  const before = kitAt(map, ref)!;
  const after = kitAt(r.value.map, ref)!;
  const rows = before.Pitches.map((b, i) => {
    const a = after.Pitches[i]!;
    return a.ArticulationID === b.ArticulationID && a.Separator === b.Separator ? b : a;
  });
  const { assigned, skipped } = r.value;
  if (rows.every((p, i) => p === before.Pitches[i])) return ok({ map, changed: false, assigned, skipped });
  return ok({ map: applyKitPitches(map, ref, rows), changed: true, indices: [], assigned, skipped });
}
