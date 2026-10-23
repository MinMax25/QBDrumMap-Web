import { describe, expect, it } from 'vitest';
import { cloneMap, importPitchlist, parseQbd, serializeQbd, type KitRef } from '../src/core';
import { parseXml, XML_MAX_DEPTH, XmlParseError } from '../src/core/xml';

// セキュリティ監査 F-02（XMLの入れ子深度）・F-03（__proto__ 等のキー）の回帰テスト。

const nest = (depth: number): string => '<a>'.repeat(depth) + '</a>'.repeat(depth);

describe('F-02: XML の入れ子深度', () => {
  it('上限ちょうどは解析でき、上限を1つ超えると XmlParseError', () => {
    expect(() => parseXml(nest(XML_MAX_DEPTH))).not.toThrow();
    expect(() => parseXml(nest(XML_MAX_DEPTH - 1))).not.toThrow();
    expect(() => parseXml(nest(XML_MAX_DEPTH + 1))).toThrow(XmlParseError);
  });

  it('深度5000でもスタック超過ではなく XmlParseError になる', () => {
    expect(() => parseXml(nest(5000))).toThrow(XmlParseError);
    expect(() => parseXml(nest(5000))).not.toThrow(RangeError);
  });

  it('深すぎる pitchlist は invalid-xml で失敗し、元のモデルは変わらない。その後の正常なファイルは読める', () => {
    const r = parseQbd(JSON.stringify({ Plugins: [{ ID: 1, Name: 'P', Kits: [{ ID: 1, Name: 'K', Pitches: [{ Pitch: 36, Name: 'x' }] }] }] }));
    if (!r.ok) throw new Error(r.error.message);
    const map = r.value;
    const before = JSON.stringify(map);
    const ref: KitRef = { pluginIndex: 0, kitIndex: 0 };
    const bad = importPitchlist(map, ref, `<Music.PitchNameList title="t">${nest(5000)}</Music.PitchNameList>`, 'x.pitchlist');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid-xml');
    expect(JSON.stringify(map)).toBe(before);
    const good = importPitchlist(map, ref, '<Music.PitchNameList title="T"><Music.PitchName pitch="36" name="Kick"/></Music.PitchNameList>', 'x.pitchlist');
    expect(good.ok).toBe(true);
  });
});

describe('F-03: XML 属性辞書', () => {
  it('__proto__ / constructor / toString が単独で現れても正常に読める', () => {
    const e = parseXml('<a __proto__="1" constructor="2" toString="3" hasOwnProperty="4"/>');
    expect(e.attrs['__proto__']).toBe('1');
    expect(e.attrs['constructor']).toBe('2');
    expect(e.attrs['toString']).toBe('3');
    expect(e.attrs['hasOwnProperty']).toBe('4');
    expect(Object.getPrototypeOf(e.attrs)).toBeNull();
  });

  it('属性が存在しないときは undefined（プロトタイプ由来の値を返さない）', () => {
    expect(parseXml('<a/>').attrs['constructor']).toBeUndefined();
  });

  it('同じ属性名が実際に二度出る場合は従来どおりエラー（特殊名でも同様）', () => {
    expect(() => parseXml('<a x="1" x="2"/>')).toThrow(XmlParseError);
    expect(() => parseXml('<a __proto__="1" __proto__="2"/>')).toThrow(XmlParseError);
    expect(() => parseXml('<a toString="1" toString="2"/>')).toThrow(XmlParseError);
  });
});

describe('F-03: Extra の __proto__ / constructor / toString', () => {
  const text = (): string => JSON.stringify({ Plugins: [] }).slice(0, -1)
    + ',"__proto__":{"polluted":1},"constructor":"c","toString":"t","prototype":5}';
  const withProto = '{"Plugins":[{"ID":1,"Name":"P","__proto__":7,"Kits":[{"ID":1,"Name":"K","__proto__":{"k":1},"Pitches":[{"Pitch":1,"__proto__":null}]}]}],'
    + '"Parts":[{"ID":1,"Name":"Pt","__proto__":"s","Articulations":[{"ID":1,"Name":"A","__proto__":[1]}]}],"__proto__":{"polluted":1}}';

  it('読み込みでキーと値が own property として保持され、プロトタイプは変わらない', () => {
    const r = parseQbd(text());
    if (!r.ok) throw new Error(r.error.message);
    const x = r.value.Extra;
    expect(Object.getPrototypeOf(x)).toBe(Object.prototype);
    expect(Object.hasOwn(x, '__proto__')).toBe(true);
    expect(x['__proto__']).toEqual({ polluted: 1 });
    expect(x['constructor']).toBe('c');
    expect(x['toString']).toBe('t');
    expect(x['prototype']).toBe(5);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('全階層の __proto__ が 保存→再読込 で欠落せず、保存結果が安定する', () => {
    const r1 = parseQbd(withProto);
    if (!r1.ok) throw new Error(r1.error.message);
    const s1 = serializeQbd(r1.value);
    if (!s1.ok) throw new Error(s1.error.message);
    expect(s1.value.text).toContain('"__proto__"');
    const r2 = parseQbd(s1.value.text);
    if (!r2.ok) throw new Error(r2.error.message);
    const m = r2.value;
    expect(m.Extra['__proto__']).toEqual({ polluted: 1 });
    expect(m.Plugins[0]!.Extra['__proto__']).toBe(7);
    expect(m.Plugins[0]!.Kits[0]!.Extra['__proto__']).toEqual({ k: 1 });
    expect(m.Plugins[0]!.Kits[0]!.Pitches[0]!.Extra['__proto__']).toBeNull();
    expect(m.Parts[0]!.Extra['__proto__']).toBe('s');
    expect(m.Parts[0]!.Articulations[0]!.Extra['__proto__']).toEqual([1]);
    const s2 = serializeQbd(m);
    if (!s2.ok) throw new Error(s2.error.message);
    expect(s2.value.text).toBe(s1.value.text);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('cloneMap（編集履歴の複製）でも __proto__ が保持される', () => {
    const r = parseQbd(withProto);
    if (!r.ok) throw new Error(r.error.message);
    const c = cloneMap(r.value);
    expect(Object.hasOwn(c.Extra, '__proto__')).toBe(true);
    expect(c.Plugins[0]!.Extra['__proto__']).toBe(7);
  });

  it('特殊キーのない通常データの保存結果は変わらない', () => {
    const src = '{"Plugins":[{"ID":1,"Name":"P","Custom":1,"Kits":[]}],"Parts":[],"Top":"x"}';
    const r = parseQbd(src);
    if (!r.ok) throw new Error(r.error.message);
    const s = serializeQbd(r.value);
    if (!s.ok) throw new Error(s.error.message);
    expect(s.value.text).toContain('"Custom": 1');
    expect(s.value.text).toContain('"Top": "x"');
  });
});
