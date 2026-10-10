import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneMap, convertMidi, parseQbd, type KitRef, type MapData, type MidiConvertFormat } from '../src/core';
import { planConvert, type ConvertRequest } from '../src/ui/convertMidi/convertPlan';

// ---- 最小の SMF ビルダー（Core の読み書きを使わない）----
const vl = (n: number): number[] => {
  const o = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) o.unshift((n & 0x7f) | 0x80);
  return o;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
type Ev = [tick: number, bytes: number[]];
function smf(tracks: Ev[][], format = tracks.length === 1 ? 0 : 1, division = 480): Uint8Array {
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, division >> 8, division & 255];
  for (const t of tracks) {
    let last = 0;
    const body = t.flatMap(([tick, b]) => { const d = vl(tick - last); last = tick; return [...d, ...b]; });
    out.push(0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body);
  }
  return Uint8Array.from(out);
}
const on = (p: number): number[] => [0x99, p, 100];
const off = (p: number): number[] => [0x89, p, 0];
const input = smf([[[0, on(36)], [240, off(36)], [240, on(38)], [480, off(38)], [480, on(99)], [600, off(99)]]]);

const pitches = (rows: [number, number, (string | number)?][]): object[] =>
  rows.map(([Pitch, ArticulationID, Separator]) => ({ Pitch, Name: `p${Pitch}`, ArticulationID, ...(Separator !== undefined ? { Separator } : {}) }));
/** B（Base）、T1・T2（変換先）、Q（未定義 Separator を含む変換先）、P2/B（Base と同名の2つ目の Kit） */
const mapData = (): MapData => {
  const r = parseQbd(JSON.stringify({
    Plugins: [
      { ID: 1, Name: 'P', Kits: [
        { ID: 1, Name: 'B', Pitches: pitches([[36, 1], [38, 2]]) },
        { ID: 2, Name: 'T1', Pitches: pitches([[60, 1], [61, 2]]) },
        { ID: 3, Name: 'T2', Pitches: pitches([[70, 1], [71, 2]]) },
        { ID: 4, Name: 'Q', Pitches: pitches([[80, 1, 77], [81, 2]]) },
      ] },
      { ID: 2, Name: 'P2', Kits: [{ ID: 5, Name: 'B', Pitches: pitches([[1, 1], [2, 2]]) }] },
    ],
    Parts: [
      { ID: 1, Name: 'Kick', Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] },
      { ID: 2, Name: 'Snare', Articulations: [{ ID: 2, Name: 'Snare', DrumMapOrder: 2 }] },
    ],
  }));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const ref = (p: number, k: number): KitRef => ({ pluginIndex: p, kitIndex: k });
const B = ref(0, 0);
const req = (over: Partial<ConvertRequest> = {}): ConvertRequest => ({
  input, fileName: 'song.mid', baseOn: B, targets: [ref(0, 1)], format: 1, ...over,
});
const must = (o: ReturnType<typeof planConvert>) => { if (!o.ok) throw new Error(`${o.error.code}: ${o.error.message}`); return o.result; };

describe('planConvert: 正常系', () => {
  it('Format 1 は単一の .mid をそのままダウンロードし、Core の出力とバイト列が一致する', () => {
    {
      const m = mapData();
      const r = must(planConvert(m, req({ targets: [ref(0, 1), ref(0, 2)] })));
      const core = convertMidi(m, B, [ref(0, 1), ref(0, 2)], input, 'song.mid', { format: 1 });
      if (!core.ok) throw new Error('x');
      expect(r.inZip).toBe(false);
      expect(r.download.fileName).toBe('song Converted.mid');
      expect(r.download.mime).toBe('audio/midi');
      expect(r.download.bytes).toEqual(core.value.files[0]!.bytes);
    }
  });

  it('Format 0 は Core が返したファイル群を ZIP にまとめる（二重 ZIP にしない。名前・バイト列を保持）', () => {
    {
      const m = mapData();
      const r = must(planConvert(m, req({ format: 0, targets: [ref(0, 1), ref(0, 2)] })));
      const core = convertMidi(m, B, [ref(0, 1), ref(0, 2)], input, 'song.mid', { format: 0 });
      if (!core.ok) throw new Error('x');
      expect(r.inZip).toBe(true);
      expect(r.download.fileName).toBe(core.value.archiveName);
      expect(r.download.mime).toBe('application/zip');
      expect(r.files).toEqual(core.value.files.map((f) => f.path));
      expect(r.files).toContain('T1.mid');
      expect(r.files).toContain('T2.mid');
      // ZIP 内のファイルが Core の出力と一致する（ローカルヘッダーを順に読む）
      const z = r.download.bytes;
      const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
      let off = 0;
      for (const f of core.value.files) {
        expect(dv.getUint32(off, true)).toBe(0x04034b50);
        const size = dv.getUint32(off + 18, true);
        const nameLen = dv.getUint16(off + 26, true);
        expect(new TextDecoder().decode(z.slice(off + 30, off + 30 + nameLen))).toBe(f.path);
        expect(z.slice(off + 30 + nameLen, off + 30 + nameLen + size)).toEqual(f.bytes);
        off += 30 + nameLen + size;
      }
      // 外側が ZIP、中身が .mid（ZIP の ZIP ではない）
      expect(Array.from(z.slice(0, 4))).toEqual([0x50, 0x4b, 3, 4]);
      expect(core.value.files.every((f) => f.path.endsWith('.mid') && f.bytes[0] === 0x4d)).toBe(true);
    }
  });

  it('Format 0 の未変換ノート（Base に割当のない Pitch 99）は #B.mid として出る', () => {
    const r = must(planConvert(mapData(), req({ format: 0 })));
    expect(r.files).toContain('#B.mid');
  });

  it('複数 Kit は Plugin／Kit の DisplayOrder 順（選択順ではない）で出力される', () => {
    const m = mapData();
    const a = must(planConvert(m, req({ format: 0, targets: [ref(0, 2), ref(0, 1)] })));
    const b = must(planConvert(m, req({ format: 0, targets: [ref(0, 1), ref(0, 2)] })));
    expect(a.files).toEqual(b.files);
  });

  it('ZIP は Python zipfile で読み戻せる（CRC・名前・内容）', () => {
    const py = spawnSync('python3', ['--version']).status === 0 ? 'python3' : spawnSync('python', ['--version']).status === 0 ? 'python' : null;
    if (py === null) return;
    const m = mapData();
    const r = must(planConvert(m, req({ format: 0, targets: [ref(0, 1), ref(0, 2)] })));
    const core = convertMidi(m, B, [ref(0, 1), ref(0, 2)], input, 'song.mid', { format: 0 });
    if (!core.ok) throw new Error('x');
    const dir = mkdtempSync(join(tmpdir(), 'qbmidi-'));
    try {
      const f = join(dir, 'a.zip');
      writeFileSync(f, r.download.bytes);
      const script = 'import zipfile,json,sys\nz=zipfile.ZipFile(sys.argv[1])\nsys.stdout.write(json.dumps({"bad":z.testzip(),"items":[[i.filename,z.read(i.filename).hex()] for i in z.infolist()]}))';
      const p = spawnSync(py, ['-I', '-c', script, f], { encoding: 'utf8' });
      expect(p.status).toBe(0);
      const got = JSON.parse(p.stdout) as { bad: string | null; items: [string, string][] };
      expect(got.bad).toBeNull();
      expect(got.items).toEqual(core.value.files.map((x) => [x.path, Buffer.from(x.bytes).toString('hex')]));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('入力のバイト列とモデルは変換で変化しない', () => {
    const m = mapData();
    const c = cloneMap(m);
    const copy = input.slice();
    for (const format of [0, 1] as MidiConvertFormat[]) planConvert(m, req({ format }));
    expect(m).toEqual(c);
    expect(input).toEqual(copy);
  });

  it('MIDI 変換には Export の未定義 Separator 検証を適用しない（未定義 Separator を持つ Kit へも変換できる）', () => {
    const r = must(planConvert(mapData(), req({ targets: [ref(0, 3)] })));
    expect(r.download.fileName).toBe('song Converted.mid');
  });

  it('標準の変換は EndOfTrack を出力し、モード切り替えは存在しない（リクエストに mode を持たない）', () => {
    const m = mapData();
    const w = must(planConvert(m, req())).download.bytes;
    expect(Buffer.from(w).toString('hex')).toContain('ff2f00');
    expect('mode' in req()).toBe(false);
  });
});

describe('planConvert: 異常系（モデルは不変）', () => {
  const fail = (o: ReturnType<typeof planConvert>) => { if (o.ok) throw new Error('成功してしまった'); return o; };

  it('空ファイル・Base Kit なし・変換先なし', () => {
    expect(fail(planConvert(mapData(), req({ input: new Uint8Array() }))).error.code).toBe('empty-midi-file');
    expect(fail(planConvert(mapData(), req({ baseOn: null }))).error.code).toBe('base-on-required');
    expect(fail(planConvert(mapData(), req({ targets: [] }))).error.code).toBe('no-target');
  });

  it('不正ヘッダー・Format 2・途中で切れたファイルはエラー（変換しない）', () => {
    const f2 = smf([[[0, on(36)]]], 2);
    const trunc = input.slice(0, 22);
    expect(fail(planConvert(mapData(), req({ input: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) }))).error.code).toBe('bad-header');
    expect(fail(planConvert(mapData(), req({ input: f2 }))).error.code).toBe('unsupported-format');
    expect(fail(planConvert(mapData(), req({ input: trunc }))).error.code).toBe('truncated');
  });

  it('存在しない Kit は kit-not-found', () => {
    expect(fail(planConvert(mapData(), req({ baseOn: ref(9, 9) }))).error.code).toBe('kit-not-found');
  });

  it('失敗してもモデルと入力は不変', () => {
    const m = mapData();
    const c = cloneMap(m);
    planConvert(m, req({ input: smf([[[0, on(36)]]], 2) }));
    expect(m).toEqual(c);
  });
});

describe('planConvert: 同名 Kit', () => {
  const dup = ref(1, 0); // P2/B（Base と同名の2つ目）
  it('Base Kit が2つ目の同名 Kit なら中止し、原因の Kit と代わりに使われる Kit を示す', () => {
    const o = planConvert(mapData(), req({ baseOn: dup }));
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.error.code).toBe('ambiguous-kit-name');
    expect(o.blockers.map((b) => [b.pluginName, b.kitName, b.baseOn, b.resolvedInstead])).toEqual([['P2', 'B', true, 'P / B']]);
  });

  it('変換先が2つ目の同名 Kit のときも中止する。最初の同名 Kit なら変換できる', () => {
    const o = planConvert(mapData(), req({ targets: [ref(0, 1), dup] }));
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.blockers[0]!.baseOn).toBe(false);
    expect(planConvert(mapData(), req({ baseOn: B, targets: [ref(0, 1)] })).ok).toBe(true);
  });
});
