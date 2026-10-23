// 最小のXMLパーサ／属性エスケープ（ブラウザAPIのDOMParserに依存しないため自前）。
// 対象は Studio One .pitchlist と Cubase .drm（要素・属性・コメント・宣言・CDATA・文字参照）。DTDは非対応。

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

export class XmlParseError extends Error {}

/** 要素の入れ子の上限（ルート=1）。正規データは pitchlist 約2・drm 約4 で、再帰によるスタック超過を防ぐための十分な余裕を取る */
export const XML_MAX_DEPTH = 64;

const NAME_START = /[\p{L}_:]/u;
const NAME_CHAR = /[\p{L}\p{N}_:.\-·]/u;

/** XML 1.0 で許可される文字か（コードポイント） */
const isXmlChar = (c: number): boolean =>
  c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) ||
  (c >= 0x10000 && c <= 0x10ffff);

function decodeEntities(raw: string, isAttr: boolean): string {
  // 属性値内の改行・タブは空白に正規化される（文字参照で書かれたものは保持）
  const src = isAttr ? raw.replace(/\r\n|[\r\n\t]/g, ' ') : raw;
  return src.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!isXmlChar(cp)) throw new XmlParseError(`不正な文字参照: &${e};`);
        return String.fromCodePoint(cp);
      }
    }
  });
}

/** 未知の `&` 参照が残っていないか（生の `&` や `<` は不正） */
function assertNoBareAmp(raw: string): void {
  if (/&(?!(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(raw)) throw new XmlParseError('不正な `&` があります');
}

/** ルート要素を返す。整形式でなければ XmlParseError */
export function parseXml(input: string): XmlElement {
  const s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  // XML 1.0 で許可されない文字（制御文字・不対サロゲートなど）が1つでもあれば整形式ではない（XmlReaderと同じ）
  for (let k = 0; k < s.length; k++) {
    const cu = s.charCodeAt(k);
    let cp = cu;
    if (cu >= 0xd800 && cu <= 0xdbff && s.charCodeAt(k + 1) >= 0xdc00 && s.charCodeAt(k + 1) <= 0xdfff) {
      cp = 0x10000;
      k++;
    }
    if (!isXmlChar(cp)) throw new XmlParseError(`XMLで使用できない文字があります (位置 ${k})`);
  }
  let i = 0;
  const err = (m: string): never => {
    throw new XmlParseError(`${m} (位置 ${i})`);
  };
  const skipWs = (): void => {
    while (i < s.length && /[ \t\r\n]/.test(s[i]!)) i++;
  };
  const readName = (): string => {
    const st = i;
    if (!(i < s.length && NAME_START.test(s[i]!))) err('名前が必要です');
    i++;
    while (i < s.length && NAME_CHAR.test(s[i]!)) i++;
    return s.slice(st, i);
  };
  const skipMisc = (): void => {
    for (;;) {
      skipWs();
      if (s.startsWith('<!--', i)) {
        const e = s.indexOf('-->', i + 4);
        if (e < 0) err('コメントが閉じていません');
        i = e + 3;
      } else if (s.startsWith('<?', i)) {
        const e = s.indexOf('?>', i + 2);
        if (e < 0) err('処理命令が閉じていません');
        i = e + 2;
      } else if (s.startsWith('<!DOCTYPE', i)) {
        err('DTDは未対応です');
      } else return;
    }
  };

  // XML宣言は先頭にだけ置ける
  if (s.startsWith('<?xml', 0) && /[ \t\r\n?]/.test(s[5] ?? '')) {
    const e = s.indexOf('?>');
    if (e < 0) err('XML宣言が閉じていません');
    i = e + 2;
  }
  skipMisc();
  if (s[i] !== '<') err('ルート要素がありません');

  const parseElement = (depth: number): XmlElement => {
    i++; // '<'
    if (depth > XML_MAX_DEPTH) err(`要素の入れ子が深すぎます (上限 ${XML_MAX_DEPTH})`);
    // 属性名が __proto__ などでもプロトタイプを書き換えないよう、プロトタイプなしの辞書にする
    const el: XmlElement = { name: readName(), attrs: Object.create(null) as Record<string, string>, children: [] };
    for (;;) {
      const before = i;
      skipWs();
      if (s[i] === '/') {
        if (s[i + 1] !== '>') err('`/>` が必要です');
        i += 2;
        return el;
      }
      if (s[i] === '>') {
        i++;
        break;
      }
      if (i === before) err('属性の前に空白が必要です');
      const an = readName();
      skipWs();
      if (s[i] !== '=') err('`=` が必要です');
      i++;
      skipWs();
      const q = s[i];
      if (q !== '"' && q !== "'") err('属性値は引用符で囲む必要があります');
      const e = s.indexOf(q as string, i + 1);
      if (e < 0) err('属性値が閉じていません');
      const raw = s.slice(i + 1, e);
      if (raw.includes('<')) err('属性値に `<` は使えません');
      assertNoBareAmp(raw);
      if (Object.hasOwn(el.attrs, an)) err(`属性が重複しています: ${an}`);
      el.attrs[an] = decodeEntities(raw, true);
      i = e + 1;
    }
    // 子要素・テキスト
    for (;;) {
      const lt = s.indexOf('<', i);
      if (lt < 0) err(`終了タグがありません: ${el.name}`);
      const text = s.slice(i, lt);
      assertNoBareAmp(text);
      if (text.includes(']]>')) err('テキストに `]]>` は使えません');
      i = lt;
      if (s.startsWith('</', i)) {
        i += 2;
        const n = readName();
        if (n !== el.name) err(`終了タグが一致しません: ${n}`);
        skipWs();
        if (s[i] !== '>') err('`>` が必要です');
        i++;
        return el;
      }
      if (s.startsWith('<!--', i)) {
        const e = s.indexOf('-->', i + 4);
        if (e < 0) err('コメントが閉じていません');
        i = e + 3;
      } else if (s.startsWith('<![CDATA[', i)) {
        const e = s.indexOf(']]>', i + 9);
        if (e < 0) err('CDATAが閉じていません');
        i = e + 3;
      } else if (s.startsWith('<?', i)) {
        const e = s.indexOf('?>', i + 2);
        if (e < 0) err('処理命令が閉じていません');
        i = e + 2;
      } else {
        el.children.push(parseElement(depth + 1));
      }
    }
  };

  const root = parseElement(1);
  skipMisc();
  if (i < s.length) err('ルート要素の後に余分な内容があります');
  return root;
}

/** 属性値のエスケープ（.NET XmlWriter 相当）。XML 1.0 で使えない文字は XmlParseError（Windows版は ArgumentException） */
export function escapeXmlAttr(value: string): string {
  let out = '';
  for (let k = 0; k < value.length; k++) {
    const cu = value.charCodeAt(k);
    let cp = cu;
    if (cu >= 0xd800 && cu <= 0xdbff) {
      const d = value.charCodeAt(k + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        cp = 0x10000 + ((cu - 0xd800) << 10) + (d - 0xdc00);
        out += value[k]! + value[k + 1]!;
        k++;
        if (!isXmlChar(cp)) throw new XmlParseError('XMLで使用できない文字が含まれています');
        continue;
      }
    }
    if (!isXmlChar(cp)) throw new XmlParseError('XMLで使用できない文字が含まれています');
    switch (cu) {
      case 0x26: out += '&amp;'; break;
      case 0x3c: out += '&lt;'; break;
      case 0x3e: out += '&gt;'; break;
      case 0x22: out += '&quot;'; break;
      case 0xa: out += '&#xA;'; break;
      case 0xd: out += '&#xD;'; break;
      case 0x9: out += '&#x9;'; break;
      default: out += value[k]!;
    }
  }
  return out;
}
