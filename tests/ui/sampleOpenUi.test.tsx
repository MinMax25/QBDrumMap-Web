// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const SAMPLE_TEXT = readFileSync(resolve(__dirname, '../../public/samples/DrumMap.qbd'), 'utf8');
const SAMPLE_TITLE = 'QBDrumMap Web (DrumMap（サンプル）)';
const rename = (name: string) => (m: MapData) => {
  const c = cloneMap(m);
  c.Plugins[0]!.Name = name;
  return { ok: true as const, value: c };
};

function fakeIo() {
  const saved: { name: string; text: string }[] = [];
  const io: FileIo = { openText: vi.fn(async () => null), saveText: (name, text) => { saved.push({ name, text }); } };
  return { io, saved };
}
const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const f = vi.fn(impl);
  vi.stubGlobal('fetch', f);
  return f;
};
const okSample = () => stubFetch(async () => new Response(SAMPLE_TEXT));
const mount = (store = new EditorStore(), io = fakeIo().io, session: SessionManager | null = null) =>
  render(<AppShell store={store} io={io} settings={new SettingsStore(null)} session={session} />);
const clickSample = () => fireEvent.click(screen.getByRole('button', { name: 'サンプルを開く' }));

describe('「サンプルを開く」', () => {
  it('ヘッダーに「新規」「開く」「サンプルを開く」「保存」があり、実データ（139 Kit）を Dirty なしで読み込む', async () => {
    const f = okSample();
    const store = new EditorStore();
    mount(store);
    const bar = screen.getByRole('banner');
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['新規', '開く', 'サンプルを開く', '保存', '元に戻す', 'やり直し']);
    clickSample();
    await waitFor(() => expect(screen.getByTestId('app-title').textContent).toBe(SAMPLE_TITLE));
    const st = store.getSnapshot();
    expect(st.map.Plugins.reduce((n, p) => n + p.Kits.length, 0)).toBe(139);
    expect(st.dirty).toBe(false);
    expect(st.fileName).toBe('DrumMap.qbd'); // 表示の「サンプル」と内部のファイル名は別
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toMatch(/samples\/DrumMap\.qbd$/);
  });

  it('Dirty あり→キャンセル: 取得せず、編集中のデータを保持する', async () => {
    const f = okSample();
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    store.apply('改名', rename('Mine'));
    mount(store);
    clickSample();
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain('未保存の変更があります');
    fireEvent.click(within(dlg).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(f).not.toHaveBeenCalled();
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('Mine');
    expect(store.getSnapshot().dirty).toBe(true);
  });

  it('Dirty あり→承認: サンプルに切り替わる', async () => {
    okSample();
    const store = new EditorStore();
    store.load(gmSmall, 'a.qbd');
    store.apply('改名', rename('Mine'));
    mount(store);
    clickSample();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(screen.getByTestId('app-title').textContent).toBe(SAMPLE_TITLE));
    expect(store.getSnapshot().dirty).toBe(false);
  });

  it('取得失敗・解析失敗でも、編集中のデータと自動保存データを保持する', async () => {
    const st = new MemorySessionStorage();
    const store = new EditorStore();
    const session = new SessionManager(store, st, { debounceMs: 1, locks: new FakeLocks() });
    mount(store, fakeIo().io, session);
    await waitFor(() => expect(session.getSnapshot().ready).toBe(true));
    store.load(gmSmall, 'a.qbd');
    store.apply('改名', rename('Mine'));
    await waitFor(() => expect(st.value).not.toBeNull());
    const saved = st.value;

    stubFetch(async () => new Response('x', { status: 404, statusText: 'Not Found' }));
    clickSample();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(screen.getAllByRole('dialog').some((d) => d.textContent?.includes('サンプルを取得できませんでした'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('Mine');
    expect(store.getSnapshot().sample).toBe(false);

    stubFetch(async () => new Response('{ broken json'));
    clickSample();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(screen.getAllByRole('dialog').some((d) => d.textContent?.includes('エラー'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(store.getSnapshot().map.Plugins[0]!.Name).toBe('Mine');
    await new Promise((r) => setTimeout(r, 20));
    expect(st.value).toBe(saved); // 自動保存データは変わらない
  });

  it('取得中は操作できず、連打しても取得は1回', async () => {
    let release!: (r: Response) => void;
    const f = stubFetch(() => new Promise<Response>((res) => { release = res; }));
    mount();
    clickSample();
    await waitFor(() => expect((screen.getByRole('button', { name: 'サンプルを開く' }) as HTMLButtonElement).disabled).toBe(true));
    clickSample();
    expect(f).toHaveBeenCalledTimes(1);
    release(new Response(SAMPLE_TEXT));
    await waitFor(() => expect(screen.getByTestId('app-title').textContent).toBe(SAMPLE_TITLE));
  });

  it('編集→Dirty→Undo→保存（ダウンロードのみ。サーバーへは書き戻さない）', async () => {
    const f = okSample();
    const { io, saved } = fakeIo();
    const store = new EditorStore();
    mount(store, io);
    clickSample();
    await waitFor(() => expect(store.getSnapshot().sample).toBe(true));
    store.apply('改名', rename('Edited'));
    expect(store.getSnapshot().dirty).toBe(true);
    store.undo();
    expect(store.getSnapshot().dirty).toBe(false);
    store.redo();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('DrumMap.qbd');
    expect(saved[0]!.text).toContain('Edited');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');
  });

  it('編集したサンプルをリロード相当で復元しても、再取得で上書きしない（Dirty・サンプル表示も復元）', async () => {
    const st = new MemorySessionStorage();
    const locks = new FakeLocks();
    const a = new EditorStore();
    const sa = new SessionManager(a, st, { debounceMs: 1, locks });
    const f = okSample();
    mount(a, fakeIo().io, sa);
    await waitFor(() => expect(sa.getSnapshot().ready).toBe(true));
    clickSample();
    await waitFor(() => expect(a.getSnapshot().sample).toBe(true));
    a.apply('改名', rename('Edited'));
    await waitFor(() => expect(st.value?.map.Plugins[0]!.Name).toBe('Edited'));
    expect(st.value!.sample).toBe(true);
    cleanup();
    sa.dispose();
    await new Promise((r) => setTimeout(r, 10)); // 所有権の解放が反映されるのを待つ（実際は別ページの読込み）
    const callsBefore = f.mock.calls.length;

    const b = new EditorStore();
    const sb = new SessionManager(b, st, { debounceMs: 1, locks });
    mount(b, fakeIo().io, sb);
    expect(await screen.findByText('前回の作業状態を復元しました')).toBeTruthy();
    expect(screen.getByTestId('app-title').textContent).toBe(`${SAMPLE_TITLE} *`);
    expect(b.getSnapshot().map.Plugins[0]!.Name).toBe('Edited');
    expect(f.mock.calls.length).toBe(callsBefore); // 起動時にサンプルを取得しない
  });

  it('通常の「開く」で別ファイルを開くとサンプル表示は外れる', async () => {
    okSample();
    const io: FileIo = { openText: vi.fn(async () => ({ name: 'my.qbd', text: gmSmall })), saveText: vi.fn() };
    const store = new EditorStore();
    mount(store, io);
    clickSample();
    await waitFor(() => expect(store.getSnapshot().sample).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    await waitFor(() => expect(screen.getByTestId('app-title').textContent).toBe('QBDrumMap Web (my)'));
  });
});
