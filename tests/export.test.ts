import { describe, expect, it } from 'vitest';
import {
  CRLF, defaultExportSettings, exportKits, exportNoteMapper, getCubaseDrumMap, getNoteMapperTemplate, getQbDrummerCsv,
  getStudioOnePitchList, getTsvText, noteNameWindows, parseCubaseDrm, parseQbd, parseXml, separatorDisplayName,
  separatorSuffix, serializeCubaseDrm, serializePitchList, toSafeFileName, utf8Bytes, type KitRef, type MapData,
} from '../src/core';

const load = (o: unknown): MapData => {
  const r = parseQbd(JSON.stringify(o));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

// Part1「HH」: Open(1) / Closed(2)。Part2「Snare」: Snare(3)。Kit「K」: 4行 + 区切りあり行
const parts = [
  { ID: 1, Name: 'HH', ScorePitch: 42, Color: '#FF0000', NoteHead: 'nhdX', Technique: 'plus', NoteHeadSet: 5, Voice: 'Down1',
    InstrumentEntityID: 'inst', TechniqueEntityID: 'tech',
    Articulations: [{ ID: 1, Name: 'Open', DrumMapOrder: 2 }, { ID: 2, Name: 'Closed', DrumMapOrder: 1 }] },
  { ID: 2, Name: 'Snare', ScorePitch: 38, Articulations: [{ ID: 3, Name: 'Snare', DrumMapOrder: 3 }] },
];
const kit = [
  { Pitch: 38, Name: 'snr', ArticulationID: 3 },
  { Pitch: 42, Name: 'cls', ArticulationID: 2 },
  { Pitch: 46, Name: 'opn', ArticulationID: 1, Separator: 'Unload' },
  { Pitch: 60, Name: 'free' },
  { Pitch: 61 },
];
const map = (): MapData => load({
  Plugins: [{ ID: 1, Name: 'Plug', Kits: [{ ID: 1, Name: 'K', Pitches: kit }, { ID: 2, Name: 'K2', Pitches: [{ Pitch: 50, Name: 'x', ArticulationID: 2 }] }] }],
  Parts: parts,
});

describe('Separator の表示名・接尾辞', () => {
  it('接尾辞と表示名（Unloadは "Not Loaded"）', () => {
    expect([separatorSuffix('None'), separatorSuffix('Separate'), separatorSuffix('Unload'), separatorSuffix('Duplicate')])
      .toEqual(['', ' (-)', ' (+)', ' (*)']);
    expect(separatorDisplayName('Unload')).toBe('Not Loaded');
    expect(separatorDisplayName('None')).toBe('');
    // 未定義の値は黙って既定値にせず null（出力側でエラーにする）
    expect(separatorSuffix(99)).toBeNull();
    expect(separatorDisplayName(99)).toBeNull();
  });
});

describe('TSV 出力', () => {
  it('5列ヘッダー、全行をDisplayOrder順に、CRLFで終わる', () => {
    const t = getTsvText(map(), 'K');
    const lines = t.split(CRLF);
    expect(lines[0]).toBe('Pitch\tNote\tName\tArticulation\tSeparator');
    expect(lines).toHaveLength(7); // ヘッダー + 5行 + 末尾の空要素
    expect(lines[6]).toBe('');
    expect(lines[1]).toBe('38\tD1\tsnr\tSnare\t');
    expect(lines[3]).toBe('46\tA#1\topn\tOpen\tUnload');
    expect(lines[5]).toBe('61\tC#3\t\t\t'); // Nameが空の行も出力される
    expect(t.includes('\n') && !t.replace(/\r\n/g, '').includes('\n')).toBe(true);
  });

  it('Note名は Windows版と同じく (byte) 折り返し（範囲外は通常存在しない）', () => {
    expect(noteNameWindows(60)).toBe('C3');
    expect(noteNameWindows(300)).toBe('G#1');
    expect(noteNameWindows(-1)).toBe('');
  });

  it('未定義のSeparator値は数値の文字列で出力する（Windows版の ToString と同じ）', () => {
    const m = load({ Plugins: [{ Kits: [{ Name: 'K', Pitches: [{ Pitch: 1, Name: 'a', Separator: 99 }] }] }] });
    expect(getTsvText(m, 'K').split(CRLF)[1]).toBe('1\tC#-2\ta\t\t99');
  });
});

describe('Studio One .pitchlist 出力', () => {
  it('Articulation名への置換・接尾辞・Part属性・区切り行・CRLF・タブインデント', () => {
    const r = getStudioOnePitchList(map(), 'K', defaultExportSettings);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xml = serializePitchList(r.value);
    expect(xml).toBe(
      ['<?xml version="1.0" encoding="utf-8"?>', '<Music.PitchNameList title="K">',
        // 表示順: Articulation順 DrumMapOrder(Closed=1, Open=2, Snare=3)。Open はUnloadなので後段
        '\t<Music.PitchName pitch="42" name="Closed" color="#FF0000" scorePitch="42" notehead="nhdX" technique="plus"/>',
        '\t<Music.PitchName pitch="38" name="Snare" scorePitch="38"/>',
        // 区切り行: 空きPitchの最小値(0)。割当あり(A)の後・割当なし区切りなし(B)の前に入る
        '\t<Music.PitchName pitch="0" name="=========="/>',
        '\t<Music.PitchName pitch="60" name="free"/>',
        '\t<Music.PitchName pitch="46" name="Open (+)" color="#FF0000" scorePitch="42" notehead="nhdX" technique="plus"/>',
        '</Music.PitchNameList>', ''].join(CRLF),
    );
  });

  it('UseArticulationPitchName=false なら元のNameを使い、UseArticulation=false ならPart属性を出さない', () => {
    const r = getStudioOnePitchList(map(), 'K', { useArticulation: false, useArticulationPitchName: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Articulation順を使わない: DisplayOrder順で、Nameが空白の行を除く。割当あり(ArticulationID!=0)の行にはSeparator接尾辞が付く
      expect(r.value.Items.map((i) => [i.Pitch, i.Name, i.Color, i.ScorePitch])).toEqual([
        [38, 'snr', null, null], [42, 'cls', null, null], [46, 'opn (+)', null, null], [60, 'free', null, null],
      ]);
    }
  });

  it('XML属性のエスケープ（name）。title はWindows版どおりエスケープしない', () => {
    const m = load({ Plugins: [{ Kits: [{ Name: 'A&B', Pitches: [{ Pitch: 1, Name: `<"'&>` }] }] }] });
    const r = getStudioOnePitchList(m, 'A&B', defaultExportSettings);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 既定（Web改善）: title / color を含む全ての属性値をエスケープする
    const xml = serializePitchList(r.value);
    expect(xml).toContain('title="A&amp;B"');
    expect(xml).toContain('name="&lt;&quot;&apos;&amp;&gt;"');
    expect(parseXml(xml).attrs['title']).toBe('A&B'); // 整形式のXMLとして読み戻せる
    // 互換モード: Windows版と同じく title は未エスケープ（不正なXMLになる）
    const compat = serializePitchList(r.value, { escapeAttributes: false });
    expect(compat).toContain('title="A&B"');
    expect(() => parseXml(compat)).toThrow();
  });

  it('未定義のSeparatorを持つArticulation割当行はエラー（黙ってNone扱いにしない）', () => {
    const m = load({ Plugins: [{ Kits: [{ Name: 'K', Pitches: [{ Pitch: 1, Name: 'a', ArticulationID: 3, Separator: 99 }] }] }], Parts: parts });
    const r = getStudioOnePitchList(m, 'K', defaultExportSettings);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('undefined-separator');
  });
});

describe('Cubase .drm 出力', () => {
  const dm = (m: MapData, baseOn: string | null = null) => {
    const r = getCubaseDrumMap(m, 'K', baseOn, defaultExportSettings);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it('128行のMapと128件のOrder。Nameのある行だけ表示順番号を持つ', () => {
    const d = dm(map());
    expect(d.Name).toBe('K');
    expect(d.Map).toHaveLength(128);
    expect(d.Order).toHaveLength(128);
    expect(d.Map[42]).toMatchObject({ INote: 42, ONote: 42, Name: 'Closed', DisplayNote: 42, NoteheadSet: 5, Voice: 1, InstrumentEntityID: 'inst' });
    expect(d.Map[46]!['Name']).toBe('Open (+)');
    expect(d.Map[0]).toMatchObject({ INote: 0, ONote: 0, DisplayNote: 0, Name: '==========' }); // 区切り行もそのPitchの行になる
    expect(d.Map[1]).toMatchObject({ INote: 1, ONote: 1, DisplayNote: 1, Name: '' });
    // 表示順（Closed, Snare, 区切り行, free, Open）が先頭、残りは Pitch 昇順
    expect(d.Order.slice(0, 6)).toEqual([42, 38, 0, 60, 46, 1]);
  });

  it('Base-On: ONote は対象Kitの代表Pitch、入力Pitch(INote)は Base Kit のもの', () => {
    // Base Kit K の Pitch 42(Closed) → 対象Kit K2 の Closed は Pitch 50
    const r = getCubaseDrumMap(map(), 'K2', 'K', defaultExportSettings);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.Name).toBe('K2');
    expect(r.value.Map[42]).toMatchObject({ INote: 42, ONote: 50, Name: 'Closed' });
    // 対象Kit K2 に Pitch が無い Snare は、Resolverの項目はあるが Pitch が空 → Windows版は ONote=0 になる（-1 ではないのでスキップされない）
    expect(r.value.Map[38]).toMatchObject({ Name: 'Snare', ONote: 0 });
    // Resolverに項目が存在しない ArticulationID の行だけが ONote=-1 でスキップされる
    const orphan = load({
      Plugins: [{ Kits: [{ Name: 'B', Pitches: [{ Pitch: 5, Name: 'x', ArticulationID: 9 }] }, { Name: 'T', Pitches: [] }] }],
      Parts: [{ Articulations: [{ ID: 1, Name: 'one' }] }],
    });
    const o = getCubaseDrumMap(orphan, 'T', 'B', defaultExportSettings);
    expect(o.ok && o.value.Map[5]!['Name']).toBe('');
  });

  it('XML構造: 宣言、DrumMap直下の要素、itemの属性とwide、Orderのtype=int、Flags、CRLF、BOMなしの文字列', () => {
    const r = serializeCubaseDrm(dm(map()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xml = r.value;
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\r\n<DrumMap>\r\n  <string name="Name" value="K" wide="true" />\r\n')).toBe(true);
    expect(xml.endsWith('  <int name="Flags" value="0" />\r\n</DrumMap>')).toBe(true);
    expect(xml).toContain('<list name="Order" type="int">');
    expect(xml).toContain('<float name="Length" value="200" />');
    expect(xml).toContain('<string name="Name" value="Closed" wide="true" />');
    const root = parseXml(xml);
    expect(root.name).toBe('DrumMap');
    expect(root.children.map((c) => `${c.name}:${c.attrs['name']}`)).toEqual([
      'string:Name', 'list:Quantize', 'list:Map', 'list:Order', 'list:OutputDevices', 'int:Flags',
    ]);
    expect(root.children[2]!.children).toHaveLength(128);
    expect(root.children[2]!.children[0]!.children.map((c) => c.attrs['name'])).toEqual([
      'INote', 'ONote', 'Channel', 'Length', 'Mute', 'DisplayNote', 'HeadSymbol', 'Voice', 'PortIndex', 'Name',
      'QuantizeIndex', 'NoteheadSet', 'InstrumentEntityID', 'TechniqueEntityID',
    ]);
  });

  it('出力 → 読み込みの往復で全フィールドが一致する', () => {
    const d = dm(map());
    const x = serializeCubaseDrm(d);
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    const back = parseCubaseDrm(x.value);
    expect(back.ok && back.value).toEqual(d);
  });

  it('属性値のエスケープ。XML 1.0 で使えない文字を含む名前はエラー', () => {
    const m = load({ Plugins: [{ Kits: [{ Name: 'K', Pitches: [{ Pitch: 1, Name: 'a&b<"c">\n' }] }] }] });
    const x = serializeCubaseDrm(dm(m));
    expect(x.ok && x.value).toContain('value="a&amp;b&lt;&quot;c&quot;&gt;&#xA;"');
    const bad = load({ Plugins: [{ Kits: [{ Name: 'K', Pitches: [{ Pitch: 1, Name: 'a\u0001b' }] }] }] });
    const e = serializeCubaseDrm(dm(bad));
    expect(e.ok).toBe(false);
  });

  it('範囲外のPitch（>127）の行があるとエラー（Windows版は ArgumentOutOfRangeException）', () => {
    const m = load({ Plugins: [{ Kits: [{ Name: 'K', Pitches: [{ Pitch: 300, Name: 'a' }] }] }] });
    const r = getCubaseDrumMap(m, 'K', null, defaultExportSettings);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('pitch-out-of-range');
  });
});

describe('NoteMapper / QBDrummer', () => {
  const ref = (k: number): KitRef => ({ pluginIndex: 0, kitIndex: k });

  it('QBDrummer CSV: ヘッダー、ID昇順、Sub=補間前の直接割当なし、複数Pitchを | 連結、CRLF', () => {
    const m = load({
      Plugins: [{ Kits: [{ Name: 'K', Pitches: [
        { Pitch: 40, Name: 'a', ArticulationID: 2 }, { Pitch: 41, Name: 'b', ArticulationID: 2, Separator: 'Duplicate' }] }] }],
      Parts: [{ ID: 1, Articulations: [{ ID: 2, Name: 'Two' }, { ID: 1, Name: 'One' }, { ID: 3, Name: 'Three' }] }],
    });
    const r = getQbDrummerCsv(m, 'K');
    expect(r.ok && r.value).toBe(['ID,Sub,Name,Pitchs', '1,1,One,40', '2,0,Two,40|41', '3,1,Three,40', ''].join(CRLF));
  });

  it('NoteMapper: Forward / Reverse の対応ペア（Pitch昇順）。ペアは対象KitのResolver基準', () => {
    const r = getNoteMapperTemplate(map(), ref(0), [ref(0), ref(1)]);
    expect(r.ok && r.value).toBe([
      '>Forward Conversion',
      // Base=K(38→Snare, 42→Closed, 46→Open)。K2 は Closed(50) のみ直接割当。Open は同Partの後方補間で 50、
      // Snare は Pitch が空だが Resolver の項目はあるため、Windows版は 0 を入れる（ペアが消えるわけではない）
      'K To K;0,127;38>38,42>42,46>46',
      'K To K2;0,127;38>0,42>50,46>50',
      '>Reverse Conversion',
      'K To K;0,127;38>38,42>42,46>46',
      'K2 To K;0,127;50>42',
      '',
    ].join(CRLF));
  });

  it('NoteMapper: 選択Kitは Plugin→Kit の DisplayOrder 順に並べ替える', () => {
    const r = getNoteMapperTemplate(map(), ref(0), [ref(1), ref(0)]);
    expect(r.ok && r.value.split(CRLF)[1]).toBe('K To K;0,127;38>38,42>42,46>46');
  });
});

describe('出力ファイルの組み立て', () => {
  const all: KitRef[] = [{ pluginIndex: 0, kitIndex: 0 }, { pluginIndex: 0, kitIndex: 1 }];

  it('パスは {Plugin}/{Kit}.{拡張子}、BOM: Studio One / Cubase / NoteMapper は付ける、TSV / CSV は付けない', () => {
    const m = map();
    const exp = (f: Parameters<typeof exportKits>[1]) => {
      const r = exportKits(m, f, all, defaultExportSettings, { baseOn: all[0]! });
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    expect(exp('studioOne').map((f) => [f.path, f.bom])).toEqual([['Plug/K.pitchlist', true], ['Plug/K2.pitchlist', true]]);
    expect(exp('cubase').map((f) => [f.path, f.bom])).toEqual([['Plug/K.drm', true], ['Plug/K2.drm', true]]);
    expect(exp('cubaseBaseOn').map((f) => f.path)).toEqual(['Plug/K.drm', 'Plug/K2.drm']);
    expect(exp('tsv').map((f) => [f.path, f.bom])).toEqual([['Plug/K.tsv', false], ['Plug/K2.tsv', false]]);
    expect(exp('qbDrummer').map((f) => [f.path, f.bom])).toEqual([['Plug/K.csv', false], ['Plug/K2.csv', false]]);
    const nm = exportNoteMapper(m, all[0]!, all);
    expect(nm.ok && [nm.value.path, nm.value.bom]).toEqual(['Templates.txt', true]);
    const bytes = utf8Bytes('あ', true);
    expect([...bytes]).toEqual([0xef, 0xbb, 0xbf, 0xe3, 0x81, 0x82]);
  });

  it('ファイル名の安全化は出力時のみ。モデルの名前は変更しない', () => {
    const m = load({ Plugins: [{ Name: 'P:1', Kits: [{ Name: 'a/b*c?', Pitches: [{ Pitch: 1, Name: 'x' }] }] }] });
    const r = exportKits(m, 'tsv', [{ pluginIndex: 0, kitIndex: 0 }], defaultExportSettings);
    expect(r.ok && r.value[0]!.path).toBe('P_1/a_b_c_.tsv');
    expect(m.Plugins[0]!.Kits[0]!.Name).toBe('a/b*c?');
    expect(toSafeFileName('ok name.ext')).toBe('ok name.ext');
  });

  it('入力モデルを変更しない／いずれかのKitでエラーなら部分出力しない', () => {
    const m = map();
    const before = JSON.stringify(m);
    expect(exportKits(m, 'cubase', all, defaultExportSettings).ok).toBe(true);
    expect(JSON.stringify(m)).toBe(before);
    const bad = load({ Plugins: [{ Name: 'P', Kits: [
      { Name: 'ok', Pitches: [{ Pitch: 1, Name: 'a' }] }, { Name: 'ng', Pitches: [{ Pitch: 999, Name: 'a' }] }] }] });
    const r = exportKits(bad, 'cubase', [{ pluginIndex: 0, kitIndex: 0 }, { pluginIndex: 0, kitIndex: 1 }], defaultExportSettings);
    expect(r.ok).toBe(false);
  });
});

describe('XML パーサ', () => {
  it('宣言・コメント・属性（単引用符）・文字参照・CDATA・自己終了タグ', () => {
    const r = parseXml('﻿<?xml version="1.0"?>\n<!-- c --><a x=\'1&amp;2\' y="&#65;&#x42;"><b/><![CDATA[<>]]><c z="a\nb"></c></a>');
    expect(r.attrs).toEqual({ x: '1&2', y: 'AB' });
    expect(r.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(r.children[1]!.attrs['z']).toBe('a b'); // 属性値内の改行は空白に正規化される
  });

  it.each([
    ['閉じていない', '<a>'], ['終了タグ不一致', '<a></b>'], ['ルートが複数', '<a/><b/>'], ['属性重複', '<a x="1" x="2"/>'],
    ['裸の &', '<a x="&"/>'], ['属性値に <', '<a x="<"/>'], ['引用符なし', '<a x=1/>'], ['制御文字', '<a x="\u0001"/>'],
    ['DTD', '<!DOCTYPE a><a/>'], ['空', ''],
  ])('整形式でない: %s', (_n, text) => {
    expect(() => parseXml(text)).toThrow();
  });
});
