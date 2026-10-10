// MIDI Convert の処理（唯一の変換処理。旧「Windows互換」モードは廃止）。
// 旧Windows版 libMidi の再現との違い（改善点。いまも維持している動作）:
// - 各トラックの末尾に EndOfTrack を出力する（全トラック同じ長さ = 入力の最長トラックの終端）。
// - ProgramChange(ch10, 0) を追加しない。
// - 複数トラックのイベントを絶対時刻で統合する（トラック内の順序は保つ。同時刻は NoteOff → NoteOn、その他はトラック順）。
// - Format 0 の出力にもテンポ・拍子・調号などのシステムイベントを保持する（トラック名は Kit 名に置き換える）。
// - Format 1 のシステムトラックの Track Name は1つに整理する（最初のものに " Converted" を付け、2つ目以降は除く）。Kit トラックには Kit 名を設定する。
// - YAMAHA XF チャンク（XFIH / XFKM）などの未知のチャンクは破棄する（保持しない。Web版の仕様）。
// - メタイベント・SysEx はバイト列を変換せず保持する（テンポ・拍子の CC/BB・調号・SequenceNumber・SysEx の F0/F7・
//   未知のメタイベント・テキストの文字コードを含む）。テキストはShift-JISから変換しない。
// - 不正なSMFはトラックを黙って捨てずエラーにする。Division はヘッダーの値をそのまま保持する。
// 共通: Pitch変換の規則（直接割当のみ・Unload/Duplicateを除外しない・複数Target・未変換ノートの #BaseKit 分離）。

import { failure, kitAt, ok, type KitRef } from './exportCommon';
import { fileNameWithoutExtension } from './importers';
import type { MapData } from './model';
import { mapPitch, orderedTargets } from './midiCommon';
import type { BinaryFile, MidiConvertFormat, MidiConvertOutput } from './midiConvert';
import { getArticulationMap, type ArticulationMap } from './resolver';
import type { Result } from './result';
import { mergeTracks, parseSmf, serializeSmf, SmfError, type WebEvent, type WebTrack } from './smfWeb';
import { dedupePaths, toSafeFileName, utf8Bytes } from './text';

const META_TRACK_NAME = 3;

const nameEvent = (name: string): WebEvent => ({ abs: 0, msg: { kind: 'meta', type: META_TRACK_NAME, data: utf8Bytes(name) } });

/** MIDIとして表せる Pitch（0–127）だけを変換結果として扱う。範囲外は -1（変換不可） */
const mapNote = (base: ArticulationMap, dst: ArticulationMap, pitch: number): number => {
  const p = mapPitch(base, dst, pitch);
  return p >= 0 && p <= 127 ? p : -1;
};

/**
 * チャンネルイベントの変換。ノート系（NoteOff / NoteOn / PolyphonicKeyPressure）は Pitch を変換し、それ以外はそのまま複製する。
 * 変換先が無い音（その Target に同じ Articulation が無い）はその Target から除く。
 * NoteOn と NoteOff は同じ規則で振り分けるため、対応関係は崩れない。
 */
function convertChannel(events: WebEvent[], base: ArticulationMap, dst: ArticulationMap): WebEvent[] {
  const out: WebEvent[] = [];
  for (const e of events) {
    const m = e.msg;
    if (m.kind === 'channel' && [0x80, 0x90, 0xa0].includes(m.status & 0xf0)) {
      const p = mapNote(base, dst, m.data[0]!);
      if (p >= 0) out.push({ abs: e.abs, msg: { ...m, data: [p, ...m.data.slice(1)] } });
    } else out.push(e);
  }
  return out;
}

/**
 * #BaseKit のイベント: 元の Pitch のまま残す音は「Base Kit で直接割当にない音」と
 * 「いずれかの Target で変換先 Pitch が 0–127 の範囲外になる音」（範囲外は変換不可として #BaseKit 側に残す。Windows版の下位8ビットへの切り詰めは行わない）。
 */
function convertBaseOut(events: WebEvent[], base: ArticulationMap, targets: readonly ArticulationMap[]): WebEvent[] {
  const keep = (pitch: number): boolean =>
    mapPitch(base, base, pitch) < 0 || targets.some((t) => mapPitch(base, t, pitch) > 127);
  return events.filter((e) => {
    const m = e.msg;
    return !(m.kind === 'channel' && [0x80, 0x90, 0xa0].includes(m.status & 0xf0)) || keep(m.data[0]!);
  });
}

const hasNoteOn = (events: WebEvent[]): boolean =>
  events.some((e) => e.msg.kind === 'channel' && (e.msg.status & 0xf0) === 0x90 && e.msg.data[1]! > 0);

/** Format 1 のシステムトラックのトラック名を整理する: 最初の Track Name にだけ " Converted" を付け、2つ目以降の Track Name は除く */
function organizeTrackNames(events: WebEvent[]): WebEvent[] {
  let done = false;
  const out: WebEvent[] = [];
  for (const e of events) {
    if (e.msg.kind === 'meta' && e.msg.type === META_TRACK_NAME) {
      if (done) continue;
      done = true;
      out.push({ abs: e.abs, msg: { ...e.msg, data: Uint8Array.from([...e.msg.data, ...utf8Bytes(' Converted')]) } });
    } else out.push(e);
  }
  return out;
}

export function convertMidiWeb(
  map: MapData, baseOn: KitRef, targets: KitRef[], input: Uint8Array, inputFileName: string, format: MidiConvertFormat,
): Result<MidiConvertOutput> {
  const baseKit = kitAt(map, baseOn);
  if (!baseKit) return failure('kit-not-found', 'Base Kit not found.');
  const targetNames = orderedTargets(map, targets);
  if (targetNames.length === 0) return failure('no-target', '変換先のKitが選択されていません');

  try {
    const src = parseSmf(input);
    const baseMap = getArticulationMap(map, baseKit.Name);
    if (!baseMap.ok) return baseMap;

    const merged = mergeTracks(src.tracks);
    const end = Math.max(...src.tracks.map((t) => t.end));
    const system = merged.filter((e) => e.msg.kind !== 'channel');
    const channel = merged.filter((e) => e.msg.kind === 'channel');
    const base = fileNameWithoutExtension(inputFileName);

    const dstMaps: { name: string; map: ArticulationMap }[] = [];
    for (const name of targetNames) {
      const dstMap = getArticulationMap(map, name);
      if (!dstMap.ok) return dstMap;
      dstMaps.push({ name, map: dstMap.value });
    }
    const kitTracks: { name: string; events: WebEvent[] }[] = [];
    const baseEvents = convertBaseOut(channel, baseMap.value, dstMaps.map((d) => d.map));
    if (hasNoteOn(baseEvents)) kitTracks.push({ name: `#${baseMap.value.Name}`, events: baseEvents });
    for (const d of dstMaps) kitTracks.push({ name: d.name, events: convertChannel(channel, baseMap.value, d.map) });

    if (format === 0) {
      // 単一トラックのファイルにシステムイベント（トラック名を除く）とチャンネルイベントを時刻順に含める
      const sys0 = system.filter((e) => !(e.msg.kind === 'meta' && e.msg.type === META_TRACK_NAME));
      const files: BinaryFile[] = kitTracks.map((k) => {
        const events = mergeTracks([{ end, events: sys0 }, { end, events: k.events }]);
        const track: WebTrack = { end, events: [nameEvent(k.name), ...events] };
        return {
          path: `${toSafeFileName(k.name)}.mid`,
          bytes: serializeSmf({ format: 0, division: src.division, tracks: [track] }),
        };
      });
      const paths = dedupePaths(files.map((f) => f.path));
      return ok({
        files: files.map((f, i) => ({ ...f, path: paths[i]! })),
        archiveName: `${toSafeFileName(base)} Converted.zip`,
      });
    }

    const tracks: WebTrack[] = [{ end, events: organizeTrackNames(system) }];
    for (const k of kitTracks) tracks.push({ end, events: [nameEvent(k.name), ...k.events] });
    return ok({
      files: [{ path: `${toSafeFileName(base)} Converted.mid`, bytes: serializeSmf({ format: 1, division: src.division, tracks }) }],
      archiveName: null,
    });
  } catch (e) {
    if (e instanceof SmfError) return failure(e.code, e.message);
    throw e;
  }
}
