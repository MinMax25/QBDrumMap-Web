import {
  APP_NAME, MIDI_CHANNELS, MODEL_VERSION, NOTE_HEADS, PLUGIN_TYPES, SEPARATORS, TECHNIQUES, VOICES,
  type Articulation, type ExtraFields, type Kit, type KitPitch, type MapData, type Part, type Plugin,
} from './model';
import { enumFromNumber, parseEnumText, type EnumValue } from './enums';
import { fail, ok, type QbdError, type Result } from './result';

class LoadFailure extends Error {
  constructor(public readonly detail: QbdError) {
    super(detail.message);
  }
}

type Obj = Record<string, unknown>;

const bad = (code: string, message: string, path: string): never => {
  throw new LoadFailure({ code, message, path });
};

function asObject(v: unknown, path: string): Obj {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return bad('type-mismatch', `${path}: オブジェクトが必要です`, path);
  }
  return v as Obj;
}

/** キー欠落は空配列（Windows版の初期値）。null・非配列はエラー。 */
function readArray(o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) return bad('type-mismatch', `${path}.${key}: 配列が必要です`, `${path}.${key}`);
  return v;
}

function readInt(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (v === undefined) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
    return bad('type-mismatch', `${path}.${key}: int32の整数が必要です`, `${path}.${key}`);
  }
  return v;
}

/** 非null想定の文字列。キー欠落・nullは既定値（差異: Windows版はnullを保持し保存時に省略する） */
function readString(o: Obj, key: string, path: string, def: string): string {
  const v = o[key];
  if (v === undefined || v === null) return def;
  if (typeof v !== 'string') return bad('type-mismatch', `${path}.${key}: 文字列が必要です`, `${path}.${key}`);
  return v;
}

/** null許容の文字列（Windows版でnull既定のKitPitch.Name / Part.Color） */
function readNullableString(o: Obj, key: string, path: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return bad('type-mismatch', `${path}.${key}: 文字列が必要です`, `${path}.${key}`);
  return v;
}

/**
 * enumの読み込み（System.Text.Json の JsonStringEnumConverter と同じ。C#での実測に基づく）。
 * - 文字列: 名前（大文字小文字を区別しない）、前後空白可、数値文字列、"A,B" のOR結合。不明な名前・空文字はエラー。
 * - 数値: int32の整数。定義済みなら名前に、未定義なら数値のまま保持する（再保存でも保持）。
 * - null・真偽値・配列・オブジェクトはエラー。
 * 差異: JSONの `2.0` / `1e0` はC#ではエラーだが、JS側では `2` と区別できず整数として受け入れる。
 */
function readEnum<T extends string>(
  o: Obj, key: string, path: string, members: readonly T[], def: T, firstValue = 0,
): EnumValue<T> {
  const v = o[key];
  if (v === undefined) return def;
  const p = `${path}.${key}`;
  let n: number | undefined;
  if (typeof v === 'string') n = parseEnumText(v, members, firstValue, true);
  else if (typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) n = v;
  if (n === undefined) return bad('unknown-enum', `${p}: 読み込めない値です`, p);
  return enumFromNumber(members, firstValue, n);
}

function extras(o: Obj, known: readonly string[]): ExtraFields {
  const e: ExtraFields = {};
  for (const k of Object.keys(o)) if (!known.includes(k)) e[k] = o[k];
  return e;
}

const K_PITCH = ['Pitch', 'Name', 'ArticulationID', 'Separator'];
const K_KIT = ['ID', 'Name', 'BankSelectMSB', 'BankSelectLSB', 'ProgramNumber', 'Pitches'];
const K_PLUGIN = ['ID', 'Name', 'PluginType', 'MidiOutDevice', 'SoundCheckChannel', 'Kits'];
const K_ARTIC = ['ID', 'Name', 'Complement', 'DrumMapOrder'];
const K_PART = [
  'ID', 'Name', 'ScorePitch', 'Color', 'NoteHead', 'Technique', 'InstrumentEntityID', 'NoteHeadSet',
  'Voice', 'TechniqueEntityID', 'Articulations',
];
const K_MAP = ['AppName', 'ModelVersion', 'Plugins', 'Parts'];

function readKitPitch(raw: unknown, path: string, index: number): KitPitch {
  const o = asObject(raw, path);
  return {
    Pitch: readInt(o, 'Pitch', path),
    Name: readNullableString(o, 'Name', path),
    ArticulationID: readInt(o, 'ArticulationID', path),
    Separator: readEnum(o, 'Separator', path, SEPARATORS, 'None'),
    DisplayOrder: index + 1,
    Extra: extras(o, K_PITCH),
  };
}

function readKit(raw: unknown, path: string, index: number): Kit {
  const o = asObject(raw, path);
  return {
    ID: readInt(o, 'ID', path),
    Name: readString(o, 'Name', path, ''),
    BankSelectMSB: readInt(o, 'BankSelectMSB', path),
    BankSelectLSB: readInt(o, 'BankSelectLSB', path),
    ProgramNumber: readInt(o, 'ProgramNumber', path),
    Pitches: readArray(o, 'Pitches', path).map((p, i) => readKitPitch(p, `${path}.Pitches[${i}]`, i)),
    DisplayOrder: index + 1,
    Extra: extras(o, K_KIT),
  };
}

function readPlugin(raw: unknown, path: string, index: number): Plugin {
  const o = asObject(raw, path);
  return {
    ID: readInt(o, 'ID', path),
    Name: readString(o, 'Name', path, ''),
    PluginType: readEnum(o, 'PluginType', path, PLUGIN_TYPES, 'None'),
    MidiOutDevice: readString(o, 'MidiOutDevice', path, ''),
    SoundCheckChannel: readEnum(o, 'SoundCheckChannel', path, MIDI_CHANNELS, 'Channel10', 1),
    Kits: readArray(o, 'Kits', path).map((k, i) => readKit(k, `${path}.Kits[${i}]`, i)),
    DisplayOrder: index + 1,
    Extra: extras(o, K_PLUGIN),
  };
}

function readArticulation(raw: unknown, path: string, index: number): Articulation {
  const o = asObject(raw, path);
  return {
    ID: readInt(o, 'ID', path),
    Name: readString(o, 'Name', path, ''),
    Complement: readInt(o, 'Complement', path),
    // DrumMapOrderは保存値をそのまま使う（Windows版Load）
    DrumMapOrder: readInt(o, 'DrumMapOrder', path),
    DisplayOrder: index + 1,
    Extra: extras(o, K_ARTIC),
  };
}

function readPart(raw: unknown, path: string, index: number): Part {
  const o = asObject(raw, path);
  return {
    ID: readInt(o, 'ID', path),
    Name: readString(o, 'Name', path, ''),
    ScorePitch: readInt(o, 'ScorePitch', path),
    Color: readNullableString(o, 'Color', path),
    NoteHead: readEnum(o, 'NoteHead', path, NOTE_HEADS, 'None'),
    Technique: readEnum(o, 'Technique', path, TECHNIQUES, 'None'),
    InstrumentEntityID: readString(o, 'InstrumentEntityID', path, ''),
    NoteHeadSet: readInt(o, 'NoteHeadSet', path),
    Voice: readEnum(o, 'Voice', path, VOICES, 'Up1'),
    TechniqueEntityID: readString(o, 'TechniqueEntityID', path, ''),
    Articulations: readArray(o, 'Articulations', path).map((a, i) =>
      readArticulation(a, `${path}.Articulations[${i}]`, i)),
    DisplayOrder: index + 1,
    Extra: extras(o, K_PART),
  };
}

/**
 * QBD JSON文字列を一時モデルへ解析する。純関数で、既存の作業モデルには一切触れない。
 * 成功時のみ呼び出し側が作業モデルと置換する（失敗時は何も変わらない）。
 * Name長・一意性などの編集時検証は行わない（Windows版Loadも行わない。validate.tsを参照）。
 * AppName / ModelVersion による拒否は行わない。
 */
export function parseQbd(text: string): Result<MapData> {
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    return fail('invalid-json', `JSONとして解析できません: ${(e as Error).message}`);
  }
  try {
    if (json === null) return fail('null-document', 'JSONがnullです');
    const root = asObject(json, '$');
    const appName = root['AppName'];
    const modelVersion = root['ModelVersion'];
    if (appName !== undefined && appName !== null && typeof appName !== 'string') {
      bad('type-mismatch', '$.AppName: 文字列が必要です', '$.AppName');
    }
    if (modelVersion !== undefined && modelVersion !== null && typeof modelVersion !== 'string') {
      bad('type-mismatch', '$.ModelVersion: 文字列が必要です', '$.ModelVersion');
    }
    return ok({
      AppName: (appName as string | null | undefined) ?? APP_NAME,
      ModelVersion: (modelVersion as string | null | undefined) ?? MODEL_VERSION,
      Plugins: readArray(root, 'Plugins', '$').map((p, i) => readPlugin(p, `Plugins[${i}]`, i)),
      Parts: readArray(root, 'Parts', '$').map((p, i) => readPart(p, `Parts[${i}]`, i)),
      Extra: extras(root, K_MAP),
    });
  } catch (e) {
    if (e instanceof LoadFailure) return { ok: false, error: e.detail };
    throw e;
  }
}
