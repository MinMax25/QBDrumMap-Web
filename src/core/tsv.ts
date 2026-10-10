import { findArticulation, kitAt, type KitRef } from './exportCommon';
import { findKitByName } from './resolver';
import type { MapData } from './model';
import { noteNameWindows } from './noteName';
import { separatorToString, separatorValue } from './separator';
import { CRLF } from './text';

export const TSV_HEADER = ['Pitch', 'Note', 'Name', 'Articulation', 'Separator'] as const;

/**
 * Windows版 UtilMap.GetText: Kit Mapping交換用のTSV。
 * - 5列固定（Pitch / Note / Name / Articulation / Separator）。Note列は参考表示（取り込み時はPitch番号で対応づける）。
 *   Note名は Windows版と同じく (byte) に折り返して変換する（範囲外のPitchは通常は存在しない）。
 * - Kit内の全KitPitch（空Nameの行も含む）を DisplayOrder 順に出力する。区切り行は含まない。
 * - Separator は None なら空、それ以外は enum 名。未定義の整数値は数値の文字列で出力する（Windows版の ToString と同じ）。
 * - 各行はCRLFで終わる（最後の行も）。Kitが見つからない場合は空文字列（Windows版は空のStringBuilder）。
 * - Articulation名は ArticulationID 一致の最初のArticulation（ID=0 は ID=0 のArticulationに一致する）。無ければ空。
 */
export function getTsvText(map: MapData, kitName: string): string {
  const kit = findKitByName(map, kitName);
  return kit ? tsvOf(map, kit.Pitches) : '';
}

/** 位置指定でKitを選ぶ版（同名Kitがある場合もこちらで区別できる） */
export function getTsvTextAt(map: MapData, ref: KitRef): string {
  const kit = kitAt(map, ref);
  return kit ? tsvOf(map, kit.Pitches) : '';
}

function tsvOf(map: MapData, pitches: MapData['Plugins'][number]['Kits'][number]['Pitches']): string {
  let out = TSV_HEADER.join('\t') + CRLF;
  const rows = [...pitches].sort((a, b) => a.DisplayOrder - b.DisplayOrder);
  for (const kp of rows) {
    const artic = findArticulation(map, kp.ArticulationID)?.Name ?? '';
    const sep = separatorValue(kp.Separator) === 0 ? '' : separatorToString(kp.Separator);
    out += `${kp.Pitch}\t${noteNameWindows(kp.Pitch)}\t${kp.Name ?? ''}\t${artic}\t${sep}${CRLF}`;
  }
  return out;
}
