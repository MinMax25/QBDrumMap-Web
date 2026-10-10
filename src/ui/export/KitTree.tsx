import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Box, Button, Checkbox, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import type { KitRef, MapData } from '../../core';
import { applyKitCheck, applyKitClick, applyPluginCheck, pluginState } from './kitTreeSelection';

/** Kit の識別（位置＋ID。Undo 等でモデルが変わって対応しなくなった選択は除かれる。Kit 名だけをキーにしない） */
export const kitKey = (pi: number, ki: number, id: number): string => `${pi}:${ki}:${id}`;

export interface KitRow {
  key: string;
  ref: KitRef;
  pluginName: string;
  kitName: string;
}

export function listKits(map: MapData): KitRow[] {
  return map.Plugins.flatMap((pl, pi) => pl.Kits.map((k, ki) => ({
    key: kitKey(pi, ki, k.ID), ref: { pluginIndex: pi, kitIndex: ki }, pluginName: pl.Name, kitName: k.Name,
  })));
}

const HELP = '行をクリック：その Kit だけを選択／Ctrl（Mac は Command）＋クリック：その Kit を追加・解除／Shift＋クリック：直前に選んだ Kit からの範囲を選択／Ctrl＋Shift＋クリック：範囲を追加／チェックボックス：その Kit だけを切り替え。範囲は、Plugin を折りたたんでいても、画面の並び順で含めます。';

const ellipsis = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

type Item = { id: string; kind: 'plugin'; pi: number } | { id: string; kind: 'kit'; pi: number; row: KitRow };

/**
 * Plugin → Kit の 2 階層ツリーで Kit を複数選択する（Export・Convert MIDI で共通）。
 * 上のヘッダー（すべて選択／選択を解除／選択中の件数）は固定で、下のツリーだけがスクロールする。
 * 選択は呼び出し側が持つ（Kit のキー集合）。展開状態・基準 Kit・フォーカスはこの部品の表示だけの状態で、QBD には影響しない。
 * 初期状態はすべて展開（Kit を探さずに選べる。折りたたみは利用者の操作で）。
 */
export function KitTree({ rows, picked, onChange, label }: {
  rows: KitRow[];
  picked: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  label: string;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const plugins = useMemo(() => {
    const m = new Map<number, KitRow[]>();
    for (const r of rows) m.set(r.ref.pluginIndex, [...(m.get(r.ref.pluginIndex) ?? []), r]);
    return [...m.entries()].map(([pi, kits]) => ({ pi, name: kits[0]!.pluginName, kits }));
  }, [rows]);
  // 画面に並ぶ行（折りたたみ中の Kit は含まない）
  const items = useMemo<Item[]>(() => plugins.flatMap((p) => [
    { id: `p${p.pi}`, kind: 'plugin' as const, pi: p.pi },
    ...(collapsed.has(p.pi) ? [] : p.kits.map((row) => ({ id: row.key, kind: 'kit' as const, pi: p.pi, row }))),
  ]), [plugins, collapsed]);
  // 範囲選択の基準となる Kit の並び。折りたたまれている Plugin の Kit も含める（展開状態に関係なく範囲選択できる）
  const allKitKeys = useMemo(() => rows.map((r) => r.key), [rows]);
  // 現在のモデルに存在する選択だけを数える（Undo・再読込で対応しなくなった選択は含めない）
  const count = rows.filter((r) => picked.has(r.key)).length;
  const anchorValid = anchor !== null && rows.some((r) => r.key === anchor) ? anchor : null;
  const activeId = focusId !== null && items.some((i) => i.id === focusId) ? focusId : items[0]?.id ?? null;

  const commit = (next: { picked: ReadonlySet<string>; anchor: string | null }) => { onChange(next.picked); setAnchor(next.anchor); };
  const cur = () => ({ picked, anchor: anchorValid });
  const toggleCollapse = (pi: number) => setCollapsed((c) => { const n = new Set(c); if (n.has(pi)) n.delete(pi); else n.add(pi); return n; });
  const focusItem = (id: string) => {
    setFocusId(id);
    treeRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
  };

  const kitClick = (e: MouseEvent, key: string) => {
    setFocusId(key);
    commit(applyKitClick(allKitKeys, cur(), key, { toggle: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
  };
  const onKey = (e: KeyboardEvent, it: Item) => {
    if (e.target !== e.currentTarget) return; // 行の中のチェックボックス・矢印ボタン自身のキー操作は、それぞれに任せる
    const idx = items.findIndex((i) => i.id === it.id);
    const go = (i: number) => { const t = items[Math.max(0, Math.min(items.length - 1, i))]; if (t) focusItem(t.id); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(idx + 1); break;
      case 'ArrowUp': e.preventDefault(); go(idx - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(items.length - 1); break;
      case 'ArrowRight':
        if (it.kind === 'plugin') { e.preventDefault(); if (collapsed.has(it.pi)) toggleCollapse(it.pi); else go(idx + 1); }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (it.kind === 'plugin') { if (!collapsed.has(it.pi)) toggleCollapse(it.pi); }
        else focusItem(`p${it.pi}`);
        break;
      case ' ':
        e.preventDefault();
        if (it.kind === 'kit') commit(applyKitCheck(cur(), it.id, !picked.has(it.id)));
        else {
          const keys = plugins.find((p) => p.pi === it.pi)!.kits.map((k) => k.key);
          commit(applyPluginCheck(cur(), keys, pluginState(keys, picked) !== 'all'));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (it.kind === 'plugin') toggleCollapse(it.pi);
        else commit(applyKitClick(allKitKeys, cur(), it.id, { toggle: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
        break;
      default:
    }
  };

  const rowSx = (selected: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 32, pr: 1, userSelect: 'none', cursor: 'pointer', borderRadius: 1,
    backgroundColor: selected ? 'action.selected' : 'transparent', '&:hover': { backgroundColor: selected ? 'action.selected' : 'action.hover' },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
  } as const);

  return (
    // 全体の高さは画面に合わせて制限し、ヘッダーは固定、ツリーだけをスクロールする
    <Paper
      variant="outlined" role="group" aria-label={label}
      sx={{ flex: '1 1 360px', minWidth: 300, maxWidth: 560, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1, borderBottom: 1, borderColor: 'divider', flex: '0 0 auto' }}>
        <Button size="small" onClick={() => onChange(new Set([...picked, ...rows.map((r) => r.key)]))}>すべて選択</Button>
        <Button size="small" onClick={() => { onChange(new Set()); setAnchor(null); }}>選択を解除</Button>
        <Typography variant="body2" sx={{ flexGrow: 1, textAlign: 'right' }} aria-live="polite" data-testid="kit-count">選択中: {count} Kits</Typography>
        <Tooltip title={HELP} arrow>
          <IconButton size="small" aria-label="選択操作のヘルプ" sx={{ width: 28, height: 28 }}>
            <Box component="span" aria-hidden sx={{ fontSize: 14, fontWeight: 700 }}>?</Box>
          </IconButton>
        </Tooltip>
      </Box>
      <Box ref={treeRef} role="tree" aria-label={`${label}（Plugin と Kit）`} aria-multiselectable sx={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', p: 0.5 }}>
        {items.map((it) => {
          if (it.kind === 'plugin') {
            const p = plugins.find((x) => x.pi === it.pi)!;
            const keys = p.kits.map((k) => k.key);
            const st = pluginState(keys, picked);
            const open = !collapsed.has(it.pi);
            return (
              <Box
                key={it.id} role="treeitem" aria-level={1} aria-expanded={open} aria-selected={st === 'all'} data-id={it.id}
                tabIndex={activeId === it.id ? 0 : -1} onKeyDown={(e) => onKey(e, it)} onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(it.id); }}
                onClick={() => toggleCollapse(it.pi)} sx={rowSx(false)} title={`${p.name}（${p.kits.length} Kits）`}
              >
                <IconButton
                  size="small" tabIndex={-1} aria-label={`${p.name} を${open ? '折りたたむ' : '展開する'}`} sx={{ width: 28, height: 28 }}
                  onClick={(e) => { e.stopPropagation(); toggleCollapse(it.pi); }}
                >
                  <Box component="span" aria-hidden sx={{ fontSize: 12 }}>{open ? '▼' : '▶'}</Box>
                </IconButton>
                <Checkbox
                  size="small" tabIndex={-1} checked={st === 'all'} indeterminate={st === 'some'} sx={{ p: 0.5 }}
                  slotProps={{ input: { 'aria-label': `${p.name}（${p.kits.length}）` } }}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => commit(applyPluginCheck(cur(), keys, e.target.checked))}
                />
                <Typography variant="subtitle2" sx={ellipsis}>{p.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: '0 0 auto' }}>（{p.kits.length}）</Typography>
              </Box>
            );
          }
          const on = picked.has(it.id);
          return (
            <Box
              key={it.id} role="treeitem" aria-level={2} aria-selected={on} data-id={it.id}
              tabIndex={activeId === it.id ? 0 : -1} onKeyDown={(e) => onKey(e, it)} onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(it.id); }}
              onClick={(e) => kitClick(e, it.id)} sx={{ ...rowSx(on), pl: 5 }} title={it.row.kitName}
            >
              <Checkbox
                size="small" tabIndex={-1} checked={on} sx={{ p: 0.5 }} slotProps={{ input: { 'aria-label': it.row.kitName } }}
                onClick={(e) => e.stopPropagation()} // 行クリックとの二重発火を防ぐ（チェックはその Kit だけを切り替える）
                onChange={(e) => { setFocusId(it.id); commit(applyKitCheck(cur(), it.id, e.target.checked)); }}
              />
              <Typography variant="body2" sx={ellipsis}>{it.row.kitName}</Typography>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
