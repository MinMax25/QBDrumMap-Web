// MIDI変換テスト用の入力SMFの生成（決定的な疑似乱数）。Web Coreの書き出しを使わず、生のバイト列を直接組み立てる。
// 同じ入力を Windows版C#の変換処理（ハーネス）と Web Core の変換へ与え、出力ファイルのバイト列を比較する。

export interface MidiInput {
  case: number;
  variant: string;
  fileName: string;
  format: 0 | 1;
  b64: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vl = (n: number): number[] => {
  const o = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) {
    o.unshift((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  return o;
};
const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];
const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

interface Ev { t: number; b: number[]; chan?: number }

const ev = {
  on: (t: number, ch: number, p: number, v: number): Ev => ({ t, b: [0x90 | (ch - 1), p, v], chan: 0x90 | (ch - 1) }),
  off: (t: number, ch: number, p: number, v = 0): Ev => ({ t, b: [0x80 | (ch - 1), p, v], chan: 0x80 | (ch - 1) }),
  cc: (t: number, ch: number, c: number, v: number): Ev => ({ t, b: [0xb0 | (ch - 1), c, v], chan: 0xb0 | (ch - 1) }),
  pc: (t: number, ch: number, p: number): Ev => ({ t, b: [0xc0 | (ch - 1), p], chan: 0xc0 | (ch - 1) }),
  at: (t: number, ch: number, v: number): Ev => ({ t, b: [0xd0 | (ch - 1), v], chan: 0xd0 | (ch - 1) }),
  poly: (t: number, ch: number, p: number, v: number): Ev => ({ t, b: [0xa0 | (ch - 1), p, v], chan: 0xa0 | (ch - 1) }),
  pb: (t: number, ch: number, lsb: number, msb: number): Ev => ({ t, b: [0xe0 | (ch - 1), lsb, msb], chan: 0xe0 | (ch - 1) }),
  meta: (t: number, type: number, data: number[]): Ev => ({ t, b: [0xff, type, ...vl(data.length), ...data] }),
  raw: (t: number, b: number[]): Ev => ({ t, b }),
  name: (t: number, s: string): Ev => ev.meta(t, 3, utf8(s)),
  tempo: (t: number, us: number): Ev => ({ t, b: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] }),
  timesig: (t: number, nn: number, dd: number, cc = 24, bb = 8): Ev => ({ t, b: [0xff, 0x58, 0x04, nn, dd, cc, bb] }),
  keysig: (t: number, sf: number, mi: number): Ev => ({ t, b: [0xff, 0x59, 0x02, sf & 0xff, mi] }),
  eot: (t: number): Ev => ({ t, b: [0xff, 0x2f, 0x00] }),
  sysex: (t: number, status: number, data: number[]): Ev => ({ t, b: [status, ...vl(data.length), ...data] }),
};

/** イベント列（時刻順に並べ替え）→ MTrk本体。running=true なら同じステータスが続く場合にステータスバイトを省略する */
function body(events: Ev[], running: boolean, rnd: () => number): number[] {
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  const out: number[] = [];
  let tick = 0;
  let last = -1;
  for (const e of sorted) {
    out.push(...vl(e.t - tick));
    tick = e.t;
    if (running && e.chan !== undefined && e.chan === last && rnd() < 0.7) out.push(...e.b.slice(1));
    else out.push(...e.b);
    last = e.chan ?? -1;
  }
  return out;
}

const chunk = (id: string, b: number[]): number[] => [...[...id].map((c) => c.charCodeAt(0)), ...be32(b.length), ...b];
const header = (format: number, ntrk: number, division: number, id = 'MThd'): number[] =>
  [...chunk(id, [...be16(format), ...be16(ntrk), ...be16(division)])];
const file = (format: number, division: number, tracks: number[][]): number[] =>
  [...header(format, tracks.length, division), ...tracks.flatMap((t) => chunk('MTrk', t))];

const b64 = (b: number[]): string => Buffer.from(Uint8Array.from(b)).toString('base64');

type Maker = (pal: number[], rnd: () => number) => number[];

/** ドラムのノート列（ch=10 既定）。pal はKitで使われているPitchと、そうでないPitch */
function notes(pal: number[], rnd: () => number, n: number, opt: { ch?: number; vel0Off?: boolean; start?: number } = {}): Ev[] {
  const ch = opt.ch ?? 10;
  const out: Ev[] = [];
  let t = opt.start ?? 0;
  for (let i = 0; i < n; i++) {
    t += 1 + Math.floor(rnd() * 240);
    const p = pal[Math.floor(rnd() * pal.length)]!;
    const v = 1 + Math.floor(rnd() * 126);
    out.push(ev.on(t, ch, p, v));
    const d = 1 + Math.floor(rnd() * 60);
    out.push(opt.vel0Off ? ev.on(t + d, ch, p, 0) : ev.off(t + d, ch, p, rnd() < 0.5 ? 0 : 64));
    if (rnd() < 0.15) out.push(ev.cc(t, ch, 11, Math.floor(rnd() * 128)));
  }
  return out;
}
const lastTick = (e: Ev[]): number => e.reduce((m, x) => Math.max(m, x.t), 0);

const VARIANTS: Record<string, Maker> = {
  mono10: (pal, r) => {
    const n = notes(pal, r, 30);
    return file(0, 480, [body([ev.name(0, 'Drum Track'), ev.tempo(0, 500000), ev.timesig(0, 4, 2), ev.keysig(0, 0, 0), ...n, ev.eot(lastTick(n) + 10)], false, r)]);
  },
  running: (pal, r) => {
    const n = notes(pal, r, 40, { vel0Off: true });
    return file(0, 480, [body([ev.name(0, 'RS'), ...n, ev.eot(lastTick(n))], true, r)]);
  },
  f1cond: (pal, r) => {
    const n = notes(pal, r, 25);
    return file(1, 480, [
      body([ev.name(0, 'Song'), ev.tempo(0, 428571), ev.timesig(0, 3, 2), ev.eot(0)], false, r),
      body([ev.name(0, 'Drums'), ...n, ev.eot(lastTick(n))], false, r),
    ]);
  },
  f1late: (pal, r) => {
    const n = notes(pal, r, 10);
    return file(1, 480, [
      body([ev.name(0, 'Cond'), ev.tempo(0, 500000), ev.eot(960)], false, r),
      body([ev.name(0, 'Drums'), ...n, ev.eot(lastTick(n))], false, r),
    ]);
  },
  f1twoNoteTracks: (pal, r) => {
    const a = notes(pal, r, 8);
    const b = notes(pal, r, 8, { start: lastTick(a) + 100 });
    return file(1, 480, [body([ev.name(0, 'A'), ...a, ev.eot(lastTick(a))], false, r), body([...b, ev.eot(lastTick(b))], false, r)]);
  },
  f1overlap: (pal, r) => {
    const a = notes(pal, r, 8);
    const b = notes(pal, r, 8);
    return file(1, 480, [body([...a, ev.eot(lastTick(a))], false, r), body([...b, ev.eot(lastTick(b))], false, r)]);
  },
  sjis: (pal, r) => {
    const n = notes(pal, r, 12);
    return file(0, 480, [body([
      ev.meta(0, 3, [0x83, 0x68, 0x83, 0x89, 0x83, 0x80]), // SJIS「ドラム」
      ev.meta(0, 5, utf8('歌詞')), ev.meta(0, 1, [0xff, 0xfe, 0x80, 0x41]), ev.meta(0, 4, [0x81, 0x40, 0xe0, 0xa1]),
      ev.meta(0, 2, [0xc3, 0x28]), ...n, ev.eot(lastTick(n))], false, r)]);
  },
  channels: (pal, r) => {
    const n = notes(pal, r, 10);
    const m = notes(pal, r, 6, { ch: 1 });
    const x = [ev.pc(0, 1, 5), ev.pb(10, 1, 0x7f, 0x7f), ev.pb(20, 10, 3, 4), ev.at(30, 10, 99), ev.poly(40, 10, pal[0]!, 77), ev.cc(50, 10, 64, 127)];
    return file(0, 480, [body([...n, ...m, ...x, ev.eot(lastTick(n))], false, r)]);
  },
  metaZoo: (pal, r) => {
    const n = notes(pal, r, 10);
    const t = [
      ev.meta(0, 0, [0x00, 0x07]), ev.raw(0, [0xff, 0x00, 0x02, 0x00, 0x07]),
      ev.raw(0, [0xff, 0x54, 0x05, 1, 2, 3, 4, 5]), ev.keysig(0, -7, 0), ev.keysig(0, 3, 1), ev.keysig(0, 7, 0), ev.keysig(0, -7, 1),
      ev.timesig(0, 3, 3, 12, 4), ev.tempo(0, 666667), ev.tempo(0, 1000000), ev.tempo(0, 10000000), ev.tempo(0, 1),
      ev.meta(0, 1, utf8('t1')), ev.meta(0, 2, utf8('c')), ev.meta(0, 4, utf8('i')), ev.meta(0, 5, utf8('l')), ev.meta(0, 6, utf8('m')),
      ev.meta(0, 7, utf8('q')), ev.meta(0, 8, utf8('p')), ev.meta(0, 9, utf8('d')), ev.meta(0, 0x20, [3]), ev.raw(0, [0xff, 0x21, 0x01, 2]),
      ev.meta(0, 0x7f, [0x43, 0x7b, 0x02, 0x13]), ev.meta(0, 0x7f, [1, 2, 3]),
      ev.sysex(0, 0xf0, [0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7]), ev.sysex(0, 0xf7, [1, 2, 3]),
    ];
    return file(0, 480, [body([...t, ...n, ev.eot(lastTick(n))], false, r)]);
  },
  // テンポ値はfloat32(BPM)を経由するため、書き出しで1µsずれる値がある（約6%）
  tempoSweep: (pal, r) => {
    const n = notes(pal, r, 8);
    const t = Array.from({ length: 40 }, (_, i) => ev.tempo(i * 10, 200000 + Math.floor(r() * 1300000)));
    return file(1, 480, [body([ev.name(0, 'T'), ...t, ev.eot(400)], false, r), body([...n, ev.eot(lastTick(n))], false, r)].map((x, i) => (i === 1 ? body([...n.map((e) => ({ ...e, t: e.t + 400 })), ev.eot(lastTick(n) + 400)], false, r) : x)));
  },
  zeroTempo: (pal, r) => file(0, 480, [body([ev.name(0, 'x'), ev.tempo(0, 0), ...notes(pal, r, 5)], false, r)]),
  zeroTimeSig: (pal, r) => file(0, 480, [body([ev.name(0, 'x'), ev.timesig(0, 0, 2), ...notes(pal, r, 5)], false, r)]),
  badKey: (pal, r) => file(0, 480, [body([ev.name(0, 'x'), ev.keysig(0, 9, 0), ...notes(pal, r, 5)], false, r)]),
  unknownMeta: (pal, r) => file(1, 480, [body([ev.name(0, 'ok'), ev.eot(0)], false, r), body([ev.name(0, 'x'), ev.meta(0, 0x0a, [1]), ...notes(pal, r, 5)], false, r)]),
  realtime: (pal, r) => file(0, 480, [body([ev.name(0, 'x'), ev.raw(5, [0xf8]), ...notes(pal, r, 5)], false, r)]),
  truncated: (pal, r) => file(0, 480, [body([ev.name(0, 'x'), ...notes(pal, r, 20)], false, r)]).slice(0, 80),
  badHeader: (pal, r) => { const f = file(0, 480, [body(notes(pal, r, 5), false, r)]); f[3] = 0x78; return f; },
  negLength: (pal, r) => {
    const f = file(0, 480, [body([ev.name(0, 'x'), ...notes(pal, r, 8)], false, r)]);
    f[18] = 0xff; f[19] = 0xff; f[20] = 0xff; f[21] = 0xff;
    return f;
  },
  shortLength: (pal, r) => {
    const f = file(0, 480, [body([ev.name(0, 'x'), ...notes(pal, r, 8)], false, r)]);
    f[20] = 0; f[21] = 12;
    return f;
  },
  bigDelta: (pal, r) => file(0, 480, [body([ev.name(0, 'x'), ev.on(200000, 10, pal[0]!, 90), ev.off(200003, 10, pal[0]!), ev.on(270003, 10, pal[1 % pal.length]!, 80), ev.off(40000000, 10, pal[1 % pal.length]!)], false, r)]),
  pc10: (pal, r) => { const n = notes(pal, r, 10); return file(0, 480, [body([ev.pc(0, 10, 25), ...n, ev.eot(lastTick(n))], false, r)]); },
  division96: (pal, r) => { const n = notes(pal, r, 10); return file(0, 96, [body([ev.name(0, 'd'), ...n, ev.eot(lastTick(n))], false, r)]); },
  divisionSmpte: (pal, r) => { const n = notes(pal, r, 10); return file(0, 0xe728, [body([ev.name(0, 'd'), ...n, ev.eot(lastTick(n))], false, r)]); },
  unmapped: (pal, r) => { const n = notes([120, 121, 122, 33], r, 12); return file(0, 480, [body([ev.name(0, 'u'), ...n, ev.eot(lastTick(n))], false, r)]); },
  noNotes: (_pal, r) => file(0, 480, [body([ev.name(0, 'empty'), ev.tempo(0, 500000), ev.eot(0)], false, r)]),
  onlyCc: (_pal, r) => file(0, 480, [body([ev.cc(0, 10, 7, 100), ev.cc(10, 10, 10, 64), ev.eot(10)], false, r)]),
  noTracks: () => header(1, 0, 480),
  extraHeader: (pal, r) => {
    const n = notes(pal, r, 6);
    return [...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 8, 0, 0, 0, 1, 1, 0xe0, 0xaa, 0xbb], ...chunk('MTrk', body([ev.name(0, 'h'), ...n], false, r))];
  },
};

const NAMES = Object.keys(VARIANTS);
const UNSAFE = /["<>|:*?\\/\u0000-\u001f]/;

/** MIDI変換に使えるケース（Windows版でもファイル名に使える一意なKit名）だけを対象にする */
function usable(c: unknown): { pal: number[] } | undefined {
  const plugin = (c as { Plugins: { Kits: { Name: string; Pitches: { Pitch: number }[] }[] }[] }).Plugins[0]!;
  const names = plugin.Kits.map((k) => k.Name);
  const lower = names.map((n) => n.toLowerCase());
  if (names.some((n) => n === '' || UNSAFE.test(n) || /[. ]$/.test(n))) return undefined;
  if (new Set(lower).size !== lower.length || lower.includes(`#${names[0]}`.toLowerCase())) return undefined;
  const pal = plugin.Kits[0]!.Pitches.map((p) => p.Pitch).filter((p) => p >= 0 && p <= 127);
  return { pal: pal.length ? pal : [36, 38] };
}

export function generateMidiInputs(cases: unknown[]): MidiInput[] {
  const out: MidiInput[] = [];
  cases.forEach((c, ci) => {
    const u = usable(c);
    if (!u) return;
    const r0 = mulberry32(777000 + ci);
    const chosen = new Set<string>(['mono10']);
    while (chosen.size < 5) chosen.add(NAMES[Math.floor(r0() * NAMES.length)]!);
    for (const v of chosen) {
      for (const format of [0, 1] as const) {
        const r = mulberry32(555000 + ci * 100 + NAMES.indexOf(v));
        const pal = [...u.pal, 1 + Math.floor(r() * 120), 1 + Math.floor(r() * 120)];
        out.push({ case: ci, variant: v, fileName: 'song.mid', format, b64: b64(VARIANTS[v]!(pal, r)) });
      }
    }
  });
  return out;
}

export const MIDI_VARIANT_NAMES = NAMES;
