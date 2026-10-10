import { enumName, enumToNumber, enumToString, type EnumValue } from './enums';
import { SEPARATORS, type Separator } from './model';

/** Separatorの数値（enum値。None=0, Separate=1, Unload=2, Duplicate=3。未定義の整数はそのまま） */
export const separatorValue = (s: EnumValue<Separator>): number => enumToNumber(SEPARATORS, 0, s);

/** Windows版 Separator.ToString() 相当（TSV出力用。未定義値は数値の文字列） */
export const separatorToString = (s: EnumValue<Separator>): string => enumToString(SEPARATORS, 0, s);

/** UI表示名（Windows版の [Display(Name)]）。None は空文字、Unload は "Not Loaded"。未定義値は null */
export function separatorDisplayName(s: EnumValue<Separator>): string | null {
  switch (enumName(SEPARATORS, 0, s)) {
    case 'None': return '';
    case 'Separate': return 'Separate';
    case 'Unload': return 'Not Loaded';
    case 'Duplicate': return 'Duplicate';
    default: return null;
  }
}

/**
 * 出力名に付ける接尾辞（Windows版 UtilMap.GetPitchName）: None なし / Separate " (-)" / Unload " (+)" / Duplicate " (*)"。
 * 未定義値は null（Windows版は ArgumentException。黙って既定値へ変換せず、呼び出し側でエラーにする）。
 */
export function separatorSuffix(s: EnumValue<Separator>): string | null {
  switch (enumName(SEPARATORS, 0, s)) {
    case 'None': return '';
    case 'Separate': return ' (-)';
    case 'Unload': return ' (+)';
    case 'Duplicate': return ' (*)';
    default: return null;
  }
}
