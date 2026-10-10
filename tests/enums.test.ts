import { describe, expect, it } from 'vitest';
import {
  getKitPitchOrder, parseEnumText, parseQbd, SEPARATORS, serializeQbd, separatorValue, type MapData,
} from '../src/core';

// 方針: 未定義の整数enumはWindows版互換を優先し、読み込み時に受け入れて数値を保持し、再保存でも保持する。
// 読み込みの挙動は System.Text.Json（JsonStringEnumConverter）をC#で実測した結果に合わせる。
const load = (o: unknown): MapData => {
  const r = parseQbd(JSON.stringify(o));
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`);
  return r.value;
};
const pitchOf = (sep: unknown): MapData =>
  load({ Plugins: [{ Kits: [{ Name: 'K', Pitches: [{ Pitch: 1, Name: 'a', Separator: sep }] }] }] });
const sepOf = (m: MapData) => m.Plugins[0]!.Kits[0]!.Pitches[0]!.Separator;

describe('enumの読み込み（System.Text.Json と同じ）', () => {
  it.each([
    ['Separate', 'Separate'], ['separate', 'Separate'], ['SEPARATE', 'Separate'], [' Separate ', 'Separate'],
    ['2', 'Unload'], [' 2', 'Unload'], ['+2', 'Unload'], [2, 'Unload'], [0, 'None'],
    ['Separate,Unload', 'Duplicate'], ['Separate, Unload', 'Duplicate'], // OR結合 (1|2 = 3)
    ['99', 99], [99, 99], [-1, -1], ['-1', -1], [2147483647, 2147483647], [-2147483648, -2147483648],
  ])('Separator %j → %j', (input, expected) => {
    expect(sepOf(pitchOf(input))).toBe(expected);
  });

  it.each([[''], ['Bogus'], ['0x2'], ['1_0'], [2147483648], [4294967295], [2.5], [null], [true], [[1]], [{}]])(
    'Separator %j は読み込みエラー', (input) => {
      const r = parseQbd(JSON.stringify({ Plugins: [{ Kits: [{ Pitches: [{ Separator: input }] }] }] }));
      expect(r.ok).toBe(false);
    });

  it('MIDIChannelは1始まり。0・範囲外の整数も数値のまま保持する', () => {
    const ch = (v: unknown) => load({ Plugins: [{ SoundCheckChannel: v }] }).Plugins[0]!.SoundCheckChannel;
    expect(ch(undefined)).toBe('Channel10');
    expect(ch('channel3')).toBe('Channel3');
    expect(ch(16)).toBe('Channel16');
    expect(ch(0)).toBe(0);
    expect(ch(17)).toBe(17);
  });

  it('Part の NoteHead / Technique / Voice / PluginType も同じ規則', () => {
    const m = load({ Plugins: [{ PluginType: 7 }], Parts: [{ NoteHead: 'NHDX', Technique: 99, Voice: '3' }] });
    expect(m.Plugins[0]!.PluginType).toBe(7);
    expect(m.Parts[0]).toMatchObject({ NoteHead: 'nhdX', Technique: 99, Voice: 'Down2' });
  });
});

describe('未定義の整数enumの保持', () => {
  it('再保存で数値のまま書き戻し、再読み込みでも同じ値になる', () => {
    const m = load({
      Plugins: [{ PluginType: 7, SoundCheckChannel: 0, Kits: [{ Name: 'K', Pitches: [{ Pitch: 1, Name: 'a', Separator: 99 }] }] }],
      Parts: [{ NoteHead: 88, Technique: -2, Voice: 5, Articulations: [] }],
    });
    const s = serializeQbd(m);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const o = JSON.parse(s.value.text);
    expect(o.Plugins[0]).toMatchObject({ PluginType: 7, SoundCheckChannel: 0 });
    expect(o.Plugins[0].Kits[0].Pitches[0].Separator).toBe(99);
    expect(o.Parts[0]).toMatchObject({ NoteHead: 88, Technique: -2, Voice: 5 });
    const back = parseQbd(s.value.text);
    expect(back.ok && back.value).toEqual(s.value.normalized);
  });

  it('定義済みの値は整数で与えても名前で保存される（Windows版と同じ）', () => {
    const s = serializeQbd(pitchOf(2));
    expect(s.ok && JSON.parse(s.value.text).Plugins[0].Kits[0].Pitches[0].Separator).toBe('Unload');
  });

  it('DAW表示順: 未定義のSeparator(≠None)は区切りありとして数値順に並ぶ（黙ってNoneへ変換しない）', () => {
    const m = load({
      Plugins: [{ Kits: [{ Name: 'K', Pitches: [
        { Pitch: 1, Name: 'dup', Separator: 'Duplicate' }, { Pitch: 2, Name: 'weird', Separator: 99 },
        { Pitch: 3, Name: 'neg', Separator: -1 }, { Pitch: 4, Name: 'plain' }] }] }],
      Parts: [{ Articulations: [{ ID: 5, Name: 'a' }] }],
    });
    m.Plugins[0]!.Kits[0]!.Pitches[3]!.ArticulationID = 5; // 'plain' にArticulationを割り当てて Articulation順を有効にする
    const r = getKitPitchOrder(m, 'K', { useArticulation: true });
    // 割当ありのplainが先頭。割当なし・区切りあり(D)は Separator の数値順（-1, 3, 99）。C/Bが無いので区切り行は入らない
    expect(r.ok && r.value.map((p) => p.Name)).toEqual(['plain', 'neg', 'dup', 'weird']);
    expect(separatorValue(99)).toBe(99);
    expect(separatorValue('Unload')).toBe(2);
  });
});

describe('parseEnumText (Enum.TryParse 相当)', () => {
  it('大文字小文字・空白・数値・OR結合・範囲', () => {
    const p = (s: string, ic: boolean) => parseEnumText(s, SEPARATORS, 0, ic);
    expect(p('Separate', false)).toBe(1);
    expect(p('separate', false)).toBeUndefined(); // 取り込み(TSV)は区別する
    expect(p('separate', true)).toBe(1);
    expect(p('Separate,Unload', false)).toBe(3);
    expect(p('Separate,', false)).toBeUndefined();
    expect(p('', false)).toBeUndefined();
    expect(p('2147483648', false)).toBeUndefined();
    expect(p('-4', false)).toBe(-4);
  });
});
