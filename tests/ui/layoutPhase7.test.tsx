// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo } from '../../src/ui/services/fileIo';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

const nullIo: FileIo = { openText: async () => null, saveText: () => undefined };
const LONG = 'とても長い日本語のKit名・SC-8820 - STANDARD 1 を拡張した非常に長い名前（識別性の確認用）';

// UI Phase 7: 一覧の高さ・左ペイン幅の可変化（表示のみ。選択・Undo・Dirty は変えない）
describe('UI Phase 7: Plugins & Kits の表示調整', () => {
  it('一覧の項目に name を tooltip（title）として付ける。長い名前も全文が取れる', () => {
    const store = new EditorStore();
    const longMap = JSON.parse(gmSmall) as { Plugins: { Kits: { Name: string }[] }[] };
    longMap.Plugins[0]!.Kits[0]!.Name = LONG;
    store.load(JSON.stringify(longMap), 'a.qbd');
    render(<AppShell store={store} io={nullIo} />);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    const kitList = screen.getByRole('listbox', { name: 'GM の Kit' });
    const opt = within(kitList).getAllByRole('option')[0]!;
    expect(opt.getAttribute('title')).toBe(LONG);
    expect(opt.textContent).toContain(LONG);
  });

  it('Plugin / Kit の選択は従来どおり（一覧の高さ指定を変えても選択・Dirty・Undo は不変）', () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={nullIo} />);
    expect(store.getSnapshot().dirty).toBe(false);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getAllByRole('option')[0]!);
    const s = store.getSnapshot().selection;
    expect(s.pluginIndex).toBe(0);
    expect(s.kitIndex).toBe(0);
    expect(store.getSnapshot().dirty).toBe(false);
    expect(screen.getByRole('table', { name: 'Pitch 表' })).toBeTruthy();
  });
});

// UI Phase 7（案 B）: 一覧の操作ボタンのアイコン化と Plugin 属性欄の折りたたみ
describe('UI Phase 7: Plugin／Kit の2列配置', () => {
  const setup = () => {
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    render(<AppShell store={store} io={nullIo} />);
    return store;
  };

  it('操作ボタンはアイコンでも従来のボタン名（aria-label）と tooltip（title）を保つ', () => {
    setup();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    const group = screen.getByRole('group', { name: 'Plugin の並べ替え' });
    for (const n of ['先頭', '上へ', '下へ', '末尾']) {
      const b = within(group).getByRole('button', { name: n });
      expect(b.getAttribute('title')).toBe(n);
    }
    expect(within(group).getByRole('button', { name: 'Plugin を追加' }).getAttribute('title')).toBe('Plugin を追加');
    expect(within(group).getByRole('button', { name: 'Plugin を削除' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Kit の並べ替え' })).toBeTruthy();
  });

  it('Parts の一覧もアイコンボタンで、ボタン名（aria-label）と tooltip（title）は Plugin／Kit と同じ', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Parts' }));
    const group = screen.getByRole('group', { name: 'Part の並べ替え' });
    for (const n of ['Part を追加', 'Part を削除', '先頭', '上へ', '下へ', '末尾']) {
      const b = within(group).getByRole('button', { name: n });
      expect(b.getAttribute('title')).toBe(n);
      expect(b.textContent).toBe(''); // アイコンのみ
    }
  });

  it('Plugin 属性欄は既定で折りたたみ。開閉しても選択・Dirty・履歴は変わらず、展開中も名前を編集できる', () => {
    const store = setup();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    const toggle = screen.getByRole('button', { name: /Plugin 属性/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Plugin 名' })).toBeNull(); // 折りたたみ中は操作対象に出ない
    const before = store.getSnapshot();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const snap = store.getSnapshot();
    expect(snap.selection).toEqual(before.selection);
    expect(snap.dirty).toBe(false);
    expect(snap.canUndo).toBe(false);
    // 展開中は Kit の選択と Plugin 名の編集ができる
    fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getAllByRole('option')[0]!);
    expect(store.getSnapshot().selection.kitIndex).toBe(0);
    const input = screen.getByRole('textbox', { name: 'Plugin 名' });
    fireEvent.change(input, { target: { value: 'GM-X' } });
    fireEvent.blur(input);
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('GM-X');
    expect(store.getSnapshot().dirty).toBe(true);
    store.undo();
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('GM');
    // 閉じても選択は維持される
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(store.getSnapshot().selection.kitIndex).toBe(0);
  });
});
