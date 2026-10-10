import { useState, type KeyboardEvent } from 'react';
import { TextField } from '@mui/material';

export interface NameFieldProps {
  label: string;
  value: string;
  /** 確定時（Enter / フォーカスを外したとき）だけ呼ぶ。1回の確定 = 1つの取り消し単位 */
  onCommit(value: string): void;
  error?: string;
  size?: 'small' | 'medium';
  hideLabel?: boolean;
  disabled?: boolean;
}

/** 確定式のテキスト入力。入力中は履歴を積まず、Enter／フォーカスアウトで確定、Escape で元に戻す */
export function NameField({ label, value, onCommit, error, size = 'small', hideLabel, disabled }: NameFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
  };
  return (
    <TextField
      label={hideLabel ? undefined : label}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={key}
      error={!!error}
      helperText={error}
      size={size}
      disabled={disabled}
      slotProps={{ htmlInput: { 'aria-label': label } }}
      fullWidth
    />
  );
}
