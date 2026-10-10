// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { createFileActions, NOTICE_DOWNLOAD_STARTED } from '../../src/ui/app/fileActions';
import { createPluginsKitsActions, type EditorUi } from '../../src/ui/editor/pluginsKitsActions';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo } from '../../src/ui/services/fileIo';
import { addKit, addPlugin, updateKit, type QbdError } from '../../src/core';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

const nullIo: FileIo = { openText: async () => null, saveText: () => undefined };

function setup(opts: { io?: FileIo; empty?: boolean } = {}) {
  const store = new EditorStore();
  if (!opts.empty) store.load(gmSmall, 'a.qbd');
  render(<AppShell store={store} io={opts.io ?? nullIo} />);
  return store;
}
const name = (s: EditorStore) => s.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.Name);
const selectGmKit = () => {
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
  fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('GM Kit'));
};
const commit = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe('Plugins & Kits タブ: 一覧と選択', () => {
  it('空データでは案内を表示し、Plugin を追加すると選択されて Kit 欄が現れる', () => {
    const store = setup({ empty: true });
    expect(screen.getByText(/Plugin がありません/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plugin を追加' }));
    expect(store.getSnapshot().map.Plugins.map((p) => p.Name)).toEqual(['Plugin1']);
    expect(store.getSnapshot().selection.pluginIndex).toBe(0);
    expect(screen.getByText(/Kit がありません/)).toBeTruthy(); // 選択された Plugin1 の Kit 欄（空）
  });

  it('Plugin → Kit を選ぶと Pitch 表（行数分）が表示される。Kit 未選択では案内', () => {
    setup();
    expect(screen.getByText('Plugin を選択すると、その Kit を表示します。')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    expect(screen.getByText('Kit を選択すると、Pitch 表を表示します。')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('GM Kit'));
    const table = screen.getByRole('table', { name: 'Pitch 表' });
    expect(within(table).getAllByRole('row')).toHaveLength(2 + 4); // ヘッダー・絞り込み行 + fixture の4行
    expect(within(table).getByDisplayValue('Kick')).toBeTruthy();
    expect(within(table).getByText('C1')).toBeTruthy(); // Pitch 36 の Note（Core の noteName）
  });

  it('Kit を追加すると128行の Pitch 表になる', () => {
    setup();
    selectGmKit();
    fireEvent.click(screen.getByRole('button', { name: 'Kit を追加' }));
    const table = screen.getByRole('table', { name: 'Pitch 表' });
    expect(within(table).getAllByRole('row')).toHaveLength(2 + 128);
    expect(screen.getByText('Pitches（128）')).toBeTruthy();
  });
});

describe('Plugins & Kits タブ: 編集', () => {
  it('Plugin 名の編集は確定（blur）で1回だけ履歴に積まれ、Escapeで取り消せる', () => {
    const store = setup();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    const input = screen.getByLabelText('Plugin 名');
    fireEvent.change(input, { target: { value: 'Ro' } });
    fireEvent.change(input, { target: { value: 'Roland' } });
    expect(store.getSnapshot().canUndo).toBe(false); // 入力中は履歴に積まない
    fireEvent.blur(input);
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('Roland');
    expect(store.getSnapshot().historyLength).toBe(1);
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((screen.getByLabelText('Plugin 名') as HTMLInputElement).value).toBe('Roland');
    expect(store.getSnapshot().historyLength).toBe(1);
  });

  it('重複名・長さ違反は該当箇所にエラー表示される。編集自体は許可される', () => {
    const store = setup();
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('Plugin2'));
    commit(screen.getByLabelText('Plugin 名'), 'GM');
    expect(store.getSnapshot().map.Plugins[1]!.Name).toBe('GM');
    expect(screen.getAllByText(/同じ名前が他にあります/).length).toBeGreaterThan(0);
    commit(screen.getByLabelText('Plugin 名'), '');
    expect(screen.getAllByText(/1〜64文字/).length).toBeGreaterThan(0);
  });

  it('Name を空にすると Articulation / Separator が連動クリアされ、その行の入力が無効になる。1回のUndoで元に戻る', () => {
    const store = setup();
    selectGmKit();
    const table = screen.getByRole('table', { name: 'Pitch 表' });
    commit(within(table).getByLabelText('Pitch 42 の Name'), '');
    expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[3]).toMatchObject({ Name: '', ArticulationID: 0, Separator: 'None' });
    expect((within(table).getByLabelText('Pitch 42 の Separator') as HTMLSelectElement).disabled).toBe(true);
    expect((within(table).getByLabelText('Pitch 42 の Articulation') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[3]).toMatchObject({ Name: 'Closed HH', ArticulationID: 3, Separator: 'Separate' });
    expect((within(table).getByLabelText('Pitch 42 の Separator') as HTMLSelectElement).disabled).toBe(false);
  });

  it('Separator の変更と、未定義値の表示（編集は保持される）', () => {
    const store = setup();
    selectGmKit();
    const sel = screen.getByLabelText('Pitch 36 の Separator') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'Unload' } });
    expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[1]!.Separator).toBe('Unload');
    act(() => { store.edit('x', (m) => ({ ok: true, value: { map: { ...m, Plugins: [{ ...m.Plugins[0]!, Kits: [{ ...m.Plugins[0]!.Kits[0]!, Pitches: m.Plugins[0]!.Kits[0]!.Pitches.map((p, i) => (i === 2 ? { ...p, Separator: 99 } : p)) }] }] }, changed: true } })); });
    expect((screen.getByLabelText('Pitch 38 の Separator') as HTMLSelectElement).value).toBe('undef:99');
    expect(screen.getByRole('option', { name: '未定義 (99)' })).toBeTruthy();
  });

  it('Articulation の選択（ダイアログ）で ID が設定される。「（なし）」で外せる', async () => {
    const store = setup();
    selectGmKit();
    fireEvent.click(screen.getByLabelText('Pitch 36 の Articulation'));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByText('Closed'));
    await waitFor(() => expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[1]!.ArticulationID).toBe(3));
    fireEvent.click(screen.getByLabelText('Pitch 36 の Articulation'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('（なし）'));
    await waitFor(() => expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[1]!.ArticulationID).toBe(0));
  });

  it('Pitch 行の選択クリアは確認後に実行される（キャンセルでは何も変わらない）', async () => {
    const store = setup();
    selectGmKit();
    const table = screen.getByRole('table', { name: 'Pitch 表' });
    fireEvent.click(within(table).getByText('36'));
    fireEvent.click(screen.getByRole('button', { name: '選択行をクリア' }));
    let dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(name(store)[1]).toBe('Kick');
    fireEvent.click(screen.getByRole('button', { name: '選択行をクリア' }));
    dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(name(store)[1]).toBeNull());
    expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches).toHaveLength(4); // 行は削除されない
  });
});

describe('Plugins & Kits タブ: 削除・並べ替え', () => {
  it('Plugin の削除は確認付き。キャンセルで不変、続行で削除され選択が解除される', async () => {
    const store = setup();
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('Plugin2'));
    fireEvent.click(screen.getByRole('button', { name: 'Plugin を削除' }));
    let dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Plugin を削除しますか？: Plugin2/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.getSnapshot().map.Plugins).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Plugin を削除' }));
    dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(store.getSnapshot().map.Plugins).toHaveLength(1));
    expect(store.getSnapshot().selection.pluginIndex).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(store.getSnapshot().map.Plugins).toHaveLength(2);
  });

  it('複数選択（Ctrl+クリック）した Kit をまとめて削除できる', async () => {
    const store = setup();
    act(() => { store.edit('+K', (m) => addKit(m, 0)); });
    act(() => { store.edit('+K', (m) => addKit(m, 0)); });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    const kits = screen.getByRole('listbox', { name: 'GM の Kit' });
    fireEvent.click(within(kits).getByText('GM Kit2'));
    fireEvent.click(within(kits).getByText('GM Kit3'), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Kit を削除' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(store.getSnapshot().map.Plugins[0]!.Kits.map((k) => k.Name)).toEqual(['GM Kit']));
  });

  it('ボタンでの並べ替え（キーボード代替）: 先頭・上へ・下へ・末尾。選択は移動先に追従する', () => {
    const store = setup();
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    const list = () => screen.getByRole('listbox', { name: 'Plugin' });
    fireEvent.click(within(list()).getByText('Plugin3'));
    const group = screen.getAllByRole('group', { name: 'Plugin の並べ替え' })[0]!;
    fireEvent.click(within(group).getByRole('button', { name: '先頭' }));
    expect(store.getSnapshot().map.Plugins.map((p) => p.Name)).toEqual(['Plugin3', 'GM', 'Plugin2']);
    expect(store.getSnapshot().selection).toMatchObject({ pluginIndex: 0, pluginIndices: [0] });
    fireEvent.click(within(group).getByRole('button', { name: '下へ' }));
    expect(store.getSnapshot().map.Plugins.map((p) => p.Name)).toEqual(['GM', 'Plugin3', 'Plugin2']);
    fireEvent.click(within(group).getByRole('button', { name: '末尾' }));
    expect(store.getSnapshot().map.Plugins.map((p) => p.Name)).toEqual(['GM', 'Plugin2', 'Plugin3']);
    fireEvent.click(within(group).getByRole('button', { name: '上へ' }));
    expect(store.getSnapshot().map.Plugins.map((p) => p.Name)).toEqual(['GM', 'Plugin3', 'Plugin2']);
    // 1操作ごとに1履歴（+P ×2 のあと 4 回）
    expect(store.getSnapshot().historyLength).toBe(6);
  });

  it('端での移動は何も起きない（履歴に積まない）', () => {
    const store = setup();
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    const n = store.getSnapshot().historyLength;
    fireEvent.click(within(screen.getAllByRole('group', { name: 'Plugin の並べ替え' })[0]!).getByRole('button', { name: '上へ' }));
    expect(store.getSnapshot().historyLength).toBe(n);
  });

  it('D&D: 選択した Plugin をドロップ先の直前へ移す', () => {
    const store = setup();
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    const list = screen.getByRole('listbox', { name: 'Plugin' });
    fireEvent.click(within(list).getByText('GM'));
    const rows = within(list).getAllByRole('option');
    fireEvent.dragStart(rows[0]!, { dataTransfer: { setData: () => undefined, effectAllowed: '' } });
    fireEvent.drop(rows[2]!);
    expect(store.getSnapshot().map.Plugins.map((p) => p.Name)).toEqual(['Plugin2', 'GM', 'Plugin3']);
    expect(store.getSnapshot().selection.pluginIndex).toBe(1);
  });

  it('Pitch 行の並べ替えボタン。絞り込み中は並べ替え不可で、解除すると可能になる', () => {
    const store = setup();
    selectGmKit();
    const table = screen.getByRole('table', { name: 'Pitch 表' });
    fireEvent.click(within(table).getByText('42'));
    const group = screen.getByRole('group', { name: 'Pitch 行の並べ替え' });
    fireEvent.change(screen.getByLabelText('Name で絞り込み'), { target: { value: 'hh' } });
    expect(screen.getByRole('status').textContent).toContain('1 / 4 行');
    expect((within(group).getByRole('button', { name: '先頭' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name で絞り込み'), { target: { value: '' } });
    fireEvent.click(within(group).getByRole('button', { name: '先頭' }));
    expect(name(store)).toEqual(['Closed HH', '', 'Kick', 'Snare']);
  });
});

describe('Plugins & Kits タブ: 絞り込み（部分一致 AND）', () => {
  it('Name と Articulation の両方に一致する行だけを表示する', () => {
    setup();
    selectGmKit();
    const table = () => screen.getByRole('table', { name: 'Pitch 表' });
    fireEvent.change(screen.getByLabelText('Name で絞り込み'), { target: { value: 'S' } }); // Snare / Closed HH? "S" を含む: Snare のみ（Closed HH にも s? 'Closed' に s あり）
    expect(within(table()).getAllByRole('row').length - 2).toBe(2); // Snare, Closed HH（部分一致・大文字小文字無視）
    fireEvent.change(screen.getByLabelText('Articulation で絞り込み'), { target: { value: 'snare' } });
    expect(within(table()).getAllByRole('row').length - 2).toBe(1);
    expect(within(table()).getByDisplayValue('Snare')).toBeTruthy();
  });
});

describe('ファイル操作との連携（保存はダウンロード開始まで）', () => {
  it('保存: ダウンロード開始を通知し、Dirtyを解消する。履歴は保たれ、保存後の Undo で Dirty になる', async () => {
    const saved: string[] = [];
    const store = setup({ io: { openText: async () => null, saveText: (n) => { saved.push(n); } } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    commit(screen.getByLabelText('Plugin 名'), 'GM2x');
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (a) *');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saved).toEqual(['a.qbd']));
    expect(await screen.findByText(NOTICE_DOWNLOAD_STARTED)).toBeTruthy();
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (a)');
    expect(store.getSnapshot().canUndo).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (a) *');
  });

  it('ダウンロードの開始に失敗（例外）したら Dirty を解除せず、エラーを表示する', async () => {
    const store = setup({ io: { openText: async () => null, saveText: () => { throw new Error('blocked'); } } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    commit(screen.getByLabelText('Plugin 名'), 'X');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/ダウンロードを開始できませんでした/)).toBeTruthy();
    expect(within(dlg).getByText(/blocked/)).toBeTruthy();
    expect(store.getSnapshot().dirty).toBe(true);
    expect(screen.queryByText(NOTICE_DOWNLOAD_STARTED)).toBeNull();
  });

  it('名前の入力エラーがあると保存を中止する（Windows版 HasError と同じ）。ダウンロードもDirty解除もしない', async () => {
    const saveText = vi.fn();
    const store = setup({ io: { openText: async () => null, saveText } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    commit(screen.getByLabelText('Plugin 名'), '');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/名前の入力エラーがあるため保存できません/)).toBeTruthy();
    expect(saveText).not.toHaveBeenCalled();
    expect(store.getSnapshot().dirty).toBe(true);
  });

  it('読込失敗は選択・モデル・履歴を保持する', async () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={{ openText: async () => ({ name: 'bad.qbd', text: '{ broken' }), saveText: () => undefined }} />);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    commit(screen.getByLabelText('Plugin 名'), 'Keep');
    const before = store.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    // 未保存のため確認 → 続行
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '続行' }));
    await screen.findByText(/QBDファイルを読み込めませんでした/);
    expect(store.getSnapshot()).toBe(before);
  });
});

describe('操作層（pluginsKitsActions）の単体', () => {
  function actionsFor(confirmAnswer = true) {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    const errors: QbdError[] = [];
    const confirm = vi.fn(async () => confirmAnswer);
    const ui: EditorUi = { confirm, onError: (e) => errors.push(e) };
    return { store, errors, confirm, a: createPluginsKitsActions(store, ui) };
  }

  it('範囲選択（Shift）・トグル（Ctrl）・単一選択で選択集合が決まり、別Pluginへの切替で Kit / Pitch 選択が解除される', () => {
    const { store, a } = actionsFor();
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    act(() => { store.edit('+P', (m) => addPlugin(m)); });
    a.selectPlugin(0);
    a.selectKit(0);
    a.selectPitch(1);
    a.selectPitch(3, 'range', [0, 1, 2, 3]);
    expect(store.getSnapshot().selection.pitchIndices).toEqual([1, 2, 3]);
    a.selectPitch(2, 'toggle');
    expect(store.getSnapshot().selection.pitchIndices).toEqual([1, 3]);
    a.selectPlugin(2, 'range');
    expect(store.getSnapshot().selection).toMatchObject({ pluginIndex: 2, pluginIndices: [0, 1, 2], kitIndex: null, pitchIndices: [] });
    a.selectPlugin(0);
    a.selectPlugin(0, 'toggle');
    expect(store.getSnapshot().selection.pluginIndices).toEqual([]);
  });

  it('同名の行が複数あると Articulation 設定時に確認し、はいで全同名行、いいえで当該行のみ', async () => {
    const { store, confirm, a } = actionsFor();
    a.selectPlugin(0);
    a.selectKit(0);
    act(() => { store.edit('Kit追加', (m) => addKit(m, 0)); });
    a.selectKit(1);
    a.updatePitch(10, { Name: 'Tom' });
    a.updatePitch(11, { Name: 'Tom' });
    await a.setArticulation(10, 1);
    expect(confirm).toHaveBeenCalledTimes(1);
    const ids = () => store.getSnapshot().map.Plugins[0]!.Kits[1]!.Pitches.map((p) => p.ArticulationID);
    expect([ids()[10], ids()[11]]).toEqual([1, 1]);
    const n = actionsFor(false);
    n.a.selectPlugin(0);
    n.store.edit('Kit追加', (m) => addKit(m, 0));
    n.a.selectKit(1);
    n.a.updatePitch(10, { Name: 'Tom' });
    n.a.updatePitch(11, { Name: 'Tom' });
    await n.a.setArticulation(10, 1);
    expect([n.store.getSnapshot().map.Plugins[0]!.Kits[1]!.Pitches[10]!.ArticulationID, n.store.getSnapshot().map.Plugins[0]!.Kits[1]!.Pitches[11]!.ArticulationID]).toEqual([1, 0]);
  });

  it('Coreがエラーを返したら通知し、状態は変わらない。選択なしの操作は何もしない', async () => {
    const { store, errors, a } = actionsFor();
    a.selectPlugin(0);
    a.selectKit(0);
    const before = store.getSnapshot();
    expect(a.updatePitch(0, { ArticulationID: 1 })).toBe(false); // 空Name行
    expect(errors.map((e) => e.code)).toEqual(['empty-name-row']);
    expect(a.updatePitch(1, { ArticulationID: 99 })).toBe(false);
    expect(errors[1]!.code).toBe('articulation-not-found');
    expect(store.getSnapshot().historyLength).toBe(before.historyLength);
    store.select({ kitIndex: null, kitIndices: [] });
    expect(a.updateKit({ Name: 'x' })).toBe(false);
    expect(await a.deleteKits()).toBe(false);
    expect(a.addKit()).toBe(true); // Plugin は選択済み
  });

  it('削除確認でキャンセルすると何も変わらず、Core の関数も呼ばれない', async () => {
    const { store, a, confirm } = actionsFor(false);
    a.selectPlugin(0);
    const before = store.getSnapshot();
    expect(await a.deletePlugins()).toBe(false);
    expect(confirm).toHaveBeenCalled();
    expect(store.getSnapshot().map).toBe(before.map);
  });
});

describe('ファイル操作の層（fileActions）', () => {
  it('保存: 検証エラー・準備失敗・ダウンロード失敗では commit されず、成功時のみ commit と通知', async () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    act(() => { store.edit('x', (m) => updateKit(m, { pluginIndex: 0, kitIndex: 0 }, { Name: 'K2' })); });
    const errs: QbdError[] = [];
    const notices: string[] = [];
    let fail = true;
    const io: FileIo = { openText: async () => null, saveText: () => { if (fail) throw new Error('nope'); } };
    const fa = createFileActions({ store, io, confirm: async () => true, onError: (e) => errs.push(e), onNotice: (m) => notices.push(m) });
    await fa.saveFile();
    expect(errs.map((e) => e.code)).toEqual(['download-failed']);
    expect(store.getSnapshot().dirty).toBe(true);
    fail = false;
    await fa.saveFile();
    expect(notices).toEqual([NOTICE_DOWNLOAD_STARTED]);
    expect(store.getSnapshot().dirty).toBe(false);
  });

  it('saveFile 後も履歴で Undo でき、キャンセル相当（確認で いいえ）の新規は何も変えない', async () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    act(() => { store.edit('x', (m) => updateKit(m, { pluginIndex: 0, kitIndex: 0 }, { Name: 'K2' })); });
    const fa = createFileActions({ store, io: { openText: async () => null, saveText: () => undefined }, confirm: async () => false, onError: () => undefined });
    await fa.newFile();
    expect(store.getSnapshot().map.Plugins).toHaveLength(1);
    expect(store.getSnapshot().historyLength).toBe(1);
  });
});

describe('キーボード', () => {
  it('Plugin 行は Enter で選択できる', () => {
    const store = setup();
    const row = within(screen.getByRole('listbox', { name: 'Plugin' })).getAllByRole('option')[0]!;
    act(() => { fireEvent.keyDown(row, { key: 'Enter' }); });
    expect(store.getSnapshot().selection.pluginIndex).toBe(0);
  });
});

describe('Pitch 表: 絞り込み行は列見出しと同じ表・同じ列に置く（UI 整理）', () => {
  const open = () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={nullIo} />);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('GM Kit'));
    return store;
  };

  it('Name／Articulation の絞り込み欄は、見出し行の直下の Name／Articulation 列のセルにあり、ほかの列は空', () => {
    open();
    const table = screen.getByRole('table', { name: 'Pitch 表' });
    const rows = within(table).getAllByRole('row');
    const head = within(rows[0]!).getAllByRole('columnheader').map((c) => c.textContent);
    expect(head).toEqual(['Pitch', 'Note', 'Name', 'Articulation', 'Separator']);
    const cells = [...rows[1]!.children];
    expect(cells).toHaveLength(5);
    expect(cells.map((c) => c.querySelector('input')?.getAttribute('aria-label') ?? '')).toEqual(['', '', 'Name で絞り込み', 'Articulation で絞り込み', '']);
    // 見出し・絞り込み・データ行は同じ <colgroup>（5列）を共有する
    expect(table.querySelectorAll('colgroup > col')).toHaveLength(5);
    expect(rows[2]!.children).toHaveLength(5);
  });

  it('×で欄を空に戻せる。絞り込みの入力・解除は Dirty と履歴を変えない。見出しは Plugins／Kits／Pitches で、親の名前は tooltip', () => {
    const store = open();
    expect(screen.queryByRole('button', { name: 'Name で絞り込みを解除' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Name で絞り込み'), { target: { value: 'sn' } });
    expect(store.getSnapshot().dirty).toBe(false);
    expect(store.getSnapshot().historyLength).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Name で絞り込みを解除' }));
    expect((screen.getByLabelText('Name で絞り込み') as HTMLInputElement).value).toBe('');
    expect(store.getSnapshot().dirty).toBe(false);
    expect(screen.getByText('Plugins（1）')).toBeTruthy();
    expect(screen.getByText('Kits（1）').getAttribute('title')).toBe('GM の Kit（1）');
    expect(screen.getByText('Pitches（4）').getAttribute('title')).toBe('GM Kit の Pitch（4）');
  });
});

describe('Pitch 上部の操作（案B）', () => {
  it('自動割当・コピー・Import は常時表示、整列はメニュー（Esc で閉じられる）。メニューを開く・閉じるだけでは履歴は変わらない', () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={nullIo} />);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('GM Kit'));
    const tools = screen.getByRole('group', { name: '編集補助' });
    expect(within(tools).getByRole('button', { name: 'Articulation を自動割当' })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: 'Articulation をコピー…' })).toBeTruthy();
    expect(within(tools).queryByRole('button', { name: 'Pitch 順に並べ替え' })).toBeNull();
    const align = within(tools).getByRole('button', { name: '整列' });
    expect(align.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(align);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Pitch 順に並べ替え', '空の行を後ろへ詰める']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(store.getSnapshot().historyLength).toBe(0);
    expect(store.getSnapshot().dirty).toBe(false);
  });
});
