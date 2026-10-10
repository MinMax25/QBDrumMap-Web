// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import { SettingsStore, type StorageLike } from '../../src/ui/settings/settingsStore';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_STORAGE_KEY } from '../../src/ui/settings/appSettings';
import type { FileIo } from '../../src/ui/services/fileIo';
import { gmSmall } from '../fixtures';
import { defaultPartNameDictionary } from '../../src/core';

afterEach(cleanup);

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const nullIo: FileIo = { openText: async () => null, saveText: () => undefined };
const bodyBg = () => getComputedStyle(document.body).backgroundColor;
const DARK_BG = 'rgb(18, 18, 18)';
const LIGHT_BG = 'rgb(255, 255, 255)';

function openSettings(settings: SettingsStore, editor = new EditorStore()) {
  render(<AppShell store={editor} io={nullIo} settings={settings} />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}
function chooseTheme(label: 'Dark' | 'Light') {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '画面テーマ' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: label }));
}

describe('画面テーマ（UI Phase 7）', () => {
  it('初回起動の既定は Dark。Settings の「画面テーマ」に Dark／Light の 2 択がある', () => {
    const settings = new SettingsStore(new MemoryStorage());
    expect(settings.getSnapshot().settings.theme).toBe('dark');
    openSettings(settings);
    expect(bodyBg()).toBe(DARK_BG);
    const combo = screen.getByRole('combobox', { name: '画面テーマ' });
    expect(combo.textContent).toBe('Dark');
    fireEvent.mouseDown(combo);
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Dark', 'Light']);
  });

  it('テーマの変更は即時に反映され（再読み込み不要）、保存され、新しいストアで復元できる', () => {
    const storage = new MemoryStorage();
    const settings = new SettingsStore(storage);
    openSettings(settings);
    chooseTheme('Light');
    expect(settings.getSnapshot().settings.theme).toBe('light');
    expect(bodyBg()).toBe(LIGHT_BG);
    expect(parseSettings(storage.getItem(SETTINGS_STORAGE_KEY))).toMatchObject({ status: 'restored', settings: { theme: 'light' } });
    // 再読み込み（新しいストア・新しい画面）
    cleanup();
    const reloaded = new SettingsStore(storage);
    expect(reloaded.getSnapshot()).toMatchObject({ restore: 'restored', settings: { theme: 'light' } });
    render(<AppShell store={new EditorStore()} io={nullIo} settings={reloaded} />);
    expect(bodyBg()).toBe(LIGHT_BG);
    // Dark へ戻す
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    chooseTheme('Dark');
    expect(bodyBg()).toBe(DARK_BG);
  });

  it('旧バージョン（version 1。theme なし）の保存データは 3 設定値を保ったまま移行し、theme は Dark', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1, settings: { useArticulation: false, useArticulationPitchName: false, convertMidiFormat: 0 },
    }));
    const settings = new SettingsStore(storage);
    expect(settings.getSnapshot()).toMatchObject({
      restore: 'restored',
      settings: { useArticulation: false, useArticulationPitchName: false, convertMidiFormat: 0, theme: 'dark' },
    });
    // 次の変更で version 3 として保存し直し、3 設定値も theme も保たれる
    settings.update({ theme: 'light' });
    const again = new SettingsStore(storage).getSnapshot().settings;
    expect(again).toEqual({ useArticulation: false, useArticulationPitchName: false, convertMidiFormat: 0, theme: 'light', partNameDictionary: defaultPartNameDictionary() });
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!).version).toBe(3);
  });

  it('不正な theme・壊れたデータ・未知バージョンは既定値（Dark）で起動し、保存データを勝手に上書きしない', () => {
    const v2 = (theme: unknown) => JSON.stringify({
      version: 2, settings: { useArticulation: false, useArticulationPitchName: true, convertMidiFormat: 0, theme },
    });
    const cases: [string, string][] = [
      [v2('blue'), 'invalid'], [v2(undefined), 'invalid'], [v2(1), 'invalid'], ['not json', 'invalid'],
      [JSON.stringify({ version: 4, settings: {} }), 'unknown-version'],
    ];
    for (const [raw, status] of cases) {
      const storage = new MemoryStorage();
      storage.setItem(SETTINGS_STORAGE_KEY, raw);
      const s = new SettingsStore(storage).getSnapshot();
      expect(s.settings, raw).toEqual(DEFAULT_SETTINGS);
      expect(s.restore, raw).toBe(status);
      expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(raw);
    }
  });

  it('保存できない環境でもテーマは即時に切り替わる（再読み込みでは既定に戻る）', () => {
    const failing: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
    const settings = new SettingsStore(failing);
    openSettings(settings);
    chooseTheme('Light');
    expect(bodyBg()).toBe(LIGHT_BG);
    expect(settings.getSnapshot()).toMatchObject({ persistent: false, settings: { theme: 'light' } });
    expect(screen.getByTestId('settings-not-persistent')).toBeTruthy();
  });

  it('テーマの変更は QBD の Dirty・Undo 履歴・内容に影響しない', () => {
    const editor = new EditorStore();
    editor.load(gmSmall, 'a.qbd');
    const settings = new SettingsStore(new MemoryStorage());
    openSettings(settings, editor);
    const before = editor.getSnapshot();
    chooseTheme('Light');
    chooseTheme('Dark');
    const after = editor.getSnapshot();
    expect(after.dirty).toBe(before.dirty);
    expect(after.canUndo).toBe(before.canUndo);
    expect(after.canRedo).toBe(before.canRedo);
    expect(after.map).toBe(before.map); // QBD の内容は同一参照のまま
  });
});
