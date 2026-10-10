import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneMap, type MapData } from '../src/core';
import { EditorStore } from '../src/ui/state/editorStore';
import { SessionManager } from '../src/ui/state/sessionManager';
import { parseSnapshot, SESSION_SCHEMA_VERSION } from '../src/ui/state/sessionPersistence';
import { FakeLocks, MemorySessionStorage } from './sessionFakes';
import { gmSmall } from './fixtures';

const DEBOUNCE = 100;
const rename = (name: string) => (m: MapData) => {
  const c = cloneMap(m);
  c.Plugins[0]!.Name = name;
  return { ok: true as const, value: c };
};
const settle = async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + 10); };

function tab(storage: MemorySessionStorage, locks: FakeLocks | null = new FakeLocks()) {
  const store = new EditorStore();
  const mgr = new SessionManager(store, storage, { debounceMs: DEBOUNCE, locks });
  return { store, mgr };
}

/** 保存データがある状態を作る（別タブ相当の store で書き込み、所有権を手放す） */
async function seeded(st: MemorySessionStorage, edit = true) {
  const a = tab(st);
  await a.mgr.start();
  a.store.load(gmSmall, 'a.qbd');
  if (edit) a.store.apply('改名', rename('X'));
  else a.mgr.notify();
  await settle();
  a.mgr.dispose();
  return a;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('SessionManager: 起動と復元', () => {
  it('保存データなし（初回起動）: 復元せず、編集するまで書込まない', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    const r = await mgr.start();
    expect(r.restored).toBe(false);
    expect(mgr.getSnapshot()).toMatchObject({ ready: true, ownership: 'owner', loadProblem: null });
    await settle();
    expect(st.writes.length + st.clears).toBe(0);
    store.load(gmSmall, 'a.qbd');
    store.apply('改名', rename('X'));
    await settle();
    expect(st.writes).toHaveLength(1);
  });

  it('起動の読取りが終わるまでは書込まない（空の初期状態で保存データを上書きしない）', async () => {
    const st = new MemorySessionStorage();
    await seeded(st);
    const before = st.value;
    const { store, mgr } = tab(st);
    store.createNew(); // start 前の操作
    await settle();
    expect(st.value).toBe(before);
    expect(mgr.getSnapshot().ready).toBe(false);
  });

  it('未保存（Dirty）の作業を復元し、Undo/Redoは復元されず、復元後の編集のUndoは動く', async () => {
    const st = new MemorySessionStorage();
    const a = tab(st);
    await a.mgr.start();
    a.store.load(gmSmall, 'a.qbd');
    a.store.apply('改名', rename('X'));
    a.store.select({ pluginIndex: 0, pluginIndices: [0] });
    a.mgr.setUi({ pageId: 'export', tabId: 'pluginsKits' });
    await settle();
    a.mgr.dispose();

    const b = tab(st);
    const r = await b.mgr.start();
    expect(r).toMatchObject({ restored: true, ui: { pageId: 'export' } });
    const s = b.store.getSnapshot();
    expect(s.map.Plugins[0]!.Name).toBe('X');
    expect(s.fileName).toBe('a.qbd');
    expect(s.dirty).toBe(true);
    expect(s.canUndo).toBe(false);
    expect(s.selection.pluginIndex).toBe(0);
    b.store.apply('改名2', rename('Y'));
    expect(b.store.undo()).toBe(true);
    expect(b.store.getSnapshot().map.Plugins[0]!.Name).toBe('X');
    expect(b.store.getSnapshot().dirty).toBe(true);
  });

  it('保存済み（Dirtyでない）作業は、復元後もDirtyにならない', async () => {
    const st = new MemorySessionStorage();
    await seeded(st, false);
    expect(st.value?.baselineMap).toBeNull();
    const b = tab(st);
    expect((await b.mgr.start()).restored).toBe(true);
    expect(b.store.getSnapshot().dirty).toBe(false);
  });

  it('保存（ダウンロード開始）後に編集した内容は、基準を保ったままDirtyで復元される', async () => {
    const st = new MemorySessionStorage();
    const a = tab(st);
    await a.mgr.start();
    a.store.load(gmSmall, 'a.qbd');
    a.store.apply('改名', rename('X'));
    const p = a.store.prepareSave('a.qbd');
    if (p.ok) a.store.commitSave(p.value);
    expect(a.store.getSnapshot().dirty).toBe(false);
    a.store.apply('改名2', rename('Z'));
    await settle();
    a.mgr.dispose();
    const b = tab(st);
    await b.mgr.start();
    expect(b.store.getSnapshot().dirty).toBe(true);
    b.store.apply('戻す', rename('X'));
    expect(b.store.getSnapshot().dirty).toBe(false); // 基準（保存時点）と一致
  });

  it('存在しない選択は解除される', async () => {
    const st = new MemorySessionStorage();
    await seeded(st, false);
    st.value = { ...st.value!, selection: { ...st.value!.selection, pluginIndex: 99, pluginIndices: [99], kitIndex: 5, kitIndices: [5] } };
    const b = tab(st);
    await b.mgr.start();
    expect(b.store.getSnapshot().selection).toMatchObject({ pluginIndex: null, pluginIndices: [], kitIndex: null });
  });

  it('復元の読取り中に編集された場合は復元せず、保存データも消さない', async () => {
    const st = new MemorySessionStorage();
    await seeded(st, false);
    const saved = st.value;
    const b = tab(st);
    const p = b.mgr.start();
    b.store.load(gmSmall, 'other.qbd'); // 読取りの完了前に利用者が読込
    const r = await p;
    expect(r.restored).toBe(false);
    expect(b.mgr.getSnapshot().loadProblem).not.toBeNull();
    b.store.apply('改名', rename('W'));
    await settle();
    expect(st.value).toBe(saved);
  });
});

describe('SessionManager: 壊れた・読めない保存データ', () => {
  it('壊れたデータは復元せず通知し、自動保存を止め、消さない。破棄で消える', async () => {
    const st = new MemorySessionStorage();
    st.value = { broken: true } as never;
    st.forcedRead = { kind: 'invalid', reason: '形式が不正', raw: { broken: true } };
    const { store, mgr } = tab(st);
    expect((await mgr.start()).restored).toBe(false);
    expect(mgr.getSnapshot().loadProblem).toMatchObject({ kind: 'invalid', reason: '形式が不正' });
    store.load(gmSmall, 'a.qbd');
    store.apply('改名', rename('X'));
    await settle();
    expect(st.writes).toHaveLength(0);
    expect(st.clears).toBe(0);
    expect(st.value).toEqual({ broken: true });
    st.forcedRead = null;
    await mgr.discard();
    expect(st.value).toBeNull();
    expect(mgr.getSnapshot().loadProblem).toBeNull();
    store.apply('改名', rename('Y'));
    await settle();
    expect(st.writes).toHaveLength(1); // 破棄後は自動保存が再開する
  });

  it('読めない（IndexedDB障害）場合は書込みを止め、再試行で復元できる', async () => {
    const st = new MemorySessionStorage();
    await seeded(st, false);
    st.forcedRead = { kind: 'unreadable', reason: 'denied' };
    const b = tab(st);
    await b.mgr.start();
    expect(b.mgr.getSnapshot().loadProblem?.kind).toBe('unreadable');
    b.store.createNew();
    await settle();
    expect(st.clears).toBe(0);
    st.forcedRead = null;
    const r = await b.mgr.start();
    expect(r.restored).toBe(true);
    expect(b.mgr.getSnapshot().loadProblem).toBeNull();
  });

  it('parseSnapshot: 未知のバージョン・不正な形は拒否する', () => {
    expect(parseSnapshot(null).ok).toBe(false);
    const bad = parseSnapshot({ schemaVersion: SESSION_SCHEMA_VERSION + 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('スキーマ');
    expect(parseSnapshot({ schemaVersion: SESSION_SCHEMA_VERSION, map: { Plugins: 1 } }).ok).toBe(false);
  });
});

describe('SessionManager: 書込みの順序・失敗・破棄', () => {
  it('debounce: 連続編集は1回の書込みにまとまる', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    await mgr.start();
    store.load(gmSmall, 'a.qbd');
    for (const n of ['a', 'b', 'c']) store.apply(n, rename(n));
    await settle();
    expect(st.writes).toHaveLength(1);
    expect(st.value!.map.Plugins[0]!.Name).toBe('c');
  });

  it('遅れて完了する古い書込みが新しい内容を上書きしない（単一キュー）', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    await mgr.start();
    store.load(gmSmall, 'a.qbd');
    const releases: (() => void)[] = [];
    st.gate = () => new Promise<void>((res) => { releases.push(res); });
    store.apply('1', rename('first'));
    await settle(); // 1回目の書込みが開始し、完了待ち
    store.apply('2', rename('second'));
    await settle(); // 2回目はキューで待つ
    expect(releases).toHaveLength(1);
    releases[0]!();
    await vi.advanceTimersByTimeAsync(5);
    releases[1]?.();
    await vi.advanceTimersByTimeAsync(5);
    expect(st.value!.map.Plugins[0]!.Name).toBe('second');
    expect(st.writes.map((w) => w.map.Plugins[0]!.Name)).toEqual(['first', 'second']);
  });

  it('保存失敗は通知され、以前の保存データは維持され、次の成功で解除される', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    await mgr.start();
    store.load(gmSmall, 'a.qbd');
    store.apply('1', rename('ok'));
    await settle();
    st.failWrites = new Error('QuotaExceededError');
    store.apply('2', rename('ng'));
    await settle();
    expect(mgr.getSnapshot().saveError).toContain('QuotaExceededError');
    expect(st.value!.map.Plugins[0]!.Name).toBe('ok');
    st.failWrites = null;
    store.apply('3', rename('ok2'));
    await settle();
    expect(mgr.getSnapshot().saveError).toBeNull();
    expect(st.value!.map.Plugins[0]!.Name).toBe('ok2');
  });

  it('破棄の直後に保留中の書込みが完了しても、保存データは復活しない', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    await mgr.start();
    store.load(gmSmall, 'a.qbd');
    store.apply('1', rename('X'));
    // 予約中（debounce 待ち）に破棄
    await mgr.discard();
    await settle();
    expect(st.value).toBeNull();
    expect(st.writes).toHaveLength(0);
  });

  it('書込み中に破棄しても、完了した古い書込みの後で削除される（復活しない）', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    await mgr.start();
    store.load(gmSmall, 'a.qbd');
    const releases: (() => void)[] = [];
    st.gate = () => new Promise<void>((res) => { releases.push(res); });
    store.apply('1', rename('X'));
    await settle(); // 書込み開始・完了待ち
    const d = mgr.discard();
    releases[0]!();
    await vi.advanceTimersByTimeAsync(5);
    releases[1]?.();
    await d;
    expect(st.value).toBeNull();
  });

  it('新規・未変更の状態では保存データを削除する（古い作業状態を復活させない）', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    await mgr.start();
    store.load(gmSmall, 'a.qbd');
    store.apply('1', rename('X'));
    await settle();
    expect(st.value).not.toBeNull();
    store.createNew();
    await settle();
    expect(st.value).toBeNull();
  });

  it('flush: 画面を離れるときは debounce を待たずに書込みを開始する', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st);
    await mgr.start();
    store.load(gmSmall, 'a.qbd');
    store.apply('1', rename('X'));
    mgr.flush();
    await vi.advanceTimersByTimeAsync(1);
    expect(st.writes).toHaveLength(1);
  });
});

describe('SessionManager: 複数タブ', () => {
  it('後から開いたタブは保存・復元せず、引き継ぐと元のタブの保存が止まる', async () => {
    const st = new MemorySessionStorage();
    const locks = new FakeLocks();
    const a = tab(st, locks);
    await a.mgr.start();
    a.store.load(gmSmall, 'a.qbd');
    a.store.apply('1', rename('A'));
    await settle();
    const saved = st.value;

    const b = tab(st, locks);
    const r = await b.mgr.start();
    expect(r.restored).toBe(false);
    expect(b.mgr.getSnapshot().ownership).toBe('other');
    b.store.load(gmSmall, 'b.qbd');
    b.store.apply('1', rename('B'));
    await settle();
    expect(st.value).toBe(saved); // 他タブは保存データに触れない

    expect(await b.mgr.takeOver()).toBe(true);
    await settle();
    expect(b.mgr.getSnapshot().ownership).toBe('owner');
    expect(a.mgr.getSnapshot().ownership).toBe('other');
    expect(st.value!.fileName).toBe('b.qbd');
    a.store.apply('2', rename('A2'));
    await settle();
    expect(st.value!.fileName).toBe('b.qbd'); // 元のタブの書込みは行われない
  });

  it('Web Locks が使えない場合は黙って書込みを許可せず、自動保存しない', async () => {
    const st = new MemorySessionStorage();
    const { store, mgr } = tab(st, null);
    await mgr.start();
    expect(mgr.getSnapshot().ownership).toBe('unsupported');
    store.load(gmSmall, 'a.qbd');
    store.apply('1', rename('X'));
    await settle();
    expect(st.writes).toHaveLength(0);
  });
});
