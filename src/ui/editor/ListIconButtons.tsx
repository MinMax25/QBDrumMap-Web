import { IconButton, SvgIcon } from '@mui/material';
import type { MoveDirection } from '../../core';

/** 一覧の操作ボタン用のアイコン（Material Icons の SVG パス。追加ライブラリは使わない） */
const ICON_PATH = {
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  top: 'M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z',
  up: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  down: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
  bottom: 'M16 13h-3V3h-2v10H8l4 4 4-4zM4 19v2h16v-2H4z',
  // 破線の四角（Material の select_all。「選択行の内容を空にする」を表す。Lucide の square-dashed 相当）
  clear: 'M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2z',
} as const;

export type ListIconName = keyof typeof ICON_PATH;

/** 並べ替えボタンの順序・名前（全一覧で共通。Windows版の Move 系と同じ） */
export const MOVE_BUTTONS: readonly { dir: MoveDirection; icon: ListIconName; label: string }[] = [
  { dir: 'top', icon: 'top', label: '先頭' },
  { dir: 'up', icon: 'up', label: '上へ' },
  { dir: 'down', icon: 'down', label: '下へ' },
  { dir: 'bottom', icon: 'bottom', label: '末尾' },
];

/** ボタンの大きさ（px）。通常 32、狭い列向けのコンパクトは 28 */
const SIZE = { normal: 32, compact: 28 } as const;

/**
 * 一覧の操作ボタン（アイコンのみ）。aria-label と tooltip（title）は同じ文字列で、全一覧で共通。
 * disabled のときは tooltip を出さないブラウザがあるため、title は常に付ける。
 */
export function ListIconButton(p: {
  icon: ListIconName; label: string; onClick(): void; disabled?: boolean; color?: 'error'; compact?: boolean;
}) {
  const size = p.compact ? SIZE.compact : SIZE.normal;
  return (
    <IconButton
      size="small" aria-label={p.label} title={p.label} onClick={p.onClick} disabled={p.disabled} color={p.color}
      sx={{ width: size, height: size, p: 0.5 }}
    >
      <SvgIcon fontSize="small" sx={{ fontSize: 20 }}><path d={ICON_PATH[p.icon]} /></SvgIcon>
    </IconButton>
  );
}

/** 先頭／上へ／下へ／末尾の4ボタン（グループ名は `${noun} の並べ替え` の規則に合わせて呼び出し側で与える） */
export function MoveIconButtons(p: { onMove(dir: MoveDirection): void; disabled?: boolean; compact?: boolean }) {
  return (
    <>
      {MOVE_BUTTONS.map((b) => (
        <ListIconButton key={b.dir} icon={b.icon} label={b.label} onClick={() => p.onMove(b.dir)} disabled={p.disabled} compact={p.compact} />
      ))}
    </>
  );
}
