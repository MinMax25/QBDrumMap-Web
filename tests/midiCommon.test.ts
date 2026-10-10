import { describe, expect, it } from 'vitest';
import {
  convertMidi, dedupePaths, mapPitch, getArticulationMap, parseQbd, toSafeFileName, utf8Bytes,
  type KitRef, type MapData, type MidiConvertOutput, type Result,
} from '../src/core';

// MIDI変換の共通規則（Pitchの割り当て・出力Kitの順序・ファイル名）。旧 midi.test.ts の Windows 互換モード専用以外のテストを標準の変換に移した。
// ---- テスト用の最小SMFビルダー／パーサ ----
const vl = (n: number): number[] => {
  const o = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) o.unshift((n & 0x7f) | 0x80);
  return o;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const metaText = (type: number, bytes: number[]): number[] => [0xff, type, ...vl(bytes.length), ...bytes];
type Ev = [tick: number, bytes: number[]];
function smf(tracks: Ev[][], division = 480): Uint8Array {
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, tracks.length === 1 ? 0 : 1, 0, tracks.length, division >> 8, division & 255];
  for (const t of tracks) {
    let last = 0;
    const body = t.flatMap(([tick, b]) => {
      const d = vl(tick - last);
      last = tick;
      return [...d, ...b];
    });
    out.push(0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body);
  }
  return Uint8Array.from(out);
}
const on = (p: number, v = 100, ch = 10): number[] => [0x90 | (ch - 1), p, v];
const off = (p: number, ch = 10): number[] => [0x80 | (ch - 1), p, 0];

interface Parsed { division: number; format: number; tracks: { tick: number; hex: string }[][] }
/** 出力SMFの簡易パース（ランニングステータスなし前提）。各イベントを (絶対時刻, 16進) で返す */
function parse(b: Uint8Array): Parsed {
  let i = 8;
  const format = (b[i]! << 8) | b[i + 1]!;
  const ntrk = (b[i + 2]! << 8) | b[i + 3]!;
  let division = (b[i + 4]! << 8) | b[i + 5]!;
  if (division >= 0x8000) division -= 0x10000;
  i += 6;
  const tracks: Parsed['tracks'] = [];
  for (let n = 0; n < ntrk; n++) {
    const len = (b[i + 4]! * 0x1000000) + (b[i + 5]! << 16) + (b[i + 6]! << 8) + b[i + 7]!;
    let p = i + 8;
    const end = p + len;
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
      let n2 = 0;
      let hdr = 1;
      if (st === 0xff) { p++; const type = b[p]!; p++; const l = varlen(); n2 = l; hdr = 0; evs.push({ tick, hex: hex([0xff, type, ...b.slice(p, p + l)]) }); p += l; continue; }
      if (st === 0xf7 || st === 0xf0) { p++; const l = varlen(); evs.push({ tick, hex: hex([st, ...b.slice(p, p + l)]) }); p += l; continue; }
      n2 = (st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0 ? 1 : 2;
      evs.push({ tick, hex: hex([...b.slice(p, p + hdr + n2)]) });
      p += hdr + n2;
    }
    tracks.push(evs);
    i = end;
  }
  return { division, format, tracks };
}
const hex = (b: ArrayLike<number>): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const notesOf = (t: Parsed['tracks'][number]): string[] => t.filter((e) => /^9/.test(e.hex)).map((e) => e.hex.slice(2, 4));
const nameOf = (t: Parsed['tracks'][number]): string => {
  const e = t.find((x) => x.hex.startsWith('ff03'));
  return e ? Buffer.from(e.hex.slice(4), 'hex').toString('utf8') : '';
};

// ---- マップ ----
// Base kit「B」: Kick=36, Snare=38(None)+40(Unload)+41(Duplicate), HiHat は Closed=42 のみ直接割当（Open は未割当 → IsSub）
// Target kit「T」: Kick=60, Snare=61, Closed=62, Open=63
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

describe('直接Mappingのみで判定（mapPitch）', () => {
  const m = mapData();
  const base = getArticulationMap(m, 'B');
  const dst = getArticulationMap(m, 'T');
  if (!base.ok || !dst.ok) throw new Error('resolver');

  it('直接割当のPitchは対象Kitの代表Pitchへ。Unload / Duplicate も変換から除外しない', () => {
    expect(mapPitch(base.value, dst.value, 36)).toBe(60);
    expect(mapPitch(base.value, dst.value, 38)).toBe(61);
    expect(mapPitch(base.value, dst.value, 40)).toBe(61); // Unload
    expect(mapPitch(base.value, dst.value, 41)).toBe(61); // Duplicate
    expect(mapPitch(base.value, dst.value, 42)).toBe(62);
  });

  it('補間で得られたPitch（IsSub）や未割当のPitchは変換しない（-1）', () => {
    // Base の Open は直接割当が無いため、Closed(42) から補間された Pitch（42）が入るが、IsSub なので入力側の判定には使わない
    const open = base.value.Items.find((i) => i.Name === 'Open')!;
    expect(open).toMatchObject({ IsSub: true, Pitches: [42] });
    expect(mapPitch(base.value, dst.value, 46)).toBe(-1);
    expect(mapPitch(base.value, dst.value, 99)).toBe(-1);
  });
});

describe('入力の検証・出力ファイル名', () => {
  it('Kit未選択・Kit位置が不正・Resolverの例外はエラー', () => {
    const input = smf([[[0, on(36)]]]);
    expect(convertMidi(mapData(), B, [], input, 'a.mid', { format: 1 }).ok).toBe(false);
    expect(convertMidi(mapData(), { pluginIndex: 9, kitIndex: 0 }, [T], input, 'a.mid', { format: 1 }).ok).toBe(false);
  });

  it('選択KitはPlugin/Kit の DisplayOrder 順に並べる', () => {
    const input = smf([[[0, on(36)]]]);
    const out = ok(convertMidi(mapData(), B, [T, B], input, 'a.mid', { format: 0 }));
    expect(out.files.map((f) => f.path)).toEqual(['B.mid', 'T.mid']);
  });

  it('ファイル名: Windows禁止文字と制御文字を _ に置換（モデルの名前は変えない）。衝突は " (2)" " (3)"（大文字小文字を区別しない）', () => {
    expect(toSafeFileName('a<b>c:d"e/f\\g|h?i*j\tk')).toBe('a_b_c_d_e_f_g_h_i_j_k');
    expect(dedupePaths(['A.mid', 'a.MID', 'B.mid', 'a.mid', 'A (2).mid'])).toEqual(['A.mid', 'a (2).MID', 'B.mid', 'a (3).mid', 'A (2) (2).mid']);
    expect(dedupePaths(['Plug/K.drm', 'plug/k.drm', 'Plug/K'])).toEqual(['Plug/K.drm', 'plug/k (2).drm', 'Plug/K']);
    const m = mapData();
    m.Plugins[0]!.Kits[1]!.Name = 'b'; // Base Kit B と大文字小文字だけが異なる
    const out = ok(convertMidi(m, B, [B, { pluginIndex: 0, kitIndex: 1 }], smf([[[0, on(36)]]]), 'x.mid', { format: 0 }));
    expect(out.files.map((f) => f.path)).toEqual(['B.mid', 'b (2).mid']);
    expect(m.Plugins[0]!.Kits[1]!.Name).toBe('b');
  });
});
