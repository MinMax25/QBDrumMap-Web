import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SETTINGS, parseSettings, serializeSettings, SETTINGS_STORAGE_KEY, type AppSettings, type RestoreStatus,
} from './appSettings';
import type { PartNameAlias } from '../../core';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** ブラウザの localStorage。利用できない（アクセス自体が例外になる等）場合は null */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface SettingsState {
  readonly settings: AppSettings;
  /** 設定がブラウザに保存されているか。false のときはメモリ上だけで動作し、再読み込みで失われる */
  readonly persistent: boolean;
  /** 起動時の復元結果 */
  readonly restore: RestoreStatus;
  /** 直近の保存失敗の理由（成功したら null） */
  readonly saveError: string | null;
}

/**
 * アプリ設定の保持者（UI非依存。React からは subscribe / getSnapshot で購読する）。
 * QBD の EditorStore とは独立で、設定の変更・復元は QBD の Dirty・Undo/Redo・保存内容に影響しない。
 * 変更のたびにスキーマバージョン付きで localStorage に保存する。ストレージが無い・例外のときはメモリ上で動作を続け、persistent=false にする。
 */
export class SettingsStore {
  private _state: SettingsState;
  private _listeners = new Set<() => void>();

  constructor(private readonly storage: StorageLike | null = browserStorage()) {
    let raw: string | null = null;
    let restore: RestoreStatus;
    let persistent = storage !== null;
    let settings: AppSettings = { ...DEFAULT_SETTINGS };
    if (storage === null) restore = 'unreadable';
    else {
      try {
        raw = storage.getItem(SETTINGS_STORAGE_KEY);
        const r = parseSettings(raw);
        settings = r.settings;
        restore = r.status;
      } catch {
        restore = 'unreadable';
        persistent = false;
      }
    }
    this._state = { settings, persistent, restore, saveError: null };
  }

  subscribe = (l: () => void): (() => void) => {
    this._listeners.add(l);
    return () => this._listeners.delete(l);
  };

  getSnapshot = (): SettingsState => this._state;

  /** 設定を更新して保存する。値が変わらなければ何もしない */
  update(patch: Partial<AppSettings>): void {
    const next: AppSettings = { ...this._state.settings, ...patch };
    const cur = this._state.settings;
    if (next.useArticulation === cur.useArticulation && next.useArticulationPitchName === cur.useArticulationPitchName && next.convertMidiFormat === cur.convertMidiFormat && next.theme === cur.theme
      && dictionaryEquals(next.partNameDictionary, cur.partNameDictionary)) return;
    this.commit(next);
  }

  /** 既定値へ戻して保存する。辞書は専用の初期化（確認つき）で戻すため、ここでは変更しない */
  reset(): void {
    this.commit({ ...DEFAULT_SETTINGS, partNameDictionary: this._state.settings.partNameDictionary });
  }

  private commit(settings: AppSettings): void {
    let persistent = this.storage !== null;
    let saveError: string | null = null;
    if (this.storage !== null) {
      try {
        this.storage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
      } catch (e) {
        persistent = false;
        saveError = e instanceof Error ? e.message : String(e);
      }
    }
    this._state = { ...this._state, settings, persistent, saveError };
    this._listeners.forEach((l) => l());
  }
}

function dictionaryEquals(a: readonly PartNameAlias[], b: readonly PartNameAlias[]): boolean {
  return a.length === b.length && a.every((e, i) => e.CanonicalName === b[i]!.CanonicalName && e.Aliases === b[i]!.Aliases);
}

export function useSettings(store: SettingsStore): SettingsState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
