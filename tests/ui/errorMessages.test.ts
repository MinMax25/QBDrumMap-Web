import { describe, expect, it } from 'vitest';
import { parseQbd } from '../../src/core';
import { toUserMessage } from '../../src/ui/services/errorMessages';
import { suggestQbdFileName } from '../../src/ui/services/fileIo';
import { brokenJson } from '../fixtures';

describe('toUserMessage', () => {
  it('既知コードは利用者向けの文言と対処、技術詳細を返す', () => {
    const m = toUserMessage({ code: 'undefined-separator', message: 'bad', path: 'Plugins[0].Kits[0].Pitches[3].Separator' });
    expect(m.title).toContain('Separator');
    expect(m.hint).toBeDefined();
    expect(m.detail).toBe('[undefined-separator] bad (Plugins[0].Kits[0].Pitches[3].Separator)');
  });

  it('未登録コードは汎用文言に落ち、コードとメッセージは詳細に残る', () => {
    const m = toUserMessage({ code: 'something-new', message: 'raw' });
    expect(m.title).toBe('処理に失敗しました。');
    expect(m.detail).toBe('[something-new] raw');
  });

  it('Coreが実際に返す読込エラーが利用者向けに変換できる', () => {
    const r = parseQbd(brokenJson);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(toUserMessage(r.error).title).toContain('QBD');
  });
});

describe('suggestQbdFileName', () => {
  it('拡張子を保証し、空なら既定名にする', () => {
    expect(suggestQbdFileName(null)).toBe('DrumMap.qbd');
    expect(suggestQbdFileName('  ')).toBe('DrumMap.qbd');
    expect(suggestQbdFileName('a')).toBe('a.qbd');
    expect(suggestQbdFileName('a.QBD')).toBe('a.QBD');
  });
});
