import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseQbd, serializeQbd } from '../src/core';

// Windows版が実際に保存した標準DrumMap.qbd（QB配下の参照ソース）。無い環境ではスキップする。
const WIN_QBD = fileURLToPath(new URL('../public/samples/DrumMap.qbd', import.meta.url));

describe.skipIf(!existsSync(WIN_QBD))('Windows版が保存した実ファイル DrumMap.qbd', () => {
  const text = existsSync(WIN_QBD) ? readFileSync(WIN_QBD, 'utf8') : '';

  it('Load→Saveの結果が元ファイルとJSON値で一致する（正規化済みファイルの再現）', () => {
    const r = parseQbd(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = serializeQbd(r.value);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(JSON.parse(s.value.text)).toEqual(JSON.parse(text));
  });

  it('参考: テキスト全体の一致（改行コードを除く）', () => {
    const r = parseQbd(text);
    if (!r.ok) throw new Error(r.error.message);
    const s = serializeQbd(r.value);
    if (!s.ok) throw new Error(s.error.message);
    expect(s.value.text).toBe(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
  });
});
