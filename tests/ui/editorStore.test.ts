import { describe, expect, it, vi } from 'vitest';
import {
  addKit, addPlugin, autoAssignArticulations, cloneMap, defaultPartNameDictionary, deleteKits, deletePlugins, movePlugins,
  normalizeIds, parseQbd, updateKit, updateKitPitch, updatePlugin, type MapData,
} from '../../src/core';
import { contentKey, DEFAULT_HISTORY_LIMIT, dirtyKey, EditorStore, sanitizeSelection, emptySelection } from '../../src/ui/state/editorStore';
import { brokenJson, gmSmall } from '../fixtures';

const rename = (name: string) => (m: MapData) => {
  const c = cloneMap(m);
  c.Plugins[0]!.Name = name;
  return { ok: true as const, value: c };
};
const renameCore = (name: string) => (m: MapData) => updatePlugin(m, 0, { Name: name });

function loaded(limit?: number): EditorStore {
  const s = new EditorStore(limit);
  expect(s.load(gmSmall, 'a.qbd').ok).toBe(true);
  return s;
}
const mustSave = (s: EditorStore, name = 'x.qbd') => {
  const p = s.prepareSave(name);
  if (!p.ok) throw new Error(p.error.message);
  s.commitSave(p.value);
  return p.value;
};

describe('EditorStore: 読込・新規・保存', () => {
  it('読込成功でモデル・ファイル名が入り、Dirtyでなく、履歴は空', () => {
    const st = loaded().getSnapshot();
    expect(st.map.Plugins).toHaveLength(1);
    expect(st.fileName).toBe('a.qbd');
    expect(st.dirty).toBe(false);
    expect(st.canUndo).toBe(false);
  });

  it('読込失敗は作業モデル・ファイル名・履歴・Dirty・選択を一切変えない', () => {
    const s = loaded();
    s.apply('改名', rename('X'));
    s.select({ pluginIndex: 0, pluginIndices: [0] });
    const before = s.getSnapshot();
    const r = s.load(brokenJson, 'bad.qbd');
    expect(r.ok).toBe(false);
    expect(s.getSnapshot()).toBe(before);
  });

  it('読込成功・新規は履歴・選択を破棄し、新しい基準になる', () => {
    const s = loaded();
    s.apply('改名', rename('X'));
    s.select({ pluginIndex: 0, pluginIndices: [0] });
    s.load(gmSmall, 'b.qbd');
    expect(s.getSnapshot()).toMatchObject({ canUndo: false, canRedo: false, dirty: false, fileName: 'b.qbd', selection: emptySelection });
    s.apply('改名', rename('Y'));
    s.createNew();
    expect(s.getSnapshot()).toMatchObject({ canUndo: false, dirty: false, fileName: null });
    expect(s.getSnapshot().map.Plugins).toHaveLength(0);
  });

  it('prepareSave は状態を変えない。commitSave でだけDirtyが解消し、ファイル名が入る', () => {
    const s = loaded();
    s.apply('改名', rename('Renamed'));
    const before = s.getSnapshot();
    const p = s.prepareSave('b.qbd');
    expect(p.ok).toBe(true);
    expect(s.getSnapshot()).toBe(before); // 準備だけでは何も変わらない（ダウンロード開始に失敗したら呼ばない）
    expect(before.dirty).toBe(true);
    if (!p.ok) return;
    expect(JSON.parse(p.value.text).Plugins[0].Name).toBe('Renamed');
    s.commitSave(p.value);
    expect(s.getSnapshot()).toMatchObject({ dirty: false, fileName: 'b.qbd', canUndo: true });
  });

  it('保存失敗(Articulation ID重複)は作業モデル・Dirty・履歴を変えない', () => {
    const s = loaded();
    s.apply('ID重複', (m) => {
      const c = cloneMap(m);
      c.Parts[1]!.Articulations[0]!.ID = c.Parts[0]!.Articulations[0]!.ID;
      return { ok: true as const, value: c };
    });
    const before = s.getSnapshot();
    const r = s.prepareSave('c.qbd');
    expect(r.ok).toBe(false);
    expect(s.getSnapshot()).toBe(before);
  });

  it('保存済み内容へ戻る編集（Undoでなくても）でDirtyが解消する', () => {
    const s = loaded();
    s.apply('a', rename('X'));
    mustSave(s);
    expect(s.getSnapshot().dirty).toBe(false);
    s.apply('b', rename('Y'));
    expect(s.getSnapshot().dirty).toBe(true);
    s.apply('c', rename('X'));
    expect(s.getSnapshot().dirty).toBe(false);
  });
});

describe('EditorStore: 保存をまたぐ履歴とID正規化', () => {
  /** IDが歯抜けで正規化により振り直されるモデル（Plugin ID 2,5 / Kit ID 7,9 / Articulation ID 11,12,13） */
  function gappy(): string {
    const raw = JSON.parse(gmSmall);
    raw.Plugins[0].ID = 5;
    raw.Plugins[0].Kits[0].ID = 9;
    raw.Plugins.push({ ID: 2, Name: 'P2', PluginType: 'GM', MidiOutDevice: '', SoundCheckChannel: 'Channel10', Kits: [{ ID: 7, Name: 'K2', Pitches: [{ Name: '' }] }] });
    const ids = [11, 12, 13];
    raw.Parts.forEach((p: { Articulations: { ID: number; Complement?: number }[] }, i: number) => { p.Articulations[0]!.ID = ids[i]!; });
    raw.Plugins[0].Kits[0].Pitches.forEach((p: { ArticulationID?: number }, i: number) => { if (i > 0) p.ArticulationID = ids[i - 1]!; });
    return JSON.stringify(raw);
  }

  it('保存は作業モデルのIDを書き換えない（履歴のスナップショットとIDが食い違わない）が、保存テキストは正規化済み', () => {
    const s = new EditorStore();
    s.load(gappy(), 'g.qbd');
    s.edit('改名', renameCore('Q'));
    const idsBefore = s.getSnapshot().map.Parts.map((p) => p.Articulations[0]!.ID);
    const p = mustSave(s);
    expect(s.getSnapshot().map.Parts.map((x) => x.Articulations[0]!.ID)).toEqual(idsBefore); // 作業モデルは不変
    const saved = parseQbd(p.text);
    expect(saved.ok && saved.value.Parts.map((x) => x.Articulations[0]!.ID)).toEqual([1, 2, 3]); // テキストは1..n
  });

  it('保存をまたいで Undo / Redo しても、各時点のモデルは自己完結していて参照が壊れない', () => {
    const s = new EditorStore();
    s.load(gappy(), 'g.qbd');
    const refsOk = (m: MapData) => {
      const ids = new Set(m.Parts.flatMap((p) => p.Articulations.map((a) => a.ID)));
      return m.Plugins.every((pl) => pl.Kits.every((k) => k.Pitches.every((r) => r.ArticulationID === 0 || ids.has(r.ArticulationID))));
    };
    const states: MapData[] = [s.getSnapshot().map];
    s.edit('1', (m) => updateKit(m, { pluginIndex: 0, kitIndex: 0 }, { Name: 'K1' }));
    states.push(s.getSnapshot().map);
    mustSave(s);
    s.edit('2', (m) => updatePlugin(m, 0, { Name: 'Q' }));
    states.push(s.getSnapshot().map);
    mustSave(s);
    s.edit('3', (m) => updateKitPitch(m, { pluginIndex: 0, kitIndex: 0 }, 1, { Name: 'Kick!' }));
    for (let i = 0; i < 3; i++) {
      expect(refsOk(s.getSnapshot().map)).toBe(true);
      expect(normalizeIds(s.getSnapshot().map).ok).toBe(true);
      s.undo();
    }
    expect(s.getSnapshot().map).toBe(states[0]);
    for (let i = 0; i < 3; i++) { expect(refsOk(s.getSnapshot().map)).toBe(true); s.redo(); }
    expect(s.getSnapshot().canRedo).toBe(false);
  });

  it('保存後に Undo して保存時点に戻れば Dirty が解消し、さらに戻せば Dirty、Redo で再び解消する', () => {
    const s = new EditorStore();
    s.load(gappy(), 'g.qbd');
    s.edit('1', (m) => updatePlugin(m, 0, { Name: 'A' }));
    mustSave(s); // 基準 = 'A'
    s.edit('2', (m) => updatePlugin(m, 0, { Name: 'B' }));
    expect(s.getSnapshot().dirty).toBe(true);
    s.undo();
    expect(s.getSnapshot().dirty).toBe(false); // 保存した内容と同じ
    s.undo();
    expect(s.getSnapshot().dirty).toBe(true); // 保存前の状態
    s.redo();
    expect(s.getSnapshot().dirty).toBe(false);
  });

  it('Dirty はID採番の違いを無視して比較する（読み込んだ時点と、ID正規化後の同内容は同じ）', () => {
    const s = new EditorStore();
    s.load(gappy(), 'g.qbd');
    const m = s.getSnapshot().map;
    const n = normalizeIds(m);
    expect(n.ok && dirtyKey(n.value)).toBe(dirtyKey(m));
    expect(contentKey(n.ok ? n.value : m)).not.toBe(contentKey(m)); // 生の内容は異なる
  });
});

describe('EditorStore: 編集・Undo/Redo・履歴上限', () => {
  it('apply → undo → redo で状態が往復する。基準のスナップショットへ戻ればDirtyでない', () => {
    const s = loaded();
    const original = s.getSnapshot().map;
    s.apply('改名', rename('X'));
    expect(s.getSnapshot()).toMatchObject({ dirty: true, undoLabel: '改名' });
    expect(s.undo()).toBe(true);
    expect(s.getSnapshot().map).toBe(original);
    expect(s.getSnapshot()).toMatchObject({ dirty: false, canRedo: true });
    expect(s.redo()).toBe(true);
    expect(s.getSnapshot().map.Plugins[0]!.Name).toBe('X');
    expect(s.undo() && s.undo()).toBe(false);
  });

  it('変更して同じ内容に戻す編集でもDirtyは解消する。履歴は残る', () => {
    const s = loaded();
    s.apply('改名', rename('X'));
    s.apply('元の名前へ', rename('GM'));
    expect(s.getSnapshot()).toMatchObject({ dirty: false, canUndo: true });
  });

  it('新しい編集でRedo履歴は破棄される', () => {
    const s = loaded();
    s.apply('a', rename('A'));
    s.undo();
    s.apply('b', rename('B'));
    expect(s.getSnapshot().canRedo).toBe(false);
  });

  it('編集関数が失敗・例外のときは何も変えず、エラーを返す（apply / edit 共通）', () => {
    const s = loaded();
    const before = s.getSnapshot();
    expect(s.apply('失敗', () => ({ ok: false, error: { code: 'kit-not-found', message: 'x' } })).ok).toBe(false);
    const r2 = s.apply('例外', () => { throw new Error('boom'); });
    expect(r2.ok === false && r2.error.code).toBe('unexpected');
    const r3 = s.edit('失敗', (m) => updatePlugin(m, 9, { Name: 'x' }));
    expect(r3.ok === false && r3.error.code).toBe('index-out-of-range');
    const r4 = s.edit('例外', () => { throw new Error('boom'); });
    expect(r4.ok).toBe(false);
    expect(s.getSnapshot()).toBe(before);
  });

  it('edit: 変更なし(changed:false)は履歴にも通知にも積まない', () => {
    const s = loaded();
    const fn = vi.fn();
    s.subscribe(fn);
    const before = s.getSnapshot();
    const r = s.edit('同じ名前', (m) => updatePlugin(m, 0, { Name: 'GM' }));
    expect(r.ok && r.value.changed).toBe(false);
    expect(s.getSnapshot()).toBe(before);
    expect(fn).not.toHaveBeenCalled();
  });

  it('apply は結果を複製して保持する（呼び出し側が後で書き換えても履歴を壊さない）', () => {
    const s = loaded();
    let leaked: MapData | undefined;
    s.apply('改名', (m) => { const c = cloneMap(m); c.Plugins[0]!.Name = 'X'; leaked = c; return { ok: true as const, value: c }; });
    leaked!.Plugins[0]!.Name = 'tampered';
    expect(s.getSnapshot().map.Plugins[0]!.Name).toBe('X');
  });

  it('edit は構造共有: 変更していない部分は同じ参照のまま履歴に残る', () => {
    const s = loaded();
    const m0 = s.getSnapshot().map;
    s.edit('改名', (m) => updatePlugin(m, 0, { Name: 'X' }));
    const m1 = s.getSnapshot().map;
    expect(m1.Plugins[0]!.Kits).toBe(m0.Plugins[0]!.Kits);
    expect(m1.Parts).toBe(m0.Parts);
  });

  it('履歴は上限で古いものから捨てられる。既定の上限は30（暫定）', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(30);
    const s = new EditorStore();
    s.load(gmSmall, null);
    for (let i = 0; i < 45; i++) s.edit(`e${i}`, (m) => updatePlugin(m, 0, { Name: `N${i}` }));
    expect(s.getSnapshot().historyLength).toBe(30);
    let n = 0;
    while (s.undo()) n++;
    expect(n).toBe(30);
    expect(s.getSnapshot().map.Plugins[0]!.Name).toBe('N14'); // 45回目の30個前の状態まで戻れる（最も古い15件は失われる）
    expect(s.getSnapshot().dirty).toBe(true);
  });

  it('上限が小さくても、履歴の切り捨てでモデルの整合性は壊れない', () => {
    const s = loaded(3);
    for (let i = 0; i < 6; i++) s.edit(`e${i}`, (m) => updatePlugin(m, 0, { Name: `N${i}` }));
    while (s.undo());
    expect(s.getSnapshot().map.Plugins[0]!.Name).toBe('N2');
    expect(normalizeIds(s.getSnapshot().map).ok).toBe(true);
  });
});

describe('EditorStore: 複合操作は1つの取り消し単位（Core呼び出し）', () => {
  it('Auto Assign は1回のapplyで、1回のUndoで全行が戻る。入力モデルは破壊されない', () => {
    const s = new EditorStore();
    s.load(gmSmall, 'a.qbd');
    s.apply('割当解除', (m) => {
      const c = cloneMap(m);
      for (const p of c.Plugins[0]!.Kits[0]!.Pitches) p.ArticulationID = 0;
      return { ok: true as const, value: c };
    });
    const beforeAssign = s.getSnapshot().map;
    const beforeJson = JSON.stringify(beforeAssign);
    const res = s.apply('Auto Assign', (m) => {
      const r = autoAssignArticulations(m, { pluginIndex: 0, kitIndex: 0 }, defaultPartNameDictionary());
      return r.ok ? { ok: true as const, value: r.value.map } : r;
    });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(beforeAssign)).toBe(beforeJson);
    expect(s.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches.filter((p) => p.ArticulationID !== 0).length).toBeGreaterThan(0);
    s.undo();
    expect(s.getSnapshot().map).toBe(beforeAssign);
  });

  it('Name を空にする連動クリア（Name・ArticulationID・Separator）は1回のUndoで戻る', () => {
    const s = loaded();
    s.edit('Name を空に', (m) => updateKitPitch(m, { pluginIndex: 0, kitIndex: 0 }, 3, { Name: '' }));
    expect(s.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[3]).toMatchObject({ Name: '', ArticulationID: 0, Separator: 'None' });
    s.undo();
    expect(s.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[3]).toMatchObject({ Name: 'Closed HH', ArticulationID: 3, Separator: 'Separate' });
    expect(s.getSnapshot().canUndo).toBe(false); // 1操作だけ
  });
});

describe('EditorStore: 選択（履歴に含めない・無効な選択は補正）', () => {
  function multi(): EditorStore {
    const s = loaded();
    s.edit('+P', (m) => addPlugin(m));
    s.edit('+K', (m) => addKit(m, 0));
    s.edit('+K', (m) => addKit(m, 0));
    return s;
  }

  it('選択変更は履歴・Dirtyに影響しない。範囲外の選択は取り除かれる', () => {
    const s = loaded();
    s.select({ pluginIndex: 0, pluginIndices: [0, 7], kitIndex: 0, kitIndices: [0, 5], pitchIndices: [1, 3, 500] });
    const st = s.getSnapshot();
    expect(st.selection).toMatchObject({ pluginIndices: [0], kitIndices: [0], pitchIndices: [1, 3] });
    expect(st).toMatchObject({ dirty: false, canUndo: false });
  });

  it('存在しないPluginの選択は解除され、配下のKit・Pitch選択も解除される', () => {
    const s = loaded();
    s.select({ pluginIndex: 4, kitIndex: 0, pitchIndices: [1] });
    expect(s.getSnapshot().selection).toEqual(emptySelection);
  });

  it('削除後・Undo後・Redo後に、無効になった選択は解除される。undo/redoしても有効な選択は保持される', () => {
    const s = multi(); // Plugin 2件、Kit 3件
    s.select({ pluginIndex: 0, pluginIndices: [0], kitIndex: 2, kitIndices: [2], pitchIndices: [1] });
    s.edit('Kit削除', (m) => deleteKits(m, 0, [2]), () => ({ kitIndex: null, kitIndices: [], pitchIndices: [] }));
    expect(s.getSnapshot().selection).toMatchObject({ pluginIndex: 0, kitIndex: null, pitchIndices: [] });
    s.select({ kitIndex: 1, kitIndices: [1] });
    s.undo(); // Kit 3件へ → Kit 1 は引き続き有効
    expect(s.getSnapshot().selection.kitIndex).toBe(1);
    s.select({ kitIndex: 2, kitIndices: [2] });
    s.redo(); // Kit 2件へ → Kit 2 は無効になり解除
    expect(s.getSnapshot().selection).toMatchObject({ pluginIndex: 0, kitIndex: null, kitIndices: [] });
    // Plugin の削除を Undo / Redo
    s.select({ pluginIndex: 1, pluginIndices: [1] });
    s.edit('Plugin削除', (m) => deletePlugins(m, [1]));
    expect(s.getSnapshot().selection.pluginIndex).toBeNull();
    s.undo();
    s.select({ pluginIndex: 1, pluginIndices: [1] });
    expect(s.getSnapshot().selection.pluginIndex).toBe(1);
  });

  it('editの selection 関数で、追加した要素や移動後の添字を選択できる（無効な値は補正される）', () => {
    const s = multi();
    s.edit('移動', (m) => movePlugins(m, [1], 'top'), (r) => ({ pluginIndex: r.indices![0]!, pluginIndices: r.indices! }));
    expect(s.getSnapshot().selection).toMatchObject({ pluginIndex: 0, pluginIndices: [0] });
    s.edit('追加', (m) => addPlugin(m), () => ({ pluginIndex: 99, pluginIndices: [99] }));
    expect(s.getSnapshot().selection.pluginIndex).toBeNull();
  });

  it('sanitizeSelection は有効な選択に対して同じオブジェクトを返す（不要な再描画をしない）', () => {
    const s = loaded();
    s.select({ pluginIndex: 0, pluginIndices: [0] });
    const sel = s.getSnapshot().selection;
    expect(sanitizeSelection(s.getSnapshot().map, sel)).toBe(sel);
  });
});

describe('EditorStore: 処理中・購読', () => {
  it('runBusyは処理中フラグを立て、完了・例外のどちらでも戻し、二重実行を拒否する', async () => {
    const s = loaded();
    let release!: () => void;
    const first = s.runBusy(() => new Promise<string>((r) => { release = () => r('done'); }));
    expect(s.getSnapshot().busy).toBe(true);
    expect(await s.runBusy(async () => 'second')).toBeUndefined();
    release();
    expect(await first).toBe('done');
    expect(s.getSnapshot().busy).toBe(false);
    await expect(s.runBusy(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(s.getSnapshot().busy).toBe(false);
  });

  it('購読者は変更時に通知され、解除後は通知されない。getSnapshotは変更が無ければ同一参照', () => {
    const s = loaded();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    const a = s.getSnapshot();
    expect(s.getSnapshot()).toBe(a);
    s.apply('改名', rename('X'));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.undo();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('contentKey / dirtyKey', () => {
  it('キー順に依存せず、内容が違えば異なる（Extraも比較対象）', () => {
    const m = loaded().getSnapshot().map;
    expect(contentKey(cloneMap(m))).toBe(contentKey(m));
    const c = cloneMap(m);
    c.Plugins[0]!.Extra = { Unknown: 1 };
    expect(contentKey(c)).not.toBe(contentKey(m));
  });
  it('正規化できない異常データ（Articulation ID重複）でも例外にならず、内容の違いは検出される', () => {
    const m = loaded().getSnapshot().map;
    const bad = cloneMap(m);
    bad.Parts[1]!.Articulations[0]!.ID = bad.Parts[0]!.Articulations[0]!.ID;
    expect(dirtyKey(bad).startsWith('R')).toBe(true);
    expect(dirtyKey(bad)).not.toBe(dirtyKey(m));
  });
});

describe('Core編集関数と履歴の結合', () => {
  it('Plugin/Kit の追加・削除は取り消しでき、ID採番も元に戻る', () => {
    const s = loaded();
    s.edit('+P', (m) => addPlugin(m));
    s.edit('+K', (m) => addKit(m, 1));
    expect(s.getSnapshot().map.Plugins[1]!.Kits[0]!.ID).toBe(2);
    s.undo();
    s.undo();
    expect(s.getSnapshot().map.Plugins).toHaveLength(1);
    s.edit('+P', (m) => addPlugin(m));
    expect(s.getSnapshot().map.Plugins[1]!.ID).toBe(2);
  });
});
