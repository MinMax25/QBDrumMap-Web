import { describe, expect, it } from 'vitest';
import {
  QbdWorkspace, cloneMap, createEmptyMap, createKit, isValidNameLength, noteName, normalizeIds,
  parseQbd, serializeQbd, validateNames, type MapData,
} from '../src/core';
import { brokenJson, complex, empty, gmSmall } from './fixtures';

const load = (text: string): MapData => {
  const r = parseQbd(text);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const save = (map: MapData): string => {
  const r = serializeQbd(map);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.text;
};

describe('Note名 (YAMAHA式 MIDI 60 = C3)', () => {
  it('代表値', () => {
    expect(noteName(60)).toBe('C3');
    expect(noteName(0)).toBe('C-2');
    expect(noteName(36)).toBe('C1');
    expect(noteName(61)).toBe('C#3');
    expect(noteName(127)).toBe('G8');
  });
  it('範囲外は空文字', () => {
    expect(noteName(-1)).toBe('');
    expect(noteName(128)).toBe('');
    expect(noteName(1.5)).toBe('');
  });
});

describe('Load', () => {
  it('配列順からDisplayOrderを1始まりで再構築する', () => {
    const m = load(complex);
    expect(m.Plugins.map((p) => [p.ID, p.DisplayOrder])).toEqual([[40, 1], [7, 2]]);
    expect(m.Plugins[1]!.Kits.map((k) => k.DisplayOrder)).toEqual([1, 2]);
    expect(m.Plugins[1]!.Kits[0]!.Pitches.map((p) => p.DisplayOrder)).toEqual([1, 2, 3]);
    expect(m.Parts.map((p) => p.DisplayOrder)).toEqual([1, 2]);
    expect(m.Parts[0]!.Articulations.map((a) => a.DisplayOrder)).toEqual([1, 2]);
    // DrumMapOrderは保存値のまま
    expect(m.Parts[0]!.Articulations.map((a) => a.DrumMapOrder)).toEqual([9, 4]);
  });

  it('欠落キーはWindows版の既定値になる', () => {
    const m = load(JSON.stringify({ Plugins: [{ Kits: [{ Pitches: [{}] }] }], Parts: [{ Articulations: [{}] }] }));
    expect(m.AppName).toBe('QBDrumMap');
    expect(m.ModelVersion).toBe('1.0.0');
    const pl = m.Plugins[0]!;
    expect(pl).toMatchObject({ ID: 0, Name: '', PluginType: 'None', MidiOutDevice: '', SoundCheckChannel: 'Channel10' });
    expect(pl.Kits[0]!.Pitches[0]).toMatchObject({ Pitch: 0, Name: null, ArticulationID: 0, Separator: 'None' });
    expect(m.Parts[0]).toMatchObject({ Color: null, NoteHead: 'None', Technique: 'None', Voice: 'Up1', NoteHeadSet: 0 });
    expect(m.Parts[0]!.Articulations[0]).toMatchObject({ ID: 0, Complement: 0, DrumMapOrder: 0 });
  });

  it('AppName/ModelVersionが異なっていても拒否しない', () => {
    const m = load(JSON.stringify({ AppName: 'Other', ModelVersion: '9.9.9', Plugins: [], Parts: [] }));
    expect(m.AppName).toBe('Other');
  });

  it('異常QBD（Name空・重複）も読み込める（編集時検証と分離）', () => {
    const m = load(JSON.stringify({ Plugins: [{ Name: '' }, { Name: '' }], Parts: [] }));
    expect(m.Plugins).toHaveLength(2);
  });

  it('未知のenum文字列は読み込みエラー', () => {
    const r = parseQbd(JSON.stringify({ Plugins: [{ Kits: [{ Pitches: [{ Separator: 'Bogus' }] }] }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('unknown-enum');
      expect(r.error.path).toBe('Plugins[0].Kits[0].Pitches[0].Separator');
    }
  });

  it.each([
    ['壊れたJSON', brokenJson, 'invalid-json'],
    ['null', 'null', 'null-document'],
    ['型違い(Pitchが文字列)', '{"Plugins":[{"Kits":[{"Pitches":[{"Pitch":"a"}]}]}]}', 'type-mismatch'],
    ['小数のID', '{"Parts":[{"ID":1.5}]}', 'type-mismatch'],
    ['Pluginsがnull', '{"Plugins":null}', 'type-mismatch'],
    ['配列要素がnull', '{"Parts":[null]}', 'type-mismatch'],
  ])('%s は読み込みエラー', (_n, text, code) => {
    const r = parseQbd(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });

  it('追加フィールドをExtraへ保持する', () => {
    const m = load(complex);
    expect(m.Extra).toEqual({ FutureRootField: { a: 1 } });
    expect(m.Plugins[1]!.Kits[0]!.Pitches[0]!.Extra).toEqual({ Memo: 'keep me' });
  });
});

describe('Save / 往復', () => {
  it('既定値を省略し、DisplayOrderは出力しない', () => {
    const t = save(load(JSON.stringify({ Plugins: [{ Kits: [{ Pitches: [{}] }] }], Parts: [{}] })));
    const o = JSON.parse(t);
    expect(o.Plugins[0].PluginType).toBeUndefined();
    expect(o.Plugins[0].SoundCheckChannel).toBe('Channel10'); // 常に出力
    expect(o.Plugins[0].Kits[0].Pitches[0]).toEqual({});
    expect(t).not.toContain('DisplayOrder');
    expect(o.Parts[0].Color).toBeUndefined();
  });

  it('キー順は宣言順', () => {
    const o = JSON.parse(save(load(gmSmall)));
    expect(Object.keys(o)).toEqual(['AppName', 'ModelVersion', 'Plugins', 'Parts']);
    expect(Object.keys(o.Parts[1])).toEqual([
      'ID', 'Name', 'ScorePitch', 'Color', 'NoteHead', 'Technique', 'InstrumentEntityID', 'NoteHeadSet',
      'Voice', 'TechniqueEntityID', 'Articulations',
    ]);
  });

  it('AppName/ModelVersionは固定値で書く', () => {
    const o = JSON.parse(save(load('{"AppName":"X","ModelVersion":"2"}')));
    expect(o.AppName).toBe('QBDrumMap');
    expect(o.ModelVersion).toBe('1.0.0');
  });

  it('System.Text.Json風に < > & + \' を \\u エスケープし、非BMPはサロゲートで出す', () => {
    const t = save(load(JSON.stringify({ Parts: [{ Name: 'a<b>&+\'😀' }] })));
    expect(t).toContain('a\\u003Cb\\u003E\\u0026\\u002B\\u0027\\uD83D\\uDE00');
    expect(load(t).Parts[0]!.Name).toBe('a<b>&+\'😀');
  });

  it.each([['gmSmall', gmSmall], ['complex', complex], ['empty', empty]])(
    '%s: Load→Save→Load で全フィールド・参照・順序が一致し、再Saveは不変',
    (_n, text) => {
      const a = load(text);
      const t1 = save(a);
      const b = load(t1);
      // 2回目のSaveは出力が不変（正規化の冪等性）
      expect(save(b)).toBe(t1);
      // 正規化済みの入力ならLoad結果が一致する
      const norm = serializeQbd(a);
      expect(norm.ok && norm.value.normalized).toEqual(b);
    },
  );

  it('GM Fixtureは正規化済みなので往復でJSON値が完全一致する', () => {
    expect(JSON.parse(save(load(gmSmall)))).toEqual(JSON.parse(gmSmall));
  });

  it('複雑Fixture: 追加フィールドと値が往復で保持される', () => {
    const o = JSON.parse(save(load(complex)));
    expect(o.FutureRootField).toEqual({ a: 1 });
    expect(o.Plugins[0].MidiOutDevice).toBe('Device <1>');
    expect(JSON.stringify(o)).toContain('keep me');
  });
});

describe('ID正規化 (FixID)', () => {
  const n = (m: MapData): MapData => {
    const r = normalizeIds(m);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it('Plugin/Part/Kit/Articulation IDを順序に従い1から再採番する', () => {
    const m = n(load(complex));
    expect(m.Plugins.map((p) => p.ID)).toEqual([1, 2]);
    expect(m.Plugins.flatMap((p) => p.Kits.map((k) => k.ID))).toEqual([1, 2, 3]); // Kit IDはPlugin横断
    expect(m.Parts.map((p) => p.ID)).toEqual([1, 2]);
    expect(m.Parts.flatMap((p) => p.Articulations.map((a) => a.ID))).toEqual([1, 2, 3]);
  });

  it('参照を新IDへ追随し、存在しない参照先は0にする', () => {
    const m = n(load(complex));
    const ride = m.Plugins[1]!.Kits[0]!.Pitches;
    // 旧300→1, 旧301→2, 旧700→3
    expect(ride.map((p) => p.ArticulationID)).toEqual([1, 2, 3]);
    expect(m.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.ArticulationID)).toEqual([3, 0]); // 999は欠損→0
    const [cymbalRide, cymbalBell] = m.Parts[0]!.Articulations;
    expect(cymbalRide).toMatchObject({ ID: 1, Complement: 2 });
    expect(cymbalBell).toMatchObject({ ID: 2, Complement: 0 }); // 12345は欠損→0
    expect(m.Parts[1]!.Articulations[0]).toMatchObject({ ID: 3, Complement: 1 });
  });

  it('誤接続しない: 参照先のNameがID正規化の前後で変わらない', () => {
    const before = load(complex);
    const nameOf = (m: MapData, id: number): string | undefined =>
      m.Parts.flatMap((p) => p.Articulations).find((a) => a.ID === id)?.Name;
    const after = n(before);
    const pairs = (m: MapData): (string | undefined)[] =>
      m.Plugins.flatMap((p) => p.Kits).flatMap((k) => k.Pitches).map((p) => nameOf(m, p.ArticulationID));
    expect(pairs(after)).toEqual(pairs(before));
  });

  it('DrumMapOrderは旧値順に全体で1から振り直す', () => {
    const m = n(load(complex));
    const byName = Object.fromEntries(m.Parts.flatMap((p) => p.Articulations).map((a) => [a.Name, a.DrumMapOrder]));
    // 旧: Floor=1, Bell=4, Ride=9
    expect(byName).toEqual({ Floor: 1, Bell: 2, Ride: 3 });
  });

  it('DisplayOrderの並びでID採番する（配列順ではなく）', () => {
    const m = load(complex);
    m.Plugins[0]!.DisplayOrder = 2;
    m.Plugins[1]!.DisplayOrder = 1;
    const r = n(m);
    expect(r.Plugins.find((p) => p.Name === 'Plugin A')!.ID).toBe(1);
    expect(r.Plugins.find((p) => p.Name === 'Plugin B')!.ID).toBe(2);
    expect(JSON.parse(save(m)).Plugins.map((p: { Name: string }) => p.Name)).toEqual(['Plugin A', 'Plugin B']);
  });

  it('KitPitch.DisplayOrderは再採番しないが、保存順はDisplayOrder順', () => {
    const m = load(gmSmall);
    const ps = m.Plugins[0]!.Kits[0]!.Pitches;
    ps[0]!.DisplayOrder = 10;
    ps[1]!.DisplayOrder = 20;
    ps[2]!.DisplayOrder = 5;
    ps[3]!.DisplayOrder = 7;
    const r = n(m);
    expect(r.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.DisplayOrder)).toEqual([10, 20, 5, 7]);
    const out = JSON.parse(save(m)).Plugins[0].Kits[0].Pitches.map((p: { Name: string }) => p.Name);
    expect(out).toEqual(['Snare', 'Closed HH', '', 'Kick']);
  });

  it('入力モデルを変更しない', () => {
    const m = load(complex);
    const copy = cloneMap(m);
    n(m);
    save(m);
    expect(m).toEqual(copy);
  });

  it('Articulation IDが重複している場合は保存時エラー（修復しない・副作用なし）', () => {
    const m = load(JSON.stringify({ Parts: [{ Articulations: [{ ID: 5, Name: 'a' }, { ID: 5, Name: 'b' }] }] }));
    const copy = cloneMap(m);
    const r = serializeQbd(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('duplicate-articulation-id');
    expect(m).toEqual(copy);
  });

  it('IDが0のArticulationが複数ある場合も重複として保存時エラー（Windows版と同じ）', () => {
    const m = load(JSON.stringify({ Parts: [{ Articulations: [{ Name: 'a' }, { Name: 'b' }] }] }));
    expect(serializeQbd(m).ok).toBe(false);
  });

  it('ID=0のArticulationが1つだけの場合、IDは0のまま採番枠のみ消費する（Windows版の挙動）', () => {
    const m = load(JSON.stringify({ Parts: [{ Articulations: [{ Name: 'zero' }, { ID: 7, Name: 'seven' }] }] }));
    const r = n(m);
    expect(r.Parts[0]!.Articulations.map((a) => a.ID)).toEqual([0, 2]);
  });
});

describe('KitPitch 128行', () => {
  it('createKitはPitch 0–127の128行（DisplayOrder = Pitch+1）', () => {
    const k = createKit(1, 'K', 1);
    expect(k.Pitches).toHaveLength(128);
    expect(k.Pitches.map((p) => p.Pitch)).toEqual(Array.from({ length: 128 }, (_, i) => i));
    expect(k.Pitches.map((p) => p.DisplayOrder)).toEqual(Array.from({ length: 128 }, (_, i) => i + 1));
    expect(noteName(k.Pitches[60]!.Pitch)).toBe('C3');
  });

  it('128行Kitの往復でPitch 0を含む全行が保持される（Pitch 0はキー省略）', () => {
    const m = createEmptyMap();
    m.Plugins.push({ ID: 1, Name: 'P', PluginType: 'None', MidiOutDevice: '', SoundCheckChannel: 'Channel10',
      Kits: [createKit(1, 'K', 1)], DisplayOrder: 1, Extra: {} });
    const b = load(save(m));
    expect(b.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.Pitch)).toEqual(Array.from({ length: 128 }, (_, i) => i));
  });
});

describe('Workspace（失敗時に既存モデルを壊さない）', () => {
  it('Load失敗では作業モデルが同一参照・同一内容のまま', () => {
    const ws = new QbdWorkspace();
    expect(ws.load(gmSmall).ok).toBe(true);
    const before = ws.map;
    const snapshot = ws.snapshot();
    for (const bad of [brokenJson, '{"Plugins":[{"PluginType":"Nope"}]}', 'null']) {
      expect(ws.load(bad).ok).toBe(false);
      expect(ws.map).toBe(before);
      expect(ws.map).toEqual(snapshot);
    }
  });

  it('Load成功で置換され、Newは空', () => {
    const ws = new QbdWorkspace();
    ws.load(complex);
    expect(ws.map.Plugins).toHaveLength(2);
    ws.createNew();
    expect(ws.map.Plugins).toEqual([]);
    expect(ws.map.Parts).toEqual([]);
  });

  it('Save失敗では作業モデルが変わらない', () => {
    const ws = new QbdWorkspace();
    ws.load(JSON.stringify({ Parts: [{ Articulations: [{ ID: 1 }, { ID: 1 }] }] }));
    const snapshot = ws.snapshot();
    expect(ws.save().ok).toBe(false);
    expect(ws.map).toEqual(snapshot);
  });

  it('Save成功で作業モデルが正規化後モデルになる', () => {
    const ws = new QbdWorkspace();
    ws.load(complex);
    expect(ws.save().ok).toBe(true);
    expect(ws.map.Plugins.map((p) => p.ID)).toEqual([1, 2]);
  });
});

describe('編集時の入力制約（Load拒否とは別）', () => {
  it('長さ: KitPitchのみ0文字可、上限64', () => {
    expect(isValidNameLength('Plugin', '')).toBe(false);
    expect(isValidNameLength('KitPitch', '')).toBe(true);
    expect(isValidNameLength('KitPitch', null)).toBe(true);
    expect(isValidNameLength('Part', 'a'.repeat(64))).toBe(true);
    expect(isValidNameLength('Part', 'a'.repeat(65))).toBe(false);
  });

  it('一意性: Kitは全Plugin横断、Articulationは全Part横断、KitPitchは重複可', () => {
    const m = load(JSON.stringify({
      Plugins: [
        { Name: 'P1', Kits: [{ Name: 'K', Pitches: [{ Name: 'd' }, { Name: 'd' }] }] },
        { Name: 'P2', Kits: [{ Name: 'K' }] },
      ],
      Parts: [
        { Name: 'A', Articulations: [{ ID: 1, Name: 'x' }] },
        { Name: 'B', Articulations: [{ ID: 2, Name: 'x' }] },
      ],
    }));
    const issues = validateNames(m);
    expect(issues.filter((i) => i.target === 'Kit' && i.kind === 'duplicate')).toHaveLength(2);
    expect(issues.filter((i) => i.target === 'Articulation' && i.kind === 'duplicate')).toHaveLength(2);
    expect(issues.filter((i) => i.target === 'KitPitch')).toHaveLength(0);
    expect(issues.filter((i) => i.target === 'Plugin')).toHaveLength(0);
  });
});
