// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import { SettingsStore } from '../../src/ui/settings/settingsStore';
import type { FileIo, OpenedFile } from '../../src/ui/services/fileIo';
import { CRLF, cloneMap, parseQbd, type MapData } from '../../src/core';
import { importConfirmText, planImport, detectImportFormat } from '../../src/ui/editor/importPlan';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

const pitchlist = (title: string, items: [number, string][]): string =>
  [`<?xml version="1.0" encoding="utf-8"?>`, `<Music.PitchNameList title="${title}">`,
    ...items.map(([p, n]) => `\t<Music.PitchName pitch="${p}" name="${n}"/>`), '</Music.PitchNameList>', ''].join(CRLF);

interface IoLog { saved: { name: string; bytes: Uint8Array; mime: string }[]; opened: number }
function makeIo(file: OpenedFile | null): { io: FileIo; log: IoLog } {
  const log: IoLog = { saved: [], opened: 0 };
  const io: FileIo = {
    openText: async () => { log.opened++; return file; },
    saveText: () => undefined,
    saveBytes: (name, bytes, mime) => { log.saved.push({ name, bytes, mime }); },
  };
  return { io, log };
}

function setup(file: OpenedFile | null, text: string = gmSmall) {
  const store = new EditorStore();
  store.load(text, 'a.qbd');
  const { io, log } = makeIo(file);
  render(<AppShell store={store} io={io} settings={new SettingsStore(null)} />);
  return { store, log };
}
const selectGmKit = () => {
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
  fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('GM Kit'));
};
const importBtn = () => screen.getByRole('button', { name: /^Import…/ });
const kitOf = (s: EditorStore) => s.getSnapshot().map.Plugins[0]!.Kits[0]!;

describe('importPlan（純粋関数）', () => {
  const m: MapData = (() => { const r = parseQbd(gmSmall); if (!r.ok) throw new Error('x'); return r.value; })();
  const ref = { pluginIndex: 0, kitIndex: 0 };

  it('拡張子の判定（大文字小文字を区別しない。未対応は null）', () => {
    expect(detectImportFormat('a.PitchList')).toBe('pitchlist');
    expect(detectImportFormat('a.drm')).toBe('drm');
    expect(detectImportFormat('x/y\\a.TSV')).toBe('tsv');
    expect(detectImportFormat('a.txt')).toBeNull();
    expect(detectImportFormat('pitchlist')).toBeNull();
  });

  it('プレビューの件数が適用結果と一致し、入力モデルは変更されない', () => {
    const before = cloneMap(m);
    const r = planImport(m, ref, 'x.pitchlist', pitchlist('Imported', [[36, 'NewKick'], [38, 'Snare']]));
    if (!r.ok) throw new Error(r.error.message);
    expect(m).toEqual(before);
    const pv = r.value.preview;
    const k = r.value.next.Plugins[0]!.Kits[0]!;
    const b = before.Plugins[0]!.Kits[0]!;
    expect(pv.kitNameBefore).toBe('GM Kit');
    expect(pv.kitNameAfter).toBe('Imported');
    expect(pv.rows).toBe(b.Pitches.length);
    expect(pv.nameChanged).toBe(k.Pitches.filter((p, i) => (p.Name ?? '') !== (b.Pitches[i]!.Name ?? '')).length);
    expect(pv.articulationCleared).toBe(k.Pitches.filter((p, i) => b.Pitches[i]!.ArticulationID !== 0 && p.ArticulationID === 0).length);
    expect(pv.articulationCleared).toBeGreaterThan(0);
    expect(pv.duplicateKitNames).toEqual([]);
  });

  it('同名の Kit がある場合は重複警告を出し、確認文に保存時の検証エラーの説明を含める', () => {
    const two = parseQbd(JSON.stringify({
      Plugins: [{ ID: 1, Name: 'P', Kits: [
        { ID: 1, Name: 'Target', Pitches: [{ Pitch: 36, Name: 'a' }] },
        { ID: 2, Name: 'Taken', Pitches: [{ Pitch: 36, Name: 'b' }] },
      ] }],
    }));
    if (!two.ok) throw new Error('x');
    const r = planImport(two.value, ref, 'x.pitchlist', pitchlist('Taken', [[36, 'a']]));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.preview.duplicateKitNames).toEqual(['P / Taken']);
    const t = importConfirmText(r.value.preview);
    expect(t).toContain('「Target」→「Taken」');
    expect(t).toContain('重複');
    expect(t).toContain('保存時の入力検証でエラーになり保存できません');
  });

  it('未対応の拡張子・解析失敗は失敗を返す', () => {
    const a = planImport(m, ref, 'x.txt', 'zzz');
    expect(!a.ok && a.error.code).toBe('unsupported-import-extension');
    const b = planImport(m, ref, 'x.pitchlist', '<broken');
    expect(b.ok).toBe(false);
    const c = planImport(m, ref, 'x.tsv', 'a\tb');
    expect(!c.ok && c.error.code).toBe('invalid-tsv');
  });
});

describe('Import（画面）', () => {
  const file = (name: string, text: string): OpenedFile => ({ name, text });

  it('Kit 未選択では Import ボタンは出ない。Kit を選ぶと出る', () => {
    setup(null);
    expect(screen.queryByRole('button', { name: /^Import…/ })).toBeNull();
    selectGmKit();
    expect(importBtn()).toBeTruthy();
  });

  it('確認ダイアログにプレビュー（Kit 名の変更前後・件数）を表示し、承認すると1回の Undo で完全に戻る', async () => {
    const { store } = setup(file('x.pitchlist', pitchlist('Imported', [[36, 'NewKick'], [38, 'Snare']])));
    selectGmKit();
    const before = store.getSnapshot().map;
    const dirtyBefore = store.getSnapshot().dirty;
    fireEvent.click(importBtn());
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('「GM Kit」→「Imported」');
    expect(dialog.textContent).toContain('Name が変わる行');
    expect(store.getSnapshot().map).toBe(before); // 確認前は変更なし
    fireEvent.click(within(dialog).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(kitOf(store).Name).toBe('Imported'));
    const s = store.getSnapshot();
    expect(s.historyLength).toBe(1);
    expect(s.undoLabel).toBe('Import');
    expect(s.dirty).toBe(true);
    // 他の Kit・Plugin・Part は変更されない／ID は不変
    expect(s.map.Parts).toEqual(before.Parts);
    expect(kitOf(store).ID).toBe(before.Plugins[0]!.Kits[0]!.ID);
    // 選択は同じ Kit に追従したまま
    expect(s.selection.pluginIndex).toBe(0);
    expect(s.selection.kitIndex).toBe(0);
    // 1回の Undo で完全に戻り、Dirty も戻る。Redo で再適用できる
    store.undo();
    expect(store.getSnapshot().map).toBe(before);
    expect(store.getSnapshot().dirty).toBe(dirtyBefore);
    store.redo();
    expect(kitOf(store).Name).toBe('Imported');
  });

  it('キャンセルではモデル・履歴・Dirty を変更しない', async () => {
    const { store } = setup(file('x.pitchlist', pitchlist('Imported', [[36, 'NewKick']])));
    selectGmKit();
    const before = store.getSnapshot().map;
    fireEvent.click(importBtn());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const s = store.getSnapshot();
    expect(s.map).toBe(before);
    expect(s.historyLength).toBe(0);
    expect(s.dirty).toBe(false);
  });

  it('ファイル選択のキャンセル（null）では何も起きない', async () => {
    const { store, log } = setup(null);
    selectGmKit();
    fireEvent.click(importBtn());
    await waitFor(() => expect(log.opened).toBe(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.getSnapshot().historyLength).toBe(0);
  });

  it('解析失敗・未対応の拡張子ではエラーを表示し、モデル・履歴・選択・Dirty は不変', async () => {
    for (const f of [file('x.pitchlist', '<broken'), file('x.txt', 'abc'), file('x.tsv', 'bad header\n')]) {
      cleanup();
      const { store } = setup(f);
      selectGmKit();
      const before = store.getSnapshot();
      fireEvent.click(importBtn());
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('エラー')).toBeTruthy();
      const after = store.getSnapshot();
      expect(after.map).toBe(before.map);
      expect(after.historyLength).toBe(0);
      expect(after.dirty).toBe(false);
      expect(after.selection).toEqual(before.selection);
    }
  });

  it('現在の Kit と同じ内容の取り込み（変更なし）では履歴を積まない', async () => {
    const { store } = setup(file('x.pitchlist', pitchlist('GM Kit', [[0, ''], [36, 'Kick'], [38, 'Snare'], [42, 'Closed HH']])));
    selectGmKit();
    // 先に一度取り込んで、Articulation 等を取り込み後の状態にそろえる
    fireEvent.click(importBtn());
    const d1 = await screen.findByRole('dialog');
    fireEvent.click(within(d1).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(store.getSnapshot().historyLength).toBe(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // 同じファイルをもう一度
    fireEvent.click(importBtn());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(store.getSnapshot().historyLength).toBe(1)); // 増えない
  });

  it('同名の Kit になる取り込みは警告付きで確認でき、保存時の検証エラーになることが示される', async () => {
    const two = JSON.stringify({
      Plugins: [{ ID: 1, Name: 'GM', Kits: [
        { ID: 1, Name: 'GM Kit', Pitches: [{ Pitch: 36, Name: 'Kick' }] },
        { ID: 2, Name: 'Taken', Pitches: [{ Pitch: 36, Name: 'b' }] },
      ] }],
    });
    const { store } = setup(file('x.pitchlist', pitchlist('Taken', [[36, 'Kick']])), two);
    selectGmKit();
    fireEvent.click(importBtn());
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('他の Kit と重複');
    expect(dialog.textContent).toContain('保存時の入力検証でエラー');
    fireEvent.click(within(dialog).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(kitOf(store).Name).toBe('Taken')); // 自動で名前を変えない
  });

  it('確認中にモデルが変更された場合は適用しない', async () => {
    const { store } = setup(file('x.pitchlist', pitchlist('Imported', [[36, 'NewKick']])));
    selectGmKit();
    fireEvent.click(importBtn());
    const dialog = await screen.findByRole('dialog');
    store.edit('other', (m) => ({ ok: true, value: { map: { ...m, AppName: 'changed' }, changed: true } }));
    fireEvent.click(within(dialog).getByRole('button', { name: '続行' }));
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    expect(kitOf(store).Name).toBe('GM Kit');
    expect(store.getSnapshot().historyLength).toBe(1); // 追加した 'other' だけ
  });
});

describe('Export ページ（画面）', () => {
  const openExport = () => fireEvent.click(within(screen.getByRole('navigation', { name: 'ページ' })).getByText('Export'));
  const chooseFormat = (label: string) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '出力形式' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(label));
  };
  const multi = JSON.stringify({
    Plugins: [
      { ID: 1, Name: 'GM', Kits: [
        { ID: 1, Name: 'K1', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }] },
        { ID: 2, Name: 'K2', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1 }] },
      ] },
      { ID: 2, Name: 'Bad', Kits: [{ ID: 3, Name: 'BK', Pitches: [{ Pitch: 36, Name: 'Kick', ArticulationID: 1, Separator: 7 }] }] },
    ],
    Parts: [{ ID: 1, Name: 'Part', Articulations: [{ ID: 1, Name: 'Kick' }] }],
  });

  it('Kit 未選択では Export が無効。出力設定が固定であることを画面に示す', () => {
    setup(null, multi);
    openExport();
    expect((screen.getByRole('button', { name: 'Export を実行' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('export-settings').textContent).toContain('UseArticulation = true');
    expect(screen.getByTestId('export-settings').textContent).toContain('UseArticulationPitchName = true');
  });

  it('1 Kit は単一ファイル、複数 Kit は ZIP でダウンロードを開始し、作業モデル・履歴・Dirty は変わらない', async () => {
    const { store, log } = setup(null, multi);
    openExport();
    const before = store.getSnapshot();
    fireEvent.click(screen.getByRole('checkbox', { name: 'K1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    expect(log.saved.map((s) => s.name)).toEqual(['K1.pitchlist']);
    expect(await screen.findByTestId('export-result')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'K2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    expect(log.saved[1]!.name).toBe('QBDrumMap Export (Studio One).zip');
    expect(log.saved[1]!.mime).toBe('application/zip');
    expect(Array.from(log.saved[1]!.bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const after = store.getSnapshot();
    expect(after.map).toBe(before.map);
    expect(after.historyLength).toBe(0);
    expect(after.dirty).toBe(false);
    expect(screen.getByText(/保存完了は確認できません/)).toBeTruthy();
  });

  it('Base-On 形式は Base Kit を選ぶまで Export が無効', () => {
    setup(null, multi);
    openExport();
    chooseFormat('NoteMapper テンプレート');
    fireEvent.click(screen.getByRole('checkbox', { name: 'K1' }));
    expect((screen.getByRole('button', { name: 'Export を実行' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Base Kit' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('GM / K2'));
    expect((screen.getByRole('button', { name: 'Export を実行' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('未定義 Separator は Plugin・Kit・Pitch・値を示して出力を中止する。対象外の Kit なら出力できる。TSV はブロックしない', async () => {
    const { store, log } = setup(null, multi);
    openExport();
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('出力できません');
    expect(dialog.textContent).toContain('Bad / BK');
    expect(dialog.textContent).toContain('Pitch 36');
    expect(dialog.textContent).toContain('Separator の値 7');
    expect(dialog.textContent).toContain('自動修正されません');
    expect(log.saved).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // 異常な Kit を外すと出力できる
    fireEvent.click(screen.getByRole('checkbox', { name: 'BK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    expect(log.saved).toHaveLength(1);
    // TSV は全 Kit でも出力できる
    chooseFormat('Text .tsv');
    fireEvent.click(screen.getByRole('checkbox', { name: 'BK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    expect(log.saved).toHaveLength(2);
    expect(log.saved[1]!.name).toBe('QBDrumMap Export (Text).zip');
    expect(store.getSnapshot().historyLength).toBe(0);
  });

  it('ダウンロード開始に失敗した場合はエラーを表示し、成功表示を出さない', async () => {
    const store = new EditorStore();
    store.load(multi, 'a.qbd');
    const io: FileIo = {
      openText: async () => null, saveText: () => undefined,
      saveBytes: vi.fn(() => { throw new Error('blocked'); }),
    };
    render(<AppShell store={store} io={io} />);
    openExport();
    fireEvent.click(screen.getByRole('checkbox', { name: 'K1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('ダウンロードを開始できませんでした');
    expect(screen.queryByTestId('export-result')).toBeNull();
  });

  it('キーボード: Kit ツリーの行と Export ボタンはフォーカス可能', () => {
    setup(null, multi);
    openExport();
    fireEvent.click(screen.getByRole('checkbox', { name: 'K1' })); // 対象を選ぶと実行ボタンが有効になる
    // Kit ツリーは行単位で Tab 到達する（フォーカスは 1 行だけ tabIndex=0。矢印キーで移動し、Space で切り替える）
    expect(screen.getAllByRole('treeitem').filter((el) => (el as HTMLElement).tabIndex === 0)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Export を実行' }) as HTMLElement).tabIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('Export ページ: 同名 Kit のブロック', () => {
  it('2つ目の同名 Kit を選ぶと、出力せずに原因の Kit と代わりに使われる Kit を表示する。TSV なら出力できる', async () => {
    const dupText = JSON.stringify({
      Plugins: [
        { ID: 1, Name: 'P1', Kits: [{ ID: 1, Name: 'Dup', Pitches: [{ Pitch: 36, Name: 'First', ArticulationID: 1 }] }] },
        { ID: 2, Name: 'P2', Kits: [{ ID: 2, Name: 'Dup', Pitches: [{ Pitch: 40, Name: 'Second', ArticulationID: 1 }] }] },
      ],
      Parts: [{ ID: 1, Name: 'Part', Articulations: [{ ID: 1, Name: 'Kick' }] }],
    });
    const { io, log } = makeIo(null);
    const store = new EditorStore();
    store.load(dupText, 'a.qbd');
    render(<AppShell store={store} io={io} />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'ページ' })).getByText('Export'));
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('特定できない');
    expect(dialog.textContent).toContain('P2 / Dup');
    expect(dialog.textContent).toContain('「P1 / Dup」の内容が出力されてしまいます');
    expect(log.saved).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '出力形式' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Text .tsv'));
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    expect(log.saved).toHaveLength(1);
  });
});
