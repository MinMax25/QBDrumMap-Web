// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { ArticulationPickerDialog } from '../../src/ui/editor/ArticulationPickerDialog';
import { parseQbd, type MapData } from '../../src/core';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

/** gmSmall に、同名・別 ID の Articulation（Part「Snare」の「Snare」と、別 Part の「Snare」）と、Part 名と同名の項目を足した作業用データ */
function mapWithSameName(): MapData {
  const o = JSON.parse(gmSmall) as { Parts: unknown[] };
  o.Parts.push(
    { ID: 10, Name: 'Extra', ScorePitch: 40, InstrumentEntityID: '', TechniqueEntityID: '',
      Articulations: [{ ID: 50, Name: 'Snare', DrumMapOrder: 10 }, { ID: 51, Name: 'Extra Rim', DrumMapOrder: 11 }] },
  );
  const r = parseQbd(JSON.stringify(o));
  if (!r.ok) throw new Error('fixture');
  return r.value;
}
const plainMap = (): MapData => {
  const r = parseQbd(gmSmall);
  if (!r.ok) throw new Error('fixture');
  return r.value;
};

function Harness(p: { map: MapData; onPick?: (id: number) => void; onClose?: () => void; current?: number }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>開く</button>
      <ArticulationPickerDialog
        open={open} map={p.map} current={p.current ?? 0}
        onClose={() => { p.onClose?.(); setOpen(false); }} onPick={(id) => p.onPick?.(id)}
      />
    </>
  );
}

describe('Articulation 選択ダイアログ（UI Phase 7）', () => {
  it('絞り込み欄は一覧のスクロール領域（DialogContent）の外にあり、タイトルとキャンセルも固定される', () => {
    render(<Harness map={plainMap()} />);
    const dialog = screen.getByRole('dialog');
    const filter = within(dialog).getByRole('textbox', { name: '名前で絞り込み' });
    const list = within(dialog).getByRole('list', { name: 'Articulation 一覧' });
    const content = list.closest('.MuiDialogContent-root');
    expect(content).toBeTruthy();
    expect(content!.contains(filter)).toBe(false); // 絞り込み欄は一覧と一緒にスクロールしない
    expect(content!.contains(within(dialog).getByRole('button', { name: 'キャンセル' }))).toBe(false);
    expect(content!.contains(within(dialog).getByText('Articulation を選択'))).toBe(false);
  });

  it('Esc で閉じる（onClose が呼ばれる）', () => {
    const onClose = vi.fn();
    render(<Harness map={plainMap()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('絞り込みを変えると一覧は先頭へ戻り、閉じて開き直すと絞り込みは空になる', () => {
    render(<Harness map={plainMap()} />);
    const dialog = screen.getByRole('dialog');
    const content = within(dialog).getByRole('list', { name: 'Articulation 一覧' }).closest('.MuiDialogContent-root') as HTMLElement;
    const filter = () => within(screen.getByRole('dialog')).getByRole('textbox', { name: '名前で絞り込み' }) as HTMLInputElement;
    content.scrollTop = 120;
    fireEvent.change(filter(), { target: { value: 'sn' } });
    expect(content.scrollTop).toBe(0);
    expect(filter().value).toBe('sn');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); // 閉じる
    fireEvent.click(screen.getByRole('button', { name: '開く', hidden: true }));
    expect(filter().value).toBe(''); // 前回の絞り込みは残らない
  });

  it('同名・別 ID の Articulation にだけ ID を補足表示し、選択は名前ではなく ID で行う', () => {
    const onPick = vi.fn();
    render(<Harness map={mapWithSameName()} onPick={onPick} />);
    const list = within(screen.getByRole('dialog')).getByRole('list', { name: 'Articulation 一覧' });
    const snares = within(list).getAllByText('Snare');
    expect(snares).toHaveLength(2); // Part「Snare」の項目と、Part「Extra」の項目（見出しは「Snare（1）」で別表記）
    // ID の補足は同名の 2 項目にだけ付く
    expect(within(list).getByText('ID 2')).toBeTruthy();
    expect(within(list).getByText('ID 50')).toBeTruthy();
    expect(within(list).queryByText(/^ID 1$/)).toBeNull(); // Kick（同名なし）
    expect(within(list).queryByText(/^ID 51$/)).toBeNull(); // Extra Rim（同名なし）
    // 同じ名前でも、押した項目の ID が渡る
    fireEvent.click(within(list).getByText('ID 50').closest('[role=button]') ?? within(list).getByText('ID 50'));
    expect(onPick).toHaveBeenLastCalledWith(50);
    fireEvent.click(within(list).getByText('ID 2').closest('[role=button]') ?? within(list).getByText('ID 2'));
    expect(onPick).toHaveBeenLastCalledWith(2);
  });

  it('同名がなければ ID は表示しない。Part 見出しには件数が付き、項目と別の文字列になる（Part 名と同名の項目でも重複して見えない）', () => {
    render(<Harness map={plainMap()} />);
    const list = within(screen.getByRole('dialog')).getByRole('list', { name: 'Articulation 一覧' });
    expect(within(list).queryByText(/^ID \d+$/)).toBeNull();
    expect(within(list).getByText('Kick（1）')).toBeTruthy(); // 見出し
    expect(within(list).getByText('Kick')).toBeTruthy(); // 項目（Part 名と同名）
  });

  it('現在の割当の項目が選択表示になり、（なし）で ID 0 が渡る', () => {
    const onPick = vi.fn();
    render(<Harness map={plainMap()} onPick={onPick} current={2} />);
    const list = within(screen.getByRole('dialog')).getByRole('list', { name: 'Articulation 一覧' });
    const snare = within(list).getByText('Snare').closest('.MuiListItemButton-root')!;
    expect(snare.className).toContain('Mui-selected');
    fireEvent.click(within(list).getByText('（なし）'));
    expect(onPick).toHaveBeenLastCalledWith(0);
  });
});
