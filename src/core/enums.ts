// C# enum の挙動の再現（System.Text.Json の JsonStringEnumConverter / Enum.TryParse / Enum.GetName / ToString）。
// 定義済みの値は名前（文字列）、未定義の整数は数値のまま保持する（Windows版互換。黙って既定値へ変換しない）。

export type EnumValue<T extends string> = T | number;

/** .NET の char.IsWhiteSpace 相当（Trim が除去する文字） */
const WS = '\\p{Zs}\\p{Zl}\\p{Zp}\\t-\\r\\u0085';
const trimDotNet = (s: string): string => s.replace(new RegExp(`^[${WS}]+|[${WS}]+$`, 'gu'), '');

/** 整数 → 定義済みなら名前、未定義なら数値のまま */
export function enumFromNumber<T extends string>(members: readonly T[], first: number, n: number): EnumValue<T> {
  const m = members[n - first];
  return m !== undefined ? m : n;
}

/** 値 → 整数（定義済みの名前は必ず members に含まれる） */
export function enumToNumber<T extends string>(members: readonly T[], first: number, v: EnumValue<T>): number {
  return typeof v === 'number' ? v : members.indexOf(v) + first;
}

/** Enum.GetName 相当: 未定義値は null */
export function enumName<T extends string>(members: readonly T[], first: number, v: EnumValue<T>): T | null {
  return typeof v === 'number' ? (members[v - first] ?? null) : v;
}

/** Enum.ToString() 相当: 未定義値は数値の文字列 */
export function enumToString<T extends string>(members: readonly T[], first: number, v: EnumValue<T>): string {
  return typeof v === 'number' ? (members[v - first] ?? String(v)) : v;
}

const INT_RE = /^[+-]?\d+$/;

/**
 * Enum.TryParse<T>(text, ignoreCase, out) 相当（非Flags enumでも "A,B" はOR結合、数値文字列も可）。
 * 前後の空白は無視。空文字・不明な名前・int32を超える数値は undefined。
 * System.Text.Json の文字列読み込み（JsonStringEnumConverter）は ignoreCase=true の同等の挙動（C#の実測で確認）。
 */
export function parseEnumText<T extends string>(
  text: string, members: readonly T[], first: number, ignoreCase: boolean,
): number | undefined {
  const parts = text.includes(',') ? text.split(',') : [text];
  let result = 0;
  for (const raw of parts) {
    const p = trimDotNet(raw);
    if (p === '') return undefined;
    let v: number | undefined;
    if (INT_RE.test(p)) {
      const n = Number(p);
      if (n < -2147483648 || n > 2147483647) return undefined;
      v = n;
    } else {
      const idx = members.findIndex((m) => (ignoreCase ? m.toLowerCase() === p.toLowerCase() : m === p));
      if (idx < 0) return undefined;
      v = idx + first;
    }
    result |= v;
  }
  return result;
}
