// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo, OpenedBinary } from '../../src/ui/services/fileIo';
import { SettingsStore, type StorageLike } from '../../src/ui/settings/settingsStore';
import { SETTINGS_STORAGE_KEY } from '../../src/ui/settings/appSettings';
import { convertMidi, defaultPartNameDictionary, exportKits, parseQbd, type ExportSettings, type KitRef } from '../../src/core';

afterEach(cleanup);

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const vl = (n: number): number[] => {
  const o = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) o.unshift((n & 0x7f) | 0x80);
  return o;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const smf = (events: [number, number[]][], format = 0): Uint8Array => {
  let last = 0;
  const body = events.flatMap(([t, b]) => { const d = vl(t - last); last = t; return [...d, ...b]; });
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, ...be32(body.length), ...body]);
};
const midiBytes = smf([[0, [0x99, 36, 100]], [240, [0x89, 36, 0]], [240, [0x99, 38, 100]], [480, [0x89, 38, 0]]]);

const qbd = JSON.stringify({
  Plugins: [
    { ID: 1, Name: 'GM', Kits: [
      { ID: 1, Name: 'K1', Pitches: [{ Pitch: 36, Name: 'p36', ArticulationID: 1 }, { Pitch: 38, Name: 'p38', ArticulationID: 2 }] },
      { ID: 2, Name: 'K2', Pitches: [{ Pitch: 60, Name: 'q60', ArticulationID: 1 }, { Pitch: 61, Name: 'q61', ArticulationID: 2 }] },
    ] },
    { ID: 2, Name: 'P2', Kits: [{ ID: 3, Name: 'K1', Pitches: [{ Pitch: 1, Name: 'x', ArticulationID: 1 }] }] },
  ],
  Parts: [
    { ID: 1, Name: 'Kick', ScorePitch: 5, Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] },
    { ID: 2, Name: 'Snare', ScorePitch: 7, Articulations: [{ ID: 2, Name: 'Snare', DrumMapOrder: 2 }] },
  ],
});
const map0 = (() => { const r = parseQbd(qbd); if (!r.ok) throw new Error('x'); return r.value; })();

interface Log { saved: { name: string; bytes: Uint8Array; mime: string }[] }
function setup(opts: { storage?: StorageLike | null; midi?: OpenedBinary | null | 'throw'; settings?: SettingsStore; store?: EditorStore } = {}) {
  const store = opts.store ?? new EditorStore();
  if (!opts.store) store.load(qbd, 'a.qbd');
  const settings = opts.settings ?? new SettingsStore(opts.storage === undefined ? new MemoryStorage() : opts.storage);
  const log: Log = { saved: [] };
  const io: FileIo = {
    openText: async () => null, saveText: () => undefined,
    openBinary: async () => { if (opts.midi === 'throw') throw new Error('read failed'); return opts.midi ?? null; },
    saveBytes: (name, bytes, mime) => { log.saved.push({ name, bytes, mime }); },
  };
  const ui = render(<AppShell store={store} io={io} settings={settings} />);
  return { store, settings, log, ui };
}
const nav = (label: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'ページ' })).getByText(label));
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const k1: KitRef = { pluginIndex: 0, kitIndex: 0 };

describe('Settings ページ', () => {
  it('現在値を表示し、変更すると保存され、再読み込み（新しいストア）で復元される', () => {
    const st = new MemoryStorage();
    setup({ storage: st });
    nav('Settings');
    const ua = screen.getByLabelText('UseArticulation') as HTMLInputElement;
    expect(ua.checked).toBe(true);
    fireEvent.click(ua);
    fireEvent.click(screen.getByLabelText('UseArticulationPitchName'));
    expect(st.getItem(SETTINGS_STORAGE_KEY)).toContain('"useArticulation":false');
    cleanup();
    setup({ storage: st });
    nav('Settings');
    expect((screen.getByLabelText('UseArticulation') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('UseArticulationPitchName') as HTMLInputElement).checked).toBe(false);
  });

  it('既定値に戻す', () => {
    const { settings } = setup();
    settings.update({ useArticulation: false, convertMidiFormat: 0 });
    nav('Settings');
    fireEvent.click(screen.getByRole('button', { name: '既定値に戻す' }));
    expect(settings.getSnapshot().settings).toEqual({ useArticulation: true, useArticulationPitchName: true, convertMidiFormat: 1, theme: 'dark', partNameDictionary: defaultPartNameDictionary() });
  });

  it('ストレージが使えないときは、その旨を表示しつつメモリ上で動作を続ける', () => {
    const { settings } = setup({ storage: null });
    nav('Settings');
    expect(screen.getByTestId('settings-not-persistent').textContent).toContain('保存できません');
    fireEvent.click(screen.getByLabelText('UseArticulation'));
    expect(settings.getSnapshot().settings.useArticulation).toBe(false);
  });

  it('保存の失敗（例外）でも通知が出る。壊れた保存データでは既定値で起動し、その旨を表示する', () => {
    const failing: StorageLike = { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new Error('quota'); } };
    setup({ storage: failing });
    nav('Settings');
    expect(screen.queryByTestId('settings-not-persistent')).toBeNull();
    fireEvent.click(screen.getByLabelText('UseArticulation'));
    expect(screen.getByTestId('settings-not-persistent').textContent).toContain('quota');
    cleanup();
    const bad = new MemoryStorage();
    bad.data.set(SETTINGS_STORAGE_KEY, '{broken');
    setup({ storage: bad });
    nav('Settings');
    expect(screen.getByText(/既定値に戻しました/)).toBeTruthy();
    expect((screen.getByLabelText('UseArticulation') as HTMLInputElement).checked).toBe(true);
  });

  it('設定の変更・復元は QBD の Dirty・Undo/Redo・内容に影響しない', () => {
    const { store, settings } = setup();
    const before = store.getSnapshot();
    nav('Settings');
    fireEvent.click(screen.getByLabelText('UseArticulation'));
    fireEvent.click(screen.getByRole('button', { name: '既定値に戻す' }));
    settings.update({ convertMidiFormat: 0 });
    const after = store.getSnapshot();
    expect(after.map).toBe(before.map);
    expect(after.dirty).toBe(false);
    expect(after.historyLength).toBe(0);
    expect(after.canUndo).toBe(false);
  });
});

describe('Export への設定の反映', () => {
  const combos: ExportSettings[] = [
    { useArticulation: true, useArticulationPitchName: true }, { useArticulation: true, useArticulationPitchName: false },
    { useArticulation: false, useArticulationPitchName: true }, { useArticulation: false, useArticulationPitchName: false },
  ];

  it('4 通りの組合せすべてで、Studio One の出力が Core にその設定を渡した結果と一致し、画面に現在値が表示される', () => {
    for (const c of combos) {
      cleanup();
      const { log, settings } = setup();
      settings.update(c);
      nav('Export');
      expect(screen.getByTestId('export-settings').textContent).toContain(`UseArticulation = ${c.useArticulation}`);
      expect(screen.getByTestId('export-settings').textContent).toContain(`UseArticulationPitchName = ${c.useArticulationPitchName}`);
      fireEvent.click(screen.getAllByRole('checkbox', { name: 'K1' })[0]!);
      fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
      const core = exportKits(map0, 'studioOne', [k1], c);
      if (!core.ok) throw new Error('x');
      expect(text(log.saved[0]!.bytes.slice(3))).toBe(core.value[0]!.content);
    }
    // 設定によって内容が実際に変わる
    const a = exportKits(map0, 'studioOne', [k1], combos[0]!);
    const b = exportKits(map0, 'studioOne', [k1], combos[1]!);
    const c = exportKits(map0, 'studioOne', [k1], combos[2]!);
    if (!a.ok || !b.ok || !c.ok) throw new Error('x');
    expect(a.value[0]!.content).not.toBe(b.value[0]!.content);
    expect(a.value[0]!.content).not.toBe(c.value[0]!.content);
  });

  it('画面遷移をはさんで設定を変えて続けて出力すると、毎回その時点の設定が使われる（古い値は残らない）', () => {
    const { log } = setup();
    nav('Export');
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'K1' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    nav('Settings');
    fireEvent.click(screen.getByLabelText('UseArticulationPitchName'));
    nav('Export');
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'K1' })[0]!); // ページを離れると選択は初期化される
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    nav('Settings');
    fireEvent.click(screen.getByLabelText('UseArticulation'));
    nav('Export');
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'K1' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    const expected = [combos[0]!, combos[1]!, combos[3]!].map((c) => {
      const r = exportKits(map0, 'studioOne', [k1], c);
      if (!r.ok) throw new Error('x');
      return r.value[0]!.content;
    });
    expect(log.saved.map((s) => text(s.bytes.slice(3)))).toEqual(expected);
    expect(new Set(expected).size).toBe(3);
  });

  /** ZIP（stored）のローカルヘッダーを順に読む */
  const unzip = (z: Uint8Array): { path: string; bytes: Uint8Array }[] => {
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    const out: { path: string; bytes: Uint8Array }[] = [];
    for (let off = 0; dv.getUint32(off, true) === 0x04034b50;) {
      const size = dv.getUint32(off + 18, true);
      const n = dv.getUint16(off + 26, true);
      out.push({ path: text(z.slice(off + 30, off + 30 + n)), bytes: z.slice(off + 30 + n, off + 30 + n + size) });
      off += 30 + n + size;
    }
    return out;
  };

  it('複数 Kit（ZIP）・Base-On・NoteMapper・TSV・QB Drummer にも、設定した値が Core に渡る', () => {
    const off: ExportSettings = { useArticulation: false, useArticulationPitchName: false };
    const { log, settings } = setup();
    settings.update(off);
    nav('Export');
    const choose = (label: string) => {
      fireEvent.mouseDown(screen.getByRole('combobox', { name: '出力形式' }));
      fireEvent.click(within(screen.getByRole('listbox')).getByText(label));
    };
    const run = () => fireEvent.click(screen.getByRole('button', { name: 'Export を実行' }));
    const k2: KitRef = { pluginIndex: 0, kitIndex: 1 };
    // 複数 Kit（ZIP）: GM の K1・K2（同名 Kit を避ける）
    fireEvent.click(screen.getByRole('checkbox', { name: /^GM（2）$/ }));
    for (const [label, format] of [['Studio One .pitchlist', 'studioOne'], ['Cubase .drm', 'cubase'], ['Text .tsv', 'tsv'], ['QB Drummer プリセット .csv', 'qbDrummer']] as const) {
      choose(label);
      run();
      const zip = unzip(log.saved.at(-1)!.bytes);
      const core = exportKits(map0, format, [k1, k2], off);
      if (!core.ok) throw new Error('x');
      expect(zip.map((f) => f.path)).toEqual(core.value.map((f) => f.path));
      core.value.forEach((f, i) => expect(text(zip[i]!.bytes.slice(f.bom ? 3 : 0))).toBe(f.content));
    }
    // Base-On は 1 Kit（K1）を Base K2 から変換
    fireEvent.click(screen.getByRole('checkbox', { name: /^GM（2）$/ })); // 全解除
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'K1' })[0]!);
    choose('Cubase .drm（Base-On）');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Base Kit' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('GM / K2'));
    run();
    const bo = exportKits(map0, 'cubaseBaseOn', [k1], off, { baseOn: k2 });
    if (!bo.ok) throw new Error('x');
    expect(text(log.saved.at(-1)!.bytes.slice(3))).toBe(bo.value[0]!.content);
    // 設定を戻すと Base-On の出力が変わる（設定が毎回その時点で使われる）
    const on = exportKits(map0, 'cubaseBaseOn', [k1], { useArticulation: true, useArticulationPitchName: true }, { baseOn: k2 });
    if (!on.ok) throw new Error('x');
    expect(on.value[0]!.content).not.toBe(bo.value[0]!.content);
  });
});

describe('Convert MIDI ページ', () => {
  const pick = async (midi: OpenedBinary | null | 'throw' = { name: 'song.mid', bytes: midiBytes }, settings?: SettingsStore) => {
    const env = setup({ midi, settings });
    nav('Convert MIDI');
    fireEvent.click(screen.getByRole('button', { name: /MIDI ファイルを選ぶ/ }));
    if (midi && midi !== 'throw') await screen.findByText(/song\.mid/);
    return env;
  };
  const chooseBase = (label: string) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Base Kit' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(label));
  };
  const convertBtn = () => screen.getByRole('button', { name: 'MIDI を変換' }) as HTMLButtonElement;
  const kit = (n: string, i = 0) => screen.getAllByRole('checkbox', { name: n })[i]!;

  it('ファイル・Base Kit・変換先がそろうまで実行できず、理由を表示する', async () => {
    await pick();
    expect(convertBtn().disabled).toBe(true);
    chooseBase('GM / K1');
    expect(screen.getByRole('status').textContent).toContain('変換先の Kit');
    fireEvent.click(kit('K2'));
    expect(convertBtn().disabled).toBe(false);
  });

  it('Format 1（既定）: 1 ファイルをダウンロードし、Core の出力と一致。モデル・Undo・Dirty・選択は不変', async () => {
    const { store, log } = await pick();
    store.select({ pluginIndex: 0, kitIndex: 1 });
    const before = store.getSnapshot();
    chooseBase('GM / K1');
    fireEvent.click(kit('K2'));
    expect(screen.getByTestId('midi-summary').textContent).toContain('Format 1');
    fireEvent.click(convertBtn());
    const core = convertMidi(map0, k1, [{ pluginIndex: 0, kitIndex: 1 }], midiBytes, 'song.mid', { format: 1 });
    if (!core.ok) throw new Error('x');
    expect(log.saved).toHaveLength(1);
    expect(log.saved[0]!.name).toBe('song Converted.mid');
    expect(log.saved[0]!.bytes).toEqual(core.value.files[0]!.bytes);
    expect(screen.getByTestId('midi-result')).toBeTruthy();
    const after = store.getSnapshot();
    expect(after.map).toBe(before.map);
    expect(after.dirty).toBe(false);
    expect(after.historyLength).toBe(0);
    expect(after.selection).toEqual(before.selection);
  });

  it('Settings の Format 0 では ZIP（Core のファイル群を保持）。変換モードの選択・Windows 互換の注意は存在しない', async () => {
    const settings = new SettingsStore(new MemoryStorage());
    settings.update({ convertMidiFormat: 0 });
    const { log } = await pick(undefined, settings);
    chooseBase('GM / K1');
    fireEvent.click(kit('K2'));
    expect(screen.getByTestId('midi-summary').textContent).toContain('Format 0');
    expect(screen.queryByTestId('windows-mode-notes')).toBeNull();
    expect(screen.queryByLabelText('Windows 互換')).toBeNull();
    expect(screen.queryByLabelText(/Web 改善/)).toBeNull();
    expect(screen.queryByText('変換モード')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(convertBtn());
    const core = convertMidi(map0, k1, [{ pluginIndex: 0, kitIndex: 1 }], midiBytes, 'song.mid', { format: 0 });
    if (!core.ok) throw new Error('x');
    expect(log.saved[0]!.name).toBe(core.value.archiveName);
    expect(log.saved[0]!.mime).toBe('application/zip');
    expect(screen.getByTestId('midi-result').textContent).toContain(core.value.files[0]!.path);
  });

  it('同名 Kit（P2 / K1 は GM / K1 と同名）を変換先に選ぶと中止し、原因を表示する。何も出力しない', async () => {
    const { log, store } = await pick();
    chooseBase('GM / K2');
    fireEvent.click(kit('K1', 1));
    fireEvent.click(convertBtn());
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain('P2 / K1');
    expect(dlg.textContent).toContain('GM / K1');
    expect(log.saved).toHaveLength(0);
    expect(store.getSnapshot().historyLength).toBe(0);
  });

  it('Format 2・壊れた MIDI はエラーを表示して何も出力しない。読み取り失敗・ファイル選択キャンセルも安全', async () => {
    const f2 = await pick({ name: 'song.mid', bytes: smf([[0, [0x99, 36, 100]]], 2) });
    chooseBase('GM / K1');
    fireEvent.click(kit('K2'));
    fireEvent.click(convertBtn());
    expect((await screen.findByRole('dialog')).textContent).toContain('対応していません');
    expect(f2.log.saved).toHaveLength(0);
    cleanup();

    const broken = await pick({ name: 'song.mid', bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) });
    chooseBase('GM / K1');
    fireEvent.click(kit('K2'));
    fireEvent.click(convertBtn());
    expect((await screen.findByRole('dialog')).textContent).toContain('ヘッダー');
    expect(broken.log.saved).toHaveLength(0);
    cleanup();

    await pick('throw');
    expect((await screen.findByRole('dialog')).textContent).toContain('読み込めませんでした');
    cleanup();

    const none = await pick(null);
    expect(screen.getByTestId('midi-file').textContent).toContain('未選択');
    expect(none.store.getSnapshot().historyLength).toBe(0);
  });

  it('連続実行できる（設定を変えた 2 回目は 2 回目の設定で出力される）', async () => {
    const settings = new SettingsStore(new MemoryStorage());
    const { log } = await pick(undefined, settings);
    chooseBase('GM / K1');
    fireEvent.click(kit('K2'));
    fireEvent.click(convertBtn());
    settings.update({ convertMidiFormat: 0 });
    await waitFor(() => expect(screen.getByTestId('midi-summary').textContent).toContain('Format 0'));
    fireEvent.click(convertBtn());
    expect(log.saved.map((s) => s.mime)).toEqual(['audio/midi', 'application/zip']);
  });

  it('ダウンロード開始に失敗した場合は成功表示を出さない', async () => {
    const store = new EditorStore();
    store.load(qbd, 'a.qbd');
    const io: FileIo = {
      openText: async () => null, saveText: () => undefined, openBinary: async () => ({ name: 'song.mid', bytes: midiBytes }),
      saveBytes: () => { throw new Error('blocked'); },
    };
    render(<AppShell store={store} io={io} settings={new SettingsStore(null)} />);
    nav('Convert MIDI');
    fireEvent.click(screen.getByRole('button', { name: /MIDI ファイルを選ぶ/ }));
    await screen.findByText(/song\.mid/);
    chooseBase('GM / K1');
    fireEvent.click(kit('K2'));
    fireEvent.click(convertBtn());
    expect((await screen.findByRole('dialog')).textContent).toContain('ダウンロードを開始できませんでした');
    expect(screen.queryByTestId('midi-result')).toBeNull();
  });
});
