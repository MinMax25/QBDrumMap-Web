import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertMidi, parseQbd, type KitRef } from '../../src/core';
import { generateMidiInputs } from './midiInputs';

// midiWebBaseline.json: 旧「Windows互換」モード廃止の直前（既定の標準モード＝ mode:'web'）の出力のSHA-256。
// 廃止後も標準の変換結果が1バイトも変わらないことを、固定入力（cases.json × 変形入力 × Format 0/1）で確認する。
const dir = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8')) as unknown[];
interface Exp { c: number; v: string; f: number; error: string | null; archive: string | null; files: { name: string; len: number; sha: string }[] | null }
const expected = JSON.parse(readFileSync(`${dir}/midiWebBaseline.json`, 'utf8')) as Exp[];
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').toUpperCase();

describe('MIDI変換: 標準の変換結果が変更前（mode:web）と一致する', () => {
  const inputs = generateMidiInputs(cases);

  it('入力数が一致する', () => {
    expect(expected).toHaveLength(inputs.length);
    expect(expected.filter((e) => e.error === null).length).toBeGreaterThan(100);
    expect(expected.filter((e) => e.error !== null).length).toBeGreaterThan(10);
  });

  it('全入力・両フォーマットで 成功/失敗・エラーコード・出力ファイル名・長さ・SHA-256・アーカイブ名が一致する', () => {
    inputs.forEach((inp, n) => {
      const exp = expected[n]!;
      const parsed = parseQbd(JSON.stringify(cases[inp.case]));
      if (!parsed.ok) throw new Error(parsed.error.message);
      const map = parsed.value;
      const targets: KitRef[] = map.Plugins.flatMap((p, pi) => p.Kits.map((_, ki) => ({ pluginIndex: pi, kitIndex: ki })));
      const res = convertMidi(map, { pluginIndex: 0, kitIndex: 0 }, targets, Uint8Array.from(Buffer.from(inp.b64, 'base64')), inp.fileName, { format: inp.format });
      const label = `case ${inp.case} ${inp.variant} F${inp.format}`;
      expect([exp.c, exp.v, exp.f], label).toEqual([inp.case, inp.variant, inp.format]);
      if (!res.ok) {
        expect(res.error.code, label).toBe(exp.error);
        return;
      }
      expect(exp.error, label).toBeNull();
      expect(res.value.archiveName, label).toBe(exp.archive);
      expect(res.value.files.map((f) => ({ name: f.path, len: f.bytes.length, sha: sha(f.bytes) })), label).toEqual(exp.files);
    });
  });
});
