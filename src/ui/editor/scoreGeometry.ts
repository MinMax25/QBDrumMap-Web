import { enumName, NOTE_HEADS, TECHNIQUES, type EnumValue } from '../../core';

/**
 * Score 譜面プレビューの図形の定義（Windows版 ScorePitchSelector／StudioOneScore の移植）。
 * 座標は Windows版 ScorePitchSelector.xaml(.cs) のキャンバス座標そのまま（原点は左上、y は下向き）。
 * 描画は ScoreStaff.tsx が行い、ここは「どの要素を、どこに出すか」だけを決める純粋関数と定数を持つ。
 */

export type NoteHeadName = (typeof NOTE_HEADS)[number];
export type TechniqueName = (typeof TECHNIQUES)[number];

/** Windows版 StudioOneScore.ScoreNotePitches の1行。lines は加線 StaffTop1〜6（y=50,60,70,80 と 140,150）の表示 */
export interface ScoreNotePitch {
  pitch: number;
  note: string;
  lines: readonly [boolean, boolean, boolean, boolean, boolean, boolean];
}

const T = true;
const F = false;
/** Windows版 StudioOneScore.ScoreNotePitches（順序も同じ。添字が音符の縦位置になる）。Pitch 0 は「なし」 */
export const SCORE_NOTE_PITCHES: readonly ScoreNotePitch[] = [
  { pitch: 0, note: '', lines: [F, F, F, F, F, F] },
  { pitch: 93, note: 'A5', lines: [T, T, T, T, F, F] },
  { pitch: 91, note: 'G5', lines: [T, T, T, T, F, F] },
  { pitch: 89, note: 'F5', lines: [F, T, T, T, F, F] },
  { pitch: 88, note: 'E5', lines: [F, T, T, T, F, F] },
  { pitch: 86, note: 'D5', lines: [F, F, T, T, F, F] },
  { pitch: 84, note: 'C5', lines: [F, F, T, T, F, F] },
  { pitch: 83, note: 'B4', lines: [F, F, F, T, F, F] },
  { pitch: 81, note: 'A4', lines: [F, F, F, T, F, F] },
  { pitch: 79, note: 'G4', lines: [F, F, F, F, F, F] },
  { pitch: 77, note: 'F4', lines: [F, F, F, F, F, F] },
  { pitch: 76, note: 'E4', lines: [F, F, F, F, F, F] },
  { pitch: 74, note: 'D4', lines: [F, F, F, F, F, F] },
  { pitch: 72, note: 'C4', lines: [F, F, F, F, F, F] },
  { pitch: 71, note: 'B3', lines: [F, F, F, F, F, F] },
  { pitch: 69, note: 'A3', lines: [F, F, F, F, F, F] },
  { pitch: 67, note: 'G3', lines: [F, F, F, F, F, F] },
  { pitch: 65, note: 'F3', lines: [F, F, F, F, F, F] },
  { pitch: 64, note: 'E3', lines: [F, F, F, F, F, F] },
  { pitch: 62, note: 'D3', lines: [F, F, F, F, F, F] },
  { pitch: 60, note: 'C3', lines: [F, F, F, F, T, F] },
  { pitch: 59, note: 'B2', lines: [F, F, F, F, T, T] },
  { pitch: 57, note: 'A2', lines: [F, F, F, F, T, T] },
];

/** 加線 StaffTop1〜6 の y 座標（Windows版 xaml の Canvas.Top） */
export const LEDGER_LINE_Y: readonly number[] = [50, 60, 70, 80, 140, 150];
/** 五線の y 座標（Windows版 xaml の Canvas.Top） */
export const STAFF_LINE_Y: readonly number[] = [90, 100, 110, 120, 130];

/** Windows版 ScorePitchSelector.xaml.cs の定数 */
export const NOTE_LEFT_OFFSET_PX = 100;
export const NOTE_TOP_OFFSET_PX = 40;
export const NOTE_TOP_FREEZE_INDEX = 15;
export const NOTE_INTERVAL_PX = 5;

/** 符頭の描画要素（Windows版 xaml の x:Name） */
export type HeadElement = 'nhNo' | 'nhdX' | 'nhSl' | 'nhCX' | 'nhTr' | 'nhDi';
/** 奏法記号の描画要素（Windows版 xaml の x:Name） */
export type TechniqueElement = 'circ' | 'ccir' | 'plus' | 'trm1' | 'trm2' | 'trm3' | 'stac';

/** Windows版 StudioOneScore.NoteHeadVisibilities */
export const NOTE_HEAD_ELEMENTS: Record<NoteHeadName, readonly HeadElement[]> = {
  None: ['nhNo'],
  nhdX: ['nhdX'],
  nhTr: ['nhTr'],
  nhSl: ['nhNo', 'nhSl'],
  nhCX: ['nhdX', 'nhCX'],
  nhDi: ['nhDi'],
};

/** Windows版 StudioOneScore.TechniqueVisibilities */
export const TECHNIQUE_ELEMENTS: Record<TechniqueName, readonly TechniqueElement[]> = {
  None: [],
  circ: ['circ'],
  ccir: ['circ', 'ccir'],
  plus: ['ccir', 'plus'],
  trm1: ['trm1'],
  trm2: ['trm1', 'trm2'],
  trm3: ['trm1', 'trm2', 'trm3'],
  stac: ['stac'],
};

/** Windows版 [Display(Name = ...)] の表示名（Web版は None を「（なし）」と表示する） */
export const NOTE_HEAD_LABEL: Record<NoteHeadName, string> = {
  None: '（なし）', nhdX: 'X', nhTr: 'Triangle', nhSl: 'Slash', nhCX: 'Circle in X', nhDi: 'Diamond',
};
export const TECHNIQUE_LABEL: Record<TechniqueName, string> = {
  None: '（なし）', circ: 'Open', ccir: 'Half Open', plus: 'Close', trm1: 'Roll 1', trm2: 'Roll 2', trm3: 'Roll 3', stac: 'Cymbal Choke',
};

export interface ScoreLayout {
  /** ScorePitch が Windows版の候補にある（未定義値なら false。このとき音符・加線・符頭・奏法は出さない） */
  pitchKnown: boolean;
  /** 音符（符幹・符頭・奏法）を出す（Pitch 0 と未定義値では false） */
  noteVisible: boolean;
  /** 出す加線の y 座標 */
  ledgerY: readonly number[];
  /** Note0（符幹・符頭・ロール記号）の原点 y。x は NOTE_LEFT_OFFSET_PX */
  note0Top: number;
  /** Note1（Open／Half Open／Close／Cymbal Choke）の原点 y。添字が NOTE_TOP_FREEZE_INDEX を超えても上がらない */
  note1Top: number;
  /** 出す符頭の要素。NoteHead が未定義値なら空 */
  heads: readonly HeadElement[];
  /** 出す奏法の要素。Technique が未定義値なら空 */
  techniques: readonly TechniqueElement[];
  noteHeadKnown: boolean;
  techniqueKnown: boolean;
}

/**
 * Windows版 ScorePitchSelector.UpdateView の移植。値は読むだけで補正しない。
 * NoteHead／Technique が未定義値のとき、Windows版は null 参照で例外になるため、Web版は該当の要素だけ出さない（意図的な差異）。
 */
export function computeScoreLayout(scorePitch: number, noteHead: EnumValue<NoteHeadName>, technique: EnumValue<TechniqueName>): ScoreLayout {
  const idx = SCORE_NOTE_PITCHES.findIndex((x) => x.pitch === scorePitch);
  const head = enumName(NOTE_HEADS, 0, noteHead);
  const tech = enumName(TECHNIQUES, 0, technique);
  const pitchKnown = idx >= 0;
  const noteVisible = pitchKnown && idx !== 0;
  return {
    pitchKnown,
    noteVisible,
    ledgerY: pitchKnown ? SCORE_NOTE_PITCHES[idx]!.lines.flatMap((on, i) => (on ? [LEDGER_LINE_Y[i]!] : [])) : [],
    note0Top: NOTE_TOP_OFFSET_PX + Math.max(idx, 0) * NOTE_INTERVAL_PX,
    note1Top: NOTE_TOP_OFFSET_PX + Math.min(Math.max(idx, 0), NOTE_TOP_FREEZE_INDEX) * NOTE_INTERVAL_PX,
    heads: noteVisible && head !== null ? NOTE_HEAD_ELEMENTS[head] : [],
    techniques: noteVisible && tech !== null ? TECHNIQUE_ELEMENTS[tech] : [],
    noteHeadKnown: head !== null,
    techniqueKnown: tech !== null,
  };
}

/** 譜面プレビューの読み上げ用の説明 */
export function describeScore(scorePitch: number, noteHead: EnumValue<NoteHeadName>, technique: EnumValue<TechniqueName>): string {
  const lay = computeScoreLayout(scorePitch, noteHead, technique);
  const head = enumName(NOTE_HEADS, 0, noteHead);
  const tech = enumName(TECHNIQUES, 0, technique);
  const pitch = lay.pitchKnown ? (scorePitch === 0 ? '未設定' : SCORE_NOTE_PITCHES.find((x) => x.pitch === scorePitch)!.note) : `未定義 (${scorePitch})`;
  const h = head === null ? `未定義 (${String(noteHead)})` : NOTE_HEAD_LABEL[head];
  const t = tech === null ? `未定義 (${String(technique)})` : TECHNIQUE_LABEL[tech];
  return `ドラム譜プレビュー: Score Pitch ${pitch}、Note Head ${h}、Technique ${t}`;
}
