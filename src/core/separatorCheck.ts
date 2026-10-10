import { enumName } from './enums';
import { isNullOrWhiteSpace } from './kitPitchOrder';
import { SEPARATORS, type MapData } from './model';
import { separatorValue } from './separator';

export interface UndefinedSeparator {
  pluginIndex: number;
  kitIndex: number;
  /** Kit.Pitches 内の添字（行位置） */
  pitchIndex: number;
  pluginName: string;
  kitName: string;
  /** 行の Pitch 番号 */
  pitch: number;
  /** 行の Name（未設定は空文字） */
  name: string;
  /** 名前のある行か。Exportで使われるのは名前のある行のみ（空白Nameの行は出力対象外） */
  hasName: boolean;
  /** 未定義の Separator 値（数値） */
  value: number;
}

/**
 * 未定義の Separator 値（None=0 / Separate=1 / Unload=2 / Duplicate=3 以外）を持つ行を全件列挙する。
 * 読み取り専用で、データは修正しない（自動修正しない方針）。Exportのエラー挙動は変更しない。
 * 並びは Plugin → Kit → 行の配列順。
 */
export function findUndefinedSeparators(map: MapData): UndefinedSeparator[] {
  const found: UndefinedSeparator[] = [];
  map.Plugins.forEach((plugin, pluginIndex) => {
    plugin.Kits.forEach((kit, kitIndex) => {
      kit.Pitches.forEach((row, pitchIndex) => {
        if (enumName(SEPARATORS, 0, row.Separator) !== null) return;
        found.push({
          pluginIndex, kitIndex, pitchIndex,
          pluginName: plugin.Name, kitName: kit.Name,
          pitch: row.Pitch, name: row.Name ?? '', hasName: !isNullOrWhiteSpace(row.Name),
          value: separatorValue(row.Separator),
        });
      });
    });
  });
  return found;
}
