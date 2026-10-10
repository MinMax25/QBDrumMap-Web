import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateImportInputs } from './importInputs';
import {
  getArticulationMap, getCubaseDrumMap, getKitPitches, getNoteMapperTemplate, getQbDrummerCsv, getStudioOnePitchList,
  getTsvText, importDrm, importPitchlist, importTsv, parseQbd, separatorToString, serializeCubaseDrm,
  serializePitchList, utf8Bytes, type ExportSettings, type KitPitch, type KitRef, type MapData, type Result,
} from '../../src/core';

// cases.json: 決定的な疑似乱数で生成した入力（generateCases.ts）。
// expected.json: Windows版C#ソースを実行した結果。ハーネス(harness/)は ArticulationMap.cs / UtilMap.cs / PitchList.cs / CubaseDrumMap.cs /
// 取り込み・出力メソッド等を無改変で取り込み、モデルだけをスタブにしている。
// ※ Windows版アプリ本体(WPF)の実機実行ではない。ファイル出力はバイト列（SHA-256とバイト長）で比較する。
const dir = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8')) as unknown[];

interface FileExp { error: string | null; len: number; sha: string | null; b64: string | null }
interface KitState { Name: string; pitches: { Pitch: number; Name: string | null; ArticulationID: number; Separator: string; DisplayOrder: number }[] }
interface ImportExp { result: { error: string | null; kit: KitState | null } }
interface ExpectedKit {
  kit: string; pi: number; ki: number;
  artic: { error: string | null; items: unknown[] | null };
  settings: Record<string, { order: unknown[] | string; tsv: FileExp; pitchlist: FileExp; drm: FileExp; drmBaseOn: FileExp }>;
  qbDrummer: FileExp;
  imports: { pitchlist: ImportExp | null; drm: ImportExp | null; tsv: ImportExp } | null;
}
interface ExpectedCase { loadError: boolean; kits?: ExpectedKit[]; noteMapper?: FileExp }
const expected = JSON.parse(readFileSync(`${dir}/expected.json`, 'utf8')) as ExpectedCase[];

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').toUpperCase();
const SETTINGS: [string, ExportSettings][] = [
  ['11', { useArticulation: true, useArticulationPitchName: true }],
  ['01', { useArticulation: false, useArticulationPitchName: true }],
  ['10', { useArticulation: true, useArticulationPitchName: false }],
  ['00', { useArticulation: false, useArticulationPitchName: false }],
];

/** C#の出力(エラーまたはバイト列)とWeb Coreの出力が一致するか */
function expectFile(label: string, exp: FileExp, actual: Result<string> | string, bom: boolean): void {
  const r: Result<string> = typeof actual === 'string' ? { ok: true, value: actual } : actual;
  if (exp.error !== null) {
    expect(r.ok, `${label}: C#は例外(${exp.error})`).toBe(false);
    return;
  }
  expect(r.ok, `${label}: ${r.ok ? '' : r.error.message}`).toBe(true);
  if (!r.ok) return;
  const bytes = utf8Bytes(r.value, bom);
  if (sha(bytes) !== exp.sha && exp.b64 !== null) {
    // 差分の調査用: 全文が保存されているケースでは文字列として比較して差異を表示する
    expect(Buffer.from(bytes).toString('base64'), label).toBe(exp.b64);
  }
  expect({ len: bytes.length, sha: sha(bytes) }, label).toEqual({ len: exp.len, sha: exp.sha });
}

const rows = (ps: KitPitch[]): unknown[] =>
  ps.map((p) => ({ Pitch: p.Pitch, Name: p.Name, ArticulationID: p.ArticulationID, Separator: separatorToString(p.Separator) }));

function kitState(map: MapData, ref: KitRef): KitState {
  const k = map.Plugins[ref.pluginIndex]!.Kits[ref.kitIndex]!;
  return {
    Name: k.Name,
    pitches: k.Pitches.map((p) => ({
      Pitch: p.Pitch, Name: p.Name, ArticulationID: p.ArticulationID, Separator: separatorToString(p.Separator),
      DisplayOrder: p.DisplayOrder,
    })),
  };
}

function expectImport(label: string, exp: ImportExp, result: Result<MapData>, ref: KitRef): void {
  if (exp.result.error !== null) {
    expect(result.ok, `${label}: C#は例外(${exp.result.error})`).toBe(false);
    return;
  }
  expect(result.ok, `${label}: ${result.ok ? '' : result.error.message}`).toBe(true);
  if (result.ok) expect(kitState(result.value, ref), label).toEqual(exp.result.kit);
}

describe('Windows版C#コードの出力との照合（ランダム生成ケース）', () => {
  it('ケース数が一致する', () => {
    expect(expected).toHaveLength(cases.length);
  });

  it('全ケースで Resolver / DAW表示順 / 5形式の出力 / 3形式の取り込み が一致する', () => {
    const stats = { kits: 0, artError: 0, divider: 0, plErr: 0, drmErr: 0, imports: 0, importErr: 0, noteMapperErr: 0, nonEmptyNm: 0 };
    cases.forEach((c, i) => {
      const exp = expected[i]!;
      const r = parseQbd(JSON.stringify(c));
      expect(r.ok, `case ${i} Load`).toBe(!exp.loadError);
      if (!r.ok) return;
      const map = r.value;
      const baseOnName = map.Plugins[0]!.Kits[0]!.Name;

      exp.kits!.forEach((ek) => {
        stats.kits++;
        const tag = `case ${i} ${JSON.stringify(ek.kit)}`;
        const ref: KitRef = { pluginIndex: ek.pi, kitIndex: ek.ki };

        // Resolver
        const am = getArticulationMap(map, ek.kit);
        if (ek.artic.error !== null) {
          stats.artError++;
          expect(am.ok, `${tag} Resolver例外`).toBe(false);
          if (!am.ok) expect(am.error.message, tag).toBe(ek.artic.error);
        } else {
          expect(am.ok, tag).toBe(true);
          if (am.ok) expect(am.value.Items, `${tag} Resolver`).toEqual(ek.artic.items);
        }

        // 設定4通り × (表示順 / TSV / Studio One / Cubase / Cubase Base-On)
        for (const [key, st] of SETTINGS) {
          const e = ek.settings[key]!;
          const label = `${tag} [${key}]`;
          const order = getKitPitches(map, ek.kit, st);
          if (typeof e.order === 'string') expect(order.ok, `${label} 表示順の例外`).toBe(false);
          else {
            expect(order.ok, label).toBe(true);
            if (order.ok) {
              expect(rows(order.value), `${label} 表示順`).toEqual(e.order);
              if (order.value.some((p) => p.Name === '==========')) stats.divider++;
            }
          }
          expectFile(`${label} TSV`, e.tsv, getTsvText(map, ek.kit), false);
          const pl = getStudioOnePitchList(map, ek.kit, st);
          if (e.pitchlist.error !== null) stats.plErr++;
          // Windows版との照合は互換モード（title / color を未エスケープ）で行う。既定（エスケープあり）は、特殊文字を含まなければ同一出力
          expectFile(`${label} Studio One`, e.pitchlist, pl.ok ? serializePitchList(pl.value, { escapeAttributes: false }) : pl, true);
          if (pl.ok && !/[&"'<>]/.test(pl.value.Title + pl.value.Items.map((i) => i.Color ?? '').join(''))) {
            expect(serializePitchList(pl.value), `${label} 既定と互換モードの一致`).toBe(serializePitchList(pl.value, { escapeAttributes: false }));
          }
          const dm = getCubaseDrumMap(map, ek.kit, null, st);
          if (e.drm.error !== null) stats.drmErr++;
          expectFile(`${label} Cubase`, e.drm, dm.ok ? serializeCubaseDrm(dm.value) : dm, true);
          const bo = getCubaseDrumMap(map, ek.kit, baseOnName, st);
          expectFile(`${label} Cubase Base-On`, e.drmBaseOn, bo.ok ? serializeCubaseDrm(bo.value) : bo, true);
        }

        // QBDrummer CSV（BOMなし）
        expectFile(`${tag} QBDrummer`, ek.qbDrummer, getQbDrummerCsv(map, ek.kit), false);

        // 取り込み（先頭Kitへ、そのKitの出力を取り込む）
        if (ek.imports) {
          const target: KitRef = { pluginIndex: 0, kitIndex: 0 };
          const st = SETTINGS[0]![1];
          const pl = getStudioOnePitchList(map, ek.kit, st);
          const dm = getCubaseDrumMap(map, ek.kit, null, st);
          if (ek.imports.pitchlist) {
            stats.imports++;
            expect(pl.ok).toBe(true);
            if (pl.ok) {
              const res = importPitchlist(map, target, serializePitchList(pl.value, { escapeAttributes: false }), 'imp.pitchlist');
              if (ek.imports.pitchlist.result.error) stats.importErr++;
              expectImport(`${tag} Import pitchlist`, ek.imports.pitchlist, res, target);
            }
          }
          if (ek.imports.drm) {
            stats.imports++;
            expect(dm.ok).toBe(true);
            const drmText = dm.ok ? serializeCubaseDrm(dm.value) : undefined;
            expect(drmText?.ok).toBe(true);
            if (drmText?.ok) {
              const res = importDrm(map, target, drmText.value);
              if (ek.imports.drm.result.error) stats.importErr++;
              expectImport(`${tag} Import drm`, ek.imports.drm, res, target);
            }
          }
          stats.imports++;
          const res = importTsv(map, target, getTsvText(map, ek.kit), 'imp.tsv');
          if (ek.imports.tsv.result.error) stats.importErr++;
          expectImport(`${tag} Import tsv`, ek.imports.tsv, res, target);
        }
      });

      // NoteMapper（先頭Kitを Base、全Kitを選択）
      const refs: KitRef[] = exp.kits!.map((k) => ({ pluginIndex: k.pi, kitIndex: k.ki }));
      const nm = getNoteMapperTemplate(map, { pluginIndex: 0, kitIndex: 0 }, refs);
      if (exp.noteMapper!.error !== null) stats.noteMapperErr++;
      else stats.nonEmptyNm++;
      expectFile(`case ${i} NoteMapper`, exp.noteMapper!, nm, false);
    });

    // 網羅性: 例外・区切り行・取り込みの成功/失敗が実際に含まれている
    expect(stats.kits).toBeGreaterThan(100);
    expect(stats.artError).toBeGreaterThan(0);
    expect(stats.divider).toBeGreaterThan(0);
    expect(stats.imports).toBeGreaterThan(150);
    expect(stats.nonEmptyNm).toBeGreaterThan(40);
    console.log('golden stats', JSON.stringify(stats));
  }, 30000);
});

describe('取り込み: 変形入力 × Windows版C#の取り込みメソッド', () => {
  const importExpected = JSON.parse(readFileSync(`${dir}/importExpected.json`, 'utf8')) as { error: string | null; digest: string | null }[];

  /** ハーネスの KitDigest と同じ正規化文字列のSHA-256 */
  function digest(map: MapData): string {
    const k = map.Plugins[0]!.Kits[0]!;
    let s = `${k.Name}`;
    for (const p of k.Pitches) {
      s += `${p.Pitch}${p.Name ?? '<null>'}${p.ArticulationID}${separatorToString(p.Separator)}${p.DisplayOrder}`;
    }
    return sha(utf8Bytes(s));
  }

  it('全入力で成功/失敗とKitの状態（名前・各行のName/ArticulationID/Separator/DisplayOrder・配列順）が一致する', () => {
    const inputs = generateImportInputs(cases);
    expect(importExpected).toHaveLength(inputs.length);
    const stats: Record<string, { ok: number; err: number }> = {};
    const target: KitRef = { pluginIndex: 0, kitIndex: 0 };
    inputs.forEach((inp, n) => {
      const exp = importExpected[n]!;
      const parsed = parseQbd(JSON.stringify(cases[inp.case]));
      if (!parsed.ok) throw new Error(parsed.error.message);
      const map = parsed.value;
      const res =
        inp.kind === 'pitchlist' ? importPitchlist(map, target, inp.text, inp.fileName)
        : inp.kind === 'drm' ? importDrm(map, target, inp.text)
        : importTsv(map, target, inp.text, inp.fileName);
      const label = `case ${inp.case} ${inp.kind}/${inp.variant}`;
      const st = (stats[`${inp.kind}/${inp.variant}`] ??= { ok: 0, err: 0 });
      if (exp.error !== null) {
        st.err++;
        expect(res.ok, `${label}: C#は例外(${exp.error})`).toBe(false);
      } else {
        st.ok++;
        expect(res.ok, `${label}: ${res.ok ? '' : res.error.message}`).toBe(true);
        if (res.ok) expect(digest(res.value), label).toBe(exp.digest);
      }
    });
    // 網羅性: 各変形で成功と失敗の両方（失敗が期待されるもの）が実際に含まれている
    for (const v of ['pitchlist/badPitch', 'pitchlist/bigPitch', 'drm/badInt', 'drm/wrongRoot', 'tsv/badHeader', 'tsv/missingPitch', 'tsv/fewColumns']) {
      expect(stats[v]!.err, v).toBeGreaterThan(0);
    }
    for (const v of ['pitchlist/drop', 'drm/dropOrder', 'drm/dropMapItems', 'tsv/shuffle', 'tsv/separators', 'tsv/pitchSpaces']) {
      expect(stats[v]!.ok, v).toBeGreaterThan(0);
    }
    console.log('import stats', JSON.stringify(stats));
  }, 30000);
});
