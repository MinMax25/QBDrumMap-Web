// .NET の文字列操作（OrdinalIgnoreCase / ToLowerInvariant / Trim）の再現。変換表は .NET の出力から生成（dotnetCaseTable.ts）。
// JS の toUpperCase / toLowerCase は全角・特殊文字で結果が異なる（ß → SS など長さが変わる）ため使わない。

import { LOWER_TABLE, OIC_TABLE } from './dotnetCaseTable';
import { isNullOrWhiteSpace } from './kitPitchOrder';

const parseTable = (t: string): Map<number, number> => {
  const m = new Map<number, number>();
  for (const e of t.split(' ')) {
    const i = e.indexOf('>');
    if (i > 0) m.set(parseInt(e.slice(0, i), 16), parseInt(e.slice(i + 1), 16));
  }
  return m;
};
const OIC = parseTable(OIC_TABLE);
const LOWER = parseTable(LOWER_TABLE);

/** コードポイント単位の単純な大文字小文字変換（変換前後で UTF-16 の長さは変わらない） */
const mapCase = (s: string, table: Map<number, number>): string => {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const to = table.get(cp);
    out += to === undefined ? ch : String.fromCodePoint(to);
  }
  return out;
};

/** string.ToLowerInvariant() */
export const toLowerInvariant = (s: string): string => mapCase(s, LOWER);

/** OrdinalIgnoreCase の比較に使う大文字化（UTF-16 の位置が元の文字列と一致する） */
const foldOrdinalIgnoreCase = (s: string): string => mapCase(s, OIC);

/** string.Equals(a, b, StringComparison.OrdinalIgnoreCase) */
export const equalsIgnoreCase = (a: string, b: string): boolean => foldOrdinalIgnoreCase(a) === foldOrdinalIgnoreCase(b);

/** string.IndexOf(value, StringComparison.OrdinalIgnoreCase)。見つからなければ -1 */
export const indexOfIgnoreCase = (s: string, value: string): number =>
  foldOrdinalIgnoreCase(s).indexOf(foldOrdinalIgnoreCase(value));

/** string.Contains(value, StringComparison.OrdinalIgnoreCase) */
export const containsIgnoreCase = (s: string, value: string): boolean => indexOfIgnoreCase(s, value) >= 0;

const WS = '\\p{Zs}\\p{Zl}\\p{Zp}\\t-\\r\\u0085';
const TRIM_RE = new RegExp(`^[${WS}]+|[${WS}]+$`, 'gu');

/** string.Trim()（char.IsWhiteSpace が空白とする文字を前後から除去） */
export const trimDotNet = (s: string): string => s.replace(TRIM_RE, '');

export { isNullOrWhiteSpace };
