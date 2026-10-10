/**
 * Part.Color の変換（Windows版 StudioOneColorConverter）。保存形式は `AABBGGRR` の16進文字列（A=不透明度、B/G/R は各 0〜255）。
 * 値が16進数として解釈できない（null・空・不正）場合は `00000000`（完全に透明な黒）として扱う（Windows版 GetStudioOneColor）。
 */

export interface StudioOneColor {
  a: number;
  r: number;
  g: number;
  b: number;
}

/** Windows版 `ulong.TryParse(raw, HexNumber)` 相当（前後の空白は許容しない。16桁まで） */
const HEX_RE = /^[0-9a-fA-F]{1,16}$/;

export function parseStudioOneColor(value: string | null | undefined): StudioOneColor {
  const raw = value ?? '';
  const text = HEX_RE.test(raw) ? raw.padStart(8, '0') : '00000000';
  const byte = (at: number): number => parseInt(text.slice(at, at + 2), 16);
  return { a: byte(0), b: byte(2), g: byte(4), r: byte(6) };
}

/** Windows版 ConvertBack: `AABBGGRR`（大文字） */
export function formatStudioOneColor(c: StudioOneColor): string {
  const h = (n: number): string => Math.min(255, Math.max(0, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');
  return h(c.a) + h(c.b) + h(c.g) + h(c.r);
}

/** CSS の色（`rgba(...)`）。表示用 */
export function studioOneColorToCss(value: string | null | undefined): string {
  const { a, r, g, b } = parseStudioOneColor(value);
  return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
}

/** `<input type="color">` 用の `#rrggbb`（不透明度は含まない） */
export function studioOneColorToHex(value: string | null | undefined): string {
  const { r, g, b } = parseStudioOneColor(value);
  const h = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
