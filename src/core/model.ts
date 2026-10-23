import type { EnumValue } from './enums';

// QBD互換モデル。フィールド名はQBD JSONのキー（PascalCase）と一致させる。
// DisplayOrderはQBD JSONへ出力しない（Windows版: ModelBase.DisplayOrderは[JsonIgnore]）。
// Extraは仕様外の追加フィールドの保持領域（Web版のデータ保護方針。Windows版は破棄する）。

export const SEPARATORS = ['None', 'Separate', 'Unload', 'Duplicate'] as const;
export type Separator = (typeof SEPARATORS)[number];

export const PLUGIN_TYPES = ['None', 'GM', 'GM2', 'GS', 'XG'] as const;
export type PluginType = (typeof PLUGIN_TYPES)[number];

/** Channel1 = 1 ... Channel16 = 16（C#側のenum値は1始まり） */
export const MIDI_CHANNELS = [
  'Channel1', 'Channel2', 'Channel3', 'Channel4', 'Channel5', 'Channel6', 'Channel7', 'Channel8',
  'Channel9', 'Channel10', 'Channel11', 'Channel12', 'Channel13', 'Channel14', 'Channel15', 'Channel16',
] as const;
export type MidiChannel = (typeof MIDI_CHANNELS)[number];

export const NOTE_HEADS = ['None', 'nhdX', 'nhTr', 'nhSl', 'nhCX', 'nhDi'] as const;
export type NoteHead = (typeof NOTE_HEADS)[number];

export const TECHNIQUES = ['None', 'circ', 'ccir', 'plus', 'trm1', 'trm2', 'trm3', 'stac'] as const;
export type Technique = (typeof TECHNIQUES)[number];

export const VOICES = ['Up1', 'Down1', 'Up2', 'Down2'] as const;
export type Voice = (typeof VOICES)[number];

export type ExtraFields = Record<string, unknown>;

/**
 * 任意のキーを自身のプロパティとして代入する。`o[k] = v` は k が `__proto__` のときにプロトタイプを
 * 書き換え（値が非オブジェクトなら無視され）キーが失われるため、Extra の読み書きではこちらを使う。
 */
export function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

export interface KitPitch {
  Pitch: number;
  /** Windows版は未初期化(null)を許容し、nullの場合は保存時に省略される */
  Name: string | null;
  ArticulationID: number;
  /** 定義済みは名前、未定義の整数は数値のまま保持する（Windows版互換） */
  Separator: EnumValue<Separator>;
  DisplayOrder: number;
  Extra: ExtraFields;
}

export interface Kit {
  ID: number;
  Name: string;
  BankSelectMSB: number;
  BankSelectLSB: number;
  ProgramNumber: number;
  Pitches: KitPitch[];
  DisplayOrder: number;
  Extra: ExtraFields;
}

export interface Plugin {
  ID: number;
  Name: string;
  PluginType: EnumValue<PluginType>;
  MidiOutDevice: string;
  SoundCheckChannel: EnumValue<MidiChannel>;
  Kits: Kit[];
  DisplayOrder: number;
  Extra: ExtraFields;
}

export interface Articulation {
  ID: number;
  Name: string;
  Complement: number;
  DrumMapOrder: number;
  DisplayOrder: number;
  Extra: ExtraFields;
}

export interface Part {
  ID: number;
  Name: string;
  ScorePitch: number;
  /** Windows版は未初期化(null)を許容し、nullの場合は保存時に省略される */
  Color: string | null;
  NoteHead: EnumValue<NoteHead>;
  Technique: EnumValue<Technique>;
  InstrumentEntityID: string;
  NoteHeadSet: number;
  Voice: EnumValue<Voice>;
  TechniqueEntityID: string;
  Articulations: Articulation[];
  DisplayOrder: number;
  Extra: ExtraFields;
}

export interface MapData {
  AppName: string;
  ModelVersion: string;
  Plugins: Plugin[];
  Parts: Part[];
  Extra: ExtraFields;
}

export const APP_NAME = 'QBDrumMap';
export const MODEL_VERSION = '1.0.0';
export const PITCH_COUNT = 128;

export function createEmptyMap(): MapData {
  return { AppName: APP_NAME, ModelVersion: MODEL_VERSION, Plugins: [], Parts: [], Extra: {} };
}

/** Pitch 0–127 の128行（Windows版 KitPanelViewModel の新規Kit作成と同じ。DisplayOrder = Pitch+1） */
export function createKitPitches(): KitPitch[] {
  return Array.from({ length: PITCH_COUNT }, (_, p) => ({
    Pitch: p,
    Name: null,
    ArticulationID: 0,
    Separator: 'None' as const,
    DisplayOrder: p + 1,
    Extra: {},
  }));
}

export function createKit(id: number, name: string, displayOrder: number): Kit {
  return {
    ID: id,
    Name: name,
    BankSelectMSB: 0,
    BankSelectLSB: 0,
    ProgramNumber: 0,
    Pitches: createKitPitches(),
    DisplayOrder: displayOrder,
    Extra: {},
  };
}

// Extraは JSON.parse 由来の値のみを持つため JSON経由の複製で十分。
function cloneExtra(e: ExtraFields): ExtraFields {
  return JSON.parse(JSON.stringify(e)) as ExtraFields;
}

export function cloneMap(map: MapData): MapData {
  return {
    AppName: map.AppName,
    ModelVersion: map.ModelVersion,
    Extra: cloneExtra(map.Extra),
    Plugins: map.Plugins.map((pl) => ({
      ...pl,
      Extra: cloneExtra(pl.Extra),
      Kits: pl.Kits.map((k) => ({
        ...k,
        Extra: cloneExtra(k.Extra),
        Pitches: k.Pitches.map((p) => ({ ...p, Extra: cloneExtra(p.Extra) })),
      })),
    })),
    Parts: map.Parts.map((pt) => ({
      ...pt,
      Extra: cloneExtra(pt.Extra),
      Articulations: pt.Articulations.map((a) => ({ ...a, Extra: cloneExtra(a.Extra) })),
    })),
  };
}
