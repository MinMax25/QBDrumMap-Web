// テキスト出力まわりの共通部品（ブラウザAPIに依存しない）。

/** Windows版の StringBuilder.AppendLine は Environment.NewLine（Windowsでは CRLF）。Web版は行指向形式をCRLFで出力する */
export const CRLF = '\r\n';

/** Microsoft.VisualBasic.Strings.Left 相当（UTF-16コード単位で切る。サロゲートペアの途中で切れ得る点もWindows版と同じ） */
export const left = (s: string | null | undefined, n: number): string => (s ?? '').slice(0, n);

const WS = '\\p{Zs}\\p{Zl}\\p{Zp}\\t-\\r\\u0085';
const INT_RE = new RegExp(`^[${WS}]*[+-]?\\d+[${WS}]*$`, 'u');

/** int.TryParse(s, out v) 相当（NumberStyles.Integer: 前後の空白と先頭の符号を許可。int32範囲外・空文字は undefined） */
export function parseDotNetInt(s: string): number | undefined {
  if (!INT_RE.test(s)) return undefined;
  const n = Number(s.replace(new RegExp(`[${WS}]`, 'gu'), ''));
  return n >= -2147483648 && n <= 2147483647 ? n : undefined;
}

/**
 * 出力ファイル名の安全化（Windows版 StringExtensions.ToSafeFilePath の無効文字置換に相当）。
 * Path.GetInvalidFileNameChars（" < > | 制御文字 : * ? \ /）と '/' を '_' に置換する。モデル内の表示名は変えない。
 * 差異: Windows版はパス中の最後の '\' より前を「ディレクトリ」として扱い置換しない。Web版は名前単体を扱い、'\' も置換する。
 */
export function toSafeFileName(name: string, replacement = '_'): string {
  return name.replace(/["<>|:*?\\/\u0000-\u001f]/g, replacement);
}

/**
 * 出力パスの衝突回避。同じパス（大文字小文字を区別しない）が既にあれば、ファイル名の拡張子の前に ` (2)`、` (3)` を付ける。
 * 入力の順に確定し、付け替えた名前自体も以降の衝突判定の対象にする。
 */
export function dedupePaths(paths: string[]): string[] {
  const used = new Set<string>();
  return paths.map((p) => {
    let candidate = p;
    if (used.has(candidate.toLowerCase())) {
      const slash = p.lastIndexOf('/');
      const dir = p.slice(0, slash + 1);
      const name = p.slice(slash + 1);
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      for (let n = 2; ; n++) {
        candidate = `${dir}${stem} (${n})${ext}`;
        if (!used.has(candidate.toLowerCase())) break;
      }
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** 文字列をUTF-8のバイト列へ（不対サロゲートは U+FFFD。.NET の UTF8Encoding の既定動作と同じ） */
export function utf8Bytes(text: string, bom = false): Uint8Array {
  const out: number[] = bom ? [0xef, 0xbb, 0xbf] : [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** 出力ファイル1件。content は文字列、BOMの有無は bom で示す（バイト列化は utf8Bytes(content, bom)） */
export interface ExportFile {
  /** ZIP内などの相対パス。例: "Plugin名/Kit名.pitchlist"（各要素は出力時のみ安全化済み） */
  path: string;
  content: string;
  /** UTF-8 BOM を付けるか（Windows版のFile.WriteAllText(..., Encoding.UTF8) / XDocument.Save は付ける） */
  bom: boolean;
}
