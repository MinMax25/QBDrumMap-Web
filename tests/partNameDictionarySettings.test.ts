import { describe, expect, it } from 'vitest';
import { defaultPartNameDictionary } from '../src/core';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, SETTINGS_STORAGE_KEY } from '../src/ui/settings/appSettings';
import { SettingsStore, type StorageLike } from '../src/ui/settings/settingsStore';
import { EditorStore } from '../src/ui/state/editorStore';
import { gmSmall } from './fixtures';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes++; this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const v3 = (dict: unknown) => JSON.stringify({
  version: 3, settings: { useArticulation: false, useArticulationPitchName: true, convertMidiFormat: 0, theme: 'light', partNameDictionary: dict },
});

describe('PartNameDictionary の保存・復元・移行', () => {
  it('保存データなし（初回）は初期7件', () => {
    const r = parseSettings(null);
    expect(r.settings.partNameDictionary).toEqual(defaultPartNameDictionary());
    expect(r.settings.partNameDictionary).toHaveLength(7);
  });

  it('version 1 から移行: 既存の設定値を保ち、theme は Dark、辞書は初期7件', () => {
    const raw = JSON.stringify({ version: 1, settings: { useArticulation: false, useArticulationPitchName: false, convertMidiFormat: 0 } });
    expect(parseSettings(raw)).toEqual({
      status: 'restored',
      settings: { useArticulation: false, useArticulationPitchName: false, convertMidiFormat: 0, theme: 'dark', partNameDictionary: defaultPartNameDictionary() },
    });
  });

  it('version 2 から移行: Theme・MIDI Format など既存の設定値を保ち、辞書は初期7件', () => {
    const raw = JSON.stringify({ version: 2, settings: { useArticulation: false, useArticulationPitchName: true, convertMidiFormat: 0, theme: 'light' } });
    expect(parseSettings(raw)).toEqual({
      status: 'restored',
      settings: { useArticulation: false, useArticulationPitchName: true, convertMidiFormat: 0, theme: 'light', partNameDictionary: defaultPartNameDictionary() },
    });
  });

  it('移行しただけでは保存データを書き換えない。次の変更で version 3 として保存し、辞書も保たれる', () => {
    const st = new MemoryStorage();
    const raw = JSON.stringify({ version: 2, settings: { useArticulation: true, useArticulationPitchName: true, convertMidiFormat: 1, theme: 'light' } });
    st.setItem(SETTINGS_STORAGE_KEY, raw);
    const s = new SettingsStore(st);
    expect(st.getItem(SETTINGS_STORAGE_KEY)).toBe(raw);
    s.update({ useArticulation: false });
    const again = new SettingsStore(st).getSnapshot().settings;
    expect(JSON.parse(st.getItem(SETTINGS_STORAGE_KEY)!).version).toBe(3);
    expect(again).toEqual({ useArticulation: false, useArticulationPitchName: true, convertMidiFormat: 1, theme: 'light', partNameDictionary: defaultPartNameDictionary() });
  });

  it('空の辞書は空のまま保存・復元する（初期7件に戻さない）', () => {
    const st = new MemoryStorage();
    const a = new SettingsStore(st);
    a.update({ partNameDictionary: [] });
    const b = new SettingsStore(st).getSnapshot();
    expect(b.restore).toBe('restored');
    expect(b.settings.partNameDictionary).toEqual([]);
  });

  it('重複・空の正規名・空の別名・空白だけの値も入力制約にせず、そのまま往復する', () => {
    const dict = [
      { CanonicalName: 'Kick', Aliases: 'BD' }, { CanonicalName: 'Kick', Aliases: 'BD' },
      { CanonicalName: '', Aliases: '' }, { CanonicalName: ' ', Aliases: ' , ' },
    ];
    expect(parseSettings(serializeSettings({ ...DEFAULT_SETTINGS, partNameDictionary: dict }))).toEqual({
      status: 'restored', settings: { ...DEFAULT_SETTINGS, partNameDictionary: dict },
    });
  });

  it('version 3 の辞書が不正（配列でない・要素の型違い・項目欠落）なら全体を既定値（invalid）にする', () => {
    for (const bad of [undefined, null, {}, 'x', [1], [null], [[]], [{ CanonicalName: 'a' }], [{ CanonicalName: 1, Aliases: '' }], [{ CanonicalName: 'a', Aliases: null }]]) {
      expect(parseSettings(v3(bad)), JSON.stringify(bad)).toEqual({ settings: DEFAULT_SETTINGS, status: 'invalid' });
    }
  });

  it('辞書の変更は保存され、内容が変わらない更新では保存しない', () => {
    const st = new MemoryStorage();
    const s = new SettingsStore(st);
    s.update({ partNameDictionary: defaultPartNameDictionary() });
    expect(st.writes).toBe(0);
    s.update({ partNameDictionary: [{ CanonicalName: 'Kick', Aliases: 'BD, Bass' }] });
    expect(st.writes).toBe(1);
    expect(JSON.parse(st.getItem(SETTINGS_STORAGE_KEY)!).settings.partNameDictionary).toEqual([{ CanonicalName: 'Kick', Aliases: 'BD, Bass' }]);
  });

  it('QBD とは独立: 辞書の変更は編集履歴・Dirty・モデルを変えない', () => {
    const editor = new EditorStore();
    expect(editor.load(gmSmall, 'a.qbd').ok).toBe(true);
    const before = editor.getSnapshot();
    const s = new SettingsStore(new MemoryStorage());
    s.update({ partNameDictionary: [] });
    s.update({ partNameDictionary: [{ CanonicalName: 'x', Aliases: 'y' }] });
    const after = editor.getSnapshot();
    expect(after.map).toBe(before.map);
    expect(after.dirty).toBe(false);
    expect(after.canUndo).toBe(false);
    expect(after.historyLength).toBe(0);
  });
});
