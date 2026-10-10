import type {
  LockManagerLike, SessionReadResult, SessionSnapshot, SessionStorage,
} from '../src/ui/state/sessionPersistence';

/** メモリ上の SessionStorage。失敗・遅延を注入できる */
export class MemorySessionStorage implements SessionStorage {
  value: SessionSnapshot | null = null;
  /** read の結果を固定したいとき（invalid / unreadable の再現） */
  forcedRead: SessionReadResult | null = null;
  writes: SessionSnapshot[] = [];
  clears = 0;
  failWrites: Error | null = null;
  /** 書込みを手動で完了させたいときに設定する待機関数 */
  gate: (() => Promise<void>) | null = null;

  async read(): Promise<SessionReadResult> {
    if (this.forcedRead) return this.forcedRead;
    return this.value ? { kind: 'ok', snapshot: this.value } : { kind: 'none' };
  }
  async write(s: SessionSnapshot): Promise<void> {
    if (this.gate) await this.gate();
    if (this.failWrites) throw this.failWrites;
    this.writes.push(s);
    this.value = s;
  }
  async clear(): Promise<void> {
    if (this.gate) await this.gate();
    if (this.failWrites) throw this.failWrites;
    this.clears++;
    this.value = null;
  }
}

/** Web Locks の簡易版（1つのブラウザ内の全タブで共有する）。steal された側は AbortError で reject される */
export class FakeLocks implements LockManagerLike {
  private holder: { abort(): void } | null = null;
  request(_name: string, options: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown> {
    if (this.holder && options.ifAvailable) return Promise.resolve(cb(null));
    if (this.holder && options.steal) { this.holder.abort(); this.holder = null; }
    return new Promise((resolve, reject) => {
      const me = { abort: () => reject(new DOMException('stolen', 'AbortError')) };
      this.holder = me;
      Promise.resolve(cb({})).then(() => {
        if (this.holder === me) this.holder = null;
        resolve(undefined);
      }, reject);
    });
  }
}
