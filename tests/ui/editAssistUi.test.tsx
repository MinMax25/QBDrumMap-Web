// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { createPluginsKitsActions, type EditorUi } from '../../src/ui/editor/pluginsKitsActions';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo } from '../../src/ui/services/fileIo';
import type { QbdError } from '../../src/core';

afterEach(cleanup);

interface Row { Pitch: number; Name: string | null; ArticulationID?: number; Separator?: string | number }

/** Plugin 'GM'（GM）に K1・K2、Part: Kick(ID1)/Snare(ID2) */
function json(k1: Row[], k2: Row[] = []): string {
  const mk = (rows: Row[]) => rows.map((r) => ({ ArticulationID: 0, ...r }));
  return JSON.stringify({
    AppName: 'QBDrumMap', ModelVersion: '1.0.0',
    Plugins: [{
      ID: 1, Name: 'GM', PluginType: 'None', MidiOutDevice: '', SoundCheckChannel: 'Channel10',
      Kits: [{ ID: 1, Name: 'K1', Pitches: mk(k1) }, { ID: 2, Name: 'K2', Pitches: mk(k2) }],
    }],
    Parts: [
      { ID: 1, Name: 'Kick', ScorePitch: 36, Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] },
      { ID: 2, Name: 'Snare', ScorePitch: 38, Articulations: [{ ID: 2, Name: 'Snare', DrumMapOrder: 2 }] },
    ],
  });
}

const messy: Row[] = [
  { Pitch: 38, Name: 'Snare' }, { Pitch: 36, Name: 'Kick' }, { Pitch: 40, Name: null }, { Pitch: 37, Name: 'x' },
];
const other: Row[] = [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }, { Pitch: 38, Name: 'Snare', ArticulationID: 2, Separator: 'Separate' }];

function actionsFor(text: string, confirmAnswer = true) {
  const store = new EditorStore();
  expect(store.load(text, 'a.qbd').ok).toBe(true);
  const errors: QbdError[] = [];
  const notices: string[] = [];
  const confirm = vi.fn(async () => confirmAnswer);
  const ui: EditorUi = { confirm, onError: (e) => errors.push(e), notify: (m) => notices.push(m) };
  const a = createPluginsKitsActions(store, ui);
  a.selectPlugin(0);
  a.selectKit(0);
  return { store, errors, notices, confirm, a };
}
const snap = (s: EditorStore) => s.getSnapshot();
const k1 = (s: EditorStore) => snap(s).map.Plugins[0]!.Kits[0]!.Pitches;

describe('Reset Order / Compress Forward の操作層', () => {
  it('Reset Order: 確認のあと1操作で整列し、Undo 1 回で戻る。選択は Pitch 番号で追従する', async () => {
    const { store, a, confirm } = actionsFor(json(messy));
    a.selectPitch(0); // Pitch 38
    expect(await a.resetOrderByPitch()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(k1(store).map((p) => p.Pitch)).toEqual([36, 37, 38, 40]);
    expect(snap(store).historyLength).toBe(1);
    expect(snap(store).dirty).toBe(true);
    expect(snap(store).selection.pitchIndices.map((i) => k1(store)[i]!.Pitch)).toEqual([38]);
    store.undo();
    expect(k1(store).map((p) => p.Pitch)).toEqual([38, 36, 40, 37]);
    expect(snap(store).dirty).toBe(false);
    expect(snap(store).selection.pitchIndices.map((i) => k1(store)[i]!.Pitch)).toEqual([38]);
  });

  it('Compress Forward: 1操作で前詰めし、Undo 1 回で戻る。選択は Pitch 番号で追従する', async () => {
    const { store, a } = actionsFor(json(messy));
    a.selectPitch(3); // Pitch 37 ('x')
    expect(await a.compressForward()).toBe(true);
    expect(k1(store).map((p) => p.Pitch)).toEqual([38, 36, 37, 40]);
    expect(snap(store).historyLength).toBe(1);
    expect(snap(store).selection.pitchIndices.map((i) => k1(store)[i]!.Pitch)).toEqual([37]);
    store.undo();
    expect(k1(store).map((p) => p.Pitch)).toEqual([38, 36, 40, 37]);
  });

  it('キャンセル・変更なし・Kit 未選択では履歴を増やさない', async () => {
    const cancel = actionsFor(json(messy), false);
    expect(await cancel.a.resetOrderByPitch()).toBe(false);
    expect(await cancel.a.compressForward()).toBe(false);
    expect(snap(cancel.store).historyLength).toBe(0);
    expect(snap(cancel.store).dirty).toBe(false);

    const sorted = actionsFor(json([{ Pitch: 1, Name: 'a' }, { Pitch: 2, Name: null }]));
    expect(await sorted.a.resetOrderByPitch()).toBe(false);
    expect(await sorted.a.compressForward()).toBe(false);
    expect(snap(sorted.store).historyLength).toBe(0);

    const none = actionsFor(json(messy));
    none.store.select({ kitIndex: null, kitIndices: [] });
    expect(await none.a.resetOrderByPitch()).toBe(false);
    expect(none.confirm).not.toHaveBeenCalled();
  });
});

describe('Copy Articulation の操作層', () => {
  it('他の Kit から Pitch 番号で対応づけてコピーし、1操作・Undo 1 回。結果を通知する', async () => {
    const { store, a, notices } = actionsFor(json(messy, other));
    expect(await a.copyArticulation({ pluginIndex: 0, kitIndex: 1 })).toBe(true);
    expect(k1(store).map((p) => [p.Pitch, p.ArticulationID, p.Separator])).toEqual([
      [38, 2, 'Separate'], [36, 1, 'None'], [40, 0, 'None'], [37, 0, 'None'],
    ]);
    expect(snap(store).historyLength).toBe(1);
    expect(notices.at(-1)).toMatch(/2 行をコピー/);
    expect(notices.at(-1)).toMatch(/1 行はコピー元に同じ Pitch の行がないため変更していません/);
    store.undo();
    expect(k1(store).every((p) => p.ArticulationID === 0)).toBe(true);
    expect(snap(store).dirty).toBe(false);
  });

  it('曖昧なケース（同じ Pitch が複数）は失敗を通知し、モデル・履歴・Dirty を変えない', async () => {
    const dup: Row[] = [{ Pitch: 36, Name: 'a', ArticulationID: 1 }, { Pitch: 36, Name: 'b', ArticulationID: 2 }];
    const { store, a, errors } = actionsFor(json(messy, dup));
    const before = snap(store);
    expect(await a.copyArticulation({ pluginIndex: 0, kitIndex: 1 })).toBe(false);
    expect(errors.map((e) => e.code)).toEqual(['ambiguous-pitch']);
    expect(snap(store)).toBe(before);
  });

  it('同じ Kit を指定すると失敗し、キャンセルでは何も起きない', async () => {
    const same = actionsFor(json(messy, other));
    expect(await same.a.copyArticulation({ pluginIndex: 0, kitIndex: 0 })).toBe(false);
    expect(same.errors.map((e) => e.code)).toEqual(['same-kit']);
    expect(snap(same.store).historyLength).toBe(0);

    const cancel = actionsFor(json(messy, other), false);
    expect(await cancel.a.copyArticulation({ pluginIndex: 0, kitIndex: 1 })).toBe(false);
    expect(snap(cancel.store).historyLength).toBe(0);
  });

  it('変更がなければ履歴を増やさず「変更はありません」と通知する', async () => {
    const { store, a, notices } = actionsFor(json([{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }], other));
    expect(await a.copyArticulation({ pluginIndex: 0, kitIndex: 1 })).toBe(false);
    expect(snap(store).historyLength).toBe(0);
    expect(notices.at(-1)).toMatch(/^変更はありません/);
  });
});

describe('Auto Assign の操作層', () => {
  const target: Row[] = [{ Pitch: 36, Name: 'Kick' }, { Pitch: 38, Name: 'Snare' }, { Pitch: 41, Name: 'zzz unknown' }];

  it('確認のあと1操作で割り当て、件数を通知する。Undo 1 回で戻り、Redo で再適用する', async () => {
    const { store, a, notices } = actionsFor(json(target, other));
    expect(await a.autoAssign()).toBe(true);
    expect(k1(store).map((p) => p.ArticulationID)).toEqual([1, 2, 0]);
    expect(k1(store)[2]!.Separator).toBe('Separate');
    expect(snap(store).historyLength).toBe(1);
    expect(snap(store).dirty).toBe(true);
    expect(notices.at(-1)).toMatch(/2 行に割り当てました。1 行は一致する候補がなく/);
    store.undo();
    expect(k1(store).map((p) => [p.ArticulationID, p.Separator])).toEqual([[0, 'None'], [0, 'None'], [0, 'None']]);
    expect(snap(store).dirty).toBe(false);
    store.redo();
    expect(k1(store).map((p) => p.ArticulationID)).toEqual([1, 2, 0]);
  });

  it('既定は web モード: Unload の行は Separate で上書きしない', async () => {
    const { store, a } = actionsFor(json([{ Pitch: 41, Name: 'zzz', Separator: 'Unload' }], other));
    expect(await a.autoAssign()).toBe(false); // 変更なし
    expect(k1(store)[0]!.Separator).toBe('Unload');
    expect(snap(store).historyLength).toBe(0);
  });

  it('変更なし・キャンセル・Kit 未選択では履歴を増やさない', async () => {
    const none = actionsFor(json([{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }], other));
    expect(await none.a.autoAssign()).toBe(false);
    expect(snap(none.store).historyLength).toBe(0);
    expect(none.notices.at(-1)).toMatch(/^変更はありません/);

    const cancel = actionsFor(json(target, other), false);
    expect(await cancel.a.autoAssign()).toBe(false);
    expect(snap(cancel.store).historyLength).toBe(0);
    expect(cancel.notices).toEqual([]);

    const noKit = actionsFor(json(target, other));
    noKit.store.select({ kitIndex: null, kitIndices: [] });
    expect(await noKit.a.autoAssign()).toBe(false);
    expect(noKit.confirm).not.toHaveBeenCalled();
  });

  it('未定義の Separator 値があっても自動修正せず、件数を通知に添える', async () => {
    const rows: Row[] = [{ Pitch: 36, Name: 'Kick' }, { Pitch: 38, Name: 'Snare', ArticulationID: 2, Separator: 9 }];
    const { store, a, notices } = actionsFor(json(rows, other));
    expect(await a.autoAssign()).toBe(true);
    expect(k1(store)[1]!.Separator).toBe(9);
    expect(notices.at(-1)).toMatch(/未定義の Separator 値が 1 行あります（自動修正していません）/);
  });
});

describe('Name の Trim（UI からの確定）', () => {
  it('Plugin 名を前後に空白つきで確定すると Trim され、履歴は1件。Trim しても同じ名前なら履歴を積まない', () => {
    const { store, a } = actionsFor(json(messy));
    expect(a.updatePlugin(0, { Name: '  Renamed  ' })).toBe(true);
    expect(snap(store).map.Plugins[0]!.Name).toBe('Renamed');
    expect(snap(store).historyLength).toBe(1);
    expect(a.updatePlugin(0, { Name: ' Renamed ' })).toBe(false);
    expect(snap(store).historyLength).toBe(1);
    store.undo();
    expect(snap(store).map.Plugins[0]!.Name).toBe('GM');
  });
});

describe('画面操作（AppShell）', () => {
  const nullIo: FileIo = { openText: async () => null, saveText: () => undefined };
  function setup(k1rows: Row[], k2rows: Row[] = []) {
    const store = new EditorStore();
    store.load(json(k1rows, k2rows), 'a.qbd');
    render(<AppShell store={store} io={nullIo} />);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('K1'));
    return store;
  }
  const confirmDialog = async (button: '続行' | 'キャンセル') => {
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: button }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };
  const tools = () => screen.getByRole('group', { name: '編集補助' });
  const pitchCells = () => within(screen.getByRole('table', { name: 'Pitch 表' })).getAllByRole('row').slice(2).map((r) => r.querySelector('.pt-pitch')!.textContent);

  it('「Pitch 順に並べ替え」: 確認ダイアログのキャンセルでは並びが変わらず、続行で整列する', async () => {
    const store = setup(messy);
    fireEvent.click(within(tools()).getByRole('button', { name: '整列' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pitch 順に並べ替え' }));
    await confirmDialog('キャンセル');
    expect(pitchCells()).toEqual(['38', '36', '40', '37']);
    expect(snap(store).historyLength).toBe(0);
    fireEvent.click(within(tools()).getByRole('button', { name: '整列' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pitch 順に並べ替え' }));
    await confirmDialog('続行');
    expect(pitchCells()).toEqual(['36', '37', '38', '40']);
    expect(snap(store).historyLength).toBe(1);
  });

  it('「空の行を後ろへ詰める」: 続行で Name のある行が前に来る', async () => {
    setup(messy);
    fireEvent.click(within(tools()).getByRole('button', { name: '整列' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '空の行を後ろへ詰める' }));
    await confirmDialog('続行');
    expect(pitchCells()).toEqual(['38', '36', '37', '40']);
  });

  it('「Articulation をコピー…」: コピー元 Kit を選ぶまでコピーできず、現在の Kit は候補に出ない。コピー後に結果が通知される', async () => {
    const store = setup(messy, other);
    fireEvent.click(within(tools()).getByRole('button', { name: 'Articulation をコピー…' }));
    const dlg = await screen.findByRole('dialog');
    const copyBtn = within(dlg).getByRole('button', { name: 'コピー' }) as HTMLButtonElement;
    expect(copyBtn.disabled).toBe(true);
    fireEvent.mouseDown(within(dlg).getByRole('combobox'));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['GM / K2']);
    fireEvent.click(within(screen.getByRole('listbox')).getByText('GM / K2'));
    fireEvent.click(within(dlg).getByRole('button', { name: 'コピー' }));
    await confirmDialog('続行');
    await screen.findByText(/2 行をコピーしました/);
    expect(snap(store).map.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.ArticulationID)).toEqual([2, 1, 0, 0]);
    expect(snap(store).historyLength).toBe(1);
  });

  it('「Articulation を自動割当」: 続行で適用され、件数が通知される。Undo ボタンで戻る', async () => {
    const store = setup([{ Pitch: 36, Name: 'Kick' }, { Pitch: 38, Name: 'Snare' }], other);
    fireEvent.click(within(tools()).getByRole('button', { name: 'Articulation を自動割当' }));
    await confirmDialog('続行');
    await screen.findByText(/2 行に割り当てました/);
    expect(snap(store).map.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.ArticulationID)).toEqual([1, 2]);
    expect(snap(store).historyLength).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /元に戻す|Undo/ }));
    expect(snap(store).map.Plugins[0]!.Kits[0]!.Pitches.map((p) => p.ArticulationID)).toEqual([0, 0]);
  });
});
