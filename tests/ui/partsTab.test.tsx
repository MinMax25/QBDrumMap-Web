// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo } from '../../src/ui/services/fileIo';
import { gmSmall } from '../fixtures';
import type { MapData } from '../../src/core';

afterEach(cleanup);

const nullIo: FileIo = { openText: async () => null, saveText: () => undefined };

function setup(json: string = gmSmall) {
  const store = new EditorStore();
  store.load(json, 'a.qbd');
  render(<AppShell store={store} io={nullIo} />);
  return store;
}
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const partList = () => screen.getByRole('listbox', { name: 'Part' });
const partNames = (s: EditorStore) => s.getSnapshot().map.Parts.map((p) => p.Name);
const pick = (list: HTMLElement, text: string | RegExp, init?: MouseEventInit) => fireEvent.click(within(list).getAllByText(text)[0]!, init);
const row = (list: HTMLElement, i: number, init?: MouseEventInit) => fireEvent.click(within(list).getAllByRole('option')[i]!, init);
const group = (name: string) => screen.getAllByRole('group', { name })[0]!;
const clickBtn = (name: string, groupName: string) => fireEvent.click(within(group(groupName)).getByRole('button', { name }));
const confirmDialog = async (button: '続行' | 'キャンセル') => {
  const dlg = await screen.findByRole('dialog');
  const text = dlg.textContent ?? '';
  fireEvent.click(within(dlg).getByRole('button', { name: button }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  return text;
};
const k1 = (s: EditorStore) => s.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.ArticulationID);
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const commit = (el: HTMLElement, value: string) => { fireEvent.change(el, { target: { value } }); fireEvent.blur(el); };

describe('Parts タブ: 一覧と選択', () => {
  it('Part 一覧（名前・Articulation 件数・色見本）が表示され、選択すると Articulation と属性が出る', () => {
    setup();
    openTab('Parts');
    expect(within(partList()).getAllByRole('option')).toHaveLength(3);
    expect(screen.getByText('Part を選択すると、その Articulation と属性を表示します。')).toBeTruthy();
    pick(partList(), 'Snare');
    expect(screen.getByRole('listbox', { name: 'Snare の Articulation' })).toBeTruthy();
    expect((screen.getByLabelText('Note Head') as HTMLSelectElement).value).toBe('nhdX');
    expect((screen.getByLabelText('Technique') as HTMLSelectElement).value).toBe('circ');
    // Cubase 用の項目（Voice／Note Head Set／Entity ID）は画面に出さない（値は Part に保持される）
    for (const label of ['Voice', 'Note Head Set', 'Instrument Entity ID', 'Technique Entity ID']) expect(screen.queryByLabelText(label)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cubase' })).toBeNull();
    expect(screen.queryByText(/Cubase の項目/)).toBeNull();
    expect(screen.getByLabelText('Color の値').textContent).toBe('#FF0000'); // 不正な値も保持して表示（透明として扱う）
    expect((screen.getByLabelText('Score Pitch') as HTMLSelectElement).value).toBe('undef:38'); // 38 は Windows版の候補にない値（保持して表示）
    expect(screen.getByRole('option', { name: '未定義 (38)' })).toBeTruthy();
  });

  it('Ctrl+クリックで複数選択、Shift+クリックで範囲選択', () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Kick');
    pick(partList(), 'HiHat', { ctrlKey: true });
    expect(store.getSnapshot().selection.partIndices).toEqual([0, 2]);
    pick(partList(), 'Kick');
    pick(partList(), 'HiHat', { shiftKey: true });
    expect(store.getSnapshot().selection.partIndices).toEqual([0, 1, 2]);
  });
});

describe('Parts タブ: 追加・名前・検証', () => {
  it('Part を追加すると Part{ID} が選択され、Articulation 欄が現れる。Undo で戻る', () => {
    const store = setup();
    openTab('Parts');
    fireEvent.click(screen.getByRole('button', { name: 'Part を追加' }));
    expect(partNames(store)).toEqual(['Kick', 'Snare', 'HiHat', 'Part4']);
    expect(screen.getByText('Part4 の Articulation（0）')).toBeTruthy(); // 選択された Part の Articulation 欄（空）
    expect(screen.getByText(/Articulation がありません/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(partNames(store)).toEqual(['Kick', 'Snare', 'HiHat']);
    expect(store.getSnapshot().selection.partIndices).toEqual([]);
  });

  it('Part 名は確定（blur）で1回だけ履歴に積まれ、Escape で取消。重複名は検証エラーを表示する', () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Kick');
    const name = input('Part 名');
    fireEvent.change(name, { target: { value: 'Kick2' } });
    expect(store.getSnapshot().historyLength).toBe(0);
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(input('Part 名').value).toBe('Kick');
    commit(input('Part 名'), 'Snare'); // 他の Part と重複
    expect(store.getSnapshot().historyLength).toBe(1);
    expect(screen.getAllByText('同じ名前が他にあります（一意にしてください）').length).toBeGreaterThan(0);
    commit(input('Part 名'), 'x'.repeat(65));
    expect(screen.getAllByText('1〜64文字で入力してください').length).toBeGreaterThan(0);
  });
});

describe('Parts タブ: 削除と参照整合性', () => {
  it('削除の確認に影響が表示され、キャンセルでは何も変わらない。続行で参照が解除され、1回の Undo で完全に戻る', async () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Snare');
    const before: MapData = store.getSnapshot().map;
    fireEvent.click(screen.getByRole('button', { name: 'Part を削除' }));
    const text = await confirmDialog('キャンセル');
    expect(text).toContain('Snare');
    expect(text).toContain('配下の Articulation 1 件を削除し');
    expect(text).toContain('KitPitch の Articulation の割り当て 1 件');
    expect(store.getSnapshot().map).toBe(before);
    expect(store.getSnapshot().historyLength).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Part を削除' }));
    await confirmDialog('続行');
    expect(partNames(store)).toEqual(['Kick', 'HiHat']);
    expect(k1(store)).toEqual([0, 1, 0, 3]); // Snare (ID 2) を参照していた行だけ 0。Name・Separator は不変
    expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[3]!.Separator).toBe('Separate');
    expect(store.getSnapshot().selection.partIndex).toBeNull();
    expect(store.getSnapshot().historyLength).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(store.getSnapshot().map).toBe(before); // 参照を含め完全に復元（同じスナップショット）
    fireEvent.click(screen.getByRole('button', { name: 'やり直し' }));
    expect(k1(store)).toEqual([0, 1, 0, 3]);
  });

  it('Articulation の削除も、参照する KitPitch の割り当てを解除する（Undo で復元）', async () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Kick');
    pick(screen.getByRole('listbox', { name: 'Kick の Articulation' }), 'Kick');
    fireEvent.click(screen.getByRole('button', { name: 'Articulation を削除' }));
    const text = await confirmDialog('続行');
    expect(text).toContain('KitPitch の Articulation の割り当て 1 件');
    expect(store.getSnapshot().map.Parts[0]!.Articulations).toHaveLength(0);
    expect(k1(store)).toEqual([0, 0, 2, 3]);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(k1(store)).toEqual([0, 1, 2, 3]);
  });
});

describe('Parts タブ: 並べ替え（ボタン・キーボード・D&D）と選択の追従', () => {
  it('ボタンで並べ替えても同じ Part が選択されたまま。Undo 1回で戻る', () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'HiHat');
    clickBtn('先頭', 'Part の並べ替え');
    expect(partNames(store)).toEqual(['HiHat', 'Kick', 'Snare']);
    expect(store.getSnapshot().selection.partIndices).toEqual([0]);
    expect(store.getSnapshot().map.Parts.map((p) => p.DisplayOrder)).toEqual([1, 2, 3]);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(partNames(store)).toEqual(['Kick', 'Snare', 'HiHat']);
    expect(store.getSnapshot().selection.partIndices).toEqual([2]);
  });

  it('Alt+↑／↓ で選択行を移動できる', () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Snare');
    const row = within(partList()).getByText('Snare').closest('[role=option]')!;
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true });
    expect(partNames(store)).toEqual(['Snare', 'Kick', 'HiHat']);
    fireEvent.keyDown(within(partList()).getByText('Snare').closest('[role=option]')!, { key: 'End', altKey: true });
    expect(partNames(store)).toEqual(['Kick', 'HiHat', 'Snare']);
    expect(store.getSnapshot().selection.partIndices).toEqual([2]);
  });

  it('D&D: 選択行を別の行の直前へ移す', () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Kick');
    const rows = within(partList()).getAllByRole('option');
    fireEvent.dragStart(rows[0]!, { dataTransfer: { setData: () => undefined, effectAllowed: '' } });
    fireEvent.drop(rows[2]!);
    expect(partNames(store)).toEqual(['Snare', 'Kick', 'HiHat']);
    expect(store.getSnapshot().selection.partIndices).toEqual([1]);
  });

  it('Articulation の並べ替えと Part 切替で Articulation の選択が別 Part に持ち越されない', () => {
    const store = setup();
    openTab('Parts');
    fireEvent.click(screen.getByRole('button', { name: 'Part を追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'Articulation を追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'Articulation を追加' }));
    expect(store.getSnapshot().map.Parts[3]!.Articulations.map((a) => a.Name)).toEqual(['Part4 1', 'Part4 2']);
    expect(store.getSnapshot().map.Parts[3]!.Articulations.map((a) => a.ID)).toEqual([4, 5]);
    clickBtn('先頭', 'Articulation の並べ替え');
    expect(store.getSnapshot().map.Parts[3]!.Articulations.map((a) => a.Name)).toEqual(['Part4 2', 'Part4 1']);
    expect(store.getSnapshot().selection.articulationIndices).toEqual([0]);
    pick(partList(), 'Kick');
    expect(store.getSnapshot().selection.articulationIndices).toEqual([]);
  });
});

describe('Parts タブ: Articulation の名前と Complement', () => {
  it('名前の編集、Complement の選択（ダイアログ）、解除（確認付き）', async () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Kick');
    pick(screen.getByRole('listbox', { name: 'Kick の Articulation' }), 'Kick');
    commit(input('Articulation 名'), 'Kick-A');
    expect(store.getSnapshot().map.Parts[0]!.Articulations[0]!.Name).toBe('Kick-A');

    fireEvent.click(screen.getByRole('button', { name: 'Complement を選択' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByText('Closed'));
    await waitFor(() => expect(store.getSnapshot().map.Parts[0]!.Articulations[0]!.Complement).toBe(3));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Complement: Closed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Complement を解除' }));
    await confirmDialog('キャンセル');
    expect(store.getSnapshot().map.Parts[0]!.Articulations[0]!.Complement).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Complement を解除' }));
    await confirmDialog('続行');
    expect(store.getSnapshot().map.Parts[0]!.Articulations[0]!.Complement).toBe(0);
  });

  it('参照先のない Complement（異常データ）は警告を表示し、保持される', () => {
    const store = setup();
    act(() => {
      store.edit('異常データ', (m) => ({
        ok: true,
        value: { changed: true, map: { ...m, Parts: m.Parts.map((p, i) => (i === 0 ? { ...p, Articulations: p.Articulations.map((a) => ({ ...a, Complement: 99 })) } : p)) } },
      }));
    });
    openTab('Parts');
    pick(partList(), 'Kick');
    pick(screen.getByRole('listbox', { name: 'Kick の Articulation' }), 'Kick');
    expect(screen.getByRole('alert').textContent).toContain('参照先の Articulation が存在しません');
    expect(screen.getByRole('button', { name: 'Complement を選択' }).textContent).toBe('（不明 ID 99）');
    expect(store.getSnapshot().map.Parts[0]!.Articulations[0]!.Complement).toBe(99);
  });
});

describe('Parts タブ: 属性の編集', () => {
  it('Note Head／Technique／Score Pitch が編集でき、1回の確定が1履歴。Cubase 用の値を含む他の属性は変わらない', () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Snare');
    fireEvent.change(screen.getByLabelText('Note Head'), { target: { value: 'nhTr' } });
    fireEvent.change(screen.getByLabelText('Technique'), { target: { value: 'trm2' } });
    fireEvent.change(screen.getByLabelText('Score Pitch'), { target: { value: '60' } });
    expect(store.getSnapshot().historyLength).toBe(3);
    expect(store.getSnapshot().map.Parts[1]).toMatchObject({
      ID: 2, Name: 'Snare', NoteHead: 'nhTr', Technique: 'trm2', Voice: 'Down1', ScorePitch: 60, InstrumentEntityID: 'inst',
      TechniqueEntityID: 'tech', NoteHeadSet: 2, Color: '#FF0000',
    });
    expect(store.getSnapshot().map.Parts[1]!.Articulations).toHaveLength(1);
  });

  it('不正な不透明度は拒否され、状態は変わらずエラーが表示される', async () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Snare');
    const before = store.getSnapshot().map;
    commit(input('Color の不透明度（0〜255）'), '300');
    expect(await screen.findByText(/不透明度は 0〜255 の整数で入力してください/)).toBeTruthy();
    expect(store.getSnapshot().map).toBe(before);
    expect(store.getSnapshot().historyLength).toBe(0);
  });

  it('Color: 色の選択は確定（フォーカスアウト）で1回、不透明度の変更、解除。Color 未設定では不透明（FF）で設定する', () => {
    const store = setup();
    openTab('Parts');
    pick(partList(), 'Kick'); // gmSmall の Kick は Color 未設定
    expect(screen.getByLabelText('Color の値').textContent).toBe('（未設定）');
    const color = input('Color');
    fireEvent.change(color, { target: { value: '#112233' } });
    expect(store.getSnapshot().historyLength).toBe(0);
    fireEvent.blur(color);
    expect(store.getSnapshot().map.Parts[0]!.Color).toBe('FF332211'); // AABBGGRR
    commit(input('Color の不透明度（0〜255）'), '128');
    expect(store.getSnapshot().map.Parts[0]!.Color).toBe('80332211');
    fireEvent.click(screen.getByRole('button', { name: 'Color を解除' }));
    expect(store.getSnapshot().map.Parts[0]!.Color).toBeNull();
    expect(store.getSnapshot().historyLength).toBe(3);
  });
});

describe('DrumMap Order タブ', () => {
  const orderList = () => screen.getByRole('listbox', { name: 'Articulation（DrumMap Order）' });
  const names = (s: EditorStore) => {
    const m = s.getSnapshot().map;
    return m.Parts.flatMap((p) => p.Articulations).sort((a, b) => a.DrumMapOrder - b.DrumMapOrder).map((a) => a.Name);
  };

  it('全 Part の Articulation を DrumMapOrder 順に表示し、Part 名を識別できる。追加・削除ボタンは出ない', () => {
    setup();
    openTab('DrumMap Order');
    const rows = within(orderList()).getAllByRole('option');
    expect(rows.map((r) => r.textContent)).toEqual(['KickKick', 'SnareSnare', 'ClosedHiHat']);
    expect(screen.queryByRole('button', { name: 'Articulation を追加' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Articulation を削除' })).toBeNull();
  });

  it('ボタン・Alt+矢印・D&D で並べ替えられ、一括並べ替えは Undo 1回で戻る。DrumMapOrder は一意', () => {
    const store = setup();
    openTab('DrumMap Order');
    pick(orderList(), 'Closed');
    pick(orderList(), 'Kick', { ctrlKey: true });
    clickBtn('先頭', 'Articulation の並べ替え');
    expect(names(store)).toEqual(['Kick', 'Closed', 'Snare']);
    expect(store.getSnapshot().historyLength).toBe(1);
    expect(new Set(store.getSnapshot().map.Parts.flatMap((p) => p.Articulations.map((a) => a.DrumMapOrder))).size).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(names(store)).toEqual(['Kick', 'Snare', 'Closed']);
    expect(store.getSnapshot().historyLength).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'やり直し' }));
    const first = within(orderList()).getAllByRole('option');
    fireEvent.keyDown(first[1]!, { key: 'ArrowDown', altKey: true });
    expect(names(store).length).toBe(3);

    const rows = within(orderList()).getAllByRole('option');
    fireEvent.dragStart(rows[0]!, { dataTransfer: { setData: () => undefined, effectAllowed: '' } });
    fireEvent.drop(rows[2]!);
    expect(new Set(names(store)).size).toBe(3);
  });

  it('並べ替えても Part 内の順序（Parts タブ）は変わらず、選択は同じ Articulation に追従する', () => {
    const store = setup();
    openTab('DrumMap Order');
    pick(orderList(), 'Snare');
    clickBtn('末尾', 'Articulation の並べ替え');
    expect(names(store)).toEqual(['Kick', 'Closed', 'Snare']);
    const idx = store.getSnapshot().selection.orderIndices;
    expect(idx).toEqual([2]);
    expect(within(orderList()).getAllByRole('option')[2]!.textContent).toBe('SnareSnare');
    expect(store.getSnapshot().map.Parts.map((p) => p.Articulations.map((a) => a.DisplayOrder))).toEqual([[1], [1], [1]]);
  });

  it('Parts タブでの Part 削除で消えた Articulation の選択は解除され、別の行に化けない', async () => {
    const store = setup();
    openTab('DrumMap Order');
    pick(orderList(), 'Snare');
    openTab('Parts');
    pick(partList(), 'Snare');
    fireEvent.click(screen.getByRole('button', { name: 'Part を削除' }));
    await confirmDialog('続行');
    expect(store.getSnapshot().selection.orderIndices).toEqual([]);
  });
});
