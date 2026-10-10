import { describe, expect, it } from 'vitest';
import {
  convertMidi, mergeTracks, parseQbd, parseSmf, serializeSmf, SmfError, utf8Bytes,
  type KitRef, type MapData, type MidiConvertOutput, type Result, type WebEvent,
} from '../src/core';

// Web改善モードのテスト。Windows版C#とのバイト一致ではなく、SMF仕様に基づく構造・イベントの検証。
// 検証側（ビルダー・パーサ）はCoreの読み書きを使わず独立に書いている。

// ---- 最小SMFビルダー ----
const vl = (n: number): number[] => {
  const o = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) o.unshift((n & 0x7f) | 0x80);
  return o;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
type Ev = [tick: number, bytes: number[]];
const body = (t: Ev[]): number[] => {
  let last = 0;
  return t.flatMap(([tick, b]) => {
    const d = vl(tick - last);
    last = tick;
    return [...d, ...b];
  });
};
/** 生のSMF。bodies はトラック本体のバイト列（不正なデータを作るため自由に指定できる） */
const raw = (fmt: number, ntrk: number, division: number, bodies: number[][], hdrLen = 6): Uint8Array =>
  Uint8Array.from([
    ...ascii('MThd'), ...be32(hdrLen), 0, fmt, 0, ntrk, division >> 8, division & 255,
    ...bodies.flatMap((b) => [...ascii('MTrk'), ...be32(b.length), ...b]),
  ]);
const EOT: Ev = [0, [0xff, 0x2f, 0x00]];
/** 正常なSMF（各トラックに EndOfTrack を付ける） */
const smf = (tracks: Ev[][], division = 480): Uint8Array => {
  const withEot = tracks.map((t) => {
    const lastTick = t.length ? t[t.length - 1]![0] : 0;
    return body([...t, [lastTick, EOT[1]]]);
  });
  return raw(tracks.length === 1 ? 0 : 1, tracks.length, division, withEot);
};
const on = (p: number, v = 100, ch = 10): number[] => [0x90 | (ch - 1), p, v];
const off = (p: number, ch = 10): number[] => [0x80 | (ch - 1), p, 0];
const meta = (type: number, bytes: number[]): number[] => [0xff, type, ...vl(bytes.length), ...bytes];
const hex = (b: ArrayLike<number>): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

interface Parsed {
  division: number;
  format: number;
  /** 各トラックのイベント（EndOfTrack を含む）。hex はステータスから（メタは ff + type + データ）。 */
  tracks: { tick: number; hex: string }[][];
}
/** 出力SMFの独立した検証つきパーサ。構造が壊れていればここで例外になる */
function parse(b: Uint8Array): Parsed {
  expect(hex(b.slice(0, 8))).toBe('4d546864' + '00000006');
  const format = (b[8]! << 8) | b[9]!;
  const ntrk = (b[10]! << 8) | b[11]!;
  const division = (b[12]! << 8) | b[13]!;
  let i = 14;
  const tracks: Parsed['tracks'] = [];
  for (let n = 0; n < ntrk; n++) {
    expect(hex(b.slice(i, i + 4))).toBe('4d54726b');
    const len = b[i + 4]! * 0x1000000 + (b[i + 5]! << 16) + (b[i + 6]! << 8) + b[i + 7]!;
    let p = i + 8;
    const end = p + len;
    expect(end).toBeLessThanOrEqual(b.length);
    let tick = 0;
    const evs: { tick: number; hex: string }[] = [];
    const varlen = (): number => {
      let v = 0;
      let c: number;
      do { c = b[p++]!; v = v * 128 + (c & 0x7f); } while (c & 0x80);
      return v;
    };
    while (p < end) {
      tick += varlen();
      const st = b[p]!;
      expect(st & 0x80, 'ランニングステータスは使わない').toBe(0x80);
      if (st === 0xff) {
        const type = b[p + 1]!;
        p += 2;
        const l = varlen();
        evs.push({ tick, hex: hex([0xff, type, ...b.slice(p, p + l)]) });
        p += l;
      } else if (st === 0xf0 || st === 0xf7) {
        p++;
        const l = varlen();
        evs.push({ tick, hex: hex([st, ...b.slice(p, p + l)]) });
        p += l;
      } else {
        const l = (st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0 ? 2 : 3;
        evs.push({ tick, hex: hex(b.slice(p, p + l)) });
        p += l;
      }
    }
    expect(p, 'イベントがチャンク長ちょうどで終わる').toBe(end);
    tracks.push(evs);
    i = end;
  }
  expect(i, 'チャンクの後ろに余分なバイトがない').toBe(b.length);
  // SMF仕様: 各トラックの最後が EndOfTrack で、他に EndOfTrack は無く、全トラックで同じ時刻
  for (const t of tracks) {
    expect(t.length).toBeGreaterThan(0);
    expect(t[t.length - 1]!.hex).toBe('ff2f');
    expect(t.filter((e) => e.hex === 'ff2f').length).toBe(1);
  }
  expect(new Set(tracks.map((t) => t[t.length - 1]!.tick)).size).toBe(1);
  return { division, format, tracks };
}
const lines = (t: Parsed['tracks'][number]): string[] => t.map((e) => `${e.tick}:${e.hex}`);
const nameOf = (t: Parsed['tracks'][number]): string => {
  const e = t.find((x) => x.hex.startsWith('ff03'));
  return e ? Buffer.from(e.hex.slice(4), 'hex').toString('utf8') : '';
};

// ---- マップ（midi.test.ts と同じ） ----
const pitches = (rows: [number, number, string?][]): object[] =>
  rows.map(([Pitch, ArticulationID, Separator]) => ({ Pitch, Name: `p${Pitch}`, ArticulationID, ...(Separator ? { Separator } : {}) }));
const mapData = (): MapData => {
  const r = parseQbd(JSON.stringify({
    Plugins: [{ ID: 1, Name: 'P', Kits: [
      { ID: 1, Name: 'B', Pitches: pitches([[36, 1], [38, 2], [40, 2, 'Unload'], [41, 2, 'Duplicate'], [42, 4]]) },
      { ID: 2, Name: 'T', Pitches: pitches([[60, 1], [61, 2], [62, 4], [63, 3]]) },
    ] }],
    Parts: [
      { ID: 1, Name: 'Kick', Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] },
      { ID: 2, Name: 'Snare', Articulations: [{ ID: 2, Name: 'Snare', DrumMapOrder: 2 }] },
      { ID: 3, Name: 'Hat', Articulations: [{ ID: 3, Name: 'Open', DrumMapOrder: 3 }, { ID: 4, Name: 'Closed', DrumMapOrder: 4 }] },
    ],
  }));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const B: KitRef = { pluginIndex: 0, kitIndex: 0 };
const T: KitRef = { pluginIndex: 0, kitIndex: 1 };
const ok = (r: Result<MidiConvertOutput>): MidiConvertOutput => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const run = (input: Uint8Array, format: 0 | 1): MidiConvertOutput => ok(convertMidi(mapData(), B, [T], input, 'song.mid', { format }));
const fail = (input: Uint8Array) => convertMidi(mapData(), B, [T], input, 'a.mid', { format: 1 });

describe('Web改善モード: EndOfTrack と ProgramChange', () => {
  const input = smf([[[0, meta(3, ascii('Drums'))], [0, on(36)], [480, off(36)]]]);

  it('Format 1: 全トラックの末尾に EndOfTrack、ProgramChange を追加しない', () => {
    const p = parse(run(input, 1).files[0]!.bytes);
    expect(p.format).toBe(1);
    expect(p.tracks.length).toBe(2);
    expect(lines(p.tracks[0]!)).toEqual(['0:ff03' + hex(ascii('Drums Converted')), '480:ff2f']);
    expect(lines(p.tracks[1]!)).toEqual(['0:ff03' + hex(ascii('T')), '0:993c64', '480:893c00', '480:ff2f']);
    expect(p.tracks.flat().some((e) => e.hex.startsWith('c9'))).toBe(false);
  });

  it('Format 0: 単一トラックで EndOfTrack があり、ProgramChange を追加しない', () => {
    const out = run(input, 0);
    expect(out.files.map((f) => f.path)).toEqual(['T.mid']);
    const p = parse(out.files[0]!.bytes);
    expect(p.format).toBe(0);
    expect(lines(p.tracks[0]!)).toEqual(['0:ff03' + hex(ascii('T')), '0:993c64', '480:893c00', '480:ff2f']);
  });

  it('標準の変換は EndOfTrack を出力し、ProgramChange を追加しない', () => {
    const r = ok(convertMidi(mapData(), B, [T], input, 'song.mid', { format: 0 }));
    expect(hex(r.files[0]!.bytes)).toContain('ff2f00');
    expect(hex(r.files[0]!.bytes)).not.toContain('c900');
  });

  it('入力にイベントが無い（EndOfTrackのみ）トラックでも構造が成立する', () => {
    const p = parse(run(smf([[]]), 1).files[0]!.bytes);
    expect(p.tracks.map((t) => t.map((e) => e.hex.slice(0, 4)))).toEqual([['ff2f'], ['ff03', 'ff2f']]);
  });

  it('全トラックの終端は入力の最も遅い終端に揃う（末尾の無音を保つ）', () => {
    const input2 = raw(1, 2, 480, [
      body([[0, on(36)], [100, off(36)], [1000, [0xff, 0x2f, 0]]]),
      body([[0, meta(3, ascii('x'))], [4000, [0xff, 0x2f, 0]]]),
    ]);
    const p = parse(run(input2, 1).files[0]!.bytes);
    expect(p.tracks.map((t) => t[t.length - 1]!.tick)).toEqual([4000, 4000]);
  });
});

describe('Web改善モード: 複数トラックの統合', () => {
  it('絶対時刻で統合する（後のトラックの時刻が前より戻る入力も変換できる）', () => {
    const input = smf([
      [[0, meta(3, ascii('Conductor'))], [0, meta(0x51, [0x07, 0xa1, 0x20])]],
      [[0, on(36)], [480, off(36)], [960, on(38)], [1440, off(38)]],
      [[240, on(42)], [300, off(42)]],
    ]);
    expect(fail(input).ok).toBe(true); // 3本目の時刻が戻る
    const p = parse(run(input, 1).files[0]!.bytes);
    expect(lines(p.tracks[1]!)).toEqual([
      '0:ff03' + hex(ascii('T')), '0:993c64', '240:993e64', '300:893e00', '480:893c00', '960:993d64', '1440:893d00', '1440:ff2f',
    ]);
    // システムトラックにはテンポが残る
    expect(lines(p.tracks[0]!)).toEqual(['0:ff03' + hex(ascii('Conductor Converted')), '0:ff5107a120', '1440:ff2f']);
  });

  it('同時刻は NoteOff が NoteOn より先（トラックをまたぐ場合）', () => {
    const input = smf([
      [[100, on(36)], [200, off(36)]],
      [[0, on(36)], [100, off(36)]],
    ]);
    const t = parse(run(input, 1).files[0]!.bytes).tracks[1]!;
    expect(lines(t).slice(1, 5)).toEqual(['0:993c64', '100:893c00', '100:993c64', '200:893c00']);
  });

  it('ベロシティ0の NoteOn は NoteOff として扱い、同時刻の NoteOn より先に出る', () => {
    const input = smf([
      [[100, on(36)], [200, off(36)]],
      [[0, on(36)], [100, on(36, 0)]],
    ]);
    const t = parse(run(input, 1).files[0]!.bytes).tracks[1]!;
    expect(lines(t).slice(1, 5)).toEqual(['0:993c64', '100:993c00', '100:993c64', '200:893c00']);
  });

  it('同一トラック内の順序は保つ（同時刻の NoteOn → NoteOff の長さ0ノート）', () => {
    const t = parse(run(smf([[[50, on(36)], [50, off(36)]]]), 1).files[0]!.bytes).tracks[1]!;
    expect(lines(t).slice(1, 3)).toEqual(['50:993c64', '50:893c00']);
  });

  it('Format 1: システムトラックの Track Name は1つに整理される（最初のものに Converted を付け、2つ目以降は除く）。Kit トラックには Kit 名', () => {
    const input = smf([
      [[0, meta(3, ascii('Conductor'))], [0, meta(0x51, [0x07, 0xa1, 0x20])]],
      [[0, meta(3, ascii('Drums'))], [0, on(36)], [10, off(36)]],
      [[0, meta(3, ascii('Bass'))], [5, meta(0x06, ascii('Verse'))]],
    ]);
    const p = parse(run(input, 1).files[0]!.bytes);
    expect(p.tracks[0]!.filter((e) => e.hex.startsWith('ff03')).map((e) => e.hex)).toEqual(['ff03' + hex(ascii('Conductor Converted'))]);
    expect(p.tracks[0]!.some((e) => e.hex === 'ff06' + hex(ascii('Verse')))).toBe(true); // マーカー等は残る
    expect(p.tracks.slice(1).map(nameOf)).toEqual(['T']);
    // Format 0 のファイルには入力の Track Name を出さず、Kit 名だけ
    const f0 = parse(run(input, 0).files[0]!.bytes).tracks[0]!;
    expect(f0.filter((e) => e.hex.startsWith('ff03')).map((e) => e.hex)).toEqual(['ff03' + hex(ascii('T'))]);
  });

  it('YAMAHA XF チャンク（XFIH / XFKM）は破棄される', () => {
    const t = body([[0, on(36)], [10, off(36)], [10, [0xff, 0x2f, 0]]]);
    const withXf = Uint8Array.from([...raw(1, 1, 480, [t]), ...ascii('XFIH'), ...be32(4), 1, 2, 3, 4, ...ascii('XFKM'), ...be32(2), 5, 6]);
    const out = run(withXf, 1).files[0]!.bytes;
    expect(hex(out)).not.toContain(hex(ascii('XFIH')));
    expect(hex(out)).not.toContain(hex(ascii('XFKM')));
    expect(parse(out).tracks.length).toBe(2);
  });

  it('Format 2 の入力はエラー', () => {
    const t = body([[0, on(36)], [10, [0xff, 0x2f, 0]]]);
    const r = fail(raw(2, 1, 480, [t]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unsupported-format');
  });

  it('変換先Pitchが0〜127の範囲外なら変換不可として #BaseKit に残す（下位8ビットへの切り詰めをしない）', () => {
    const r = parseQbd(JSON.stringify({
      Plugins: [{ ID: 1, Name: 'P', Kits: [
        { ID: 1, Name: 'B', Pitches: pitches([[36, 1], [38, 2]]) },
        { ID: 2, Name: 'T', Pitches: pitches([[128, 1], [300, 2]]) },
      ] }],
      Parts: [{ ID: 1, Name: 'K', Articulations: [{ ID: 1, Name: 'K', DrumMapOrder: 1 }, { ID: 2, Name: 'S', DrumMapOrder: 2 }] }],
    }));
    if (!r.ok) throw new Error(r.error.message);
    const out = ok(convertMidi(r.value, B, [T], smf([[[0, on(36)], [10, off(36)], [20, on(38)], [30, off(38)]]]), 'a.mid', { format: 1 }));
    const p = parse(out.files[0]!.bytes);
    expect(p.tracks.map(nameOf)).toEqual(['', '#B', 'T']);
    expect(p.tracks[1]!.filter((e) => /^[89]/.test(e.hex)).map((e) => e.hex)).toEqual(['992464', '892400', '992664', '892600']);
    expect(p.tracks[2]!.filter((e) => /^[89]/.test(e.hex))).toEqual([]);
  });

  it('同時刻のメタイベントはチャンネルイベントより先、同種ならトラック順', () => {
    const input = smf([
      [[0, on(36)]],
      [[0, meta(0x51, [0x07, 0xa1, 0x20])]],
      [[0, meta(0x58, [4, 2, 24, 8])]],
    ]);
    const sys = parse(run(input, 1).files[0]!.bytes).tracks[0]!;
    expect(lines(sys).slice(0, 2)).toEqual(['0:ff5107a120', '0:ff5804021808']);
  });

  it('mergeTracks: 各トラックの順序を保ち、時刻の昇順になる', () => {
    const ev = (abs: number, status: number, d: number[]): WebEvent => ({ abs, msg: { kind: 'channel', status, data: d } });
    const a = { end: 10, events: [ev(0, 0x99, [36, 100]), ev(5, 0x99, [38, 100])] };
    const b = { end: 10, events: [ev(5, 0x89, [36, 0]), ev(7, 0x99, [40, 100])] };
    const m = mergeTracks([a, b]);
    expect(m.map((e) => e.abs)).toEqual([0, 5, 5, 7]);
    expect(m[1]!.msg).toMatchObject({ status: 0x89 }); // 同時刻は NoteOff が先
  });
});

describe('Web改善モード: Format 0 でもシステムイベントを保持する', () => {
  const sys = [
    [0, meta(3, ascii('Conductor'))],
    [0, meta(0x51, [0x07, 0xa1, 0x20])],
    [0, meta(0x58, [3, 3, 24, 8])],
    [0, meta(0x59, [0xfd, 1])],
    [0, [0xf0, 0x04, 0x7e, 0x7f, 0x09, 0xf7]],
    [960, meta(0x51, [0x05, 0x00, 0x00])],
  ] as Ev[];
  const input = smf([sys, [[0, on(36)], [480, off(36)], [960, on(46)], [1000, off(46)]]]);

  it('テンポ・拍子・調号・SysExを時刻どおりに出力し、トラック名はKit名に置き換える', () => {
    const out = run(input, 0);
    // 変換できないノート(46)があるので #B も出る
    expect(out.files.map((f) => f.path)).toEqual(['#B.mid', 'T.mid']);
    const t = parse(out.files[1]!.bytes).tracks[0]!;
    expect(lines(t)).toEqual([
      '0:ff0354',
      '0:ff5107a120',
      '0:ff5803031808',
      '0:ff59fd01',
      '0:f07e7f09f7',
      '0:993c64',
      '480:893c00',
      '960:ff51050000',
      '1000:ff2f',
    ]);
  });

  it('#B ファイルにも同じシステムイベントが入る', () => {
    const t = parse(run(input, 0).files[0]!.bytes).tracks[0]!;
    expect(nameOf(t)).toBe('#B');
    expect(t.filter((e) => e.hex.startsWith('ff51')).length).toBe(2);
    expect(t.filter((e) => e.hex.startsWith('99')).map((e) => e.hex)).toEqual(['992e64']);
  });
});

describe('Web改善モード: イベント情報の保持（非可逆変換をしない）', () => {
  const sjis = [0x83, 0x65, 0x83, 0x58, 0x83, 0x67]; // 「テスト」(Shift-JIS)
  // [入力イベント, 出力に期待するhex（メタは ff + type + データ、SysExは ステータス + データ）]
  const cases: [Ev, string][] = [
    [[0, meta(0x00, [0x00, 0x07])], 'ff000007'], // SequenceNumber
    [[0, meta(0x01, sjis)], 'ff01' + hex(sjis)], // Text（Shift-JISのまま）
    [[0, meta(0x51, [0x07, 0xa1, 0x21])], 'ff5107a121'], // 500001µs（BPMのfloat32化で値が変わり得る）
    [[0, meta(0x51, [0x01, 0xe2, 0x40])], 'ff5101e240'], // 123456µs
    [[0, meta(0x54, [0x21, 0x22, 0x23, 0x24, 0x25])], 'ff542122232425'],
    [[0, meta(0x58, [6, 3, 36, 16])], 'ff5806032410'], // 6/8、CC=36、BB=16
    [[0, meta(0x59, [0x03, 0x01])], 'ff590301'], // 調号 #3 マイナー
    [[0, meta(0x59, [0xf9, 0x00])], 'ff59f900'], // 調号 b7 メジャー
    [[0, meta(0x20, [0x09])], 'ff2009'], // MIDI Channel Prefix
    [[0, meta(0x21, [0x02])], 'ff2102'], // Port
    [[0, meta(0x10, [0xaa, 0xbb])], 'ff10aabb'], // 未定義のメタイベント
    [[0, meta(0x7f, [0x00, 0x01, 0x02])], 'ff7f000102'],
    [[0, [0xf0, 0x03, 0x41, 0x10, 0xf7]], 'f04110f7'], // F0
    [[0, [0xf7, 0x02, 0x01, 0x02]], 'f70102'], // F7（続きパケット）
  ];
  const input = smf([cases.map((c) => c[0]), [[0, on(36)], [480, off(36)]]]);

  it('Format 1: システムトラックにバイト列を変えずに保持される', () => {
    const sys = parse(run(input, 1).files[0]!.bytes).tracks[0]!.map((e) => e.hex);
    for (const [, expected] of cases) expect(sys, `保持: ${expected}`).toContain(expected);
    expect(sys.filter((h) => h.startsWith('ff51')).length).toBe(2);
  });

  it('Format 0: 同じイベントを保持する', () => {
    const t = parse(run(input, 0).files[0]!.bytes).tracks[0]!.map((e) => e.hex);
    for (const [, expected] of cases) expect(t, `保持: ${expected}`).toContain(expected);
  });

  it('拍子の CC/BB を保持する', () => {
    const small = smf([[[0, meta(0x58, [6, 3, 36, 16])]], [[0, on(36)], [480, off(36)]]]);
    expect(hex(run(small, 1).files[0]!.bytes)).toContain('ff5804060324' + '10');
  });
});

describe('Web改善モード: Division と Format', () => {
  it('Division（SMPTE形式を含む）はヘッダーの値をそのまま出力する', () => {
    for (const div of [96, 480, 960, 0x7fff, 0xe728]) {
      const input = raw(0, 1, div, [body([[0, on(36)], [10, off(36)], [10, [0xff, 0x2f, 0]]])]);
      for (const f of [0, 1] as const) {
        const b = run(input, f).files[0]!.bytes;
        expect(hex(b.slice(12, 14)), `division ${div} Format ${f}`).toBe(div.toString(16).padStart(4, '0'));
      }
    }
  });

  it('Format 1 のヘッダーはトラック数と一致し、#BaseKit は未変換ノートがあるときだけ付く', () => {
    const none = parse(run(smf([[[0, on(36)], [10, off(36)]]]), 1).files[0]!.bytes);
    expect([none.format, none.tracks.length]).toEqual([1, 2]);
    const some = parse(run(smf([[[0, on(36)], [10, off(36)], [20, on(99)], [30, off(99)]]]), 1).files[0]!.bytes);
    expect([some.format, some.tracks.length]).toEqual([1, 3]);
    expect(some.tracks.map(nameOf)).toEqual(['', '#B', 'T']);
  });

  it('NoteOn が無い（ベロシティ0のみ）の #BaseKit は出力しない', () => {
    const input = smf([[[0, on(99, 0)], [10, off(99)]]]);
    expect(parse(run(input, 1).files[0]!.bytes).tracks.length).toBe(2);
  });

  it('Format 0 のファイル名と ZIP 名は互換モードと同じ規則', () => {
    const r = run(smf([[[0, on(36)], [10, off(36)], [20, on(99)], [30, off(99)]]]), 0);
    expect(r.files.map((f) => f.path)).toEqual(['#B.mid', 'T.mid']);
    expect(r.archiveName).toBe('song Converted.zip');
    expect(run(smf([[[0, on(36)]]]), 1).files.map((f) => f.path)).toEqual(['song Converted.mid']);
  });

  it('入力Format 0 の1トラック（チャンネル・メタ混在）でも変換できる', () => {
    const input = smf([[[0, meta(0x51, [0x07, 0xa1, 0x20])], [0, on(36)], [10, off(36)]]]);
    const f0 = parse(run(input, 0).files[0]!.bytes).tracks[0]!;
    expect(lines(f0)).toEqual(['0:ff03' + hex(ascii('T')), '0:ff5107a120', '0:993c64', '10:893c00', '10:ff2f']);
  });
});

describe('Web改善モード: NoteOn/NoteOff の対応関係（乱数による性質テスト）', () => {
  // 乱数ノートを3トラックに分けて入力し、出力が「入力ノートの Pitch 変換結果」と一致することを確認する
  const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const MAP: Record<number, number> = { 36: 60, 38: 61, 40: 61, 41: 61, 42: 62 }; // それ以外は未変換 → #B

  it('全トラック・全Pitchで NoteOn/NoteOff の個数と時刻の対応が保たれる', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const notes = Array.from({ length: 24 }, () => ({
        p: [36, 38, 40, 41, 42, 46, 99][Math.floor(r() * 7)]!,
        start: Math.floor(r() * 20) * 10,
        len: 1 + Math.floor(r() * 5) * 10,
        trk: Math.floor(r() * 3),
        ch: 1 + Math.floor(r() * 2) * 9, // 1 または 10
      }));
      const tracks: Ev[][] = [[], [], []];
      for (const n of notes) {
        tracks[n.trk]!.push([n.start, on(n.p, 100, n.ch)], [n.start + n.len, off(n.p, n.ch)]);
      }
      // トラック内は (時刻, NoteOff先) の順に並べる
      for (const t of tracks) t.sort((a, b) => a[0] - b[0] || ((a[1][0]! & 0xf0) === 0x80 ? -1 : 1) - ((b[1][0]! & 0xf0) === 0x80 ? -1 : 1));
      const input = smf(tracks);
      const expectFor = (kit: 'T' | '#B'): string[] =>
        notes
          .flatMap((n) => {
            const dst = MAP[n.p];
            if (kit === 'T' ? dst === undefined : dst !== undefined) return [];
            const p = kit === 'T' ? dst! : n.p;
            return [
              `${n.start}:${hex(on(p, 100, n.ch))}`, `${n.start + n.len}:${hex(off(p, n.ch))}`,
            ];
          })
          .sort();
      const got = (t: Parsed['tracks'][number]): string[] =>
        t.filter((e) => /^[89]/.test(e.hex)).map((e) => `${e.tick}:${e.hex}`).sort();
      const p1 = parse(run(input, 1).files[0]!.bytes);
      const names = p1.tracks.map(nameOf);
      const tTrack = p1.tracks[names.indexOf('T')]!;
      expect(got(tTrack), `seed ${seed} T`).toEqual(expectFor('T'));
      if (names.includes('#B')) expect(got(p1.tracks[names.indexOf('#B')]!), `seed ${seed} #B`).toEqual(expectFor('#B'));
      else expect(expectFor('#B'), `seed ${seed}`).toEqual([]);
      // 時刻の昇順で、同時刻では NoteOff が NoteOn より先
      for (const t of p1.tracks) {
        for (let i = 1; i < t.length; i++) expect(t[i]!.tick).toBeGreaterThanOrEqual(t[i - 1]!.tick);
        for (let i = 1; i < t.length; i++) {
          if (t[i]!.tick === t[i - 1]!.tick && /^9/.test(t[i - 1]!.hex) && /^8/.test(t[i]!.hex)) {
            throw new Error(`seed ${seed}: 同時刻で NoteOn が NoteOff より先 @${t[i]!.tick}`);
          }
        }
      }
      // Format 0 の出力も同じ内容
      const f0 = run(input, 0).files;
      const t0 = f0.find((f) => f.path === 'T.mid')!;
      expect(got(parse(t0.bytes).tracks[0]!), `seed ${seed} F0`).toEqual(expectFor('T'));
    }
  });
});

describe('Web改善モード: 複数 Target Kit の順序（Plugin.DisplayOrder → Kit.DisplayOrder の順）', () => {
  it('Plugin / Kit の表示順で出力される', () => {
    const out = ok(convertMidi(mapData(), B, [T, B], smf([[[0, on(36)], [10, off(36)]]]), 'a.mid', { format: 0 }));
    expect(out.files.map((f) => f.path)).toEqual(['B.mid', 'T.mid']);
  });
});

// ---- 不正・特殊なSMF ----
describe('Web版SMF読み込み: 不正なSMFはエラー', () => {
  const t1 = body([[0, on(36)], [10, off(36)], [10, [0xff, 0x2f, 0]]]);
  const code = (bytes: Uint8Array): string => {
    try {
      parseSmf(bytes);
    } catch (e) {
      if (e instanceof SmfError) return e.code;
      throw e;
    }
    return 'ok';
  };

  it.each([
    ['空ファイル', new Uint8Array(0), 'bad-header'],
    ['MThd でない', Uint8Array.from([...ascii('MThx'), ...raw(0, 1, 480, [t1]).slice(4)]), 'bad-header'],
    ['ヘッダー長が6未満', raw(0, 1, 480, [t1], 3), 'bad-header'],
    ['ヘッダー長がファイルを超える', raw(0, 1, 480, [t1], 1000), 'bad-header'],
    ['Format 2（未対応）', raw(2, 1, 480, [t1]), 'unsupported-format'],
    ['Format が範囲外', raw(5, 1, 480, [t1]), 'bad-format'],
    ['Division が 0', raw(0, 1, 0, [t1]), 'bad-division'],
    ['トラック数が 0', raw(0, 0, 480, []), 'no-tracks'],
    ['宣言したトラック数より少ない', raw(1, 2, 480, [t1]), 'truncated'],
    ['チャンク長がファイルを超える', Uint8Array.from([...raw(0, 1, 480, [t1]).slice(0, 18), 0x7f, ...raw(0, 1, 480, [t1]).slice(19)]), 'truncated'],
    ['イベントの途中でチャンクが終わる', raw(0, 1, 480, [[0x00, 0x99, 0x24]]), 'truncated'],
    ['メタの長さがチャンクを超える', raw(0, 1, 480, [[0x00, 0xff, 0x01, 0x10, 0x41]]), 'truncated'],
    ['SysExの長さがチャンクを超える', raw(0, 1, 480, [[0x00, 0xf0, 0x10, 0x41]]), 'truncated'],
    ['ステータス無しの最初のイベント', raw(0, 1, 480, [[0x00, 0x24, 0x64]]), 'bad-running-status'],
    ['メタの後のランニングステータス', raw(0, 1, 480, [[0, 0x99, 0x24, 0x64, 0, 0xff, 0x01, 0x00, 0, 0x24, 0x64]]), 'bad-running-status'],
    ['SysExの後のランニングステータス', raw(0, 1, 480, [[0, 0x99, 0x24, 0x64, 0, 0xf7, 0x00, 0, 0x24, 0x64]]), 'bad-running-status'],
    ['データバイトの最上位ビット', raw(0, 1, 480, [[0x00, 0x99, 0x24, 0x90]]), 'bad-data-byte'],
    ['可変長数が5バイト', raw(0, 1, 480, [[0x80, 0x80, 0x80, 0x80, 0x00, 0x99, 0x24, 0x64]]), 'bad-varlen'],
    ['SMFに含められないステータス', raw(0, 1, 480, [[0x00, 0xf1, 0x00]]), 'unsupported-system'],
  ] as [string, Uint8Array, string][])('%s', (_name, bytes, expected) => {
    expect(code(bytes)).toBe(expected);
    const r = fail(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(expected);
  });

  it('2本目のトラックが壊れている入力: トラックを黙って捨てずエラーにする', () => {
    const input = raw(1, 2, 480, [t1, [0x00, 0x99, 0x24]]);
    const r = fail(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('truncated');
  });
});

describe('Web版SMF読み込み: 仕様上許される形式', () => {
  it('EndOfTrack が無いトラックを受け付け、終端は最後のイベントの時刻', () => {
    const m = parseSmf(raw(0, 1, 480, [body([[0, on(36)], [30, off(36)]])]));
    expect(m.tracks[0]!.end).toBe(30);
    expect(m.tracks[0]!.events.length).toBe(2);
  });

  it('最初の EndOfTrack で終わり、以降のバイトは無視する', () => {
    const m = parseSmf(raw(0, 1, 480, [[...body([[0, on(36)], [10, [0xff, 0x2f, 0]]]), 0x05, 0x99, 0x24, 0x64]]));
    expect(m.tracks[0]!.events.length).toBe(1);
    expect(m.tracks[0]!.end).toBe(10);
  });

  it('ランニングステータスを展開する', () => {
    const m = parseSmf(raw(0, 1, 480, [[0, 0x99, 0x24, 0x64, 0x10, 0x24, 0x00, 0x10, 0x26, 0x50, 0, 0xff, 0x2f, 0]]));
    expect(m.tracks[0]!.events.map((e) => e.msg)).toEqual([
      { kind: 'channel', status: 0x99, data: [0x24, 0x64] },
      { kind: 'channel', status: 0x99, data: [0x24, 0x00] },
      { kind: 'channel', status: 0x99, data: [0x26, 0x50] },
    ]);
    expect(m.tracks[0]!.events.map((e) => e.abs)).toEqual([0, 16, 32]);
  });

  it('未知のチャンクを読み飛ばし、最後のトラックの後ろの余分なバイトを無視する', () => {
    const t = body([[0, on(36)], [10, [0xff, 0x2f, 0]]]);
    const bytes = Uint8Array.from([
      ...raw(1, 2, 480, [t]), ...ascii('XFIH'), ...be32(3), 1, 2, 3, ...ascii('MTrk'), ...be32(t.length), ...t, 0xde, 0xad,
    ]);
    expect(parseSmf(bytes).tracks.length).toBe(2);
  });

  it('未定義のメタイベントとSysExをそのまま持つ', () => {
    const m = parseSmf(raw(0, 1, 480, [body([[0, meta(0x10, [1, 2])], [0, [0xf0, 0x02, 0x7d, 0xf7]], [0, [0xff, 0x2f, 0]]])]));
    expect(m.tracks[0]!.events.map((e) => e.msg)).toEqual([
      { kind: 'meta', type: 0x10, data: Uint8Array.from([1, 2]) },
      { kind: 'sysex', status: 0xf0, data: Uint8Array.from([0x7d, 0xf7]) },
    ]);
  });
});

describe('Web版SMF書き出し', () => {
  it('parseSmf → serializeSmf → parseSmf でイベントが変わらない', () => {
    const input = smf([
      [[0, meta(0x51, [0x07, 0xa1, 0x21])], [0, [0xf0, 0x02, 0x7d, 0xf7]], [0, meta(0x01, [0x83, 0x65])]],
      [[0, on(36)], [480, off(36)], [500, [0xc9, 0x05]], [500, [0xe9, 0x00, 0x40]]],
    ]);
    const a = parseSmf(input);
    const b = parseSmf(serializeSmf(a));
    expect(b).toEqual(a);
  });

  it('デルタタイムの範囲外・時刻が戻るイベント・トラック数の不整合はエラー', () => {
    const e = (f: () => unknown): string => {
      try { f(); } catch (x) { return (x as SmfError).code; }
      return 'ok';
    };
    expect(e(() => serializeSmf({ format: 1, division: 480, tracks: [{ end: 0x10000000, events: [] }] }))).toBe('bad-delta');
    const ev = (abs: number): WebEvent => ({ abs, msg: { kind: 'meta', type: 1, data: new Uint8Array() } });
    expect(e(() => serializeSmf({ format: 1, division: 480, tracks: [{ end: 9, events: [ev(5), ev(2)] }] }))).toBe('event-order');
    expect(e(() => serializeSmf({ format: 1, division: 480, tracks: [{ end: 1, events: [ev(5)] }] }))).toBe('event-order');
    expect(e(() => serializeSmf({ format: 0, division: 480, tracks: [{ end: 0, events: [] }, { end: 0, events: [] }] }))).toBe('bad-format');
    expect(e(() => serializeSmf({ format: 1, division: 480, tracks: [] }))).toBe('no-tracks');
  });

  it('最大の可変長数（0x0FFFFFFF）まで書ける', () => {
    const bytes = serializeSmf({ format: 0, division: 480, tracks: [{ end: 0x0fffffff, events: [] }] });
    expect(hex(bytes.slice(-7))).toBe('ffffff7fff2f00');
  });

  it('トラック名はUTF-8で出力される（Kit名が日本語でも）', () => {
    const r = parseQbd(JSON.stringify({
      Plugins: [{ ID: 1, Name: 'P', Kits: [{ ID: 1, Name: 'Bd', Pitches: pitches([[36, 1]]) }, { ID: 2, Name: 'キット', Pitches: pitches([[60, 1]]) }] }],
      Parts: [{ ID: 1, Name: 'K', Articulations: [{ ID: 1, Name: 'K', DrumMapOrder: 1 }] }],
    }));
    if (!r.ok) throw new Error('parse');
    const out = ok(convertMidi(r.value, B, [T], smf([[[0, on(36)], [10, off(36)]]]), 'a.mid', { format: 1 }));
    expect(nameOf(parse(out.files[0]!.bytes).tracks[1]!)).toBe('キット');
    expect(hex(utf8Bytes('キット'))).toBe(hex(Buffer.from('キット')));
  });
});
