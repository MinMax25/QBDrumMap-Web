import { describe, expect, it } from 'vitest';
import { NOTE_HEADS, TECHNIQUES } from '../src/core';
import {
  computeScoreLayout, describeScore, NOTE_HEAD_ELEMENTS, SCORE_NOTE_PITCHES, TECHNIQUE_ELEMENTS,
} from '../src/ui/editor/scoreGeometry';

/** Windows版 StudioOneScore.ScoreNotePitches の Pitch 順と、出す加線の y（Line1〜4 = 50,60,70,80 / Line5,6 = 140,150） */
const EXPECTED: readonly [number, number[]][] = [
  [0, []], [93, [50, 60, 70, 80]], [91, [50, 60, 70, 80]], [89, [60, 70, 80]], [88, [60, 70, 80]], [86, [70, 80]], [84, [70, 80]],
  [83, [80]], [81, [80]], [79, []], [77, []], [76, []], [74, []], [72, []], [71, []], [69, []], [67, []], [65, []], [64, []], [62, []],
  [60, [140]], [59, [140, 150]], [57, [140, 150]],
];

describe('Score 譜面プレビューの図形（Windows版 ScorePitchSelector の移植）', () => {
  it('ScorePitch 候補は Windows版と同じ23件・同じ順序', () => {
    expect(SCORE_NOTE_PITCHES.map((x) => x.pitch)).toEqual(EXPECTED.map(([p]) => p));
  });

  it.each(EXPECTED.map((e, i) => [e[0], i, e[1]] as const))('Pitch %i（添字 %i）: 縦位置と加線', (pitch, idx, ledger) => {
    const lay = computeScoreLayout(pitch, 'None', 'None');
    expect(lay.pitchKnown).toBe(true);
    expect(lay.noteVisible).toBe(pitch !== 0); // Pitch 0（なし）は音符を出さない
    expect(lay.note0Top).toBe(40 + idx * 5); // NOTE_TOP_OFFSET + 添字 × 5
    expect(lay.note1Top).toBe(40 + Math.min(idx, 15) * 5); // 奏法記号の原点は添字15で止まる
    expect(lay.ledgerY).toEqual(ledger);
  });

  it('未定義の ScorePitch は音符・加線・符頭・奏法を出さない', () => {
    for (const bad of [38, -1, 1, 128]) {
      const lay = computeScoreLayout(bad, 'nhdX', 'circ');
      expect(lay).toMatchObject({ pitchKnown: false, noteVisible: false, ledgerY: [], heads: [], techniques: [] });
    }
  });

  it('NoteHead 全候補の要素（None は通常の楕円）', () => {
    expect(NOTE_HEAD_ELEMENTS).toEqual({
      None: ['nhNo'], nhdX: ['nhdX'], nhTr: ['nhTr'], nhSl: ['nhNo', 'nhSl'], nhCX: ['nhdX', 'nhCX'], nhDi: ['nhDi'],
    });
    for (const h of NOTE_HEADS) expect(computeScoreLayout(72, h, 'None').heads).toEqual(NOTE_HEAD_ELEMENTS[h]);
  });

  it('Technique 全候補の要素（None は何も出さない）', () => {
    expect(TECHNIQUE_ELEMENTS).toEqual({
      None: [], circ: ['circ'], ccir: ['circ', 'ccir'], plus: ['ccir', 'plus'], trm1: ['trm1'], trm2: ['trm1', 'trm2'],
      trm3: ['trm1', 'trm2', 'trm3'], stac: ['stac'],
    });
    for (const t of TECHNIQUES) expect(computeScoreLayout(72, 'None', t).techniques).toEqual(TECHNIQUE_ELEMENTS[t]);
  });

  it('未定義の NoteHead／Technique はその要素だけ出さない（Windows版は例外になる箇所。意図的な差異）', () => {
    const lay = computeScoreLayout(72, 7, 9);
    expect(lay).toMatchObject({ pitchKnown: true, noteVisible: true, heads: [], techniques: [], noteHeadKnown: false, techniqueKnown: false });
    expect(computeScoreLayout(72, 'nhTr', 9).heads).toEqual(['nhTr']);
  });

  it('説明文は未設定・未定義値も表す', () => {
    expect(describeScore(60, 'nhSl', 'circ')).toBe('ドラム譜プレビュー: Score Pitch C3、Note Head Slash、Technique Open');
    expect(describeScore(0, 'None', 'None')).toBe('ドラム譜プレビュー: Score Pitch 未設定、Note Head （なし）、Technique （なし）');
    expect(describeScore(38, 9, 8)).toBe('ドラム譜プレビュー: Score Pitch 未定義 (38)、Note Head 未定義 (9)、Technique 未定義 (8)');
  });
});
