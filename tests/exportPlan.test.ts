import { describe, expect, it } from 'vitest';
import {
  cloneMap, defaultExportSettings, exportKits, exportNoteMapper, findUndefinedSeparators, parseQbd, utf8Bytes, type KitRef, type MapData,
} from '../src/core';
import {
  archiveNameFor, buildExport, EXPORT_FORMATS, SEPARATOR_SENSITIVE, type UiExportFormat,
} from '../src/ui/export/exportPlan';

const load = (o: unknown): MapData => {
  const r = parseQbd(JSON.stringify(o));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const ref = (p: number, k: number): KitRef => ({ pluginIndex: p, kitIndex: k });

/** P1/Good（正常）、P1/Bad（Name あり・割当ありの行に未定義Separator=7）、P2/Hidden（空Nameの行に未定義Separator）、P2/Good2 */
const base = (): MapData => load({
  Plugins: [
    { ID: 1, Name: 'P1', Kits: [
      { ID: 1, Name: 'Good', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }, { Pitch: 38, Name: 'Snare', ArticulationID: 2, Separator: 'Separate' }] },
      { ID: 2, Name: 'Bad', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }, { Pitch: 40, Name: 'Rim', ArticulationID: 2, Separator: 7 }] },
    ] },
    { ID: 2, Name: 'P2', Kits: [
      { ID: 3, Name: 'Hidden', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }, { Pitch: 41, Name: '', ArticulationID: 0, Separator: 9 }] },
      { ID: 4, Name: 'Good2', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }] },
    ] },
  ],
  Parts: [{ ID: 1, Name: 'Part', Articulations: [{ ID: 1, Name: 'Kick' }, { ID: 2, Name: 'Snare' }] }],
});

const all = [ref(0, 0), ref(0, 1), ref(1, 0), ref(1, 1)];
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('出力設定の既定', () => {
  it('設定を渡さない場合は Core の既定（UseArticulation / UseArticulationPitchName ともに true）で出力する', () => {
    expect(defaultExportSettings).toEqual({ useArticulation: true, useArticulationPitchName: true });
    const a = buildExport(base(), { format: 'studioOne', kits: [ref(0, 0)], baseOn: null });
    const b = buildExport(base(), { format: 'studioOne', kits: [ref(0, 0)], baseOn: null }, defaultExportSettings);
    if (!a.ok || !b.ok) throw new Error('x');
    expect(a.bundle.download.bytes).toEqual(b.bundle.download.bytes);
  });
});

describe('buildExport: 単一／複数ファイル', () => {
  it('1 Kit は ZIP にせず、そのファイル名・BOM 付きバイト列でダウンロードする（Studio One）', () => {
    const o = buildExport(base(), { format: 'studioOne', kits: [ref(0, 0)], baseOn: null });
    if (!o.ok) throw new Error(o.error.message);
    expect(o.bundle.download.fileName).toBe('Good.pitchlist');
    expect(Array.from(o.bundle.download.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(o.bundle.download.bytes.slice(3))).toBe(o.bundle.files[0]!.content);
  });

  it('TSV は BOM なし・CRLF のバイト列。QBDrummer CSV も BOM なし', () => {
    for (const [format, ext] of [['tsv', 'tsv'], ['qbDrummer', 'csv']] as const) {
      const o = buildExport(base(), { format, kits: [ref(0, 0)], baseOn: null });
      if (!o.ok) throw new Error(o.error.message);
      expect(o.bundle.download.fileName).toBe(`Good.${ext}`);
      expect(o.bundle.download.bytes[0]).not.toBe(0xef);
      expect(o.bundle.download.bytes).toEqual(utf8Bytes(o.bundle.files[0]!.content, false));
      expect(text(o.bundle.download.bytes)).toContain('\r\n');
    }
  });

  it('複数 Kit は ZIP（Plugin 別階層）。アーカイブ名は形式名入り', () => {
    const o = buildExport(base(), { format: 'tsv', kits: all, baseOn: null });
    if (!o.ok) throw new Error(o.error.message);
    expect(o.bundle.download.fileName).toBe('QBDrumMap Export (Text).zip');
    expect(o.bundle.download.mime).toBe('application/zip');
    expect(o.bundle.files.map((f) => f.path)).toEqual(['P1/Good.tsv', 'P1/Bad.tsv', 'P2/Hidden.tsv', 'P2/Good2.tsv']);
  });

  it('NoteMapper は選択 Kit 数に関係なく Templates.txt 1つ（ZIPにしない）', () => {
    const m = base();
    const o = buildExport(m, { format: 'noteMapper', kits: [ref(0, 0), ref(1, 1)], baseOn: ref(0, 0) });
    if (!o.ok) throw new Error(o.error.message);
    expect(o.bundle.download.fileName).toBe('Templates.txt');
    const direct = exportNoteMapper(m, ref(0, 0), [ref(0, 0), ref(1, 1)]);
    if (!direct.ok) throw new Error('x');
    expect(o.bundle.download.bytes).toEqual(utf8Bytes(direct.value.content, true));
  });

  it('Base Kit が必要な形式で Base Kit が無いとエラー', () => {
    for (const format of ['cubaseBaseOn', 'noteMapper'] as const) {
      const o = buildExport(base(), { format, kits: [ref(0, 0)], baseOn: null });
      expect(o.ok).toBe(false);
      if (!o.ok) expect(o.error.code).toBe('base-on-required');
    }
  });

  it('対象 Kit なしは no-target', () => {
    const o = buildExport(base(), { format: 'tsv', kits: [], baseOn: null });
    expect(!o.ok && o.error.code).toBe('no-target');
  });

  it('出力名の衝突（安全化後に同じ名前・大文字小文字違い）は (2) (3) で回避する', () => {
    const m = load({
      Plugins: [{ ID: 1, Name: 'P', Kits: [
        { ID: 1, Name: 'A:B', Pitches: [{ Pitch: 36, Name: 'x' }] },
        { ID: 2, Name: 'a_b', Pitches: [{ Pitch: 36, Name: 'x' }] },
        { ID: 3, Name: 'A_B', Pitches: [{ Pitch: 36, Name: 'x' }] },
      ] }],
    });
    const o = buildExport(m, { format: 'tsv', kits: [ref(0, 0), ref(0, 1), ref(0, 2)], baseOn: null });
    if (!o.ok) throw new Error(o.error.message);
    expect(o.bundle.files.map((f) => f.path)).toEqual(['P/A_B.tsv', 'P/a_b (2).tsv', 'P/A_B (3).tsv']);
  });

  it('archiveNameFor は全形式で .zip', () => {
    for (const f of EXPORT_FORMATS) expect(archiveNameFor(f.id)).toMatch(/^QBDrumMap Export \(.+\)\.zip$/);
  });

  it('作業モデルは出力で変化しない', () => {
    const m = base();
    const before = JSON.stringify(m);
    buildExport(m, { format: 'studioOne', kits: all, baseOn: null });
    buildExport(m, { format: 'tsv', kits: all, baseOn: null });
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('未定義 Separator の事前検証は Core の実際のエラー条件と一致する', () => {
  const formats = EXPORT_FORMATS.map((f) => f.id);

  it('全形式×全 Kit で、ブロックの有無とエラーコードが Core の結果と一致する', () => {
    const m = base();
    for (const format of formats) {
      for (const k of all) {
        const core = format === 'noteMapper'
          ? exportNoteMapper(m, ref(0, 0), [k])
          : exportKits(m, format, [k], defaultExportSettings, { baseOn: ref(0, 0) });
        const o = buildExport(m, { format, kits: [k], baseOn: ref(0, 0) });
        expect(o.ok, `${format} ${k.pluginIndex}/${k.kitIndex}`).toBe(core.ok);
        if (!o.ok && !core.ok) expect(o.error.code).toBe(core.error.code);
      }
    }
  });

  it('Studio One / Cubase: 対象に Bad を含むと全体を出力せずブロックし、Plugin・Kit・Pitch・値を示す', () => {
    for (const format of ['studioOne', 'cubase'] as const) {
      const o = buildExport(base(), { format, kits: all, baseOn: null });
      expect(o.ok).toBe(false);
      if (o.ok) continue;
      expect(o.error.code).toBe('undefined-separator');
      // Hidden は空Nameの行だけが未定義なので、Core は拒否しない（ブロック対象にならない）
      expect(o.blockers.map((b) => `${b.pluginName}/${b.kitName}`)).toEqual(['P1/Bad']);
      expect(o.blockers[0]!.separatorRows.map((r) => [r.pluginName, r.kitName, r.pitch, r.name, r.value])).toEqual([['P1', 'Bad', 40, 'Rim', 7]]);
    }
  });

  it('対象外 Kit の異常値ではブロックしない（Bad を選ばなければ出力できる）', () => {
    for (const format of ['studioOne', 'cubase'] as const) {
      expect(buildExport(base(), { format, kits: [ref(0, 0), ref(1, 0), ref(1, 1)], baseOn: null }).ok, format).toBe(true);
    }
  });

  it('Separator に無関係な形式（TSV・QBDrummer・NoteMapper）は Bad を含んでもブロックしない', () => {
    for (const format of ['tsv', 'qbDrummer'] as const) expect(buildExport(base(), { format, kits: all, baseOn: null }).ok, format).toBe(true);
    expect(buildExport(base(), { format: 'noteMapper', kits: all, baseOn: ref(0, 0) }).ok).toBe(true);
    expect(SEPARATOR_SENSITIVE.has('tsv')).toBe(false);
  });

  it('TSV は未定義 Separator を数値の文字列で出力する（黙って None にしない）', () => {
    const o = buildExport(base(), { format: 'tsv', kits: [ref(0, 1)], baseOn: null });
    if (!o.ok) throw new Error('x');
    expect(o.bundle.files[0]!.content).toContain('\t7\r\n');
  });

  it('Base-On: 未定義 Separator が Base Kit 側にあるとブロックされ、Base Kit の行が示される', () => {
    const o = buildExport(base(), { format: 'cubaseBaseOn', kits: [ref(1, 1)], baseOn: ref(0, 1) });
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.blockers[0]!.baseOn).toBe(true);
    expect(o.blockers[0]!.separatorRows[0]!.kitName).toBe('Bad');
  });

  it('検査後も未定義 Separator は残る（自動修正しない）', () => {
    const m = base();
    buildExport(m, { format: 'studioOne', kits: all, baseOn: null });
    expect(findUndefinedSeparators(m)).toHaveLength(2);
  });

  it('全形式を実行しても入力モデルは複製と一致する', () => {
    const m = base();
    const c = cloneMap(m);
    for (const format of formats as UiExportFormat[]) buildExport(m, { format, kits: all, baseOn: ref(0, 0) });
    expect(m).toEqual(c);
  });
});

describe('同名 Kit: 選択した Kit を特定できない出力は中止する（回帰）', () => {
  /** P1/Dup(36)、P1/Other、P2/Dup(40。同名の2つ目)、P2/Dup2 */
  const dup = (): MapData => load({
    Plugins: [
      { ID: 1, Name: 'P1', Kits: [
        { ID: 1, Name: 'Dup', Pitches: [{ Pitch: 36, Name: 'First', ArticulationID: 1 }] },
        { ID: 2, Name: 'Other', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }] },
      ] },
      { ID: 2, Name: 'P2', Kits: [
        { ID: 3, Name: 'Dup', Pitches: [{ Pitch: 40, Name: 'Second', ArticulationID: 1 }] },
      ] },
    ],
    Parts: [{ ID: 1, Name: 'Part', Articulations: [{ ID: 1, Name: 'Kick' }] }],
  });
  const first = ref(0, 0);
  const second = ref(1, 0);
  const nameResolved = ['studioOne', 'cubase', 'qbDrummer'] as const;

  it('Core は2つ目の同名 Kit を選んでも最初の Kit の内容を出力する（既存の挙動。変更しない）', () => {
    const m = dup();
    const r = exportKits(m, 'qbDrummer', [second], defaultExportSettings);
    const f = exportKits(m, 'qbDrummer', [first], defaultExportSettings);
    if (!r.ok || !f.ok) throw new Error('x');
    expect(r.value[0]!.content).toBe(f.value[0]!.content);
  });

  it('名前で引く形式は、2つ目の同名 Kit を含むと出力せずブロックし、原因の Kit と代わりに使われる Kit を示す', () => {
    for (const format of nameResolved) {
      const o = buildExport(dup(), { format, kits: [first, second], baseOn: null });
      expect(o.ok, format).toBe(false);
      if (o.ok) continue;
      expect(o.error.code).toBe('ambiguous-kit-name');
      expect(o.blockers.map((b) => [b.pluginName, b.kitName, b.resolvedInstead])).toEqual([['P2', 'Dup', 'P1 / Dup']]);
    }
  });

  it('最初の同名 Kit だけ・同名でない Kit だけなら出力できる（Core が実際に使う Kit と一致するため）', () => {
    for (const format of nameResolved) {
      expect(buildExport(dup(), { format, kits: [first, ref(0, 1)], baseOn: null }).ok, format).toBe(true);
    }
  });

  it('TSV は位置で引くので、同名 Kit でも内容が正しく出力できる（ブロックしない）', () => {
    const o = buildExport(dup(), { format: 'tsv', kits: [first, second], baseOn: null });
    if (!o.ok) throw new Error(o.error.message);
    expect(o.bundle.files[0]!.content).toContain('First');
    expect(o.bundle.files[1]!.content).toContain('Second');
  });

  it('Base Kit が2つ目の同名 Kit のときもブロックする（Base-On・NoteMapper）。対象外の Kit では起きない', () => {
    for (const format of ['cubaseBaseOn', 'noteMapper'] as const) {
      const o = buildExport(dup(), { format, kits: [ref(0, 1)], baseOn: second });
      expect(o.ok, format).toBe(false);
      if (!o.ok) {
        expect(o.error.code).toBe('ambiguous-kit-name');
        expect(o.blockers[0]!.baseOn).toBe(true);
      }
      expect(buildExport(dup(), { format, kits: [ref(0, 1)], baseOn: first }).ok, format).toBe(true);
    }
  });

  it('ブロック時も作業モデルは不変で、重複は自動で変更されない', () => {
    const m = dup();
    const c = cloneMap(m);
    buildExport(m, { format: 'studioOne', kits: [first, second], baseOn: null });
    expect(m).toEqual(c);
  });
});
