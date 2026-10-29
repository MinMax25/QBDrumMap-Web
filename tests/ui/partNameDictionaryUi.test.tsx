// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { createPluginsKitsActions } from '../../src/ui/editor/pluginsKitsActions';
import { EditorStore } from '../../src/ui/state/editorStore';
import { SettingsStore, type StorageLike } from '../../src/ui/settings/settingsStore';
import { SETTINGS_STORAGE_KEY } from '../../src/ui/settings/appSettings';
import { defaultPartNameDictionary } from '../../src/core';
import type { FileIo } from '../../src/ui/services/fileIo';

afterEach(cleanup);

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

/** Kit K1 の行 'BD'（辞書の別名 BD → 正規名 Kick）。Part: Kick（Articulation ID1） */
const qbd = JSON.stringify({
  AppName: 'QBDrumMap', ModelVersion: '1.0.0',
  Plugins: [{
    ID: 1, Name: 'P', PluginType: 'None', MidiOutDevice: '', SoundCheckChannel: 'Channel10',
    Kits: [{ ID: 1, Name: 'K1', Pitches: [{ Pitch: 36, Name: 'BD', ArticulationID: 0 }] }],
  }],
  Parts: [{ ID: 1, Name: 'Kick', ScorePitch: 36, Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] }],
});

const io: FileIo = { openText: async () => null, saveText: () => undefined, openBinary: async () => null, saveBytes: () => undefined };
const nav = (label: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'ページ' })).getByText(label));
const dict = (s: SettingsStore) => s.getSnapshot().settings.partNameDictionary;
const answer = async (button: '続行' | 'キャンセル') => {
  const dlg = await screen.findByRole('dialog');
  fireEvent.click(within(dlg).getByRole('button', { name: button }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

function setup(storage: StorageLike = new MemoryStorage()) {
  const store = new EditorStore();
  expect(store.load(qbd, 'a.qbd').ok).toBe(true);
  const settings = new SettingsStore(storage);
  render(<AppShell store={store} io={io} settings={settings} />);
  nav('Settings');
  return { store, settings, storage };
}

describe('Part Name Dictionary の編集UI（Settings）', () => {
  it('初期辞書（22件）を表示する', () => {
    setup();
    expect(screen.getAllByTestId(/^dictionary-row-/)).toHaveLength(22);
    expect((screen.getByLabelText('Canonical Name (1)') as HTMLInputElement).value).toBe('Kick');
    expect((screen.getByLabelText('Aliases (1)') as HTMLInputElement).value).toBe('Bass Drum,BD');
  });

  it('追加: 空の行が末尾に増え、即時保存される。QBD の Dirty・Undo には影響しない', () => {
    const { store, storage } = setup();
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getAllByTestId(/^dictionary-row-/)).toHaveLength(23);
    const saved = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!).settings.partNameDictionary;
    expect(saved).toHaveLength(23);
    expect(saved[22]).toEqual({ CanonicalName: '', Aliases: '' });
    expect(store.getSnapshot().dirty).toBe(false);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it('編集: 確定（フォーカスを外す）で前後の空白を除いて即時保存。重複した正規名・空の値も許可する。最大64文字', () => {
    const { settings } = setup();
    const name = screen.getByLabelText('Canonical Name (2)') as HTMLInputElement;
    expect(name.maxLength).toBe(64);
    fireEvent.change(name, { target: { value: '  Kick  ' } });
    fireEvent.blur(name);
    expect(dict(settings)[1]!.CanonicalName).toBe('Kick');
    expect((screen.getByLabelText('Canonical Name (2)') as HTMLInputElement).value).toBe('Kick');
    const alias = screen.getByLabelText('Aliases (2)') as HTMLInputElement;
    fireEvent.change(alias, { target: { value: '' } });
    fireEvent.blur(alias);
    expect(dict(settings)[1]).toEqual({ CanonicalName: 'Kick', Aliases: '' });
  });

  it('削除: 複数選択（Ctrl）→ 確認 → 削除。キャンセルでは変更しない', async () => {
    const { settings } = setup();
    fireEvent.click(screen.getByTestId('dictionary-row-0'));
    fireEvent.click(screen.getByTestId('dictionary-row-3'), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '選択行を削除' }));
    expect(await screen.findByText(/Part Name Alias を削除しますか？: Kick, Hi-Hat/)).toBeTruthy();
    await answer('キャンセル');
    expect(dict(settings)).toHaveLength(22);
    fireEvent.click(screen.getByRole('button', { name: '選択行を削除' }));
    await answer('続行');
    expect(dict(settings).map((e) => e.CanonicalName)).toEqual(defaultPartNameDictionary().map((e) => e.CanonicalName).filter((n) => n !== 'Kick' && n !== 'Hi-Hat'));
  });

  it('Delete キー: 行にフォーカスがあるときは削除の確認、入力欄の編集中は行を削除しない', async () => {
    const { settings } = setup();
    fireEvent.click(screen.getByTestId('dictionary-row-0'));
    fireEvent.keyDown(screen.getByLabelText('Canonical Name (1)'), { key: 'Delete' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('dictionary-row-0'), { key: 'Delete' });
    await answer('続行');
    expect(dict(settings)).toHaveLength(21);
  });

  it('全削除した空の辞書は、再読み込み（新しいストア）でも空のまま', async () => {
    const { storage } = setup();
    fireEvent.click(screen.getByTestId('dictionary-row-0'));
    fireEvent.click(screen.getByTestId('dictionary-row-21'), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: '選択行を削除' }));
    await answer('続行');
    expect(screen.queryAllByTestId(/^dictionary-row-/)).toHaveLength(0);
    expect(new SettingsStore(storage).getSnapshot().settings.partNameDictionary).toEqual([]);
  });

  it('初期辞書に戻す: 確認のあと初期辞書に戻す。キャンセルでは変更しない。既定値に戻す（全体）は辞書を変えない', async () => {
    const { settings } = setup();
    settings.update({ partNameDictionary: [{ CanonicalName: 'X', Aliases: '' }] });
    fireEvent.click(screen.getByRole('button', { name: '初期辞書に戻す' }));
    await answer('キャンセル');
    expect(dict(settings)).toEqual([{ CanonicalName: 'X', Aliases: '' }]);
    fireEvent.click(screen.getByRole('button', { name: '既定値に戻す' }));
    expect(dict(settings)).toEqual([{ CanonicalName: 'X', Aliases: '' }]);
    fireEvent.click(screen.getByRole('button', { name: '初期辞書に戻す' }));
    await answer('続行');
    expect(dict(settings)).toEqual(defaultPartNameDictionary());
  });
});

describe('Auto Assign への接続', () => {
  const run = async (settings: SettingsStore) => {
    const store = new EditorStore();
    store.load(qbd, 'a.qbd');
    const a = createPluginsKitsActions(
      store, { confirm: async () => true, onError: () => undefined }, () => settings.getSnapshot().settings.partNameDictionary,
    );
    a.selectPlugin(0);
    a.selectKit(0);
    await a.autoAssign();
    return store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[0]!.ArticulationID;
  };

  it('初期辞書では別名 BD が Kick に解決され、割り当てられる', async () => {
    expect(await run(new SettingsStore(new MemoryStorage()))).toBe(1);
  });

  it('辞書を編集すると、次の Auto Assign 実行から反映される（同じストアのまま）', async () => {
    const settings = new SettingsStore(new MemoryStorage());
    settings.update({ partNameDictionary: [{ CanonicalName: 'Kick', Aliases: '' }] });
    expect(await run(settings)).toBe(0);
    settings.update({ partNameDictionary: [{ CanonicalName: 'Kick', Aliases: 'BD' }] });
    expect(await run(settings)).toBe(1);
  });

  it('空の辞書でも実行でき、辞書による照合は行わない', async () => {
    const settings = new SettingsStore(new MemoryStorage());
    settings.update({ partNameDictionary: [] });
    expect(await run(settings)).toBe(0);
  });

  it('AppShell 経由でも設定の辞書が使われる（辞書が空なら割り当てない／初期辞書なら割り当てる）', async () => {
    for (const [dictionary, expected] of [[[], 0], [defaultPartNameDictionary(), 1]] as const) {
      const store = new EditorStore();
      store.load(qbd, 'a.qbd');
      const settings = new SettingsStore(new MemoryStorage());
      settings.update({ partNameDictionary: [...dictionary] });
      const view = render(<AppShell store={store} io={io} settings={settings} />);
      fireEvent.click(await screen.findByText('P'));
      fireEvent.click(await screen.findByText('K1'));
      fireEvent.click(await screen.findByRole('button', { name: 'Articulation を自動割当' }));
      await answer('続行');
      expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[0]!.ArticulationID).toBe(expected);
      view.unmount();
    }
  });
});
