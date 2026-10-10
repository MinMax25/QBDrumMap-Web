// Auto Assign（KitPitch への Articulation 自動割当）。Windows版 UtilArticulationAutoAssign.AutoAssignArticulations の再現。
// mode: 'windows' は Windows版の挙動そのもの（C#照合テストの基準）。'web'（既定）は下記の3点だけをWeb版の意図的な改善として変更する:
//  (1) 割当先が見つからない行の Separator が Unload / Duplicate なら Separate で上書きしない（件数は skipped に数える）。
//  (2) 他のKitから得た ArticulationID が Parts に存在しない場合は候補にしない（次の候補・辞書照合へ進む）。
//  (3) 辞書で ID=0 の Articulation に一致した場合は、割当成功とせず「見つからない」と同じ扱い（skipped）にする。
// Windows版は Kit を直接書き換えるが、Web版は入力の MapData を変更せず、更新後の MapData の複製を返す（Web版の意図的な差異）。
// 割当の規則（Windows版と同じ。C#コードを実行した出力と照合している）:
// - 対象は ArticulationID=0 かつ Name が空白でない行。それ以外の行は一切変更しない。
// - Plugin が GM / GM2 / GS / XG で Pitch が GM のパーカッション域（54, 56, 58, 60–81）なら Separate にして割当しない。
// - 割当元の優先順: ①他のKit（同じPluginを優先、なければPlugin順・Kit順・行順で最初）の同名（辞書で正規化した名前）の割当済み行
//   → ②辞書でPartを特定し、そのPartの Articulation の完全一致 → 類似度（Jaccard、閾値0.6以上、最大のものを先着で）。
// - 見つからなければ Separate にする（既存のSeparatorは上書きされる）。
// - 同じKit内で同じ ArticulationID の行が複数になった場合、今回割り当てた行の Separator を整理する（代表は None、他は Duplicate）。

import {
  containsIgnoreCase, equalsIgnoreCase, indexOfIgnoreCase, isNullOrWhiteSpace, toLowerInvariant, trimDotNet,
} from './dotnetString';
import { enumName, type EnumValue } from './enums';
import { failure, kitAt, ok, type KitRef } from './exportCommon';
import { cloneMap, PLUGIN_TYPES, type Kit, type KitPitch, type MapData, type Part, type PluginType } from './model';
import type { Result } from './result';
import { separatorValue } from './separator';

/** Part 名の辞書（Windows版 PartNameAlias。Aliases はカンマ区切りの文字列） */
export interface PartNameAlias {
  CanonicalName: string;
  Aliases: string;
}

/** Windows版 SettingService.SeedDefaultPartNameDictionaryIfEmpty の初期値 */
export const defaultPartNameDictionary = (): PartNameAlias[] => [
  { CanonicalName: 'Kick', Aliases: 'Bass Drum,BD' },
  { CanonicalName: 'Snare', Aliases: 'SD' },
  { CanonicalName: 'Hi-Hat', Aliases: 'HiHat,HH,Hat' },
  { CanonicalName: 'Tom', Aliases: 'Floor Tom' },
  { CanonicalName: 'Ride', Aliases: 'Ride Cymbal' },
  { CanonicalName: 'Crash', Aliases: 'Crash Cymbal' },
  { CanonicalName: 'Cymbal', Aliases: '' },
];

export interface AutoAssignOptions {
  /** 'web'（既定）= Web版の改善あり、'windows' = Windows版の挙動 */
  mode?: 'web' | 'windows';
}

export interface AutoAssignOutput {
  /** 更新後の MapData（入力とは別のオブジェクト。入力は変更しない） */
  map: MapData;
  /** 今回 Articulation を割り当てた行数（Web版: 結果の ArticulationID が 0 でない行だけ） */
  assigned: number;
  /** 割当先が見つからなかった行数（GMのパーカッション域で Separate にした行は含まない。Web版: ID=0 の Articulation に一致した行を含む） */
  skipped: number;
}

const SIMILARITY_THRESHOLD = 0.6;

/** GMDrumMap.PercussionNotes のキー */
const PERCUSSION_NOTES = new Set([54, 56, 58, ...Array.from({ length: 22 }, (_, i) => 60 + i)]);
/** GMDrumMap.StandardDrumNotes のキー */
const STANDARD_DRUM_NOTES = new Set([...Array.from({ length: 19 }, (_, i) => 35 + i), 55, 57, 59]);

/** PartNameAlias.GetAllNames: 正規名（前後の空白除去）→ Aliases をカンマで分割して前後の空白を除いたもの。空白のみは除く */
function allNames(e: PartNameAlias): string[] {
  const names: string[] = [];
  if (!isNullOrWhiteSpace(e.CanonicalName)) names.push(trimDotNet(e.CanonicalName));
  if (!isNullOrWhiteSpace(e.Aliases)) {
    for (const a of e.Aliases.split(',')) {
      const t = trimDotNet(a);
      if (t !== '') names.push(t);
    }
  }
  return names.filter((x) => !isNullOrWhiteSpace(x));
}

interface Replacement {
  alias: string;
  canonical: string;
}

/** Normalize の置換リスト: 辞書の順に（正規名, 別名…）を並べ、別名の長い順（同じ長さは辞書の順）に安定ソート */
function replacementsOf(dictionary: readonly PartNameAlias[]): Replacement[] {
  return dictionary
    .flatMap((e) => allNames(e).map((alias) => ({ alias, canonical: e.CanonicalName })))
    .sort((a, b) => b.alias.length - a.alias.length);
}

/**
 * Normalize: 別名（長い順）ごとに最初の出現（大文字小文字を区別しない）を正規名に置換していく（置換結果にも後続の置換が掛かる）。
 * 最後に前後の空白を除いて小文字化する。
 */
const normalizeCache = new WeakMap<readonly Replacement[], Map<string, string>>();
function normalize(name: string | null, replacements: readonly Replacement[]): string {
  if (isNullOrWhiteSpace(name)) return '';
  // 結果は (名前, 置換リスト) だけで決まるため、実行中は置換リストごとに結果を使い回す（同じ名前を何度も正規化するため）
  let cache = normalizeCache.get(replacements);
  if (!cache) normalizeCache.set(replacements, (cache = new Map()));
  const hit = cache.get(name!);
  if (hit !== undefined) return hit;
  const value = normalizeUncached(name!, replacements);
  cache.set(name!, value);
  return value;
}

function normalizeUncached(name: string, replacements: readonly Replacement[]): string {
  let result = name;
  for (const { alias, canonical } of replacements) {
    const index = indexOfIgnoreCase(result, alias);
    if (index >= 0) result = result.slice(0, index) + canonical + result.slice(index + alias.length);
  }
  return toLowerInvariant(trimDotNet(result));
}

const TOKEN_SEPARATORS = new Set([' ', '-', '_', '[', ']', '<', '>', '(', ')', '/', '\\']);
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  let cur = '';
  for (const ch of text) {
    if (ch.length === 1 && TOKEN_SEPARATORS.has(ch)) {
      if (cur !== '') tokens.add(toLowerInvariant(cur));
      cur = '';
    } else cur += ch;
  }
  if (cur !== '') tokens.add(toLowerInvariant(cur));
  return tokens;
}

/** トークン集合の Jaccard 係数。どちらかが空白のみ、またはトークンが無ければ 0 */
function similarity(a: string, b: string): number {
  if (isNullOrWhiteSpace(a) || isNullOrWhiteSpace(b)) return 0;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const union = ta.size + tb.size - common;
  return union === 0 ? 0 : common / union;
}

const isGmFamily = (pluginType: EnumValue<PluginType>): boolean => {
  const n = enumName(PLUGIN_TYPES, 0, pluginType);
  return n === 'GM' || n === 'GM2' || n === 'GS' || n === 'XG';
};

/** 他のKit（対象Kit以外）の割当済み・名前付きの行のうち、正規化した名前が一致するもの。同じPluginを優先し、なければ最初のもの */
function findByOtherKitReference(
  map: MapData, target: KitRef, pitchName: string, replacements: readonly Replacement[], validIds: ReadonlySet<number> | null,
): number | undefined {
  const normalized = normalize(pitchName, replacements);
  let first: number | undefined;
  for (let pi = 0; pi < map.Plugins.length; pi++) {
    const kits = map.Plugins[pi]!.Kits;
    for (let ki = 0; ki < kits.length; ki++) {
      if (pi === target.pluginIndex && ki === target.kitIndex) continue;
      for (const p of kits[ki]!.Pitches) {
        if (p.ArticulationID === 0 || isNullOrWhiteSpace(p.Name)) continue;
        if (validIds && !validIds.has(p.ArticulationID)) continue; // Web版: Parts に存在しないIDは候補にしない
        if (normalize(p.Name, replacements) !== normalized) continue;
        if (pi === target.pluginIndex) return p.ArticulationID;
        first ??= p.ArticulationID;
      }
    }
  }
  return first;
}

/** 辞書の名前（正規名・別名）のうち、行の名前に含まれる（大文字小文字不問）最も長いものの正規名に一致する Part（同長は先着） */
function identifyPart(map: MapData, pitchName: string, dictionary: readonly PartNameAlias[]): Part | undefined {
  let bestCanonical: string | null = null;
  let bestLength = 0;
  for (const entry of dictionary) {
    for (const candidate of allNames(entry)) {
      if (candidate.length > bestLength && !isNullOrWhiteSpace(pitchName) && containsIgnoreCase(pitchName, candidate)) {
        bestCanonical = entry.CanonicalName;
        bestLength = candidate.length;
      }
    }
  }
  if (bestCanonical === null) return undefined;
  return map.Parts.find((p) => equalsIgnoreCase(p.Name, bestCanonical!));
}

function findByPartDictionary(
  map: MapData, pitchName: string, dictionary: readonly PartNameAlias[], replacements: readonly Replacement[],
): number | undefined {
  const part = identifyPart(map, pitchName, dictionary);
  if (!part || part.Articulations.length === 0) return undefined;
  const normalized = normalize(pitchName, replacements);
  const exact = part.Articulations.find((a) => normalize(a.Name, replacements) === normalized);
  if (exact) return exact.ID;
  let best: number | undefined;
  let bestScore = 0;
  for (const a of part.Articulations) {
    const score = similarity(normalized, normalize(a.Name, replacements));
    if (score > bestScore) {
      bestScore = score;
      best = a.ID;
    }
  }
  return best !== undefined && bestScore >= SIMILARITY_THRESHOLD ? best : undefined;
}

/** 同じ ArticulationID の行が複数ある場合、今回割り当てた行の Separator を整理する（代表は None、他は Duplicate） */
function resolveDuplicates(kit: Kit, newlyAssigned: ReadonlySet<KitPitch>): void {
  const groups = new Map<number, KitPitch[]>();
  for (const p of kit.Pitches) {
    if (p.ArticulationID === 0) continue;
    const g = groups.get(p.ArticulationID);
    if (g) g.push(p);
    else groups.set(p.ArticulationID, [p]);
  }
  for (const members of groups.values()) {
    if (members.length <= 1) continue;
    let representative = members.find((p) => separatorValue(p.Separator) === 0 && !newlyAssigned.has(p));
    if (!representative) {
      const newMembers = members.filter((p) => newlyAssigned.has(p));
      representative = newMembers.find((p) => STANDARD_DRUM_NOTES.has(p.Pitch)) ?? newMembers[0];
    }
    for (const m of members) {
      if (!newlyAssigned.has(m)) continue;
      m.Separator = m === representative ? 'None' : 'Duplicate';
    }
  }
}

/**
 * 指定したKitの Articulation を自動割当する。入力の MapData は変更せず、結果の MapData（複製）を返す。
 * Kit の参照が不正な場合はエラー（Windows版は何もせず (0, 0) を返す）。辞書は呼び出し側が渡す（空配列なら辞書による照合は行わない）。
 */
export function autoAssignArticulations(
  source: MapData, kitRef: KitRef, dictionary: readonly PartNameAlias[], options: AutoAssignOptions = {},
): Result<AutoAssignOutput> {
  const web = (options.mode ?? 'web') === 'web';
  if (!kitAt(source, kitRef)) return failure('kit-not-found', 'Kit not found.');
  const map = cloneMap(source);
  const plugin = map.Plugins[kitRef.pluginIndex]!;
  const kit = plugin.Kits[kitRef.kitIndex]!;
  const replacements = replacementsOf(dictionary);
  const gm = isGmFamily(plugin.PluginType);
  const validIds = web ? new Set(map.Parts.flatMap((pt) => pt.Articulations.map((a) => a.ID))) : null;

  let assigned = 0;
  let skipped = 0;
  const newlyAssigned = new Set<KitPitch>();
  for (const pitch of kit.Pitches) {
    if (pitch.ArticulationID !== 0 || isNullOrWhiteSpace(pitch.Name)) continue;
    if (gm && PERCUSSION_NOTES.has(pitch.Pitch)) {
      pitch.Separator = 'Separate';
      continue;
    }
    let id = findByOtherKitReference(map, kitRef, pitch.Name!, replacements, validIds)
      ?? findByPartDictionary(map, pitch.Name!, dictionary, replacements);
    if (web && id === 0) id = undefined; // ID=0 の Articulation への一致は割当成功とみなさない
    if (id !== undefined) {
      pitch.ArticulationID = id;
      newlyAssigned.add(pitch);
      assigned++;
    } else {
      const sep = separatorValue(pitch.Separator);
      if (!(web && (sep === 2 || sep === 3))) pitch.Separator = 'Separate'; // Web版: Unload / Duplicate は保持
      skipped++;
    }
  }
  resolveDuplicates(kit, newlyAssigned);
  return ok({ map, assigned, skipped });
}
