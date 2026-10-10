// Standard MIDI File の読み書き（MIDI変換が使う唯一のSMF実装）。
// 方針: SMF仕様に沿って厳密に読み、イベントのバイト列を変換せずに保持する（メタイベント・SysEx・チャンネルイベントとも
// 種別と内容をそのまま持つ）。不正なファイルはトラックを黙って捨てずエラーにする。
// - 読み込み: ランニングステータス（メタ・SysExで解除）、可変長数（最大4バイト）、トラック長の厳密な検査、
//   最初の EndOfTrack でトラックを終える（以降のバイトは無視）。EndOfTrack が無いトラックも受け付ける。
//   未知のチャンクは長さ分を読み飛ばす。Format 2 は未対応（エラー）。
// - 書き出し: 各トラックの末尾に EndOfTrack を出力する。ランニングステータスは使わず、毎回ステータスを書く。


/** SMFの読み込み・変換で検出したエラー（code は画面のエラー表示に使う） */
export class SmfError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/** 可変長数のバイト列（MIDI の variable-length quantity） */
export function varLen(value: number): number[] {
  const out = [value % 128];
  value = Math.floor(value / 128);
  while (value > 0) {
    out.unshift((value % 128) | 0x80);
    value = Math.floor(value / 128);
  }
  return out;
}

export type WebMessage =
  /** status は 0x80–0xEF（チャンネル込み）。data は 1 または 2 バイト（0–127） */
  | { kind: 'channel'; status: number; data: number[] }
  /** status は 0xF0 または 0xF7。data は長さ指定の後ろのバイト列（そのまま） */
  | { kind: 'sysex'; status: 0xf0 | 0xf7; data: Uint8Array }
  /** メタイベント（EndOfTrack を除く）。type と data はファイルのまま */
  | { kind: 'meta'; type: number; data: Uint8Array };

export interface WebEvent {
  /** 絶対時刻（tick） */
  abs: number;
  msg: WebMessage;
}

export interface WebTrack {
  /** EndOfTrack の絶対時刻（無い場合は最後のイベントの時刻） */
  end: number;
  /** EndOfTrack を含まない、トラック内の順序どおりのイベント */
  events: WebEvent[];
}

export interface WebSmf {
  format: 0 | 1;
  /** ヘッダーの division（16ビット値。上位ビットが立つ場合はSMPTE形式）をそのまま保持する */
  division: number;
  tracks: WebTrack[];
}

const MAX_VAR = 0x0fffffff;

const ascii = (b: Uint8Array): string => String.fromCharCode(...b);

class Cursor {
  pos: number;
  constructor(readonly b: Uint8Array, pos: number, readonly end: number) {
    this.pos = pos;
  }
  byte(): number {
    if (this.pos >= this.end) throw new SmfError('truncated', 'SMFのデータが途中で終わっています');
    return this.b[this.pos++]!;
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.end) throw new SmfError('truncated', 'SMFのデータが途中で終わっています');
    const r = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return r;
  }
  variable(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.byte();
      v = v * 128 + (c & 0x7f);
      if ((c & 0x80) === 0) return v;
    }
    throw new SmfError('bad-varlen', '可変長数が4バイトを超えています');
  }
}

const u16 = (b: Uint8Array, p: number): number => (b[p]! << 8) | b[p + 1]!;
const u32 = (b: Uint8Array, p: number): number => b[p]! * 0x1000000 + (b[p + 1]! << 16) + (b[p + 2]! << 8) + b[p + 3]!;

function parseTrackBody(b: Uint8Array, start: number, end: number): WebTrack {
  const c = new Cursor(b, start, end);
  const events: WebEvent[] = [];
  let abs = 0;
  let running = 0; // ランニングステータス（0 = なし）
  while (c.pos < end) {
    abs += c.variable();
    let first = c.byte();
    let status: number;
    if (first & 0x80) {
      status = first;
      first = -1;
    } else {
      if (running === 0) throw new SmfError('bad-running-status', 'ランニングステータスの前のステータスがありません');
      status = running;
    }
    if (status === 0xff) {
      running = 0;
      const type = c.byte();
      const data = c.bytes(c.variable());
      if (type === 0x2f) return { end: abs, events }; // 最初の EndOfTrack で終了
      events.push({ abs, msg: { kind: 'meta', type, data } });
    } else if (status === 0xf0 || status === 0xf7) {
      running = 0;
      events.push({ abs, msg: { kind: 'sysex', status, data: c.bytes(c.variable()) } });
    } else if (status >= 0xf1) {
      throw new SmfError('unsupported-system', `SMFに含められないステータス 0x${status.toString(16)} があります`);
    } else {
      running = status;
      const n = (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
      const data: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = i === 0 && first >= 0 ? first : c.byte();
        if (v & 0x80) throw new SmfError('bad-data-byte', 'データバイトの最上位ビットが立っています');
        data.push(v);
      }
      events.push({ abs, msg: { kind: 'channel', status, data } });
    }
  }
  return { end: abs, events };
}

/** SMFを読む。不正なファイルは SmfError（トラックを黙って捨てない） */
export function parseSmf(bytes: Uint8Array): WebSmf {
  if (bytes.length < 14 || ascii(bytes.subarray(0, 4)) !== 'MThd') throw new SmfError('bad-header', 'MThd がありません');
  const headLen = u32(bytes, 4);
  if (headLen < 6 || 8 + headLen > bytes.length) throw new SmfError('bad-header', 'ヘッダーの長さが不正です');
  const format = u16(bytes, 8);
  const count = u16(bytes, 10);
  const division = u16(bytes, 12);
  if (format > 2) throw new SmfError('bad-format', `不正なフォーマット値です: ${format}`);
  if (format === 2) throw new SmfError('unsupported-format', 'SMF Format 2 には対応していません');
  if (division === 0) throw new SmfError('bad-division', 'Division が 0 です');
  if (count === 0) throw new SmfError('no-tracks', 'トラックがありません');
  const tracks: WebTrack[] = [];
  let pos = 8 + headLen;
  while (tracks.length < count) {
    if (pos + 8 > bytes.length) throw new SmfError('truncated', 'トラックのチャンクが不足しています');
    const id = ascii(bytes.subarray(pos, pos + 4));
    const len = u32(bytes, pos + 4);
    const bodyEnd = pos + 8 + len;
    if (bodyEnd > bytes.length) throw new SmfError('truncated', 'チャンクの長さがファイルの終端を超えています');
    if (id === 'MTrk') tracks.push(parseTrackBody(bytes, pos + 8, bodyEnd));
    pos = bodyEnd;
  }
  return { format: format as 0 | 1, division, tracks };
}

// ---- 書き出し ---------------------------------------------------------------------------------

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function delta(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VAR) throw new SmfError('bad-delta', 'デルタタイムが範囲外です');
  return varLen(value);
}

function messageBytes(m: WebMessage): number[] {
  switch (m.kind) {
    case 'channel': return [m.status, ...m.data];
    case 'sysex': return [m.status, ...delta(m.data.length), ...m.data];
    case 'meta': return [0xff, m.type, ...delta(m.data.length), ...m.data];
  }
}

/** SMFを書き出す。イベントは絶対時刻の昇順で、各トラックの末尾に EndOfTrack を出力する */
export function serializeSmf(smf: WebSmf): Uint8Array {
  if (smf.tracks.length === 0) throw new SmfError('no-tracks', '出力するトラックがありません');
  if (smf.format === 0 && smf.tracks.length !== 1) throw new SmfError('bad-format', 'Format 0 のトラックは1本です');
  const out: number[] = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, ...be16(smf.format), ...be16(smf.tracks.length), ...be16(smf.division)];
  for (const t of smf.tracks) {
    const body: number[] = [];
    let prev = 0;
    for (const e of t.events) {
      if (e.abs < prev) throw new SmfError('event-order', 'イベントが時刻の昇順ではありません');
      body.push(...delta(e.abs - prev), ...messageBytes(e.msg));
      prev = e.abs;
    }
    if (t.end < prev) throw new SmfError('event-order', 'EndOfTrack の時刻が最後のイベントより前です');
    body.push(...delta(t.end - prev), 0xff, 0x2f, 0x00);
    out.push(0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body);
  }
  return Uint8Array.from(out);
}

// ---- トラックの統合 ---------------------------------------------------------------------------

/** 同時刻のイベントの優先順位（小さいほど先）。メタ・SysEx → ノート以外 → NoteOff → NoteOn */
export function eventGroup(m: WebMessage): number {
  if (m.kind !== 'channel') return 0;
  const type = m.status & 0xf0;
  if (type === 0x80 || (type === 0x90 && m.data[1] === 0)) return 2;
  if (type === 0x90) return 3;
  return 1;
}

/**
 * 複数トラックのイベントを絶対時刻で統合する。各トラック内の順序は変えない（同時刻の NoteOn→NoteOff の長さ0ノートも保たれる）。
 * 同時刻の先頭候補が複数のトラックにある場合は、eventGroup の小さいもの（NoteOff を NoteOn より先）、同じなら若いトラック番号を先にする。
 */
export function mergeTracks(tracks: readonly WebTrack[]): WebEvent[] {
  const heads = tracks.map(() => 0);
  const out: WebEvent[] = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < tracks.length; i++) {
      const e = tracks[i]!.events[heads[i]!];
      if (!e) continue;
      if (best < 0) { best = i; continue; }
      const b = tracks[best]!.events[heads[best]!]!;
      if (e.abs < b.abs || (e.abs === b.abs && eventGroup(e.msg) < eventGroup(b.msg))) best = i;
    }
    if (best < 0) return out;
    out.push(tracks[best]!.events[heads[best]!++]!);
  }
}
