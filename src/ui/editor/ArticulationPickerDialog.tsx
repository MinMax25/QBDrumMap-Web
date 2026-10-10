import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, ListSubheader, TextField,
} from '@mui/material';
import { containsIgnoreCase, type MapData } from '../../core';

export interface ArticulationPickerProps {
  open: boolean;
  map: MapData;
  /** 現在の ArticulationID（0 = 未割当） */
  current: number;
  onClose(): void;
  /** 選択された Articulation の ID（0 = 割当を外す） */
  onPick(articulationId: number): void;
}

/**
 * Articulation の選択ダイアログ（UI Phase 2 の必要最小限版）。Part ごとにグループ化した一覧と名前の絞り込み。
 * 完成版の検索ダイアログ（Windows版 SearchArticulation 相当）は Phase 3 で、この props 契約のまま差し替える。
 *
 * UI Phase 7 の改善：タイトル・絞り込み欄・キャンセルは固定し、候補一覧だけをスクロールさせる。
 * 絞り込みを変えたら一覧を先頭へ戻し、開くたびに絞り込みを空にする。Part 見出しは項目と区別できる見た目にする。
 * 同名の Articulation（別 ID）がある場合に限り、その項目へ ID を補足表示する（統合・削除・自動修正はしない）。
 * 選択は従来どおり ID で行い、名前では同定しない。
 */
export function ArticulationPickerDialog({ open, map, current, onClose, onPick }: ArticulationPickerProps) {
  const [filter, setFilter] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  // 開くたびに絞り込みを空にする（ダイアログは常に描画されたまま open だけが切り替わるため）
  useEffect(() => {
    if (open) setFilter('');
  }, [open]);

  // 絞り込みを変えたら、候補一覧を先頭へ戻す
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [filter]);

  // 名前ごとの出現数（絞り込みに関係なく全体で数える）。2 以上の名前の項目にだけ ID を補足する
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const part of map.Parts) for (const a of part.Articulations) m.set(a.Name, (m.get(a.Name) ?? 0) + 1);
    return m;
  }, [map]);

  const groups = useMemo(
    () =>
      map.Parts.map((part, i) => ({
        key: `${i}:${part.ID}`,
        part: part.Name,
        items: part.Articulations.filter((a) => filter === '' || containsIgnoreCase(a.Name, filter)),
      })).filter((g) => g.items.length > 0),
    [map, filter],
  );
  return (
    <Dialog
      open={open} onClose={onClose} fullWidth maxWidth="xs"
      // 絞り込みで件数が減ってもダイアログの高さが変わらないようにする
      slotProps={{ paper: { sx: { height: 'min(640px, 80vh)' } } }}
    >
      <DialogTitle>Articulation を選択</DialogTitle>
      <Box sx={{ px: 3, pb: 1 }}>
        <TextField label="名前で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} size="small" fullWidth autoFocus />
      </Box>
      <DialogContent dividers ref={contentRef} sx={{ pt: 0 }}>
        <List dense aria-label="Articulation 一覧">
          <ListItemButton selected={current === 0} onClick={() => onPick(0)}>
            <ListItemText primary="（なし）" />
          </ListItemButton>
          {groups.map((g) => (
            <li key={g.key}>
              <ul style={{ padding: 0 }}>
                <ListSubheader
                  sx={(t) => ({
                    lineHeight: '28px', fontWeight: 700, borderBottom: 1, borderColor: 'divider',
                    // スクロール中に項目が透けないよう不透明にする。ダイアログの背景（Dark では明るく持ち上がる）とは別の色で、見出しと項目を区別する
                    bgcolor: t.palette.mode === 'dark' ? t.palette.grey[800] : t.palette.grey[100],
                  })}
                >
                  {g.part}（{g.items.length}）
                </ListSubheader>
                {g.items.map((a) => (
                  <ListItemButton key={a.ID} selected={a.ID === current} onClick={() => onPick(a.ID)} sx={{ pl: 4 }}>
                    <ListItemText primary={a.Name} secondary={(nameCounts.get(a.Name) ?? 0) > 1 ? `ID ${a.ID}` : undefined} />
                  </ListItemButton>
                ))}
              </ul>
            </li>
          ))}
        </List>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>キャンセル</Button></DialogActions>
    </Dialog>
  );
}
