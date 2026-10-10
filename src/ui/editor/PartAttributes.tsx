import { useState } from 'react';
import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import {
  enumName, formatStudioOneColor, NOTE_HEADS, parseStudioOneColor, studioOneColorToHex, TECHNIQUES,
  type EnumValue, type Part, type QbdError,
} from '../../core';
import { NameField } from './NameField';
import type { PartsActions } from './partsActions';
import { NOTE_HEAD_LABEL, SCORE_NOTE_PITCHES, TECHNIQUE_LABEL } from './scoreGeometry';
import { ScoreStaff } from './ScoreStaff';

/** 定義済みの値は名前、未定義の整数は `undef:n`（保持したまま表示する。黙って既定値に変えない） */
function EnumSelect<T extends string>(p: {
  label: string; members: readonly T[]; labels?: Record<T, string>; value: EnumValue<T>; onPick(v: T): void;
}) {
  const name = enumName(p.members, 0, p.value);
  const value = name ?? `undef:${String(p.value)}`;
  return (
    <TextField
      select size="small" label={p.label} value={value} error={name === null}
      onChange={(e) => p.onPick(e.target.value as T)}
      slotProps={{ select: { native: true }, htmlInput: { 'aria-label': p.label } }}
      sx={{ minWidth: 180 }}
    >
      {p.members.map((m) => <option key={m} value={m}>{p.labels?.[m] ?? m}</option>)}
      {name === null && <option value={value} disabled>{`未定義 (${String(p.value)})`}</option>}
    </TextField>
  );
}

/**
 * Color（`AABBGGRR`）の編集。色は標準の色選択、不透明度は 0〜255 の数値。選択中の値は確定するまで履歴を積まない
 * （色選択を閉じる／フォーカスが外れたときに1回で確定）。未設定（null）のときは色を選ぶと不透明（FF）で設定する。
 */
function ColorField({ value, onCommit, onInvalid }: { value: string | null; onCommit(v: string | null): void; onInvalid(message: string): void }) {
  const cur = parseStudioOneColor(value);
  const [draftHex, setDraftHex] = useState<string | null>(null);
  const hex = draftHex ?? studioOneColorToHex(value);
  const commitHex = () => {
    if (draftHex === null) return;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(draftHex);
    setDraftHex(null);
    if (!m) return;
    const next = formatStudioOneColor({ a: value === null ? 255 : cur.a, r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) });
    if (next !== value) onCommit(next);
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <input
        type="color" aria-label="Color" value={hex} onChange={(e) => setDraftHex(e.target.value)} onBlur={commitHex}
        style={{ width: 48, height: 32, padding: 0, border: 'none', background: 'transparent' }}
      />
      <Typography variant="body2" component="code" aria-label="Color の値">{value ?? '（未設定）'}</Typography>
      <Box sx={{ width: 200 }}>
        <NameField
          label="Color の不透明度（0〜255）" value={String(cur.a)} disabled={value === null} size="small"
          onCommit={(v) => {
            if (!/^\d{1,3}$/.test(v.trim()) || Number(v) > 255) { onInvalid('不透明度は 0〜255 の整数で入力してください'); return; }
            onCommit(formatStudioOneColor({ ...cur, a: Number(v) }));
          }}
        />
      </Box>
      <Button size="small" disabled={value === null} onClick={() => onCommit(null)} aria-label="Color を解除">解除</Button>
    </Box>
  );
}

export interface PartAttributesProps {
  part: Part;
  actions: PartsActions;
  onInvalid(error: QbdError): void;
}

/**
 * 選択した Part の Score 属性（Windows版 PartPanel の Score 欄）。左に五線譜プレビュー、右に編集欄（Score Pitch／Note Head／
 * Technique／Color）。プレビューは表示だけで、値は既存の編集欄から変える。Name は Parts 一覧の隣で編集する。
 * Cubase の項目（Voice／Note Head Set／Instrument・Technique Entity ID）は画面に出さない。値は Part にそのまま保持され、
 * 保存・Cubase 出力ではこれまでどおり使われる。
 */
export function PartAttributes({ part, actions, onInvalid }: PartAttributesProps) {
  const invalid = (message: string) => onInvalid({ code: 'invalid-value', message });
  const scoreKnown = SCORE_NOTE_PITCHES.some((x) => x.pitch === part.ScorePitch);
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 1.5 }} aria-label="Part の属性" role="group">
      <Typography variant="subtitle1" component="h3">Score（Studio One）</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <ScoreStaff scorePitch={part.ScorePitch} noteHead={part.NoteHead} technique={part.Technique} />
        <Box sx={{ flex: 1, minWidth: 280, display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              select size="small" label="Score Pitch" value={scoreKnown ? String(part.ScorePitch) : `undef:${part.ScorePitch}`}
              error={!scoreKnown} onChange={(e) => actions.updatePart({ ScorePitch: Number(e.target.value) })}
              slotProps={{ select: { native: true }, htmlInput: { 'aria-label': 'Score Pitch' } }} sx={{ minWidth: 120 }}
            >
              {SCORE_NOTE_PITCHES.map((x) => <option key={x.pitch} value={x.pitch}>{x.note === '' ? '（なし）' : x.note}</option>)}
              {!scoreKnown && <option value={`undef:${part.ScorePitch}`} disabled>{`未定義 (${part.ScorePitch})`}</option>}
            </TextField>
            <EnumSelect label="Note Head" members={NOTE_HEADS} labels={NOTE_HEAD_LABEL} value={part.NoteHead} onPick={(v) => actions.updatePart({ NoteHead: v })} />
            <EnumSelect label="Technique" members={TECHNIQUES} labels={TECHNIQUE_LABEL} value={part.Technique} onPick={(v) => actions.updatePart({ Technique: v })} />
          </Box>
          <ColorField value={part.Color} onCommit={(v) => actions.updatePart({ Color: v })} onInvalid={invalid} />
        </Box>
      </Box>
    </Paper>
  );
}
