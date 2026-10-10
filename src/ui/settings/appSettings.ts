import { defaultPartNameDictionary, type MidiConvertFormat, type PartNameAlias } from '../../core';

/**
 * アプリ設定（QBD とは独立。QBD には保存されず、編集履歴・Dirty にも影響しない）。
 * Windows版 AppSettings.cs のうち、Core が対応し意味が明確な項目（3 項目と PartNameDictionary）と画面テーマを扱う。
 * Language の編集UIは後続課題。
 */
/** 画面テーマ（Dark／Light の 2 択。OS のテーマへの自動追従はしない） */
export type ThemeMode = 'dark' | 'light';

export interface AppSettings {
  /** UseArticulation: Articulation 順の並びと Part 属性（色・音符頭など）の出力 */
  useArticulation: boolean;
  /** UseArticulationPitchName: PitchName を Articulation 名で置き換える */
  useArticulationPitchName: boolean;
  /** ConvertMIDIFormat: MIDI 変換の出力形式（Windows版の既定は Format 1） */
  convertMidiFormat: MidiConvertFormat;
  /** 画面テーマ（既定は Dark。表示だけの設定で、QBD・Dirty・Undo には関係しない） */
  theme: ThemeMode;
  /** PartNameDictionary: Auto Assign が使う Part 名の辞書（Windows版 AppSettings.PartNameDictionary）。空配列も有効な値で、空のまま保存・復元する */
  partNameDictionary: PartNameAlias[];
}

/** 既定値（Windows版 AppSettings の既定と同じ） */
export const DEFAULT_SETTINGS: AppSettings = { useArticulation: true, useArticulationPitchName: true, convertMidiFormat: 1, theme: 'dark', partNameDictionary: defaultPartNameDictionary() };

export const SETTINGS_STORAGE_KEY = 'qbdrummap-web.settings';
/**
 * 2: 画面テーマ（theme）を追加。3: partNameDictionary を追加。
 * version 1／2 の保存データは既存の設定値を保ったまま、足りない項目（theme は dark、辞書は初期7件）を既定にして読み込む。
 */
export const SETTINGS_SCHEMA_VERSION = 3;
const THEME_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;

export type RestoreStatus =
  /** 保存データなし（初回） */
  | 'none'
  /** 保存データから復元した */
  | 'restored'
  /** 保存データが壊れている・値が不正だったため既定値にした */
  | 'invalid'
  /** 未知のバージョンの保存データだったため既定値にした（保存データは設定を変更するまで上書きしない） */
  | 'unknown-version'
  /** ストレージを読めなかった */
  | 'unreadable';

export interface RestoreResult {
  settings: AppSettings;
  status: RestoreStatus;
}

/** 保存文字列を検証して設定へ。不正な値を黙って補正せず、1つでも不正なら全体を既定値にして status で知らせる */
export function parseSettings(raw: string | null): RestoreResult {
  if (raw === null) return { settings: { ...DEFAULT_SETTINGS }, status: 'none' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid' };
  const o = data as Record<string, unknown>;
  if (typeof o['version'] !== 'number' || !Number.isInteger(o['version'])) return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid' };
  const version = o['version'];
  if (version !== SETTINGS_SCHEMA_VERSION && version !== THEME_SCHEMA_VERSION && version !== LEGACY_SCHEMA_VERSION) return { settings: { ...DEFAULT_SETTINGS }, status: 'unknown-version' };
  const s = o['settings'];
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid' };
  const v = s as Record<string, unknown>;
  const fmt = v['convertMidiFormat'];
  if (typeof v['useArticulation'] !== 'boolean' || typeof v['useArticulationPitchName'] !== 'boolean' || (fmt !== 0 && fmt !== 1)) {
    return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid' };
  }
  // version 1（theme なし）は theme を既定にする。version 2 以降では theme も検証する
  let theme: ThemeMode = DEFAULT_SETTINGS.theme;
  if (version !== LEGACY_SCHEMA_VERSION) {
    const t = v['theme'];
    if (t !== 'dark' && t !== 'light') return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid' };
    theme = t;
  }
  // version 3 以降は辞書も検証する（空配列は有効）。version 1／2 は辞書を持たないため初期辞書にする
  let partNameDictionary: PartNameAlias[] = defaultPartNameDictionary();
  if (version === SETTINGS_SCHEMA_VERSION) {
    const d = parseDictionary(v['partNameDictionary']);
    if (d === null) return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid' };
    partNameDictionary = d;
  }
  return {
    settings: { useArticulation: v['useArticulation'], useArticulationPitchName: v['useArticulationPitchName'], convertMidiFormat: fmt, theme, partNameDictionary },
    status: 'restored',
  };
}

/** 辞書の検証。配列で、各要素が文字列の CanonicalName／Aliases を持てば採用（空文字・重複も許可）。不正なら null */
function parseDictionary(raw: unknown): PartNameAlias[] | null {
  if (!Array.isArray(raw)) return null;
  const result: PartNameAlias[] = [];
  for (const e of raw as unknown[]) {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
    const o = e as Record<string, unknown>;
    if (typeof o['CanonicalName'] !== 'string' || typeof o['Aliases'] !== 'string') return null;
    result.push({ CanonicalName: o['CanonicalName'], Aliases: o['Aliases'] });
  }
  return result;
}

export function serializeSettings(s: AppSettings): string {
  return JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { useArticulation: s.useArticulation, useArticulationPitchName: s.useArticulationPitchName, convertMidiFormat: s.convertMidiFormat, theme: s.theme,
      partNameDictionary: s.partNameDictionary.map((e) => ({ CanonicalName: e.CanonicalName, Aliases: e.Aliases })),
    },
  });
}
