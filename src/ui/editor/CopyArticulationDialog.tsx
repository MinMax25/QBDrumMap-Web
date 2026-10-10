import { useMemo, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, TextField } from '@mui/material';
import type { KitRef, MapData } from '../../core';

export interface CopyArticulationDialogProps {
  open: boolean;
  map: MapData;
  /** コピー先（現在の Kit）。コピー元の候補から除く */
  target: KitRef;
  onClose(): void;
  onCopy(source: KitRef): void;
}

/** Articulation のコピー元 Kit の選択。コピー元の候補は Plugin／Kit の表示順（自分自身を除く） */
export function CopyArticulationDialog({ open, map, target, onClose, onCopy }: CopyArticulationDialogProps) {
  const [value, setValue] = useState('');
  const options = useMemo(
    () => map.Plugins.flatMap((pl, pi) =>
      pl.Kits.map((k, ki) => ({ key: `${pi}:${ki}`, ref: { pluginIndex: pi, kitIndex: ki }, label: `${pl.Name} / ${k.Name}` }))
        .filter((o) => !(pi === target.pluginIndex && o.ref.kitIndex === target.kitIndex))),
    [map, target.pluginIndex, target.kitIndex],
  );
  const chosen = options.find((o) => o.key === value);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Articulation をコピー</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          コピー元の Kit を選んでください。同じ Pitch 番号の行どうしで Articulation と Separator をコピーします。
        </DialogContentText>
        <TextField
          select fullWidth size="small" label="コピー元の Kit" value={chosen ? value : ''} onChange={(e) => setValue(e.target.value)}
          helperText={options.length === 0 ? 'コピーできる他の Kit がありません。' : undefined}
        >
          {options.map((o) => <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!chosen} onClick={() => { if (chosen) { onClose(); onCopy(chosen.ref); } }}>コピー</Button>
      </DialogActions>
    </Dialog>
  );
}
