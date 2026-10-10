import { convertMidi, type KitRef, type MapData, type MidiConvertFormat, type QbdError } from '../../core';
import { findAmbiguousTargets, type ExportBlocker } from '../export/exportPlan';
import { createZip, ZipTooLargeError } from '../services/zip';

export interface ConvertRequest {
  input: Uint8Array;
  fileName: string;
  baseOn: KitRef | null;
  targets: KitRef[];
  format: MidiConvertFormat;
}

export interface ConvertResult {
  download: { fileName: string; mime: string; bytes: Uint8Array };
  /** Core が返したファイルのパス（Format 0 では ZIP の中身） */
  files: string[];
  inZip: boolean;
}

export type ConvertOutcome =
  | { ok: true; result: ConvertResult }
  | { ok: false; error: QbdError; blockers: ExportBlocker[] };

const fail = (code: string, message: string, blockers: ExportBlocker[] = []): ConvertOutcome => ({ ok: false, error: { code, message }, blockers });

/**
 * MIDI 変換の実行（作業モデルは変更しない）。Core の convertMidi をそのまま呼ぶ。
 * - 入力は SMF のバイト列。Base Kit と変換先 Kit は位置で指定する。
 * - Core は Kit を名前で引くため、選んだ Kit が Kit 名の最初の一致でない場合（同名 Kit）は誤変換を防ぐため中止する。
 * - Export 用の未定義 Separator 検証は適用しない（MIDI 変換は Separator を参照しない）。
 * - Format 0 は Core が archiveName を返すので、返されたファイル群をそのまま ZIP にまとめる（Core が ZIP を返すことはないので二重にならない）。
 *   Format 1 は単一ファイルをそのままダウンロードする。
 */
export function planConvert(map: MapData, req: ConvertRequest): ConvertOutcome {
  if (req.input.length === 0) return fail('empty-midi-file', 'MIDI ファイルが空です');
  if (!req.baseOn) return fail('base-on-required', 'Base Kit が必要です');
  if (req.targets.length === 0) return fail('no-target', '変換先の Kit が選択されていません');
  const blockers = findAmbiguousTargets(map, [{ ref: req.baseOn, baseOn: true }, ...req.targets.map((ref) => ({ ref, baseOn: false }))]);
  if (blockers.length > 0) return { ok: false, error: blockers[0]!.error, blockers };
  let r: ReturnType<typeof convertMidi>;
  try {
    r = convertMidi(map, req.baseOn, req.targets, req.input, req.fileName, { format: req.format });
  } catch (e) {
    return fail('unexpected', e instanceof Error ? e.message : String(e));
  }
  if (!r.ok) return { ok: false, error: r.error, blockers: [] };
  const { files, archiveName } = r.value;
  if (files.length === 0) return fail('no-output', '出力するファイルがありません');
  try {
    if (archiveName === null) {
      if (files.length !== 1) return fail('unexpected', '単一ファイルの出力が複数のファイルになりました');
      const f = files[0]!;
      return { ok: true, result: { download: { fileName: f.path.slice(f.path.lastIndexOf('/') + 1), mime: 'audio/midi', bytes: f.bytes }, files: [f.path], inZip: false } };
    }
    return {
      ok: true,
      result: {
        download: { fileName: archiveName, mime: 'application/zip', bytes: createZip(files.map((f) => ({ path: f.path, bytes: f.bytes }))) },
        files: files.map((f) => f.path),
        inZip: true,
      },
    };
  } catch (e) {
    if (e instanceof ZipTooLargeError) return fail('zip-too-large', e.message);
    throw e;
  }
}
