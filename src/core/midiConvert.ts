import type { KitRef } from './exportCommon';
import type { MapData } from './model';
import { convertMidiWeb } from './midiConvertWeb';
import { mapPitch } from './midiCommon';
import type { Result } from './result';

export type MidiConvertFormat = 0 | 1;

export interface MidiConvertOptions {
  /** 出力フォーマット（Windows版の設定 ConvertMIDIFormat。既定はFormat 1） */
  format: MidiConvertFormat;
}

export interface BinaryFile {
  /** アーカイブ（またはフォルダ）内の相対パス */
  path: string;
  bytes: Uint8Array;
}

export interface MidiConvertOutput {
  files: BinaryFile[];
  /** Format 0 は複数ファイルなので `{元MIDI名} Converted.zip` にまとめる。Format 1 は単一ファイルなので null */
  archiveName: string | null;
}

/**
 * MIDI変換（唯一の変換処理。midiConvertWeb.ts / smfWeb.ts）。入力データ・モデルは変更しない。
 * 旧「Windows互換」モード（Windows版 libMidi の癖の再現）は廃止した。QBD の保存形式・Export の Windows版との互換には影響しない。
 */
export function convertMidi(
  map: MapData, baseOn: KitRef, targets: KitRef[], input: Uint8Array, inputFileName: string, options: MidiConvertOptions,
): Result<MidiConvertOutput> {
  return convertMidiWeb(map, baseOn, targets, input, inputFileName, options.format);
}

export { mapPitch };
