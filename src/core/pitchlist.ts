import { enumName } from './enums';
import {
  findArticulation, findPartOfArticulation, getKitPitches, failure, ok, type ExportSettings,
} from './exportCommon';
import { NOTE_HEADS, TECHNIQUES, type MapData } from './model';
import { isNullOrWhiteSpace } from './kitPitchOrder';
import type { Result } from './result';
import { separatorSuffix } from './separator';
import { CRLF } from './text';

/** Windows版 PitchName（Studio One の <Music.PitchName> 1件） */
export interface PitchName {
  Pitch: number;
  Name: string;
  ScorePitch: string | null;
  Color: string | null;
  Notehead: string | null;
  Technique: string | null;
}

export interface PitchList {
  Title: string;
  Items: PitchName[];
}

/**
 * Windows版 UtilMap.GetStudioOnePitchList。
 * - 対象は GetKitPitches の結果（表示順。`==========` の区切り行も1件として出力される）。
 * - UseArticulationPitchName かつ Articulation名が空白でない場合、Name を Articulation名に置き換える。
 *   ArticulationID != 0 の行は Separator 接尾辞（" (-)" / " (+)" / " (*)"）を付ける。未定義のSeparator値はエラー
 *   （Windows版は ArgumentException。黙って None 扱いにしない）。
 * - UseArticulation の場合のみ Part の属性を付ける: scorePitch(0は省略)、color("00000000"は省略)、notehead / technique(Noneは省略)。
 *   notehead / technique は Enum.GetName 相当で、未定義の整数値は属性ごと省略される（Windows版と同じ）。
 * - Pitch は byte へのキャスト（0–255に折り返す。Windows版と同じ）。
 */
export function getStudioOnePitchList(map: MapData, kitName: string, settings: ExportSettings): Result<PitchList> {
  const rows = getKitPitches(map, kitName, settings);
  if (!rows.ok) return rows;
  const list: PitchList = { Title: kitName, Items: [] };
  for (const item of rows.value) {
    const artic = findArticulation(map, item.ArticulationID);
    const part = findPartOfArticulation(map, item.ArticulationID);

    let name = item.Name ?? '';
    if (settings.useArticulationPitchName && !isNullOrWhiteSpace(artic?.Name ?? null)) name = artic!.Name;
    if (item.ArticulationID !== 0) {
      const suffix = separatorSuffix(item.Separator);
      if (suffix === null) {
        return failure('undefined-separator', `Separatorの値が未定義のため出力できません: Pitch ${item.Pitch}`);
      }
      name += suffix;
    }

    let color: string | null = part?.Color ?? '00000000';
    if (color === '00000000') color = null;

    const pitch = ((item.Pitch % 256) + 256) % 256;
    if (settings.useArticulation) {
      const noteHead = part ? enumName(NOTE_HEADS, 0, part.NoteHead) : 'None';
      const technique = part ? enumName(TECHNIQUES, 0, part.Technique) : 'None';
      list.Items.push({
        Pitch: pitch,
        Name: name,
        ScorePitch: (part?.ScorePitch ?? 0) === 0 ? null : `${part!.ScorePitch}`,
        Color: color,
        Notehead: !part || noteHead === 'None' ? null : noteHead,
        Technique: !part || technique === 'None' ? null : technique,
      });
    } else {
      list.Items.push({ Pitch: pitch, Name: name, ScorePitch: null, Color: null, Notehead: null, Technique: null });
    }
  }
  return ok(list);
}

/** Windows版 PitchList.EscXML（& " ' < > のみ） */
export const escXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SerializePitchListOptions {
  /**
   * XML属性値を適切にエスケープする（既定 true。Web改善）。
   * false の場合は Windows版と同じ挙動: `title` と `color` をエスケープしない（`name` は常にエスケープ）。
   * Windows版では Kit名に & " < > が含まれると不正なXMLになる。通常のKit名（これらの文字を含まない）では両者の出力は一致する。
   */
  escapeAttributes?: boolean;
}

/**
 * Windows版 PitchList.Save が書く文字列（CRLF、タブインデント）。
 * 属性は pitch, name, color, scorePitch, notehead, technique の順で、空白のみの値は省略。
 * ファイルは UTF-8 BOM付き。
 */
export function serializePitchList(list: PitchList, options: SerializePitchListOptions = {}): string {
  const esc = options.escapeAttributes ?? true ? escXml : (x: string): string => x;
  let sb = `<?xml version="1.0" encoding="utf-8"?>${CRLF}<Music.PitchNameList title="${esc(list.Title)}">${CRLF}`;
  for (const item of list.Items) {
    sb += `	<Music.PitchName pitch="${item.Pitch}" name="${escXml(item.Name)}"`;
    if (!isNullOrWhiteSpace(item.Color)) sb += ` color="${esc(item.Color!)}"`;
    if (!isNullOrWhiteSpace(item.ScorePitch)) sb += ` scorePitch="${escXml(item.ScorePitch!)}"`;
    if (!isNullOrWhiteSpace(item.Notehead)) sb += ` notehead="${escXml(item.Notehead!)}"`;
    if (!isNullOrWhiteSpace(item.Technique)) sb += ` technique="${escXml(item.Technique!)}"`;
    sb += `/>${CRLF}`;
  }
  return `${sb}</Music.PitchNameList>${CRLF}`;
}
