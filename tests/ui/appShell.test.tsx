// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cloneMap } from '../../src/core';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo, OpenedFile } from '../../src/ui/services/fileIo';
import { brokenJson, gmSmall } from '../fixtures';

afterEach(cleanup);

function fakeIo(file: OpenedFile | null) {
  const saved: { name: string; text: string }[] = [];
  const io: FileIo = {
    openText: vi.fn(async () => file),
    saveText: (name, text) => { saved.push({ name, text }); },
  };
  return { io, saved };
}

const edit = (store: EditorStore) =>
  store.apply('改名', (m) => {
    const c = cloneMap(m);
    c.Plugins[0]!.Name = 'X';
    return { ok: true as const, value: c };
  });

describe('AppShell', () => {
  it('起動時: タイトル・4つの上位画面・Map Editorの3タブ・空の要約を表示する', () => {
    const { io } = fakeIo(null);
    render(<AppShell store={new EditorStore()} io={io} />);
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web');
    const nav = screen.getByRole('navigation', { name: 'ページ' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Map Editor', 'Export', 'Convert MIDI', 'Settings',
    ]);
    expect(screen.getByText(/Plugin がありません/)).toBeTruthy(); // Plugins & Kits タブは実データに接続されている
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Plugins & Kits', 'Parts', 'DrumMap Order']);
  });

  it('ナビゲーションでページ見出しが切り替わり、Map Editor以外にはタブが出ない。タブ切替で実装予定フェーズが変わる', () => {
    const { io } = fakeIo(null);
    render(<AppShell store={new EditorStore()} io={io} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Parts' }));
    expect(screen.getByText(/Part がありません/)).toBeTruthy(); // UI Phase 3 で Parts タブは実データに接続された（以前は「実装予定」の表示）
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Export');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('開く: 読込成功でファイル名と件数が反映される', async () => {
    const { io } = fakeIo({ name: 'a.qbd', text: gmSmall });
    render(<AppShell store={new EditorStore()} io={io} />);
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    await waitFor(() => expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (a)'));
    expect(screen.getByRole('listbox', { name: 'Plugin' }).textContent).toContain('GM');
  });

  it('開く: 壊れたファイルはエラーダイアログを出し、既存の状態を保つ', async () => {
    const store = new EditorStore();
    store.load(gmSmall, 'keep.qbd');
    const { io } = fakeIo({ name: 'bad.qbd', text: brokenJson });
    render(<AppShell store={store} io={io} />);
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/QBDファイルを読み込めませんでした/)).toBeTruthy();
    expect(store.getSnapshot().fileName).toBe('keep.qbd');
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (keep)');
  });

  it('Dirty: タイトルに印が付き、新規は確認を挟む。キャンセルで何も変わらず、続行で空になる', async () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    const { io } = fakeIo(null);
    render(<AppShell store={store} io={io} />);
    act(() => { edit(store); });
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (a) *');

    fireEvent.click(screen.getByRole('button', { name: '新規' }));
    let dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('未保存の変更があります。破棄して続行しますか？')).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.getSnapshot().map.Plugins).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '新規' }));
    dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(store.getSnapshot().map.Plugins).toHaveLength(0));
  });

  it('Dirtyでなければ新規・開くは確認なしで実行される', async () => {
    const { io } = fakeIo({ name: 'b.qbd', text: gmSmall });
    const store = new EditorStore();
    render(<AppShell store={store} io={io} />);
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    await waitFor(() => expect(store.getSnapshot().fileName).toBe('b.qbd'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('保存: ダウンロード用テキストを渡し、Dirtyが解消する', async () => {
    const { io, saved } = fakeIo(null);
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={io} />);
    act(() => { edit(store); });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('a.qbd');
    expect(JSON.parse(saved[0]!.text).Plugins[0].Name).toBe('X');
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (a)');
  });

  it('保存失敗(ID重複)はエラーを表示し、ダウンロードしない', async () => {
    const { io, saved } = fakeIo(null);
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    store.apply('ID重複', (m) => {
      const c = cloneMap(m);
      c.Parts[1]!.Articulations[0]!.ID = c.Parts[0]!.Articulations[0]!.ID;
      return { ok: true as const, value: c };
    });
    render(<AppShell store={store} io={io} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/ID が重複/)).toBeTruthy();
    expect(saved).toHaveLength(0);
  });

  it('元に戻す／やり直しボタンと Ctrl+Z / Ctrl+Y が有効・無効と動作で連動する', () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={fakeIo(null).io} />);
    const undo = screen.getByRole('button', { name: '元に戻す' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'やり直し' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    act(() => { edit(store); });
    expect(undo.disabled).toBe(false);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('GM');
    expect(redo.disabled).toBe(false);
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('X');
  });

  it('入力欄にフォーカスがあるときの Ctrl+Z はアプリのUndoを奪わない', () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={fakeIo(null).io} />);
    act(() => { edit(store); });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('X');
    input.remove();
  });

  it('Dirtyの間だけ beforeunload の確認を登録する', () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={fakeIo(null).io} />);
    const fire = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(fire()).toBe(false);
    act(() => { edit(store); });
    expect(fire()).toBe(true);
    act(() => { store.undo(); });
    expect(fire()).toBe(false);
  });
});
