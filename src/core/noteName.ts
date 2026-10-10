const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * 表示用Note名（YAMAHA式固定: MIDI 60 = C3）。保存対象ではない。
 * 範囲外(0–127以外・非整数)は空文字。
 * 差異: Windows版は (byte) キャストのため 256 が 0 と同じ扱いになる。Web版は範囲外を空文字とする。
 */
export function noteName(pitch: number): string {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return '';
  const note = pitch % 12;
  const oct = (pitch - note) / 12 - 2;
  return `${NOTE_NAMES[note]}${oct}`;
}

/**
 * Windows版 `Pitch.NoteName(int)` と同じ表示（`(byte)` キャストで 0–255 に折り返してから変換する）。
 * TSVのNote列（参考表示）など、Windows版の出力と揃える箇所で使う。例: 300 → 44 → "G#1"、-1 → 255 → ""。
 * 通常のPitch(0–127)では noteName と同じ。
 */
export function noteNameWindows(pitch: number): string {
  return noteName(((Math.trunc(pitch) % 256) + 256) % 256);
}
