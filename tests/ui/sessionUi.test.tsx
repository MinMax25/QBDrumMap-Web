// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cloneMap, type MapData } from '../../src/core';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import { SessionManager } from '../../src/ui/state/sessionManager';
import { SettingsStore } from '../../src/ui/settings/settingsStore';
import type { FileIo } from '../../src/ui/services/fileIo';
import { FakeLocks, MemorySessionStorage } from '../sessionFakes';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

const rename = (name: string) => (m: MapData) => {
  const c = cloneMap(m);
  c.Plugins[0]!.Name = name;
  return { ok: true as const, value: c };
};
const io: FileIo = { openText: vi.fn(async () => null), saveText: vi.fn() };

/** 保存データのある状態を作る（別タブ相当） */
async function seededStorage(): Promise<MemorySessionStorage> {
  const st = new MemorySessionStorage();
  const store = new EditorStore();
  const mgr = new SessionManager(store, st, { debounceMs: 1, locks: new FakeLocks() });
  await mgr.start();
  store.load(gmSmall, 'a.qbd');
  store.apply('改名', rename('Restored'));
  mgr.setUi({ pageId: 'export', tabId: 'pluginsKits' });
  await waitFor(() => expect(st.value).not.toBeNull());
  await waitFor(() => expect(st.value!.ui.pageId).toBe('export'));
  mgr.dispose();
  return st;
}

function mount(st: MemorySessionStorage) {
  const store = new EditorStore();
  const session = new SessionManager(store, st, { debounceMs: 1, locks: new FakeLocks() });
  render(<AppShell store={store} io={io} settings={new SettingsStore(null)} session={session} />);
  return { store, session };
}

describe('作業状態の自動復元（AppShell）', () => {
  it('保存データを復元し、画面を戻して軽く通知する（確認ダイアログは出さない）', async () => {
    const st = await seededStorage();
    const { store } = mount(st);
    expect(await screen.findByText('前回の作業状態を復元しました')).toBeTruthy();
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('Restored');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Export');
    expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (a) *');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('保存データがない初回起動は従来どおり（通知・警告なし）', async () => {
    mount(new MemorySessionStorage());
    await waitFor(() => expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web'));
    expect(screen.queryByText('前回の作業状態を復元しました')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Map Editor');
  });

  it('壊れた保存データは警告し、書き出しと破棄を選べる。無警告では消さない', async () => {
    const st = new MemorySessionStorage();
    st.value = { broken: true } as never;
    st.forcedRead = { kind: 'invalid', reason: '形式が不正', raw: { broken: true } };
    mount(st);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('前回の作業状態を復元できませんでした');
    expect(st.value).toEqual({ broken: true });
    fireEvent.click(within(alert).getByRole('button', { name: '保存データを書き出す' }));
    expect(io.saveText).toHaveBeenCalledWith('QBDrumMap_session_backup.json', JSON.stringify({ broken: true }), 'application/json');
    st.forcedRead = null;
    fireEvent.click(within(alert).getByRole('button', { name: '保存データを破棄して続ける' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(st.value).toBeNull());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('Settings の「前回の作業状態を破棄」: Dirty なら確認し、キャンセルでは何も変えない。続行で保存データを削除して新規にする', async () => {
    const st = await seededStorage();
    const { store } = mount(st);
    await screen.findByText('前回の作業状態を復元しました');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'ページ' })).getByText('Settings'));
    fireEvent.click(screen.getByRole('button', { name: '前回の作業状態を破棄' }));
    let dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain('未保存の変更があります');
    fireEvent.click(within(dlg).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(st.value).not.toBeNull();
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('Restored');

    fireEvent.click(screen.getByRole('button', { name: '前回の作業状態を破棄' }));
    dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(st.value).toBeNull());
    expect(store.getSnapshot().map.Plugins).toHaveLength(0);
    expect(store.getSnapshot().dirty).toBe(false);
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Map Editor' })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(st.value).toBeNull(); // 破棄後に復活しない
  });

  it('他のタブが保存中のときは案内を出し、引き継ぎには確認が入る', async () => {
    const st = new MemorySessionStorage();
    const locks = new FakeLocks();
    const ownerStore = new EditorStore();
    await new SessionManager(ownerStore, st, { debounceMs: 1, locks }).start();
    const store = new EditorStore();
    const session = new SessionManager(store, st, { debounceMs: 1, locks });
    render(<AppShell store={store} io={io} settings={new SettingsStore(null)} session={session} />);
    expect(await screen.findByText(/別のタブが作業状態を自動保存しています/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'このタブで引き継ぐ' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(screen.queryByText(/別のタブが作業状態を自動保存しています/)).toBeNull());
  });

  it('自動保存の失敗は QBD 保存を促すエラーとして表示する', async () => {
    const st = new MemorySessionStorage();
    const { store } = mount(st);
    await waitFor(() => expect(screen.getByTestId('app-title')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 10));
    st.failWrites = new Error('QuotaExceededError');
    store.load(gmSmall, 'a.qbd');
    store.apply('改名', rename('X'));
    expect((await screen.findByRole('alert')).textContent).toContain('作業状態の自動保存ができません。QBD ファイルとして保存してください。');
  });
});
