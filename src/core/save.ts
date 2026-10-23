import { normalizeIds } from './fixId';
import {
  APP_NAME, MODEL_VERSION, NOTE_HEADS, PLUGIN_TYPES, SEPARATORS, TECHNIQUES, VOICES, setOwn,
  type ExtraFields, type MapData,
} from './model';
import { ok, type Result } from './result';

type Json = Record<string, unknown>;

/** 出力しない既定値の指定。NONEは「常に出力」 */
const ALWAYS = Symbol('always');
type Field = [key: string, value: unknown, def: unknown];

const sorted = <T extends { DisplayOrder: number }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.DisplayOrder - b.DisplayOrder);

/** WhenWritingDefault相当: 値が既定値なら出力しない。キー順は宣言順（Windows版と同じ）。Extraは末尾。 */
function build(fields: Field[], extra: ExtraFields): Json {
  const o: Json = {};
  for (const [k, v, def] of fields) if (v !== def) o[k] = v;
  for (const k of Object.keys(extra)) setOwn(o, k, extra[k]);
  return o;
}

function toDto(map: MapData): Json {
  // AppName / ModelVersion は、Windows版同様、読み込んだ値によらず固定値で書く
  return build(
    [
      ['AppName', APP_NAME, null],
      ['ModelVersion', MODEL_VERSION, null],
      ['Plugins', sorted(map.Plugins).map((pl) => build([
        ['ID', pl.ID, 0],
        ['Name', pl.Name, null],
        ['PluginType', pl.PluginType, PLUGIN_TYPES[0]],
        ['MidiOutDevice', pl.MidiOutDevice, null],
        // MIDIChannelの値は1始まりで既定値(0)に当たるものがなく、常に出力される
        ['SoundCheckChannel', pl.SoundCheckChannel, ALWAYS],
        ['Kits', sorted(pl.Kits).map((k) => build([
          ['ID', k.ID, 0],
          ['Name', k.Name, null],
          ['BankSelectMSB', k.BankSelectMSB, 0],
          ['BankSelectLSB', k.BankSelectLSB, 0],
          ['ProgramNumber', k.ProgramNumber, 0],
          ['Pitches', sorted(k.Pitches).map((p) => build([
            ['Pitch', p.Pitch, 0],
            ['Name', p.Name, null],
            ['ArticulationID', p.ArticulationID, 0],
            ['Separator', p.Separator, SEPARATORS[0]],
          ], p.Extra)), ALWAYS],
        ], k.Extra)), ALWAYS],
      ], pl.Extra)), ALWAYS],
      ['Parts', sorted(map.Parts).map((pt) => build([
        ['ID', pt.ID, 0],
        ['Name', pt.Name, null],
        ['ScorePitch', pt.ScorePitch, 0],
        ['Color', pt.Color, null],
        ['NoteHead', pt.NoteHead, NOTE_HEADS[0]],
        ['Technique', pt.Technique, TECHNIQUES[0]],
        ['InstrumentEntityID', pt.InstrumentEntityID, null],
        ['NoteHeadSet', pt.NoteHeadSet, 0],
        ['Voice', pt.Voice, VOICES[0]],
        ['TechniqueEntityID', pt.TechniqueEntityID, null],
        ['Articulations', sorted(pt.Articulations).map((a) => build([
          ['ID', a.ID, 0],
          ['Name', a.Name, null],
          ['Complement', a.Complement, 0],
          ['DrumMapOrder', a.DrumMapOrder, 0],
        ], a.Extra)), ALWAYS],
      ], pt.Extra)), ALWAYS],
    ],
    map.Extra,
  );
}

/** System.Text.Json(UnicodeRanges.All)の文字列エスケープに合わせる: < > & ' + ` と非BMP(サロゲート)を \uXXXX 化 */
function escapeLikeDotNet(json: string): string {
  return json.replace(/"(?:[^"\\]|\\.)*"/g, (token) =>
    token.replace(/\\(?:u[0-9a-fA-F]{4}|.)|[<>&'+`\ud800-\udfff]/g, (m) => {
      if (m.startsWith('\\')) return m.length === 6 ? `\\u${m.slice(2).toUpperCase()}` : m;
      return `\\u${m.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
    }));
}

export interface SaveOutput {
  /** 保存するQBD JSON文字列（インデント2、改行はLF） */
  text: string;
  /** ID正規化後のモデル。Windows版Save同様、呼び出し側が作業モデルと置換できる */
  normalized: MapData;
}

/**
 * ID正規化(FixID)後にQBD JSONへ変換する。入力モデルは変更しない。
 * DisplayOrderはJSONへ出力しない（出力順で表現する）。既定値のフィールドは省略する。
 */
export function serializeQbd(map: MapData): Result<SaveOutput> {
  const n = normalizeIds(map);
  if (!n.ok) return n;
  const text = escapeLikeDotNet(JSON.stringify(toDto(n.value), null, 2));
  return ok({ text, normalized: n.value });
}
