import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Box, List, ListItemButton, ListItemText, Paper, Typography } from '@mui/material';
import type { MoveDirection } from '../../core';
import { ListIconButton, MoveIconButtons } from './ListIconButtons';

export interface OrderListItem {
  key: string;
  label: string;
  /** 入力検証エラー（あれば表示。補足より優先して表示する） */
  error?: string;
  /** 補足の表示（例: DrumMap Order の Part 名） */
  detail?: string;
  /** 色見本（CSS の色。Part の Color など） */
  swatch?: string;
}

export interface OrderListProps {
  /** 一覧の名前（listbox の aria-label・見出しの tooltip）。親の名前を含めてよい（例: 「GM の Kit」） */
  title: string;
  /** 見出しに表示する短い名前（既定は title）。長い親の名前は title の tooltip で確認できる */
  heading?: string;
  /** 例: "Plugin" / "Kit"（ボタンの aria-label に使う） */
  noun: string;
  items: readonly OrderListItem[];
  /** 複数選択された添字 */
  selected: readonly number[];
  /** 主選択（右側に詳細を出す対象） */
  active: number | null;
  onSelect(index: number, mode: 'single' | 'toggle' | 'range'): void;
  onAdd(): void;
  onDelete(): void;
  onMove(dir: MoveDirection): void;
  /** D&D: 選択ブロックを、元の添字 to の直前へ移す */
  onDropTo(to: number): void;
  /** 追加できない状態（親が未選択など） */
  addDisabled?: boolean;
  /** 追加・削除のボタンを出さない（DrumMap Order のように並べ替えだけの一覧） */
  reorderOnly?: boolean;
  /** 一覧の最大の高さ（既定 260。CSS の長さも指定できる） */
  maxHeight?: number | string;
  /**
   * 左ペインの狭い列向けの表示（既定は false）。操作ボタンは全一覧でアイコン（aria-label・tooltip は同じボタン名）で、
   * コンパクトではボタンが少し小さくなる。さらに項目は1行（省略表示＋tooltip）にし、一覧は親の高さいっぱいに広がる。
   * 機能・キーボード操作は変わらない。
   */
  compact?: boolean;
  emptyText: string;
}

/**
 * Plugin / Kit の一覧。並べ替えは、ボタン（先頭／上へ／下へ／末尾。Windows版の Move 系と同じ）と
 * ドラッグ&ドロップの両方で行える。D&D は選択行（複数可）をまとめて、ドロップ先の行の直前へ移す。
 */
export function OrderList(p: OrderListProps) {
  const [dropAt, setDropAt] = useState<number | null>(null);
  const hasSel = p.selected.length > 0;
  // キーボードで並べ替えた後は、行の DOM が入れ替わってフォーカスが外れるため、主選択（無ければ選択行）へフォーカスを戻す
  const listRef = useRef<HTMLUListElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const root = listRef.current;
    (root?.querySelector<HTMLElement>('[data-active="true"][aria-selected="true"]') ?? root?.querySelector<HTMLElement>('[aria-selected="true"]'))?.focus();
  });

  const click = (e: MouseEvent, i: number) => p.onSelect(i, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single');
  const key = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      p.onSelect(i, e.shiftKey ? 'range' : e.ctrlKey ? 'toggle' : 'single');
    } else if (e.altKey && hasSel) {
      // Alt+↑／↓ で選択行を1つ上／下へ、Alt+Home／End で先頭／末尾へ（ボタンと同じ並べ替え）
      const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'Home' ? 'top' : e.key === 'End' ? 'bottom' : null;
      if (dir) { e.preventDefault(); refocus.current = true; p.onMove(dir); window.setTimeout(() => { refocus.current = false; }, 100); }
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={p.compact
        ? { p: 0.5, display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }
        : { p: 1, mb: 2 }}
    >
      <Box sx={p.compact ? { px: 0.5 } : { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography
          variant={p.compact ? 'subtitle2' : 'subtitle1'} component="h3" noWrap={p.compact} sx={p.compact ? undefined : { flexGrow: 1 }}
          title={p.heading !== undefined || p.compact ? `${p.title}（${p.items.length}）` : undefined}
        >{p.heading ?? p.title}（{p.items.length}）</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap' }} role="group" aria-label={`${p.noun} の並べ替え`}>
          {!p.reorderOnly && <ListIconButton icon="add" label={`${p.noun} を追加`} onClick={p.onAdd} disabled={p.addDisabled} compact={p.compact} />}
          {!p.reorderOnly && <ListIconButton icon="delete" label={`${p.noun} を削除`} onClick={p.onDelete} disabled={!hasSel} color="error" compact={p.compact} />}
          <MoveIconButtons onMove={p.onMove} disabled={!hasSel} compact={p.compact} />
        </Box>
      </Box>
      {p.items.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 1 }}>{p.emptyText}</Typography>
      ) : (
        <List ref={listRef} dense role="listbox" aria-label={p.title} aria-multiselectable sx={p.compact
          // 画面が極端に低い（ページスクロールへ切り替える）ときだけ高さを制限する
          ? { flex: '1 1 0', minHeight: 96, overflow: 'auto', py: 0, '@media (max-height: 639px)': { flex: 'none', maxHeight: 300 } }
          : { maxHeight: p.maxHeight ?? 260, overflow: 'auto' }}>
          {p.items.map((it, i) => {
            const isSel = p.selected.includes(i);
            return (
              <ListItemButton
                key={it.key}
                role="option"
                aria-selected={isSel}
                selected={isSel}
                draggable={isSel}
                onClick={(e) => click(e, i)}
                onKeyDown={(e) => key(e, i)}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                onDragOver={(e) => { if (hasSel) { e.preventDefault(); setDropAt(i); } }}
                onDragLeave={() => setDropAt((d) => (d === i ? null : d))}
                onDrop={(e) => { e.preventDefault(); setDropAt(null); p.onDropTo(i); }}
                sx={{ ...(p.compact ? { px: 1, py: 0.5 } : {}), borderTop: dropAt === i ? '2px solid' : '2px solid transparent', borderColor: dropAt === i ? 'primary.main' : 'transparent' }}
                data-active={i === p.active}
                title={it.label}
              >
                {it.swatch !== undefined && (
                  <Box
                    component="span" aria-hidden title={it.swatch}
                    sx={{ width: 28, height: 14, mr: 1.5, flexShrink: 0, borderRadius: '2px', border: 1, borderColor: 'divider', backgroundColor: it.swatch }}
                  />
                )}
                <ListItemText
                  primary={it.label || '（名前なし）'}
                  secondary={it.error ?? it.detail}
                  sx={p.compact ? { minWidth: 0, my: 0 } : undefined}
                  slotProps={{ primary: { noWrap: p.compact, sx: { fontWeight: i === p.active ? 700 : 400 } }, secondary: { sx: { color: it.error ? 'error.main' : 'text.secondary' } } }}
                />
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Paper>
  );
}
