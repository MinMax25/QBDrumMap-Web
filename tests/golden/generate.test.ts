import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { generateCases } from './generateCases';
import { generateImportInputs } from './importInputs';
import { generateAutoAssignInputs } from './autoAssignInputs';
import { generateMidiInputs } from './midiInputs';

// 手動実行用: GEN_GOLDEN=1 npx vitest run tests/golden/generate.test.ts で cases.json と（コミットしない）importInputs.json を再生成する。
describe.skipIf(!process.env['GEN_GOLDEN'])('golden: ケース生成', () => {
  it('cases.json / importInputs.json を書き出す', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    mkdirSync(dir, { recursive: true });
    const cases = generateCases(100);
    writeFileSync(`${dir}/cases.json`, JSON.stringify(cases), 'utf8');
    writeFileSync(`${dir}/importInputs.json`, JSON.stringify(generateImportInputs(cases)), 'utf8');
    writeFileSync(`${dir}/midiInputs.json`, JSON.stringify(generateMidiInputs(cases)), 'utf8');
    writeFileSync(`${dir}/autoAssignInputs.json`, JSON.stringify(generateAutoAssignInputs(600)), 'utf8');
  });
});
