// Auto Assign（KitPitch への Articulation 自動割当）。Windows版 v2.1.0 UtilArticulationAutoAssign.AutoAssignArticulations の再現。
// mode: 'windows' は Windows版の挙動そのもの（C#照合テストの基準）。'web'（既定）は下記の2点だけをWeb版の意図的な改善として変更する:
//  (1) 割当先が見つからない行の Separator が Unload / Duplicate なら Separate で上書きしない（件数は skipped に数える）。
//  (2) 辞書で ID=0 の Articulation に一致した場合は、割当成功とせず「見つからない」と同じ扱い（skipped）にする。
// Windows版は Kit を直接書き換えるが、Web版は入力の MapData を変更せず、更新後の MapData の複製を返す（Web版の意図的な差異）。
// 割当の規則（Windows版と同じ。C#コードを実行した出力と照合している）:
// - 対象は ArticulationID が Parts に存在しない（0 を含む）かつ Name が空白でない行。それ以外の行は一切変更しない。
// - Plugin が GM / GM2 / GS / XG で Pitch が GM のパーカッション域（54, 56, 58, 60–81）なら Separate にして割当しない。
// - 割当元の優先順: ①他のKit（同じPluginを優先、なければPlugin順・Kit順・行順で最初）の同名（辞書で正規化した名前）の、
//   Parts に存在する ArticulationID を持つ行 → ②入力名と Part 名・Articulation 名のトークン一致数による照合。
// - 照合は、辞書の別名を語境界つきで正規名へ置換し、小文字化して語に分けて行う。
//   除外語を含む名前は割り当てず、無視語は照合から除く。語尾違い（Choked / Choke）は4文字以上の前置一致で同一視する。
// - 見つからなければ Separate にする（既存のSeparatorは上書きされる）。
// - 同じKit内で同じ ArticulationID の行が複数になった場合、今回割り当てた行の Separator を整理する（代表は None、他は Duplicate）。

import {
  equalsIgnoreCase, isNullOrWhiteSpace, toLowerInvariant, trimDotNet,
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

/** Windows版 SettingService.AddDefaultPartNameDictionary の初期値 */
export const defaultPartNameDictionary = (): PartNameAlias[] => [
  { CanonicalName: 'Kick', Aliases: 'Bass Drum,BD' },
  { CanonicalName: 'Snare', Aliases: 'SD' },
  { CanonicalName: 'Snare Sidestick', Aliases: 'Side-Stick,Side Stick,Sidestick' },
  { CanonicalName: 'Hi-Hat', Aliases: 'HiHat,HH,Hat' },
  { CanonicalName: 'Floortom', Aliases: 'Floor Tom' },
  { CanonicalName: 'Racktom', Aliases: 'Rack Tom' },
  { CanonicalName: 'Floortom 1', Aliases: 'Tom Low,High Floor Tom,Hi Floor Tom' },
  { CanonicalName: 'Floortom 2', Aliases: 'Low Floor Tom' },
  { CanonicalName: 'Racktom 1', Aliases: 'Tom Mid' },
  { CanonicalName: 'Racktom 2', Aliases: 'High Rack Tom,Hi Rack Tom' },
  { CanonicalName: 'Racktom 4', Aliases: 'Low Rack Tom' },
  { CanonicalName: 'Hightom 1', Aliases: 'Tom Hi,Tom High' },
  { CanonicalName: 'Crash L', Aliases: 'High Crash' },
  { CanonicalName: 'Crash R', Aliases: 'Low Crash' },
  { CanonicalName: 'Ride', Aliases: 'Ride Cymbal' },
  { CanonicalName: 'Crash', Aliases: 'Crash Cymbal' },
  { CanonicalName: 'Cymbal', Aliases: '' },
  { CanonicalName: 'Hi-Hat Open Edge 1', Aliases: 'Hi Hat Open 1/4,Hi-Hat Open 1/4' },
  { CanonicalName: 'Hi-Hat Open Edge 2', Aliases: 'Hi Hat Open 1/2,Hi-Hat Open 1/2' },
  { CanonicalName: 'Hi-Hat Open Edge 3', Aliases: 'Hi Hat Open 3/4,Hi-Hat Open 3/4' },
  { CanonicalName: 'Hi-Hat Open Edge 4', Aliases: 'Hi Hat Open Loose,Hi-Hat Open Loose' },
  { CanonicalName: 'Hi-Hat Open Edge 5', Aliases: 'Hi Hat Open Full,Hi-Hat Open Full' },
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

/** Part 名の語のうち、入力名に含まれている割合の下限 */
const MINIMUM_PART_COVERAGE = 0.5;
/** 語尾違い（Choked / Choke など）を同一視する前置一致の最小長 */
const MINIMUM_PREFIX_LENGTH = 4;
/** 非ドラム系の打楽器や制御用のノート。Articulation を割り当てない */
const EXCLUDED_WORDS: ReadonlySet<string> = new Set(['spiral', 'chopper', 'cowbell', 'clap', 'controller']);
/** Part や Articulation の判別に寄与しない語。入力名から除いて照合する */
const NOISE_WORDS: ReadonlySet<string> = new Set(['drum', 'cym', 'cymbal', 'center']);

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

/** BuildReplacements: 辞書の順に（正規名, 別名…）を並べ、別名の長い順（同じ長さは辞書の順）に安定ソート */
function replacementsOf(dictionary: readonly PartNameAlias[]): Replacement[] {
  return dictionary
    .flatMap((e) => allNames(e).map((alias) => ({ alias, canonical: e.CanonicalName })))
    .sort((a, b) => b.alias.length - a.alias.length);
}

/** char.IsLetterOrDigit（UTF-16 の1要素ごとの判定。単独のサロゲートは false） */
const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;
const isLetterOrDigit = (ch: string): boolean => LETTER_OR_DIGIT.test(ch);
/** text.Any(char.IsLetter)（UTF-16 の1要素ごとの判定） */
const LETTER = /\p{L}/u;
const hasLetter = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (LETTER.test(text[i]!)) return true;
  return false;
};

const isWordStart = (text: string, index: number): boolean => index === 0 || !isLetterOrDigit(text[index - 1]!);

/** 語の途中で終わる別名（"Hat" に対する "Hats" など）は一致としない */
function isAliasAt(text: string, index: number, alias: string): boolean {
  const end = index + alias.length;
  if (end > text.length || !equalsIgnoreCase(text.slice(index, end), alias)) return false;
  return end === text.length || !isLetterOrDigit(text[end]!);
}

/**
 * Normalize: 先頭から1回だけ走査し、語の先頭で別名（長い順）に一致した箇所を正規名へ置換する（置換結果には再度掛けない。
 * "Hat" が "Hi-Hat" の一部を置換しない）。最後に前後の空白を除いて小文字化する。
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
  let result = '';
  let index = 0;
  while (index < name.length) {
    const match = isWordStart(name, index) ? replacements.find((x) => isAliasAt(name, index, x.alias)) : undefined;
    if (match) {
      result += match.canonical;
      index += match.alias.length;
    } else {
      result += name[index];
      index++;
    }
  }
  return toLowerInvariant(trimDotNet(result));
}

const TOKEN_SEPARATORS = new Set([' ', '-', '_', '[', ']', '<', '>', '(', ')', '/', '\\']);
/** 語の位置（後ろの語ほど具体的）を比較に使うため、出現順を保って重複を除く */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (TOKEN_SEPARATORS.has(ch)) {
      if (cur !== '') tokens.push(toLowerInvariant(cur));
      cur = '';
    } else cur += ch;
  }
  if (cur !== '') tokens.push(toLowerInvariant(cur));
  return [...new Set(tokens)];
}

interface MatchResult {
  matched: number;
  indexSum: number;
  extras: number;
  candidateMatched: number;
  hasWord: boolean;
}

function isSameToken(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= MINIMUM_PREFIX_LENGTH && (a.startsWith(b) || b.startsWith(a));
}

function countMatches(pitchTokens: readonly string[], candidateTokens: readonly string[]): MatchResult {
  let matched = 0;
  let indexSum = 0;
  let hasWord = false;
  pitchTokens.forEach((token, i) => {
    if (!candidateTokens.some((c) => isSameToken(token, c))) return;
    matched++;
    indexSum += i;
    // 数字や1文字だけの一致（"1"、"L" など）では、対象 Part と判断しない
    hasWord ||= token.length >= 2 && hasLetter(token);
  });
  const candidateMatched = candidateTokens.filter((c) => pitchTokens.some((p) => isSameToken(p, c))).length;
  return { matched, indexSum, extras: candidateTokens.length - candidateMatched, candidateMatched, hasWord };
}

/** 他のKit（対象Kit以外）の、有効な ArticulationID を持つ名前付きの行のうち、正規化した名前が一致するもの。同じPluginを優先し、なければ最初のもの */
function findByOtherKitReference(
  map: MapData, target: KitRef, pitchName: string, replacements: readonly Replacement[], validIds: ReadonlySet<number>,
): number | undefined {
  const normalized = normalize(pitchName, replacements);
  let first: number | undefined;
  for (let pi = 0; pi < map.Plugins.length; pi++) {
    const kits = map.Plugins[pi]!.Kits;
    for (let ki = 0; ki < kits.length; ki++) {
      if (pi === target.pluginIndex && ki === target.kitIndex) continue;
      for (const p of kits[ki]!.Pitches) {
        if (!validIds.has(p.ArticulationID) || isNullOrWhiteSpace(p.Name)) continue;
        if (normalize(p.Name, replacements) !== normalized) continue;
        if (pi === target.pluginIndex) return p.ArticulationID;
        first ??= p.ArticulationID;
      }
    }
  }
  return first;
}

/** 入力名の語のうち Part 名の語に一致する数が最も多い Part。Part 名側の語の半数以上が入力名に含まれることを条件にする */
function findBestPart(map: MapData, pitchTokens: readonly string[], replacements: readonly Replacement[]): Part | undefined {
  let best: Part | undefined;
  let bestMatch: MatchResult | undefined;
  for (const part of map.Parts) {
    if (part.Articulations.length === 0) continue;
    const partTokens = tokenize(normalize(part.Name, replacements));
    const match = countMatches(pitchTokens, partTokens);
    // 入力名が長くても特定できるよう、Part 名側の語がどれだけ入力名に含まれるかで判定する
    if (!match.hasWord || match.candidateMatched / partTokens.length < MINIMUM_PART_COVERAGE) continue;
    // 一致数が同じなら、後ろの語に一致する Part を優先する（Hi Hat Closed Pedal は Pedal 側）
    if (!bestMatch
      || match.matched > bestMatch.matched
      || (match.matched === bestMatch.matched && match.indexSum > bestMatch.indexSum)
      || (match.matched === bestMatch.matched && match.indexSum === bestMatch.indexSum && match.extras < bestMatch.extras)) {
      best = part;
      bestMatch = match;
    }
  }
  return best;
}

function findBestArticulation(part: Part, pitchTokens: readonly string[], replacements: readonly Replacement[]): number | undefined {
  let best: number | undefined;
  let bestMatch: MatchResult | undefined;
  for (const articulation of part.Articulations) {
    const match = countMatches(pitchTokens, tokenize(normalize(articulation.Name, replacements)));
    // 同点の場合は余分な語がないものを優先し、それも同点なら一覧の先頭を採用する。主要な Articulation が先頭に並ぶ前提
    if (!bestMatch
      || match.matched > bestMatch.matched
      || (match.matched === bestMatch.matched && match.indexSum > bestMatch.indexSum)
      || (match.matched === bestMatch.matched && match.indexSum === bestMatch.indexSum && match.extras === 0 && bestMatch.extras !== 0)) {
      best = articulation.ID;
      bestMatch = match;
    }
  }
  return best;
}

function findByPartDictionary(map: MapData, pitchName: string, replacements: readonly Replacement[]): number | undefined {
  const allTokens = tokenize(normalize(pitchName, replacements));
  if (allTokens.some((t) => EXCLUDED_WORDS.has(t))) return undefined;
  const pitchTokens = allTokens.filter((t) => !NOISE_WORDS.has(t));
  if (pitchTokens.length === 0) return undefined;
  const part = findBestPart(map, pitchTokens, replacements);
  return part ? findBestArticulation(part, pitchTokens, replacements) : undefined;
}

const isGmFamily = (pluginType: EnumValue<PluginType>): boolean => {
  const n = enumName(PLUGIN_TYPES, 0, pluginType);
  return n === 'GM' || n === 'GM2' || n === 'GS' || n === 'XG';
};

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
 * Kit の参照が不正な場合はエラー（Windows版は何もせず (0, 0) を返す）。辞書は呼び出し側が渡す（空配列なら別名の置換は行わない）。
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
  // MapData.IsValidArticulationID: 0 ではなく、いずれかの Part に存在する ID
  const validIds = new Set(map.Parts.flatMap((pt) => pt.Articulations.map((a) => a.ID)).filter((id) => id !== 0));

  let assigned = 0;
  let skipped = 0;
  const newlyAssigned = new Set<KitPitch>();
  for (const pitch of kit.Pitches) {
    if (validIds.has(pitch.ArticulationID) || isNullOrWhiteSpace(pitch.Name)) continue;
    if (gm && PERCUSSION_NOTES.has(pitch.Pitch)) {
      pitch.Separator = 'Separate';
      continue;
    }
    let id = findByOtherKitReference(map, kitRef, pitch.Name!, replacements, validIds)
      ?? findByPartDictionary(map, pitch.Name!, replacements);
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
