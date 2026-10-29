import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  autoAssignArticulations, convertMidi, defaultExportSettings, defaultPartNameDictionary, exportKits, getArticulationMap,
  getKitPitchOrder, parseQbd, separatorToString, serializeQbd, type ExportFormat, type KitRef, type MapData,
} from '../src/core';
import { generateAutoAssignInputs } from './golden/autoAssignInputs';

// Core 統合・回帰確認（Phase 1〜5b）。Windows互換モードのC#照合は tests/golden/、MIDI のWeb改善は midiWeb.test.ts。
// ここでは複数機能をまたぐ流れ（読み込み→Auto Assign→保存→再読み込み→Resolver→出力→MIDI変換）の整合性を確認する。

const inputs = generateAutoAssignInputs(600);
const refsOf = (m: MapData): KitRef[] => m.Plugins.flatMap((p, pi) => p.Kits.map((_, ki) => ({ pluginIndex: pi, kitIndex: ki })));
const load = (json: unknown): MapData => {
  const r = parseQbd(typeof json === 'string' ? json : JSON.stringify(json));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
/** ID の付け替え（FixID）に影響されない比較用の状態: Articulation は Part 名と Articulation 名で表す */
function nameState(m: MapData): string {
  const artName = (id: number): string => {
    for (const p of m.Parts) for (const a of p.Articulations) if (a.ID === id) return `${p.Name}/${a.Name}`;
    return id === 0 ? '-' : `?${id}`;
  };
  return m.Plugins.map((pl) => pl.Kits.map((k) =>
    `${k.Name}=${k.Pitches.map((x) => `${x.Pitch}:${x.Name ?? '<null>'}:${artName(x.ArticulationID)}:${separatorToString(x.Separator)}`).join(';')}`).join('|')).join('||');
}
const FORMATS: ExportFormat[] = ['studioOne', 'cubase', 'tsv', 'qbDrummer'];
/** 入力に壊れた参照（存在しないID）が無い入力か */
const hasOnlyValidIds = (m: MapData): boolean => {
  const ids = new Set(m.Parts.flatMap((p) => p.Articulations.map((a) => a.ID)));
  return m.Plugins.every((pl) => pl.Kits.every((k) => k.Pitches.every((x) => x.ArticulationID === 0 || ids.has(x.ArticulationID))));
};

describe('統合: QBD 読み込み → Auto Assign → 保存 → 再読み込み', () => {
  it('保存・再読み込みで Auto Assign の結果が変わらない（Articulation は名前で比較。保存は2回目以降も安定）', () => {
    let saved = 0, skippedInvalid = 0;
    for (const inp of inputs) {
      const m = load(inp.map);
      if (!hasOnlyValidIds(m)) { skippedInvalid++; continue; } // 壊れた参照の入力は下の別テストで扱う
      if (!serializeQbd(m).ok) { skippedInvalid++; continue; } // 元から保存できない入力（ID=0 の Articulation の重複など）は別テスト
      const r = autoAssignArticulations(m, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      const s = serializeQbd(r.value.map);
      if (!s.ok) throw new Error(`${inp.tag}: ${s.error.code} ${s.error.message}`);
      const again = load(s.value.text);
      expect(nameState(again), inp.tag).toBe(nameState(r.value.map));
      const s2 = serializeQbd(again);
      expect(s2.ok && s2.value.text, `${inp.tag} 保存の安定`).toBe(s.value.text);
      saved++;
    }
    expect(saved).toBeGreaterThan(80);
    expect(skippedInvalid).toBeGreaterThan(0);
  });

  it('割当後の ArticulationID は保存後も Parts を指している（参照整合性）', () => {
    for (const inp of inputs) {
      const m = load(inp.map);
      if (!hasOnlyValidIds(m) || !serializeQbd(m).ok) continue;
      const r = autoAssignArticulations(m, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      expect(hasOnlyValidIds(r.value.map), `${inp.tag} 割当後`).toBe(true);
      const s = serializeQbd(r.value.map);
      if (!s.ok) throw new Error(inp.tag);
      expect(hasOnlyValidIds(s.value.normalized), `${inp.tag} 保存後`).toBe(true);
      expect(hasOnlyValidIds(load(s.value.text)), `${inp.tag} 再読み込み後`).toBe(true);
    }
  });

  it('壊れた参照（存在しないID）を含む入力でも Auto Assign は壊れた参照を増やさず（対象Kitの壊れた参照は有効なIDへ割り当て直され得る）、保存の成否が割当で変わらない', () => {
    let n = 0;
    for (const inp of inputs) {
      const m = load(inp.map);
      if (hasOnlyValidIds(m)) continue;
      const r = autoAssignArticulations(m, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      const ids = new Set(m.Parts.flatMap((p) => p.Articulations.map((a) => a.ID)));
      const count = (mm: MapData): number => mm.Plugins.flatMap((p) => p.Kits.flatMap((k) => k.Pitches)).filter((x) => x.ArticulationID !== 0 && !ids.has(x.ArticulationID)).length;
      expect(count(r.value.map), inp.tag).toBeLessThanOrEqual(count(m)); // 壊れた参照は増えない（割当は有効なIDのみ。対象Kitの壊れた参照は未割当として扱い、割り当て直す）
      expect(serializeQbd(r.value.map).ok, `${inp.tag} 保存の成否`).toBe(serializeQbd(m).ok);
      n++;
    }
    expect(n).toBeGreaterThan(20);
  });

  const WIN_QBD = fileURLToPath(new URL('../public/samples/DrumMap.qbd', import.meta.url));
  it.skipIf(!existsSync(WIN_QBD))('実ファイル DrumMap.qbd: 全Kitに Auto Assign（連続）→ 保存 → 再読み込みで状態が変わらない', () => {
    const m = load(readFileSync(WIN_QBD, 'utf8'));
    let cur = m;
    for (const ref of refsOf(m)) {
      const r = autoAssignArticulations(cur, ref, defaultPartNameDictionary());
      if (!r.ok) throw new Error(r.error.code);
      cur = r.value.map;
    }
    const s = serializeQbd(cur);
    if (!s.ok) throw new Error(s.error.message);
    expect(nameState(load(s.value.text))).toBe(nameState(cur));
    expect(hasOnlyValidIds(cur)).toBe(true);
  }, 60000);
});

describe('統合: Resolver と Auto Assign の連携', () => {
  it('割当後も全Kitの Resolver が（割当前に成功していれば）成功し、Item の ID は Parts に存在する。割当した行の Pitch は Item に現れる', () => {
    let checked = 0;
    for (const inp of inputs) {
      const m = load(inp.map);
      if (!hasOnlyValidIds(m)) continue;
      const refs = refsOf(m);
      const before = refs.map((r) => getArticulationMap(m, m.Plugins[r.pluginIndex]!.Kits[r.kitIndex]!.Name));
      const r = autoAssignArticulations(m, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      const ids = new Set(m.Parts.flatMap((p) => p.Articulations.map((a) => a.ID)));
      refs.forEach((ref, i) => {
        const kit = r.value.map.Plugins[ref.pluginIndex]!.Kits[ref.kitIndex]!;
        // 同名のKitがあるとKit名での解決は曖昧になるので、一意な名前のKitだけ確認する
        if (refs.filter((x) => m.Plugins[x.pluginIndex]!.Kits[x.kitIndex]!.Name === kit.Name).length !== 1) return;
        const after = getArticulationMap(r.value.map, kit.Name);
        if (!before[i]!.ok) return;
        expect(after.ok, `${inp.tag} ${kit.Name}`).toBe(true);
        if (!after.ok) return;
        for (const item of after.value.Items) if (item.ID !== 0) expect(ids.has(item.ID), `${inp.tag} Item.ID`).toBe(true);
        // 直接割当（IsSub でない）Item の Pitch は、そのKitの ArticulationID が一致する行の Pitch
        for (const item of after.value.Items) {
          if (item.IsSub) continue;
          for (const pitch of item.Pitches) {
            const row = kit.Pitches.find((x) => x.Pitch === pitch && x.ArticulationID === item.ID);
            expect(row, `${inp.tag} ${kit.Name} pitch ${pitch}`).toBeDefined();
          }
        }
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('Auto Assign が付けた Duplicate の行も、同じ Articulation の Pitch として Resolver に現れる', () => {
    const m = load({
      Plugins: [{ ID: 1, Name: 'P', Kits: [
        { ID: 1, Name: 'A', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }] },
        { ID: 2, Name: 'T', Pitches: [{ Pitch: 36, Name: 'Kick' }, { Pitch: 35, Name: 'BD' }, { Pitch: 34, Name: 'Zzz' }] },
      ] }],
      Parts: [{ ID: 1, Name: 'Kick', Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] }],
    });
    const r = autoAssignArticulations(m, { pluginIndex: 0, kitIndex: 1 }, defaultPartNameDictionary());
    if (!r.ok) throw new Error('x');
    expect(r.value.map.Plugins[0]!.Kits[1]!.Pitches.map((p) => `${p.Pitch}:${p.ArticulationID}:${separatorToString(p.Separator)}`)).toEqual(['36:1:None', '35:1:Duplicate', '34:0:Separate']);
    const a = getArticulationMap(r.value.map, 'T');
    if (!a.ok) throw new Error('x');
    const kick = a.value.Items.find((i) => i.ID === 1)!;
    expect(kick.Pitches).toEqual(expect.arrayContaining([36, 35]));
    // 表示順（DAW順）: 割当あり・区切りなし → 区切り行 → 割当あり・区切りあり（Duplicate）→ 割当なし・区切りあり（Separate）
    const order = getKitPitchOrder(r.value.map, 'T', { useArticulation: true });
    if (!order.ok) throw new Error('x');
    expect(order.value.map((p) => p.Pitch)).toEqual([36, 0, 35, 34]);
  });
});

describe('統合: Import / Export / MIDI変換への影響', () => {
  it('Auto Assign は入力モデルと、その入力から作った出力を変えない。結果のモデルの出力も成功する（表示順・DisplayOrder・行の並びは不変）', () => {
    let n = 0;
    for (const inp of inputs) {
      const m = load(inp.map);
      if (!hasOnlyValidIds(m)) continue;
      const refs = refsOf(m);
      const snap = JSON.stringify(m);
      const exportAll = (mm: MapData) => FORMATS.map((f) => {
        const r = exportKits(mm, f, refs, defaultExportSettings);
        return r.ok ? r.value.map((x) => `${x.path}\n${x.content}`).join('\u0000') : `ERR:${r.error.code}`;
      });
      const before = exportAll(m);
      const r = autoAssignArticulations(m, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      expect(JSON.stringify(m), `${inp.tag} 入力不変`).toBe(snap);
      expect(exportAll(m), `${inp.tag} 入力からの出力が不変`).toEqual(before);
      // 割当前後で、行の並び（Pitch・Name・DisplayOrder）と Kit・Plugin の並びは同じ
      const shape = (mm: MapData): string => JSON.stringify(mm.Plugins.map((p) => [p.Name, p.DisplayOrder, p.Kits.map((k) => [k.Name, k.DisplayOrder, k.Pitches.map((x) => [x.Pitch, x.Name, x.DisplayOrder])])]));
      expect(shape(r.value.map), inp.tag).toBe(shape(m));
      // 結果のモデルでも、割当前に成功した出力は成功する
      const after = exportAll(r.value.map);
      // 未定義のSeparator値（99 など）を持つ行は、Articulation を割り当てると Articulation 順の出力に入り、出力エラーになり得る（下の別テスト）
      const hasUndefinedSep = m.Plugins.some((p) => p.Kits.some((k) => k.Pitches.some((x) => typeof x.Separator === 'number' && (x.Separator < 0 || x.Separator > 3))));
      if (!hasUndefinedSep) {
        before.forEach((b, i) => { if (!b.startsWith('ERR:')) expect(after[i]!.startsWith('ERR:'), `${inp.tag} ${FORMATS[i]}`).toBe(false); });
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it('【確認事項】未定義のSeparator値（Windows版と同様に保持）を持つ行に Auto Assign が ID を割り当てると、その Kit の Articulation 順の出力はエラーになる（割当前は成功）', () => {
    const m = load({
      Plugins: [{ ID: 1, Name: 'P', Kits: [
        { ID: 1, Name: 'A', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }] },
        { ID: 2, Name: 'T', Pitches: [{ Pitch: 36, Name: 'Kick', Separator: 99 }] },
      ] }],
      Parts: [{ ID: 1, Name: 'Kick', Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] }],
    });
    const ref = { pluginIndex: 0, kitIndex: 1 };
    expect(exportKits(m, 'studioOne', [ref], defaultExportSettings).ok).toBe(true);
    const r = autoAssignArticulations(m, ref, defaultPartNameDictionary());
    if (!r.ok) throw new Error('x');
    expect(r.value.map.Plugins[0]!.Kits[1]!.Pitches[0]!.Separator).toBe(99); // 割り当てた行の Separator は変更しない（Windows版と同じ）
    const after = exportKits(r.value.map, 'studioOne', [ref], defaultExportSettings);
    expect(after.ok).toBe(false);
  });

  it('変更していないKit同士のMIDI変換は、別のKitへの Auto Assign の前後で同じ出力（バイト一致）', () => {
    // 4小節の簡単な入力: ドラムの NoteOn/Off を 36–47 に並べる
    const ev: number[] = [];
    let last = 0;
    for (let i = 0; i < 24; i++) {
      const t = i * 120;
      const d = (n: number): number[] => { const o = [n & 0x7f]; for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) o.unshift((v & 0x7f) | 0x80); return o; };
      ev.push(...d(t - last), 0x99, 36 + (i % 12), 100, ...d(60), 0x89, 36 + (i % 12), 0);
      last = t + 60;
    }
    ev.push(0, 0xff, 0x2f, 0);
    const smf = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, (ev.length >>> 24) & 255, (ev.length >>> 16) & 255, (ev.length >>> 8) & 255, ev.length & 255, ...ev]);
    let compared = 0;
    for (const inp of inputs) {
      const m = load(inp.map);
      const refs = refsOf(m);
      if (refs.length < 3) continue;
      const mod = { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] };
      const others = refs.filter((x) => x.pluginIndex !== mod.pluginIndex || x.kitIndex !== mod.kitIndex);
      const base = others[0]!;
      const targets = others.slice(1);
      const convert = (mm: MapData) => convertMidi(mm, base, targets, smf, 'a.mid', { format: 1 });
      const a = convert(m);
      const r = autoAssignArticulations(m, mod, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      const b = convert(r.value.map);
      expect(b.ok, inp.tag).toBe(a.ok);
      if (a.ok && b.ok) expect(Buffer.from(b.value.files[0]!.bytes).equals(Buffer.from(a.value.files[0]!.bytes)), inp.tag).toBe(true);
      compared++;
    }
    expect(compared).toBeGreaterThan(50);
  });

  it('Auto Assign した Kit を Base Kit にした MIDI変換が成功し、割り当てた Articulation の Pitch が変換される', () => {
    const m = load({
      Plugins: [{ ID: 1, Name: 'P', Kits: [
        { ID: 1, Name: 'T', Pitches: [{ Pitch: 60, Name: 'Kick', ArticulationID: 1 }] },
        { ID: 2, Name: 'B', Pitches: [{ Pitch: 36, Name: 'Kick' }] },
      ] }],
      Parts: [{ ID: 1, Name: 'Kick', Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] }],
    });
    const smf = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0, 0x99, 36, 100, 10, 0x89, 36, 0, 0, 0xff, 0x2f, 0]);
    const before = convertMidi(m, { pluginIndex: 0, kitIndex: 1 }, [{ pluginIndex: 0, kitIndex: 0 }], smf, 'a.mid', { format: 1 });
    expect(before.ok).toBe(true);
    // 割当前: B の 36 は未割当 → すべて #B 側（T への出力に NoteOn なし）
    const r = autoAssignArticulations(m, { pluginIndex: 0, kitIndex: 1 }, defaultPartNameDictionary());
    if (!r.ok) throw new Error('x');
    const after = convertMidi(r.value.map, { pluginIndex: 0, kitIndex: 1 }, [{ pluginIndex: 0, kitIndex: 0 }], smf, 'a.mid', { format: 1 });
    if (!after.ok || !before.ok) throw new Error('x');
    const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
    expect(hex(before.value.files[0]!.bytes)).not.toContain('993c64');
    expect(hex(after.value.files[0]!.bytes)).toContain('993c64'); // 36 → 60 (0x3c)
  });
});

describe('統合: 不正データ・入力モデルの不変性・部分更新の防止', () => {
  it('不正な参照は何も変更せずエラーを返す', () => {
    const m = load(inputs[0]!.map);
    const snap = JSON.stringify(m);
    for (const ref of [{ pluginIndex: 99, kitIndex: 0 }, { pluginIndex: 0, kitIndex: 99 }, { pluginIndex: -1, kitIndex: -1 }]) {
      const r = autoAssignArticulations(m, ref, defaultPartNameDictionary());
      expect(r.ok).toBe(false);
    }
    expect(JSON.stringify(m)).toBe(snap);
  });

  it('不正な QBD（JSON構文エラー・型違い・未定義の列挙名）は読み込みエラーで、モデルを返さない', () => {
    for (const bad of ['', '{', '[]', 'null', '{"Plugins":{}}', '{"Plugins":[{"Kits":[{"Pitches":[{"Pitch":"a"}]}]}]}',
      '{"Plugins":[{"Kits":[{"Pitches":[{"Pitch":1,"Separator":"Nope"}]}]}]}']) {
      expect(parseQbd(bad).ok, bad).toBe(false);
    }
  });

  it('保存エラー（Articulation ID の重複）でも入力モデルを変更しない。Auto Assign の結果にも同じエラーが残り、割当が保存を壊さない', () => {
    const m = load({
      Plugins: [{ ID: 1, Name: 'P', Kits: [{ ID: 1, Name: 'K', Pitches: [{ Pitch: 36, Name: 'Kick' }] }] }],
      Parts: [{ ID: 1, Name: 'Kick', Articulations: [{ ID: 5, Name: 'Kick', DrumMapOrder: 1 }, { ID: 5, Name: 'Kick2', DrumMapOrder: 2 }] }],
    });
    const snap = JSON.stringify(m);
    const s = serializeQbd(m);
    expect(s.ok).toBe(false);
    expect(JSON.stringify(m)).toBe(snap);
    const r = autoAssignArticulations(m, { pluginIndex: 0, kitIndex: 0 }, defaultPartNameDictionary());
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeQbd(r.value.map).ok).toBe(false);
    expect(JSON.stringify(m)).toBe(snap);
  });

  it('Auto Assign の結果を保存しても、入力モデルは変更されない（FixID は複製に対して行われる）', () => {
    for (const inp of inputs.slice(0, 100)) {
      const m = load(inp.map);
      const r = autoAssignArticulations(m, { pluginIndex: inp.kit[0], kitIndex: inp.kit[1] }, inp.dictionary);
      if (!r.ok) throw new Error(inp.tag);
      const snap = JSON.stringify(r.value.map);
      serializeQbd(r.value.map);
      expect(JSON.stringify(r.value.map), inp.tag).toBe(snap);
    }
  });
});
