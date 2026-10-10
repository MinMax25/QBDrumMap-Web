import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { defaultPartNameDictionary, type PartNameAlias } from '../../core';
import { deleteMessage } from '../editor/pluginsKitsActions';
import { useSettings, type SettingsStore } from './settingsStore';

/** Windows版 DataGridEditingTextBoxStyle の MaxLength */
const MAX_LENGTH = 64;

/**
 * Part Name Dictionary の編集（Windows版 SettingPage の「Part Name Dictionary」）。
 * 辞書は設定（SettingsStore）の一部で、QBD とは独立。編集は確定のたびに即時保存し、QBD の Dirty・Undo/Redo には影響しない。
 * Windows版と同じく、重複・空の正規名・空の別名も入力制約にしない。確定時に前後の空白だけを除く。
 */
export function PartNameDictionaryEditor({ store, confirm }: { store: SettingsStore; confirm: (message: string) => Promise<boolean> }) {
  const { settings } = useSettings(store);
  const dictionary = settings.partNameDictionary;
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);

  const setDictionary = (next: PartNameAlias[]): void => store.update({ partNameDictionary: next });

  const select = (index: number, e: MouseEvent): void => {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)];
      setSelected(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((cur) => (cur.includes(index) ? cur.filter((i) => i !== index) : [...cur, index]));
      setAnchor(index);
    } else {
      setSelected([index]);
      setAnchor(index);
    }
  };

  const add = (): void => {
    setDictionary([...dictionary, { CanonicalName: '', Aliases: '' }]);
    setSelected([dictionary.length]);
    setAnchor(dictionary.length);
  };

  const removeSelected = async (): Promise<void> => {
    const targets = selected.filter((i) => i < dictionary.length);
    if (targets.length === 0) return;
    const names = targets.map((i) => dictionary[i]!.CanonicalName);
    if (!(await confirm(deleteMessage('Part Name Alias', names)))) return;
    setDictionary(dictionary.filter((_, i) => !targets.includes(i)));
    setSelected([]);
    setAnchor(null);
  };

  const resetToDefault = async (): Promise<void> => {
    if (!(await confirm('Part Name Dictionary を初期辞書（7件）に戻します。現在の内容は失われます。実行しますか？'))) return;
    setDictionary(defaultPartNameDictionary());
    setSelected([]);
    setAnchor(null);
  };

  // 編集中（入力欄にフォーカスがある）の Delete は文字の削除。行の削除は入力欄の外にフォーカスがあるときだけ
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Delete' || (e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    void removeSelected();
  };

  const commit = (index: number, field: keyof PartNameAlias, input: HTMLInputElement): void => {
    const value = input.value.trim();
    input.value = value;
    if (dictionary[index]![field] === value) return;
    setDictionary(dictionary.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  };

  const cell = (index: number, field: keyof PartNameAlias, label: string) => (
    <TextField
      // 値が確定で変わったときに入力欄を作り直し、保存された値を表示する
      key={`${index}:${dictionary[index]![field]}`}
      size="small" fullWidth defaultValue={dictionary[index]![field]}
      slotProps={{ htmlInput: { maxLength: MAX_LENGTH, 'aria-label': `${label} (${index + 1})` } }}
      onBlur={(e) => commit(index, field, e.target as HTMLInputElement)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );

  return (
    <Box sx={{ display: 'grid', gap: 1 }} data-testid="part-name-dictionary">
      <Typography variant="subtitle1" component="h3">Part Name Dictionary</Typography>
      <Typography variant="caption" color="text.secondary">
        Auto Assign が Pitch の名前から Part を見つけるための辞書です。別名はカンマ区切りで入力します。変更はすぐに保存され、次の Auto Assign から使われます。
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" onClick={add}>追加</Button>
        <Button variant="outlined" size="small" disabled={selected.length === 0} onClick={() => void removeSelected()}>選択行を削除</Button>
        <Button variant="outlined" size="small" onClick={() => void resetToDefault()}>初期辞書に戻す</Button>
      </Box>
      <TableContainer tabIndex={0} onKeyDown={onKeyDown} sx={{ maxHeight: 300, border: 1, borderColor: 'divider' }} aria-label="Part Name Dictionary の一覧">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }}>#</TableCell>
              <TableCell sx={{ width: 220 }}>Canonical Name</TableCell>
              <TableCell>Aliases (comma separated)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {dictionary.map((_, i) => (
              <TableRow key={i} hover selected={selected.includes(i)} onClick={(e) => select(i, e)} data-testid={`dictionary-row-${i}`}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{cell(i, 'CanonicalName', 'Canonical Name')}</TableCell>
                <TableCell>{cell(i, 'Aliases', 'Aliases')}</TableCell>
              </TableRow>
            ))}
            {dictionary.length === 0 && (
              <TableRow><TableCell colSpan={3}><Typography variant="body2" color="text.secondary">辞書は空です。辞書が空でも Auto Assign は動作します（他の Kit の割当と名前の完全一致だけで割り当てます）。</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
