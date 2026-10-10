import { Box } from '@mui/material';
import type { EnumValue } from '../../core';
import {
  computeScoreLayout, describeScore, NOTE_LEFT_OFFSET_PX, STAFF_LINE_Y, type NoteHeadName, type TechniqueName,
} from './scoreGeometry';

export const SCORE_WIDTH = 160;
/** 描画領域（Windows版の座標のまま。最上段の音符の奏法記号も y>=0 に収まる） */
const VIEW_TOP = 0;
const VIEW_HEIGHT = 170;

/**
 * 五線譜／ドラム譜プレビュー（Windows版 ScorePitchSelector の移植）。表示だけで、状態は持たない。
 * 線と記号は `currentColor`（テーマの文字色）で描くため、Dark／Light のどちらでも読める。
 * 座標・図形・表示条件は scoreGeometry.ts と Windows版 ScorePitchSelector.xaml に対応する。
 */
export function ScoreStaff(p: { scorePitch: number; noteHead: EnumValue<NoteHeadName>; technique: EnumValue<TechniqueName> }) {
  const lay = computeScoreLayout(p.scorePitch, p.noteHead, p.technique);
  const h = new Set<string>(lay.heads);
  const t = new Set<string>(lay.techniques);
  return (
    <Box
      sx={{ flexShrink: 0, width: SCORE_WIDTH, color: 'text.primary', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, lineHeight: 0 }}
    >
      <svg
        role="img" aria-label={describeScore(p.scorePitch, p.noteHead, p.technique)} data-testid="score-staff"
        width={SCORE_WIDTH} height={VIEW_HEIGHT} viewBox={`0 ${VIEW_TOP} ${SCORE_WIDTH} ${VIEW_HEIGHT}`}
        fill="none" stroke="currentColor" strokeWidth={1}
      >
        {/* 打楽器記号（2本の太線） */}
        <line x1={30} x2={30} y1={100} y2={120} strokeWidth={3} />
        <line x1={36} x2={36} y1={100} y2={120} strokeWidth={3} />
        {/* 五線 */}
        {STAFF_LINE_Y.map((y) => <line key={y} data-staff x1={0} x2={SCORE_WIDTH} y1={y} y2={y} />)}
        {/* 加線 */}
        {lay.ledgerY.map((y) => <line key={y} data-ledger={y} x1={NOTE_LEFT_OFFSET_PX} x2={NOTE_LEFT_OFFSET_PX + 20} y1={y} y2={y} />)}

        {lay.noteVisible && (
          <g data-note="0" transform={`translate(${NOTE_LEFT_OFFSET_PX} ${lay.note0Top})`}>
            <line x1={16} x2={16} y1={-2} y2={-25} />
            {/* 符頭 */}
            {h.has('nhNo') && <ellipse data-el="nhNo" cx={10} cy={0.5} rx={5.5} ry={3.5} fill="currentColor" transform="translate(10 0.5) skewY(-8) translate(-10 -0.5)" />}
            {h.has('nhSl') && <rect data-el="nhSl" x={1.5} y={-0.5} width={17} height={1} transform="rotate(-145 10 0)" />}
            {h.has('nhdX') && (
              <g data-el="nhdX"><line x1={8} x2={16} y1={-3} y2={5} /><line x1={16} x2={8} y1={-3} y2={5} /></g>
            )}
            {h.has('nhCX') && <ellipse data-el="nhCX" cx={12} cy={1} rx={5.5} ry={5.5} />}
            {h.has('nhTr') && <path data-el="nhTr" d="M 11,-3 L 7,4 L 15,4 Z" fill="currentColor" stroke="none" />}
            {h.has('nhDi') && <path data-el="nhDi" d="M 7,0 L 11,4 L 15,0 L 11,-4 Z" fill="currentColor" stroke="none" />}
            {/* ロール（斜線） */}
            {t.has('trm1') && <line data-el="trm1" x1={12} x2={20} y1={-12} y2={-16} strokeWidth={2} />}
            {t.has('trm2') && <line data-el="trm2" x1={12} x2={20} y1={-16} y2={-20} strokeWidth={2} />}
            {t.has('trm3') && <line data-el="trm3" x1={12} x2={20} y1={-8} y2={-12} strokeWidth={2} />}
          </g>
        )}
        {/* Open／Cymbal Choke の円: Windows版は Margin(6,-69)・高さ8 の楕円で、WPF の Canvas では負の Margin の分の領域の中央に置かれるため、中心は -34.5（縦線 -40〜-28 と重なる） */}
        {lay.noteVisible && (
          <g data-note="1" transform={`translate(${NOTE_LEFT_OFFSET_PX} ${lay.note1Top})`}>
            {t.has('circ') && <ellipse data-el="circ" cx={10} cy={-34.5} rx={3.5} ry={3.5} />}
            {t.has('ccir') && <line data-el="ccir" x1={10} x2={10} y1={-40} y2={-28} />}
            {t.has('plus') && <line data-el="plus" x1={4} x2={16} y1={-34} y2={-34} />}
            {t.has('stac') && <ellipse data-el="stac" cx={10} cy={-34.5} rx={3.5} ry={3.5} fill="currentColor" />}
          </g>
        )}
      </svg>
    </Box>
  );
}
