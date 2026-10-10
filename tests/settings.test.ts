import { describe, expect, it } from 'vitest';
import { defaultPartNameDictionary } from '../src/core';
import {
  DEFAULT_SETTINGS, parseSettings, serializeSettings, SETTINGS_SCHEMA_VERSION, SETTINGS_STORAGE_KEY, type AppSettings,
} from '../src/ui/settings/appSettings';
import { SettingsStore, type StorageLike } from '../src/ui/settings/settingsStore';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes++; this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const saved = (): AppSettings => ({
  useArticulation: false, useArticulationPitchName: false, convertMidiFormat: 0, theme: 'light',
  partNameDictionary: [{ CanonicalName: 'Kick', Aliases: 'BD' }],
});

describe('設定の既定値と保存形式', () => {
  it('既定値は Windows版の既定（両方 true、Format 1）に、画面テーマ Dark を加えたもの', () => {
    expect(DEFAULT_SETTINGS).toEqual({ useArticulation: true, useArticulationPitchName: true, convertMidiFormat: 1, theme: 'dark', partNameDictionary: defaultPartNameDictionary() });
  });

  it('保存形式にスキーマバージョンを持ち、往復で一致する', () => {
    const text = serializeSettings(saved());
    expect(JSON.parse(text).version).toBe(SETTINGS_SCHEMA_VERSION);
    expect(parseSettings(text)).toEqual({ settings: saved(), status: 'restored' });
  });

  it('保存データなしは既定値（none）', () => {
    expect(parseSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, status: 'none' });
  });

  it('壊れた JSON・型違い・不正値・欠落は既定値（invalid）。黙って一部だけ採用しない', () => {
    const v = SETTINGS_SCHEMA_VERSION;
    const bad = [
      'not json', '[]', 'null', '123', '{}', '{"version":"1"}',
      JSON.stringify({ version: v }),
      JSON.stringify({ version: v, settings: null }),
      JSON.stringify({ version: v, settings: { useArticulation: 'yes', useArticulationPitchName: true, convertMidiFormat: 1 } }),
      JSON.stringify({ version: v, settings: { useArticulation: true, useArticulationPitchName: true, convertMidiFormat: 2 } }),
      JSON.stringify({ version: v, settings: { useArticulation: true, useArticulationPitchName: true, convertMidiFormat: '1' } }),
      JSON.stringify({ version: v, settings: { useArticulation: false, useArticulationPitchName: true } }),
      JSON.stringify({ version: 1.5, settings: {} }),
    ];
    for (const raw of bad) expect(parseSettings(raw), raw).toEqual({ settings: DEFAULT_SETTINGS, status: 'invalid' });
  });

  it('未知のバージョンは既定値（unknown-version）', () => {
    const raw = JSON.stringify({ version: SETTINGS_SCHEMA_VERSION + 1, settings: saved() });
    expect(parseSettings(raw)).toEqual({ settings: DEFAULT_SETTINGS, status: 'unknown-version' });
  });

  it('余分なキーがあっても必要な値だけを採用する', () => {
    const raw = JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, extra: 1, settings: { ...saved(), future: true } });
    expect(parseSettings(raw).settings).toEqual(saved());
  });
});

describe('SettingsStore', () => {
  it('変更を保存し、新しいストアで復元できる（再読み込み）', () => {
    const st = new MemoryStorage();
    const a = new SettingsStore(st);
    expect(a.getSnapshot().restore).toBe('none');
    a.update({ useArticulation: false, convertMidiFormat: 0 });
    expect(a.getSnapshot().persistent).toBe(true);
    const b = new SettingsStore(st);
    expect(b.getSnapshot().restore).toBe('restored');
    expect(b.getSnapshot().settings).toEqual({ useArticulation: false, useArticulationPitchName: true, convertMidiFormat: 0, theme: 'dark', partNameDictionary: defaultPartNameDictionary() });
  });

  it('値が変わらない更新では保存しない。購読者へ通知する', () => {
    const st = new MemoryStorage();
    const s = new SettingsStore(st);
    let n = 0;
    s.subscribe(() => n++);
    s.update({ useArticulation: true });
    expect(st.writes).toBe(0);
    expect(n).toBe(0);
    s.update({ useArticulation: false });
    expect(st.writes).toBe(1);
    expect(n).toBe(1);
  });

  it('reset は辞書以外を既定値に戻して保存する（辞書は変更しない）', () => {
    const st = new MemoryStorage();
    const s = new SettingsStore(st);
    s.update(saved());
    s.reset();
    const expected = { ...DEFAULT_SETTINGS, partNameDictionary: saved().partNameDictionary };
    expect(s.getSnapshot().settings).toEqual(expected);
    expect(parseSettings(st.getItem(SETTINGS_STORAGE_KEY)).settings).toEqual(expected);
  });

  it('ストレージが無い（null）ときはメモリ上で動作を続け、persistent=false', () => {
    const s = new SettingsStore(null);
    expect(s.getSnapshot().persistent).toBe(false);
    s.update({ useArticulation: false });
    expect(s.getSnapshot().settings.useArticulation).toBe(false);
    expect(s.getSnapshot().persistent).toBe(false);
  });

  it('読み取りで例外が出たら既定値で動作を続け、persistent=false（unreadable）', () => {
    const st: StorageLike = { getItem() { throw new Error('denied'); }, setItem() { /* 何もしない */ }, removeItem() { /* 何もしない */ } };
    const s = new SettingsStore(st);
    expect(s.getSnapshot()).toMatchObject({ settings: DEFAULT_SETTINGS, persistent: false, restore: 'unreadable' });
  });

  it('書き込みで例外（容量超過など）が出ても設定は反映され、persistent=false と理由が記録される。成功すれば回復する', () => {
    let fail = true;
    const st: StorageLike = {
      getItem: () => null, removeItem: () => undefined,
      setItem() { if (fail) throw new Error('QuotaExceeded'); },
    };
    const s = new SettingsStore(st);
    s.update({ useArticulationPitchName: false });
    expect(s.getSnapshot().settings.useArticulationPitchName).toBe(false);
    expect(s.getSnapshot().persistent).toBe(false);
    expect(s.getSnapshot().saveError).toContain('QuotaExceeded');
    fail = false;
    s.update({ useArticulationPitchName: true });
    expect(s.getSnapshot()).toMatchObject({ persistent: true, saveError: null });
  });

  it('不正・未知バージョンの保存データでは既定値で起動し、設定を変更するまで保存データを上書きしない', () => {
    for (const raw of ['broken', JSON.stringify({ version: 99, settings: saved() })]) {
      const st = new MemoryStorage();
      st.data.set(SETTINGS_STORAGE_KEY, raw);
      const s = new SettingsStore(st);
      expect(s.getSnapshot().settings).toEqual(DEFAULT_SETTINGS);
      expect(['invalid', 'unknown-version']).toContain(s.getSnapshot().restore);
      expect(st.data.get(SETTINGS_STORAGE_KEY)).toBe(raw);
      s.update({ useArticulation: false });
      expect(st.data.get(SETTINGS_STORAGE_KEY)).not.toBe(raw);
    }
  });
});
