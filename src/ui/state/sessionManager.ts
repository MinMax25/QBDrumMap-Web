import type { EditorStore } from './editorStore';
import {
  browserLocks, createIndexedDbSessionStorage, OwnerLease, SESSION_SCHEMA_VERSION,
  type LockManagerLike, type SessionSnapshot, type SessionStorage, type SessionUi,
} from './sessionPersistence';

/** 起動時に復元できなかった理由。この間は自動保存を止め、保存データを上書き・消去しない */
export interface LoadProblem {
  kind: 'invalid' | 'unreadable';
  reason: string;
  /** invalid のときの保存データそのもの（書き出し用） */
  raw?: unknown;
}

export interface SessionStatus {
  /** 起動時の読取りが終わるまでは false。この間は自動保存を行わない（空の初期状態で保存データを上書きしない） */
  readonly ready: boolean;
  /** owner: このタブが保存する／other: 他のタブが保存中／unsupported: Web Locks が使えない（自動保存しない） */
  readonly ownership: 'owner' | 'other' | 'unsupported';
  readonly loadProblem: LoadProblem | null;
  /** 直近の保存失敗の理由（成功したら null） */
  readonly saveError: string | null;
}

export interface StartResult {
  restored: boolean;
  ui: SessionUi | null;
}

export interface SessionManagerOptions {
  debounceMs?: number;
  locks?: LockManagerLike | null;
  now?: () => Date;
}

export const DEFAULT_DEBOUNCE_MS = 500;

/**
 * 作業状態の自動保存・復元の調整役（UI非依存）。
 * - 起動（start）が完了するまで書込みを行わない。保存データが壊れている・読めない間は書込みも止める（無警告で消さない）。
 * - 書込みは単一のキューで順番に実行し、最新でないスナップショットと、破棄（世代の更新）より前のものは実行しない。
 * - 保存すべき内容が無い初期状態（新規で未変更）のときは、保存データを削除する（古い作業状態を復活させない）。
 * - 複数タブ: 保存できるのは所有権（Web Locks）を持つタブだけ。他タブは保存せず、利用者が明示的に引き継ぐ。
 */
export class SessionManager {
  private _status: SessionStatus = { ready: false, ownership: 'other', loadProblem: null, saveError: null };
  private readonly _listeners = new Set<() => void>();
  private readonly lease: OwnerLease;
  private readonly debounceMs: number;
  private readonly now: () => Date;
  private ui: SessionUi = { pageId: 'mapEditor', tabId: 'pluginsKits' };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private seq = 0;
  private generation = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly store: EditorStore,
    private readonly storage: SessionStorage = createIndexedDbSessionStorage(),
    options: SessionManagerOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.now = options.now ?? (() => new Date());
    this.lease = new OwnerLease(options.locks === undefined ? browserLocks() : options.locks, () => this.onLostOwnership());
  }

  subscribe = (l: () => void): (() => void) => {
    this._listeners.add(l);
    return () => this._listeners.delete(l);
  };

  getSnapshot = (): SessionStatus => this._status;

  private set(patch: Partial<SessionStatus>): void {
    this._status = { ...this._status, ...patch };
    this._listeners.forEach((l) => l());
  }

  private get canWrite(): boolean {
    const s = this._status;
    return s.ready && s.ownership === 'owner' && s.loadProblem === null;
  }

  private started: Promise<StartResult> | null = null;

  /** 起動処理を1回だけ実行する（StrictMode などで複数回呼ばれても同じ結果を返す） */
  startOnce(): Promise<StartResult> {
    this.started ??= this.start();
    return this.started;
  }

  /** 起動時の所有権取得と復元。再試行（unreadable のとき）にも使う */
  async start(): Promise<StartResult> {
    const before = this.store.getSnapshot();
    if (!this.lease.supported) {
      this.set({ ready: true, ownership: 'unsupported' });
      return { restored: false, ui: null };
    }
    if (this._status.ownership !== 'owner') {
      const got = await this.lease.acquire(false);
      if (!got) {
        this.set({ ready: true, ownership: 'other' });
        return { restored: false, ui: null };
      }
      this.set({ ownership: 'owner' });
    }
    const r = await this.storage.read();
    let result: StartResult = { restored: false, ui: null };
    const after = this.store.getSnapshot();
    if (r.kind === 'ok' && (after.map !== before.map || after.fileName !== before.fileName)) {
      // 読取り中に利用者が編集・読込した。保存データで上書きしない（保存データも消さない）
      this.set({
        ready: true,
        loadProblem: { kind: 'unreadable', reason: '復元データの読取り中に編集が行われたため、復元を行いませんでした。保存データは削除していません' },
      });
    } else if (r.kind === 'ok') {
      const s = r.snapshot;
      this.store.restore(s.map, s.baselineMap, s.fileName, s.selection, s.sample === true);
      this.ui = s.ui;
      result = { restored: true, ui: s.ui };
      this.set({ ready: true, loadProblem: null });
    } else if (r.kind === 'invalid') {
      this.set({ ready: true, loadProblem: { kind: 'invalid', reason: r.reason, raw: r.raw } });
    } else if (r.kind === 'unreadable') {
      this.set({ ready: true, loadProblem: { kind: 'unreadable', reason: r.reason } });
    } else {
      this.set({ ready: true, loadProblem: null });
    }
    this.attach();
    return result;
  }

  private attach(): void {
    if (this.unsubscribe) return;
    let last: unknown[] = [];
    this.unsubscribe = this.store.subscribe(() => {
      const st = this.store.getSnapshot();
      // busy など保存内容に関係しない変化では書込みを予約しない
      const cur = [st.map, this.store.baselineMap, st.fileName, st.selection, st.sample];
      if (cur.length === last.length && cur.every((v, i) => v === last[i])) return;
      last = cur;
      this.notify();
    });
  }

  /** 画面（ページ・タブ）の変更を伝える */
  setUi(ui: SessionUi): void {
    if (ui.pageId === this.ui.pageId && ui.tabId === this.ui.tabId) return;
    this.ui = ui;
    this.notify();
  }

  /** 変更の通知。debounce して保存する */
  notify(): void {
    if (!this.canWrite) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.persistNow(); }, this.debounceMs);
  }

  /** 画面を離れる・隠れるときのベストエフォート（非同期の書込み完了は保証できない） */
  flush(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.persistNow();
  }

  private buildSnapshot(): SessionSnapshot | null {
    const st = this.store.getSnapshot();
    if (st.fileName === null && !st.dirty) return null; // 新規・未変更: 復元すべき作業状態がない
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      savedAt: this.now().toISOString(),
      seq: ++this.seq,
      fileName: st.fileName,
      sample: st.sample,
      map: st.map,
      // 未保存のときだけ基準も保存する（保存済みなら作業モデルが基準）
      baselineMap: st.dirty ? this.store.baselineMap : null,
      ui: this.ui,
      selection: st.selection,
    };
  }

  private persistNow(): void {
    if (!this.canWrite) return;
    const snap = this.buildSnapshot();
    const myGen = this.generation;
    const mySeq = snap ? snap.seq : ++this.seq;
    this.enqueue(async () => {
      if (myGen !== this.generation || mySeq !== this.seq) return; // 破棄後、または新しい予約がある
      if (snap) await this.storage.write(snap);
      else await this.storage.clear();
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task).then(
      () => { if (this._status.saveError !== null) this.set({ saveError: null }); },
      (e: unknown) => { this.set({ saveError: e instanceof Error ? e.message : String(e) }); },
    );
    this.chain = run;
    return run;
  }

  /** 保存データを削除する（アプリ設定は対象外）。遅れて完了する古い書込みは世代で無効にする */
  async discard(): Promise<void> {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.generation++;
    const myGen = this.generation;
    this.seq++;
    await this.enqueue(async () => {
      if (myGen !== this.generation) return;
      await this.storage.clear();
    });
    if (this._status.saveError === null) this.set({ loadProblem: null });
  }

  /** 他のタブから保存の所有権を引き継ぐ。このタブの現在の内容で保存データを置き換える */
  async takeOver(): Promise<boolean> {
    if (!(await this.lease.acquire(true))) return false;
    this.generation++;
    this.set({ ownership: 'owner', loadProblem: null, ready: true });
    this.attach();
    this.persistNow();
    return true;
  }

  private onLostOwnership(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.generation++; // 保留中の書込みは実行しない
    this.set({ ownership: 'other' });
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.lease.releaseNow();
  }
}
