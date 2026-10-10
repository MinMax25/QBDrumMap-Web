import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  Box, Button, Menu, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
  type Theme,
} from '@mui/material';
import {
  enumName, filterKitPitchIndices, noteName, separatorValue, SEPARATORS,
  type Kit, type KitPitch, type KitRef, type MapData, type MoveDirection, type Separator,
} from '../../core';
import { ArticulationPickerDialog } from './ArticulationPickerDialog';
import { CopyArticulationDialog } from './CopyArticulationDialog';
import { ListIconButton, MoveIconButtons } from './ListIconButtons';
import type { PluginsKitsActions } from './pluginsKitsActions';

export interface PitchTableProps {
  map: MapData;
  kit: Kit;
  selected: readonly number[];
  actions: PluginsKitsActions;
  /** path（Plugins[i].Kits[j].Pitches[n]）→ 入力検証エラーの文言 */
  errors: ReadonlyMap<string, string>;
  pathPrefix: string;
  /** 表示中の Kit の位置（Articulation のコピー先） */
  kitRef: KitRef;
  /** 選択中の Kit への Import（未指定なら Import ボタンを出さない） */
  onImport?: () => void;
}

interface RowProps {
  index: number;
  row: KitPitch;
  articulationName: string;
  selected: boolean;
  error?: string;
  draggable: boolean;
  actions: PluginsKitsActions;
  onRowClick(e: MouseEvent, index: number): void;
  onPickArticulation(index: number): void;
  onDropTo(index: number): void;
}

const SEP_LABEL: Record<Separator, string> = { None: '（なし）', Separate: 'Separate', Unload: 'Not Loaded', Duplicate: 'Duplicate' };

/**
 * 行内の Name 入力。128行 × MUI TextField は描画が重いため、標準の input で同じ挙動を実装する（NameField と同じ確定式）:
 * 入力中は履歴を積まず、Enter／フォーカスアウトで確定、Escape で元に戻す。下書きは行（Pitch 番号キー）ごとに保持され、
 * 他の行の更新・選択変更では消えない。
 */
function RowNameInput({ label, value, error, onCommit }: { label: string; value: string; error?: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
  };
  return (
    <>
      <input
        className="pt-input" aria-label={label} aria-invalid={error ? true : undefined}
        value={draft ?? value} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={key}
      />
      {error && <div className="pt-error">{error}</div>}
    </>
  );
}

/**
 * 列見出しの直下に置く絞り込み欄（標準の input。×で空に戻す）。値は表示だけの状態で、QBD の内容・Dirty・Undo 履歴には関係しない。
 * ×は「選択行をクリア」とは別の操作（この欄の文字を消すだけ）。
 */
function FilterInput({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="pt-filter-box">
      <input className="pt-input pt-filter-input" aria-label={label} placeholder="絞り込み" value={value} onChange={(e) => onChange(e.target.value)} />
      {value !== '' && (
        <button type="button" className="pt-filter-clear" aria-label={`${label}を解除`} title={`${label}を解除`} onClick={() => onChange('')}>×</button>
      )}
    </div>
  );
}

const Row = memo(function Row(p: RowProps) {
  const blank = p.row.Name === null || p.row.Name.trim() === '';
  const sepName = enumName(SEPARATORS, 0, p.row.Separator);
  const sepValue = sepName ?? `undef:${separatorValue(p.row.Separator)}`;
  const [over, setOver] = useState(false);
  return (
    <tr
      className={`pt-row${p.selected ? ' pt-selected' : ''}${over ? ' pt-over' : ''}`}
      aria-selected={p.selected}
      onClick={(e) => p.onRowClick(e, p.index)}
      draggable={p.draggable && p.selected}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(p.index)); }}
      onDragOver={(e) => { if (p.draggable) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); p.onDropTo(p.index); }}
    >
      <td className="pt-pitch">{p.row.Pitch}</td>
      <td className="pt-note">{noteName(p.row.Pitch)}</td>
      <td className="pt-name">
        <RowNameInput
          label={`Pitch ${p.row.Pitch} の Name`} value={p.row.Name ?? ''} error={p.error}
          onCommit={(v) => p.actions.updatePitch(p.index, { Name: v })}
        />
      </td>
      <td className="pt-artic">
        <button
          type="button" className="pt-button" disabled={blank}
          onClick={(e) => { e.stopPropagation(); p.onPickArticulation(p.index); }}
          aria-label={`Pitch ${p.row.Pitch} の Articulation`}
        >
          {p.articulationName || '（なし）'}
        </button>
      </td>
      <td className="pt-sep">
        <select
          className="pt-input" disabled={blank} value={sepValue} aria-invalid={sepName === null ? true : undefined}
          aria-label={`Pitch ${p.row.Pitch} の Separator`}
          onChange={(e) => p.actions.setSeparator(p.index, e.target.value as Separator)}
        >
          {SEPARATORS.map((s) => <option key={s} value={s}>{SEP_LABEL[s]}</option>)}
          {sepName === null && <option value={sepValue} disabled>{`未定義 (${separatorValue(p.row.Separator)})`}</option>}
        </select>
      </td>
    </tr>
  );
});

/** 見出し行の高さ（絞り込み行を直下に固定するため、見出し行の高さを決めておく） */
const HEAD_ROW_PX = 33;
/** 列幅（px）。Name と Articulation は残りを等分する（表は table-layout: fixed）。全体の最小幅は合計＋Name・Articulation の最小幅 */
const COL_PITCH = 64;
const COL_NOTE = 64;
const COL_SEP = 150;

/** 行は標準要素なので、見た目はここ（表全体に1回）で定義する */
const tableSx = (theme: Theme) => ({
  // 親（Plugins & Kits タブ）の残り高さをすべて使う。ツールバーの折り返し段数に依存しない。
  // 画面が極端に低いとき（ページスクロールへ切り替える）だけ高さを制限する
  flex: '1 1 0', minHeight: 160,
  '@media (max-height: 639px)': { flex: 'none', maxHeight: 480 },
  '& th': { padding: '6px 8px' },
  // 列幅は <colgroup> が1回だけ決める（見出し・絞り込み行・データ行は同じ表の同じ列）。見出しの2段（見出し／絞り込み）はどちらも上端に固定する
  '& thead tr:first-of-type th': { height: HEAD_ROW_PX, boxSizing: 'border-box' },
  '& thead tr.pt-filter-row th': { top: HEAD_ROW_PX, padding: '2px 8px 4px', fontWeight: 'normal' },
  '& .pt-filter-box': { position: 'relative' },
  '& .pt-filter-input': { paddingRight: 24 },
  '& .pt-filter-clear': {
    position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, padding: 0, lineHeight: 1,
    border: 'none', borderRadius: 10, background: 'transparent', color: theme.palette.text.secondary, cursor: 'pointer', fontSize: 14,
  },
  '& .pt-filter-clear:hover': { backgroundColor: theme.palette.action.hover, color: theme.palette.text.primary },
  '& .pt-filter-clear:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
  '& .pt-row td': { padding: '4px 8px', borderBottom: `1px solid ${theme.palette.divider}`, verticalAlign: 'top', fontSize: theme.typography.body2.fontSize },
  '& .pt-row:hover': { backgroundColor: theme.palette.action.hover },
  '& .pt-row.pt-selected': { backgroundColor: theme.palette.action.selected },
  '& .pt-row.pt-over': { boxShadow: `inset 0 2px 0 ${theme.palette.primary.main}` },
  '& .pt-input': {
    width: '100%', boxSizing: 'border-box', font: 'inherit', color: 'inherit', background: 'transparent',
    padding: '4px 8px', border: `1px solid ${theme.palette.divider}`, borderRadius: 4,
  },
  // ネイティブの選択肢の一覧は背景が不透明な既定色になるため、文字色と背景をテーマの色で明示する（Dark で文字が読めなくなる）
  '& select.pt-input option': { color: theme.palette.text.primary, backgroundColor: theme.palette.background.paper },
  '& .pt-input:focus': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -1 },
  '& .pt-input[aria-invalid="true"]': { borderColor: theme.palette.error.main },
  '& .pt-input:disabled': { opacity: 0.5 },
  '& .pt-error': { color: theme.palette.error.main, fontSize: '0.75rem', marginTop: 2 },
  '& .pt-button': {
    font: 'inherit', color: theme.palette.primary.main, background: 'transparent', border: 'none', padding: '4px 8px',
    cursor: 'pointer', borderRadius: 4, textAlign: 'left',
  },
  '& .pt-button:hover:not(:disabled)': { backgroundColor: theme.palette.action.hover },
  '& .pt-button:disabled': { color: theme.palette.text.disabled, cursor: 'default' },
});

/** 選択Kitの Pitch 表（128行を想定。実際の行数は Kit.Pitches に従う）。フィルタ中は並べ替え不可 */
export function PitchTable({ map, kit, selected, actions, errors, pathPrefix, kitRef, onImport }: PitchTableProps) {
  const [nameFilter, setNameFilter] = useState('');
  const [articFilter, setArticFilter] = useState('');
  const [picking, setPicking] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const filterActive = nameFilter !== '' || articFilter !== '';
  const visible = useMemo(
    () => (filterActive ? filterKitPitchIndices(map, kit, { name: nameFilter, articulation: articFilter }) : kit.Pitches.map((_, i) => i)),
    [map, kit, nameFilter, articFilter, filterActive],
  );
  // 行のキーは Pitch 番号（配列位置ではなく行の同一性）。重複する番号は出現順で一意にする。
  // 並べ替えで行の DOM（編集中の下書きを含む）が行と一緒に移動する
  const rowKeys = useMemo(() => {
    const seen = new Map<number, number>();
    return kit.Pitches.map((r) => {
      const n = seen.get(r.Pitch) ?? 0;
      seen.set(r.Pitch, n + 1);
      return n === 0 ? String(r.Pitch) : `${r.Pitch}#${n}`;
    });
  }, [kit]);
  // Articulation ID → 名前（行ごとの探索を避ける。Parts が変わったときだけ再生成）
  const articNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const part of map.Parts) for (const a of part.Articulations) if (!m.has(a.ID)) m.set(a.ID, a.Name);
    return m;
  }, [map.Parts]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const hasSel = selected.length > 0;
  const canMove = hasSel && !filterActive;
  const move = (dir: MoveDirection) => actions.movePitches(dir);

  // 行はメモ化されている（構造共有により変更のない行は再描画しない）ため、行へ渡す関数は参照を安定させる
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onRowClick = useCallback(
    (e: MouseEvent, i: number) =>
      actions.selectPitch(i, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single', visibleRef.current),
    [actions],
  );
  const onDropTo = useCallback((to: number) => actions.movePitchesTo(to), [actions]);

  return (
    <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      {/* 1段にまとめる（狭いときだけ折り返す）。自動割当・コピーは常時表示、整列はメニュー、Import は独立 */}
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', mb: 1, '& .MuiButton-root': { px: 1, minWidth: 0, whiteSpace: 'nowrap' } }}>
        <Typography variant="subtitle1" component="h3" sx={{ flexGrow: 1 }} title={`${kit.Name} の Pitch（${kit.Pitches.length}）`}>Pitches（{kit.Pitches.length}）</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }} role="group" aria-label="編集補助">
          <Button size="small" variant="outlined" onClick={() => void actions.autoAssign()} aria-label="Articulation を自動割当" title="Articulation を自動割当">自動割当</Button>
          <Button size="small" variant="outlined" onClick={() => setCopying(true)} aria-label="Articulation をコピー…" title="Articulation をコピー…">コピー…</Button>
          <Button
            size="small" variant="outlined" aria-haspopup="menu" aria-expanded={menuAnchor !== null} aria-controls={menuAnchor ? 'align-menu' : undefined}
            endIcon={<span aria-hidden>▾</span>} onClick={(e) => setMenuAnchor(e.currentTarget)}
          >整列</Button>
          <Menu id="align-menu" anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => { setMenuAnchor(null); void actions.resetOrderByPitch(); }}>Pitch 順に並べ替え</MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); void actions.compressForward(); }}>空の行を後ろへ詰める</MenuItem>
          </Menu>
          {onImport && <Button size="small" variant="outlined" onClick={onImport} aria-label="Import…（.pitchlist / .drm / .tsv）" title="Import…（.pitchlist / .drm / .tsv）">Import…</Button>}
        </Box>
        <ListIconButton icon="clear" label="選択行をクリア" onClick={() => void actions.clearSelectedPitches()} disabled={!hasSel} color="error" compact />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }} role="group" aria-label="Pitch 行の並べ替え">
          <MoveIconButtons onMove={move} disabled={!canMove} compact />
        </Box>
      </Box>
      {filterActive && (
        <Typography variant="caption" color="text.secondary" role="status">
          絞り込み中（{visible.length} / {kit.Pitches.length} 行）。並べ替えは絞り込みを解除してから行えます。
        </Typography>
      )}
      <TableContainer sx={tableSx}>
        <Table size="small" stickyHeader aria-label="Pitch 表" sx={{ tableLayout: 'fixed', width: '100%', minWidth: COL_PITCH + COL_NOTE + COL_SEP + 400 }}>
          <colgroup>
            <col style={{ width: COL_PITCH }} /><col style={{ width: COL_NOTE }} /><col /><col /><col style={{ width: COL_SEP }} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell>Pitch</TableCell><TableCell>Note</TableCell><TableCell>Name</TableCell>
              <TableCell>Articulation</TableCell><TableCell>Separator</TableCell>
            </TableRow>
            <TableRow className="pt-filter-row">
              <TableCell /><TableCell />
              <TableCell><FilterInput label="Name で絞り込み" value={nameFilter} onChange={setNameFilter} /></TableCell>
              <TableCell><FilterInput label="Articulation で絞り込み" value={articFilter} onChange={setArticFilter} /></TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((i) => {
              const row = kit.Pitches[i]!;
              return (
                <Row
                  key={rowKeys[i]} index={i} row={row}
                  articulationName={row.ArticulationID === 0 ? '' : (articNames.get(row.ArticulationID) ?? `（不明 ID ${row.ArticulationID}）`)}
                  selected={selectedSet.has(i)} error={errors.get(`${pathPrefix}.Pitches[${i}]`)}
                  draggable={!filterActive} actions={actions}
                  onRowClick={onRowClick} onPickArticulation={setPicking} onDropTo={onDropTo}
                />
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <CopyArticulationDialog
        open={copying} map={map} target={kitRef} onClose={() => setCopying(false)}
        onCopy={(source) => void actions.copyArticulation(source)}
      />
      <ArticulationPickerDialog
        open={picking !== null} map={map} current={picking !== null ? (kit.Pitches[picking]?.ArticulationID ?? 0) : 0}
        onClose={() => setPicking(null)}
        onPick={(id) => { const i = picking; setPicking(null); if (i !== null) void actions.setArticulation(i, id); }}
      />
    </Paper>
  );
}
