import { enumToNumber } from './enums';
import {
  findArticulation, findPartOfArticulation, getKitPitches, failure, ok, type ExportSettings,
} from './exportCommon';
import { isNullOrWhiteSpace } from './kitPitchOrder';
import { VOICES, type MapData } from './model';
import { getArticulationMap } from './resolver';
import type { Result } from './result';
import { separatorSuffix } from './separator';
import { CRLF, parseDotNetInt } from './text';
import { escapeXmlAttr, parseXml, XmlParseError, type XmlElement } from './xml';

type FieldType = 'int' | 'float' | 'string';
type FieldDef = readonly [key: string, type: FieldType, def: number | string];
type Row = Record<string, number | string>;

// Windows版の各 *Item クラスのプロパティ（宣言順＝XML出力順）と既定値
const MAP_FIELDS: readonly FieldDef[] = [
  ['INote', 'int', 0], ['ONote', 'int', 0], ['Channel', 'int', -1], ['Length', 'float', 200], ['Mute', 'int', 0],
  ['DisplayNote', 'int', 0], ['HeadSymbol', 'int', 0], ['Voice', 'int', 0], ['PortIndex', 'int', 0],
  ['Name', 'string', ''], ['QuantizeIndex', 'int', 0], ['NoteheadSet', 'int', 0],
  ['InstrumentEntityID', 'string', ''], ['TechniqueEntityID', 'string', ''],
];
const QUANTIZE_FIELDS: readonly FieldDef[] = [
  ['Grid', 'int', 4], ['Type', 'int', 0], ['Swing', 'float', 0], ['Legato', 'int', 50],
];
const OUTPUT_FIELDS: readonly FieldDef[] = [
  ['DeviceName', 'string', 'Default Device'], ['PortName', 'string', 'Default Port'],
];

/** Windows版 CubaseDrumMap。Map の各要素は MAP_FIELDS のキーを持つ */
export interface CubaseDrumMap {
  Name: string;
  Quantize: Row[];
  Map: Row[];
  Order: number[];
  OutputDevices: Row[];
  Flags: number;
}

const newRow = (defs: readonly FieldDef[]): Row => Object.fromEntries(defs.map(([k, , d]) => [k, d]));

/** Windows版 CubaseDrumMap.Initialize: Name=Default、Pitch 0–127 の128行（INote=ONote=DisplayNote=Pitch）、Order=0..127 */
export function initializeCubaseDrumMap(): CubaseDrumMap {
  const map: Row[] = [];
  const order: number[] = [];
  for (let p = 0; p < 128; p++) {
    map.push({ ...newRow(MAP_FIELDS), Name: '', INote: p, ONote: p, DisplayNote: p });
    order.push(p);
  }
  return { Name: 'Default', Quantize: [newRow(QUANTIZE_FIELDS)], Map: map, Order: order, OutputDevices: [newRow(OUTPUT_FIELDS)], Flags: 0 };
}

/** float の文字列化（.NETの既定のshortest round-trip書式に相当。200 → "200"） */
const fmt = (v: number | string): string => String(v);

// ---- 出力（XDocument.Save 相当）-------------------------------------------------------------

function itemXml(defs: readonly FieldDef[], row: Row, indent: string): string {
  let s = `${indent}<item>${CRLF}`;
  for (const [key, type] of defs) {
    const wide = type === 'string' ? ' wide="true"' : '';
    s += `${indent}  <${type} name="${key}" value="${escapeXmlAttr(fmt(row[key] as number | string))}"${wide} />${CRLF}`;
  }
  return `${s}${indent}</item>${CRLF}`;
}

function listXml(name: string, type: string, body: string): string {
  return body === ''
    ? `  <list name="${name}" type="${type}" />${CRLF}`
    : `  <list name="${name}" type="${type}">${CRLF}${body}  </list>${CRLF}`;
}

/**
 * Windows版 CubaseDrumMap.Save（XDocument.Save）が書くXML文字列。
 * 構造: DrumMap > string Name / list Quantize / list Map / list Order(type=int) / list OutputDevices / int Flags。
 * インデントは2スペース、改行はCRLF、XML宣言は `<?xml version="1.0" encoding="utf-8"?>`。ファイルはBOM付きUTF-8。
 * 属性値は XmlWriter 相当にエスケープ。XML 1.0 で使えない文字を含む場合はエラー（Windows版は ArgumentException）。
 */
export function serializeCubaseDrm(dm: CubaseDrumMap): Result<string> {
  try {
    return ok(buildCubaseXml(dm));
  } catch (e) {
    if (e instanceof XmlParseError) return failure('invalid-xml-char', e.message);
    throw e;
  }
}

function buildCubaseXml(dm: CubaseDrumMap): string {
  let s = `<?xml version="1.0" encoding="utf-8"?>${CRLF}<DrumMap>${CRLF}`;
  s += `  <string name="Name" value="${escapeXmlAttr(dm.Name)}" wide="true" />${CRLF}`;
  s += listXml('Quantize', 'list', dm.Quantize.map((r) => itemXml(QUANTIZE_FIELDS, r, '    ')).join(''));
  s += listXml('Map', 'list', dm.Map.map((r) => itemXml(MAP_FIELDS, r, '    ')).join(''));
  s += listXml('Order', 'int', dm.Order.map((o) => `    <item value="${o}" />${CRLF}`).join(''));
  s += listXml('OutputDevices', 'list', dm.OutputDevices.map((r) => itemXml(OUTPUT_FIELDS, r, '    ')).join(''));
  s += `  <int name="Flags" value="${dm.Flags}" />${CRLF}`;
  return `${s}</DrumMap>`;
}

// ---- 読み込み（XDocument.Load 相当）---------------------------------------------------------

const named = (parent: XmlElement, key: string): XmlElement[] => parent.children.filter((c) => c.attrs['name'] === key);

function parseFloatDotNet(s: string): number | undefined {
  return /^[ \t\r\n]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[ \t\r\n]*$/.test(s) ? Number(s.trim()) : undefined;
}

function readRow(defs: readonly FieldDef[], item: XmlElement): Row {
  const row = newRow(defs);
  for (const [key, type] of defs) {
    const child = named(item, key)[0];
    if (!child) continue;
    const raw = child.attrs['value'];
    if (type === 'string') row[key] = raw ?? '';
    else if (type === 'int') {
      const n = parseDotNetInt(raw ?? '0');
      if (n === undefined) throw new XmlParseError(`${key}: 整数として解析できません`);
      row[key] = n;
    } else {
      const n = parseFloatDotNet(raw ?? '0');
      if (n === undefined) throw new XmlParseError(`${key}: 数値として解析できません`);
      row[key] = n;
    }
  }
  return row;
}

/**
 * Windows版 CubaseDrumMap.Load。ルートが DrumMap でなければエラー。
 * `name` 属性で要素を引く（Name / Quantize / Map / Order / OutputDevices / Flags）。欠けた項目は既定値、値の型不正はエラー。
 */
export function parseCubaseDrm(text: string): Result<CubaseDrumMap> {
  try {
    const root = parseXml(text);
    if (root.name !== 'DrumMap') return failure('invalid-drm', 'ルート要素が DrumMap ではありません');
    const items = (key: string): XmlElement[] =>
      named(root, key).flatMap((e) => e.children.filter((c) => c.name === 'item'));
    const int = (e: XmlElement | undefined): number => {
      const n = parseDotNetInt(e?.attrs['value'] ?? '0');
      if (n === undefined) throw new XmlParseError('整数として解析できません');
      return n;
    };
    return ok({
      Name: named(root, 'Name')[0]?.attrs['value'] ?? '',
      Quantize: items('Quantize').map((e) => readRow(QUANTIZE_FIELDS, e)),
      Map: items('Map').map((e) => readRow(MAP_FIELDS, e)),
      Order: items('Order').map((e) => int(e)),
      OutputDevices: items('OutputDevices').map((e) => readRow(OUTPUT_FIELDS, e)),
      Flags: int(named(root, 'Flags')[0]),
    });
  } catch (e) {
    if (e instanceof XmlParseError) return failure('invalid-xml', e.message);
    throw e;
  }
}

// ---- Kit → Cubase Drum Map ---------------------------------------------------------------

/** Windows版 `int.Parse($"0{value}")`: 負数は "0-5" となり FormatException */
function parseZeroPrefixed(value: number): number | undefined {
  return parseDotNetInt(`0${value}`);
}

/**
 * Windows版 UtilMap.GetCubaseDrumMap。baseOn を指定すると Base-On 出力（入力Pitchは Base Kit、出力Pitch(ONote)は対象Kitの代表Pitch）。
 *
 * - 表示順は getKitPitches(baseOn ?? kit)（区切り行 `==========` もその Pitch の行として名前が入る）。
 * - 各 Pitch 0–127 について、その Pitch を持つ最初の行から Name / ONote / Part 属性を決める。
 * - ONote: 通常は Pitch。Base-On は「対象KitのResolverで ArticulationID に対応する Item の先頭Pitch」。
 *   Itemが無ければ -1、Itemはあるが Pitch が空なら 0（Windows版は `FirstOrDefault()` が int の 0 を返すため）。
 *   Pitch != 0 かつ ONote == -1 の行はスキップする。
 * - ArticulationID != 0 の行は Separator 接尾辞を付ける（未定義のSeparatorはエラー）。
 * - UseArticulation の場合のみ DisplayNote(ScorePitch) / NoteheadSet / Voice / InstrumentEntityID / TechniqueEntityID を Part から設定。
 *   ScorePitch / NoteHeadSet が負数なら Windows版は FormatException（エラー）。
 * - Order: 表示順に 1.. を振り（Nameが空白の行は番号だけ消費）、残りは 999。(番号, Pitch) の昇順で128件。
 * - 範囲外の Pitch（<0 または >127）の行があるとエラー（Windows版は ArgumentOutOfRangeException）。
 * - 対象KitのResolver（getArticulationMap）がエラーならそのエラー。
 */
export function getCubaseDrumMap(
  map: MapData, drumKitName: string, baseOn: string | null, settings: ExportSettings,
): Result<CubaseDrumMap> {
  const isBaseOn = baseOn !== null;
  const itemsR = getKitPitches(map, baseOn ?? drumKitName, settings);
  if (!itemsR.ok) return itemsR;
  const items = itemsR.value;
  const am = getArticulationMap(map, drumKitName);
  if (!am.ok) return am;

  const dm = initializeCubaseDrumMap();
  dm.Name = drumKitName;
  const odr = new Map<number, number>();

  for (let pitch = 0; pitch < 128; pitch++) {
    odr.set(pitch, 999);
    const item = items.find((x) => x.Pitch === pitch);
    if (!item) continue;
    const artic = findArticulation(map, item.ArticulationID);
    const part = findPartOfArticulation(map, item.ArticulationID);

    let name = item.Name ?? '';
    if (settings.useArticulationPitchName && !isNullOrWhiteSpace(artic?.Name ?? null)) name = artic!.Name;

    let onote: number;
    if (!isBaseOn) onote = item.Pitch;
    else {
      const target = am.value.Items.find((m) => m.ID === item.ArticulationID);
      onote = target ? (target.Pitches[0] ?? 0) : -1;
    }
    if (item.Pitch !== 0 && onote === -1) continue;

    if (item.ArticulationID !== 0) {
      const suffix = separatorSuffix(item.Separator);
      if (suffix === null) {
        return failure('undefined-separator', `Separatorの値が未定義のため出力できません: Pitch ${item.Pitch}`);
      }
      name += suffix;
    }

    const row = dm.Map[pitch]!;
    row['Name'] = name;
    row['ONote'] = onote;
    if (settings.useArticulation) {
      const score = parseZeroPrefixed(part?.ScorePitch ?? 0);
      const headSet = parseZeroPrefixed(part?.NoteHeadSet ?? 0);
      if (score === undefined || headSet === undefined) {
        return failure('invalid-part-value', 'ScorePitch / NoteHeadSet が負数のため出力できません');
      }
      row['DisplayNote'] = score;
      row['NoteheadSet'] = headSet;
      row['Voice'] = part ? enumToNumber(VOICES, 0, part.Voice) : 0;
      row['InstrumentEntityID'] = part?.InstrumentEntityID ?? '';
      row['TechniqueEntityID'] = part?.TechniqueEntityID ?? '';
    }
  }

  let i = 1;
  for (const item of items) {
    const row = dm.Map[item.Pitch];
    if (!row) return failure('pitch-out-of-range', `Pitchが範囲外のため出力できません: ${item.Pitch}`);
    if (!isNullOrWhiteSpace(row['Name'] as string)) odr.set(item.Pitch, i);
    i++;
  }
  dm.Order = [...odr.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([k]) => k);
  return ok(dm);
}
