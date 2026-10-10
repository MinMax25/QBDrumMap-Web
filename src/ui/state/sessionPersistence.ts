import { serializeQbd, type MapData } from '../../core';
import { emptySelection, type Selection } from './editorStore';

/**
 * 作業状態の自動復元（永続データ・保存先の層。UI非依存）。
 *
 * - 保存先は IndexedDB（origin 単位。サーバー・GitHub へは何も送らない）。QBD ファイルへの保存とは無関係で、
 *   「保存済み」の扱いは変えない（Dirty は保存基準モデルとの比較で、基準も併せて保存・復元する）。
 * - Undo/Redo 履歴・MIDI 入力・Export の一時結果・ファイルハンドルは保存しない。
 * - 永続データには schemaVersion を付け、未知の版・壊れた形は読み込まずに「invalid」として返す（消去しない）。
 */
export const SESSION_SCHEMA_VERSION = 1;

export interface SessionUi {
  pageId: string;
  tabId: string;
}

export interface SessionSnapshot {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  /** 保存した時刻（ISO 8601。表示・調査用） */
  savedAt: string;
  /** 書込みの通し番号（調査用。順序の保証は書込みキューが行う） */
  seq: number;
  /** 元の QBD の表示名（ローカルのパス・書込み権限は保存しない） */
  fileName: string | null;
  /** 公開サンプルから開いた文書か（表示用。旧レコードには無く、無ければ false） */
  sample?: boolean;
  map: MapData;
  /** 保存基準のモデル。null は「作業モデルが基準（未変更）」 */
  baselineMap: MapData | null;
  ui: SessionUi;
  selection: Selection;
}

export type SessionReadResult =
  | { kind: 'none' }
  | { kind: 'ok'; snapshot: SessionSnapshot }
  /** 壊れている・未知の版。raw は書き出し用に保持する（消去しない） */
  | { kind: 'invalid'; reason: string; raw: unknown }
  /** ストレージ自体にアクセスできない（読めないだけで、壊れているとは限らない） */
  | { kind: 'unreadable'; reason: string };

export interface SessionStorage {
  read(): Promise<SessionReadResult>;
  /** 失敗時は reject する（以前の正常なスナップショットは維持される） */
  write(snapshot: SessionSnapshot): Promise<void>;
  clear(): Promise<void>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isIdxOrNull = (v: unknown): boolean => v === null || (isInt(v) && v >= 0);
const isIdxList = (v: unknown): boolean => Array.isArray(v) && v.every((i) => isInt(i) && i >= 0);

/** 復元に必要な最小限の形（部分復元で文書を壊すより、復元の失敗を選ぶ） */
export function isMapShape(m: unknown): m is MapData {
  if (!isObj(m) || typeof m.AppName !== 'string' || typeof m.ModelVersion !== 'string' || !isObj(m.Extra)) return false;
  if (!Array.isArray(m.Plugins) || !Array.isArray(m.Parts)) return false;
  const kitOk = (k: unknown): boolean =>
    isObj(k) && isInt(k.ID) && typeof k.Name === 'string' && Array.isArray(k.Pitches) &&
    k.Pitches.every((p: unknown) => isObj(p) && isInt(p.Pitch) && isInt(p.ArticulationID));
  const pluginOk = (p: unknown): boolean =>
    isObj(p) && isInt(p.ID) && typeof p.Name === 'string' && Array.isArray(p.Kits) && p.Kits.every(kitOk);
  const partOk = (p: unknown): boolean =>
    isObj(p) && isInt(p.ID) && typeof p.Name === 'string' && Array.isArray(p.Articulations) &&
    p.Articulations.every((a: unknown) => isObj(a) && isInt(a.ID) && typeof a.Name === 'string');
  return m.Plugins.every(pluginOk) && m.Parts.every(partOk);
}

function isSelectionShape(s: unknown): s is Selection {
  return isObj(s) &&
    isIdxOrNull(s.pluginIndex) && isIdxOrNull(s.kitIndex) && isIdxOrNull(s.partIndex) && isIdxOrNull(s.articulationIndex) &&
    isIdxList(s.pluginIndices) && isIdxList(s.kitIndices) && isIdxList(s.pitchIndices) && isIdxList(s.partIndices) &&
    isIdxList(s.articulationIndices) && isIdxList(s.orderIndices);
}

/** 保存された値の検証。読み込めない場合は理由つきで invalid を返す（呼び出し側は消去しない） */
export function parseSnapshot(raw: unknown): { ok: true; snapshot: SessionSnapshot } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: '保存データの形式が不正です' };
  if (raw.schemaVersion !== SESSION_SCHEMA_VERSION) {
    return { ok: false, reason: `未対応のスキーマバージョンです（${String(raw.schemaVersion)}。このアプリは ${SESSION_SCHEMA_VERSION} に対応）` };
  }
  if (!isMapShape(raw.map)) return { ok: false, reason: 'QBD の作業データの形式が不正です' };
  if (raw.baselineMap !== null && !isMapShape(raw.baselineMap)) return { ok: false, reason: '保存基準のデータの形式が不正です' };
  if (raw.fileName !== null && typeof raw.fileName !== 'string') return { ok: false, reason: 'ファイル名の形式が不正です' };
  if (raw.sample !== undefined && typeof raw.sample !== 'boolean') return { ok: false, reason: 'サンプル表示の形式が不正です' };
  if (!isObj(raw.ui) || typeof raw.ui.pageId !== 'string' || typeof raw.ui.tabId !== 'string') return { ok: false, reason: '画面状態の形式が不正です' };
  if (!isSelectionShape(raw.selection)) return { ok: false, reason: '選択状態の形式が不正です' };
  if (!serializeQbd(raw.map).ok) return { ok: false, reason: 'QBD として保存できないデータです' };
  return {
    ok: true,
    snapshot: {
      schemaVersion: SESSION_SCHEMA_VERSION,
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
      seq: isInt(raw.seq) ? raw.seq : 0,
      fileName: raw.fileName,
      sample: raw.sample === true,
      map: raw.map,
      baselineMap: raw.baselineMap,
      ui: { pageId: raw.ui.pageId, tabId: raw.ui.tabId },
      selection: { ...emptySelection, ...raw.selection },
    },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB 実装

const DB_NAME = 'qbdrummap-web';
const STORE_NAME = 'session';
const KEY = 'current';

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB の要求に失敗しました'));
  });
}

/** IndexedDB に1件（key=current）だけ保存する。トランザクションの完了を待って成功とする */
export function createIndexedDbSessionStorage(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): SessionStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('このブラウザでは IndexedDB を利用できません'));
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けません'));
      req.onblocked = () => reject(new Error('IndexedDB が他のタブにブロックされています'));
    }).catch((e: unknown) => { dbPromise = null; throw e; });
    return dbPromise;
  };
  const tx = async (mode: IDBTransactionMode, run: (s: IDBObjectStore) => void): Promise<void> => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_NAME, mode);
      run(t.objectStore(STORE_NAME));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error('IndexedDB の書込みに失敗しました'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB の書込みが中断されました'));
    });
  };
  return {
    async read(): Promise<SessionReadResult> {
      let raw: unknown;
      try {
        const db = await open();
        raw = await reqToPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY));
      } catch (e) {
        return { kind: 'unreadable', reason: e instanceof Error ? e.message : String(e) };
      }
      if (raw === undefined) return { kind: 'none' };
      const r = parseSnapshot(raw);
      return r.ok ? { kind: 'ok', snapshot: r.snapshot } : { kind: 'invalid', reason: r.reason, raw };
    },
    write: (snapshot) => tx('readwrite', (s) => { s.put(snapshot, KEY); }),
    clear: () => tx('readwrite', (s) => { s.delete(KEY); }),
  };
}

// ---------------------------------------------------------------------------
// 複数タブの所有権（Web Locks）

export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}

export const OWNER_LOCK_NAME = 'qbdrummap-web-session-owner';

/**
 * 作業状態の保存を行えるタブを1つに限る（同じ origin の他タブとスナップショットを奪い合わない）。
 * Web Locks が使えないブラウザでは所有権を取れない（黙って同時書込みを許可しない）。
 * 奪取（steal）された側は onLost が呼ばれる。
 */
export class OwnerLease {
  private release: (() => void) | null = null;
  private held = false;

  constructor(private readonly locks: LockManagerLike | null, private readonly onLost: () => void) {}

  get supported(): boolean {
    return this.locks !== null;
  }

  /** 所有権を取る。他タブが保持中なら false（steal=true なら奪う） */
  acquire(steal = false): Promise<boolean> {
    const locks = this.locks;
    if (!locks) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
      locks.request(OWNER_LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) { settle(false); return undefined; }
        this.held = true;
        settle(true);
        return new Promise<void>((release) => { this.release = release; });
      }).then(
        () => { this.held = false; },
        () => { // 他タブに奪われた（AbortError）等
          const wasHeld = this.held;
          this.held = false;
          settle(false);
          if (wasHeld) this.onLost();
        },
      );
    });
  }

  releaseNow(): void {
    this.release?.();
    this.release = null;
    this.held = false;
  }
}

export function browserLocks(): LockManagerLike | null {
  try {
    return typeof navigator !== 'undefined' && navigator.locks ? (navigator.locks as unknown as LockManagerLike) : null;
  } catch {
    return null;
  }
}
