import { describe, expect, it } from 'vitest';
import { type MapData, type MoveDirection } from '../../src/core';
import { EditorStore, emptySelection, type Selection } from '../../src/ui/state/editorStore';
import { remapSelection } from '../../src/ui/state/selectionIdentity';
import { createPluginsKitsActions } from '../../src/ui/editor/pluginsKitsActions';
import { brokenJson, gmSmall } from '../fixtures';

/** Plugin 4件（ID は非連続）× Kit 4件（ID は全体で一意）× Pitch 8行（Pitch 番号 36〜43） */
function buildJson(opts: { dupPluginId?: boolean; dupKitId?: boolean; dupPitch?: boolean } = {}): string {
  const plugins = [10, 20, 30, 40].map((pid, pi) => ({
    ID: opts.dupPluginId && pi === 3 ? 10 : pid,
    Name: `P${pi}`,
    PluginType: 'GM',
    MidiOutDevice: '',
    SoundCheckChannel: 'Channel10',
    Kits: [0, 1, 2, 3].map((ki) => ({
      ID: opts.dupKitId && pi === 2 && ki === 3 ? 21 : pi * 10 + ki + 1,
      Name: `P${pi}K${ki}`,
      Pitches: Array.from({ length: 8 }, (_, n) => ({
        Pitch: opts.dupPitch && pi === 0 && ki === 0 && n === 7 ? 36 : 36 + n, Name: `p${36 + n}`,
      })),
    })),
  }));
  return JSON.stringify({ AppName: 'QBDrumMap', ModelVersion: '1.0.0', Plugins: plugins, Parts: [] });
}

function setup(json = buildJson()) {
  const store = new EditorStore();
  expect(store.load(json, 'a.qbd').ok).toBe(true);
  const actions = createPluginsKitsActions(store, { confirm: async () => true, onError: () => undefined });
  return { store, actions };
}
const snap = (s: EditorStore) => s.getSnapshot();
const pluginNames = (s: EditorStore, idx: readonly number[] = snap(s).selection.pluginIndices) => idx.map((i) => snap(s).map.Plugins[i]!.Name);
const kitNames = (s: EditorStore) => {
  const { map, selection } = snap(s);
  const pl = selection.pluginIndex !== null ? map.Plugins[selection.pluginIndex] : undefined;
  return selection.kitIndices.map((i) => pl!.Kits[i]!.Name);
};
const pitchNumbers = (s: EditorStore) => {
  const { map, selection } = snap(s);
  const kit = selection.pluginIndex !== null && selection.kitIndex !== null ? map.Plugins[selection.pluginIndex]!.Kits[selection.kitIndex] : undefined;
  return selection.pitchIndices.map((i) => kit!.Pitches[i]!.Pitch);
};
const sorted = (a: readonly (string | number)[]) => [...a].sort();
const DIRS: MoveDirection[] = ['top', 'up', 'down', 'bottom'];

describe('選択の同一性: Plugin', () => {
  it('単一選択は 先頭／上／下／末尾 の移動後も同じ Plugin を指す', () => {
    for (const dir of DIRS) {
      const { store, actions } = setup();
      actions.selectPlugin(2);
      actions.movePlugins(dir);
      expect(pluginNames(store)).toEqual(['P2']);
      expect(pluginNames(store, [snap(store).selection.pluginIndex!])).toEqual(['P2']);
    }
  });

  it('非連続の複数選択は移動後も同じ要素の集合で、重複しない（クリック順も保つ）', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectPlugin(3, 'toggle');
    actions.selectPlugin(1, 'toggle');
    actions.movePlugins('bottom');
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P1', 'P3']);
    expect(pluginNames(store)).toEqual(['P0', 'P3', 'P1']);
    expect(new Set(snap(store).selection.pluginIndices).size).toBe(3);
    actions.movePlugins('top');
    actions.movePlugins('down');
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P1', 'P3']);
  });

  it('D&D の後も同じ要素。Undo／Redo でも同じ要素に追従する', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectPlugin(1, 'toggle');
    actions.movePluginsTo(4); // 末尾へ
    expect(snap(store).map.Plugins.map((p) => p.Name)).toEqual(['P2', 'P3', 'P0', 'P1']);
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P1']);
    store.undo();
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P1']);
    expect(snap(store).selection.pluginIndices.sort()).toEqual([0, 1]);
    store.redo();
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P1']);
    expect(snap(store).selection.pluginIndices.sort()).toEqual([2, 3]);
  });

  it('移動を組み合わせても別要素に化けない（先頭／下／D&D／Undo×2／Redo）', () => {
    const { store, actions } = setup();
    actions.selectPlugin(3);
    actions.movePlugins('top');
    actions.movePlugins('down');
    actions.selectPlugin(0, 'toggle');
    actions.movePluginsTo(3);
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P3']);
    store.undo();
    store.undo();
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P3']);
    store.redo();
    expect(sorted(pluginNames(store))).toEqual(['P0', 'P3']);
  });

  it('主選択（右側に出す Plugin）も同じ要素に追従し、Kit の選択も保たれる', () => {
    const { store, actions } = setup();
    actions.selectPlugin(2);
    actions.selectKit(1);
    actions.movePlugins('top');
    const s = snap(store).selection;
    expect(s.pluginIndex).toBe(0);
    expect(snap(store).map.Plugins[0]!.Name).toBe('P2');
    expect(kitNames(store)).toEqual(['P2K1']);
    expect(snap(store).map.Plugins[0]!.Kits[s.kitIndex!]!.Name).toBe('P2K1');
  });

  it('削除された Plugin の選択は解除され、別 Plugin に付け替わらない。配下の Kit 選択も解除される', async () => {
    const { store, actions } = setup();
    actions.selectPlugin(1);
    actions.selectKit(2);
    await actions.deletePlugins();
    const s = snap(store).selection;
    expect(s.pluginIndex).toBeNull();
    expect(s.pluginIndices).toEqual([]);
    expect(s.kitIndex).toBeNull();
    expect(s.kitIndices).toEqual([]);
    expect(s.pitchIndices).toEqual([]);
  });

  it('複数選択の一部だけを削除すると、残る要素の選択は維持される', () => {
    const { store, actions } = setup();
    actions.selectPlugin(1);
    actions.selectPlugin(3, 'toggle');
    store.edit('削除', (m) => ({ ok: true, value: { map: { ...m, Plugins: m.Plugins.filter((p) => p.Name !== 'P1') }, changed: true } }));
    expect(pluginNames(store)).toEqual(['P3']);
  });

  it('Undo で復活した Plugin は自動では再選択されず、Redo で再び消えても別要素にならない', async () => {
    const { store, actions } = setup();
    actions.selectPlugin(1);
    await actions.deletePlugins();
    store.undo();
    expect(snap(store).selection.pluginIndices).toEqual([]);
    expect(snap(store).map.Plugins).toHaveLength(4);
    actions.selectPlugin(0);
    store.redo();
    expect(pluginNames(store)).toEqual(['P0']);
  });

  it('Undo で消える要素（直前に追加した Plugin）の選択は解除される', () => {
    const { store, actions } = setup();
    actions.addPlugin();
    expect(pluginNames(store)).toEqual(['Plugin1']);
    store.undo();
    expect(snap(store).selection.pluginIndices).toEqual([]);
    expect(snap(store).selection.pluginIndex).toBeNull();
  });
});

describe('選択の同一性: Kit', () => {
  it('単一・複数選択が 移動／D&D／Undo／Redo の後も同じ Kit を指す', () => {
    const { store, actions } = setup();
    actions.selectPlugin(1);
    actions.selectKit(0);
    actions.selectKit(2, 'toggle');
    actions.moveKits('bottom');
    expect(sorted(kitNames(store))).toEqual(['P1K0', 'P1K2']);
    expect(snap(store).map.Plugins[1]!.Kits.map((k) => k.Name)).toEqual(['P1K1', 'P1K3', 'P1K0', 'P1K2']);
    actions.moveKitsTo(0);
    expect(sorted(kitNames(store))).toEqual(['P1K0', 'P1K2']);
    store.undo();
    store.undo();
    expect(sorted(kitNames(store))).toEqual(['P1K0', 'P1K2']);
    store.redo();
    expect(sorted(kitNames(store))).toEqual(['P1K0', 'P1K2']);
  });

  it('Kit を削除すると、その Kit と Pitch の選択だけが解除される', async () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectKit(1);
    actions.selectPitch(2);
    await actions.deleteKits();
    const s = snap(store).selection;
    expect(s.kitIndex).toBeNull();
    expect(s.kitIndices).toEqual([]);
    expect(s.pitchIndices).toEqual([]);
    expect(s.pluginIndex).toBe(0);
  });

  it('主選択でない Kit を削除しても、主選択の Kit は同じ要素のまま', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectKit(3);
    actions.selectPitch(4);
    store.edit('削除', (m) => ({
      ok: true,
      value: { map: { ...m, Plugins: m.Plugins.map((p, i) => (i === 0 ? { ...p, Kits: p.Kits.filter((k) => k.Name !== 'P0K0') } : p)) }, changed: true },
    }));
    expect(snap(store).map.Plugins[0]!.Kits[snap(store).selection.kitIndex!]!.Name).toBe('P0K3');
    expect(pitchNumbers(store)).toEqual([40]);
  });

  it('Plugin の並べ替え中も、別 Plugin の同じ位置にある Kit に化けない', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectKit(2);
    actions.selectPlugin(1);
    actions.movePlugins('top'); // P1 が先頭へ。以前の添字ベースなら P0 の選択位置が別物になる
    expect(snap(store).map.Plugins.map((p) => p.Name)).toEqual(['P1', 'P0', 'P2', 'P3']);
    expect(snap(store).selection.kitIndex).toBeNull(); // P1 を選び直したので Kit は未選択
  });
});

describe('選択の同一性: KitPitch', () => {
  it('Pitch 番号と配列位置が異なる（並べ替え済み）Kit でも正しい Pitch を追跡する', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectKit(0);
    actions.selectPitch(2); // Pitch 38
    actions.selectPitch(5, 'toggle'); // Pitch 41
    actions.movePitches('bottom');
    expect(sorted(pitchNumbers(store))).toEqual([38, 41]);
    const kit = snap(store).map.Plugins[0]!.Kits[0]!;
    expect(kit.Pitches.map((p) => p.Pitch)).toEqual([36, 37, 39, 40, 42, 43, 38, 41]);
    // 位置と番号がずれた状態でさらに操作する
    actions.selectPitch(0, 'toggle'); // Pitch 36
    actions.movePitchesTo(4);
    expect(sorted(pitchNumbers(store))).toEqual([36, 38, 41]);
    store.undo();
    expect(sorted(pitchNumbers(store))).toEqual([36, 38, 41]);
    store.undo();
    expect(sorted(pitchNumbers(store))).toEqual([36, 38, 41]);
    store.redo();
    store.redo();
    expect(sorted(pitchNumbers(store))).toEqual([36, 38, 41]);
  });

  it('Name 編集（行の置換）でも選択は同じ Pitch のまま', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectKit(0);
    actions.selectPitch(3);
    actions.updatePitch(3, { Name: 'renamed' });
    expect(pitchNumbers(store)).toEqual([39]);
  });

  it('Pitch の範囲選択の基点（末尾）は同じ Pitch に追従する', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectKit(0);
    actions.selectPitch(1);
    actions.selectPitch(4, 'toggle'); // 基点 = Pitch 40
    actions.movePitches('top');
    expect(pitchNumbers(store).at(-1)).toBe(40);
  });

  it('Kit を切り替えると Pitch 選択は解除され、他の Kit の同じ Pitch 番号を引き継がない', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.selectKit(0);
    actions.selectPitch(2);
    actions.selectKit(1);
    expect(snap(store).selection.pitchIndices).toEqual([]);
  });
});

describe('選択の同一性: 同定できない場合は安全側に解除する', () => {
  it('Plugin ID が重複していると、その Plugin の選択は編集後に解除される（別要素に付け替えない）', () => {
    const { store, actions } = setup(buildJson({ dupPluginId: true }));
    actions.selectPlugin(0); // ID 10（P3 も ID 10）
    expect(pluginNames(store)).toEqual(['P0']);
    actions.selectPlugin(1);
    actions.selectPlugin(3, 'toggle'); // 重複ID側
    actions.movePlugins('top');
    expect(pluginNames(store)).toEqual(['P1']); // 重複IDの P3 は同定できないため解除。P1 は一意なので追従
  });

  it('Kit ID の重複・Pitch 番号の重複も同様に解除し、一意な要素は追従する', () => {
    const k = setup(buildJson({ dupKitId: true }));
    k.actions.selectPlugin(2);
    k.actions.selectKit(3); // 同じPlugin内で ID 21 が P2K0 と重複する Kit（P2K3）
    k.actions.selectKit(1, 'toggle');
    k.actions.moveKits('bottom');
    expect(kitNames(k.store)).toEqual(['P2K1']);
    const p = setup(buildJson({ dupPitch: true }));
    p.actions.selectPlugin(0);
    p.actions.selectKit(0);
    p.actions.selectPitch(0); // Pitch 36（末尾にも 36 がある）
    p.actions.selectPitch(3, 'toggle');
    p.actions.movePitches('bottom');
    expect(pitchNumbers(p.store)).toEqual([39]);
  });

  it('remapSelection は同じモデルなら入力をそのまま返し、Part は範囲外だけ解除する', () => {
    const { store } = setup();
    const m = snap(store).map;
    const s: Selection = { ...emptySelection, partIndex: 0 };
    expect(remapSelection(m, m, s)).toBe(s);
    expect(remapSelection(m, { ...m, Parts: [] }, s).partIndex).toBeNull();
  });
});

describe('選択: 新規／開く・履歴・保存との関係', () => {
  it('開く成功で選択はリセットされ、失敗ではモデル・履歴・選択が変わらない', () => {
    const { store, actions } = setup();
    actions.selectPlugin(1);
    actions.selectKit(1);
    const before = snap(store);
    expect(store.load(brokenJson, 'bad.qbd').ok).toBe(false);
    expect(snap(store)).toBe(before);
    expect(store.load(gmSmall, 'ok.qbd').ok).toBe(true);
    expect(snap(store).selection).toEqual(emptySelection);
    actions.selectPlugin(0);
    store.createNew();
    expect(snap(store).selection).toEqual(emptySelection);
  });

  it('選択は履歴に含まれず、保存をまたぐ Undo／Redo でも追従し、Dirty・履歴件数は従来どおり', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.movePlugins('bottom');
    expect(snap(store).dirty).toBe(true);
    const p = store.prepareSave('x.qbd');
    expect(p.ok).toBe(true);
    if (p.ok) store.commitSave(p.value);
    expect(snap(store).dirty).toBe(false);
    expect(pluginNames(store)).toEqual(['P0']);
    store.undo();
    expect(pluginNames(store)).toEqual(['P0']);
    expect(snap(store).dirty).toBe(true);
    store.redo();
    expect(pluginNames(store)).toEqual(['P0']);
    expect(snap(store).dirty).toBe(false);
    expect(snap(store).historyLength).toBe(1);
  });

  it('選択だけの変更は履歴・Dirty に影響しない。履歴上限（30）を超えても選択は追従する', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    expect(snap(store).historyLength).toBe(0);
    expect(snap(store).dirty).toBe(false);
    for (let i = 0; i < 35; i++) actions.movePlugins(i % 2 === 0 ? 'bottom' : 'top');
    expect(snap(store).historyLength).toBe(30);
    expect(pluginNames(store)).toEqual(['P0']);
  });

  it('Plugin／Kit を追加すると、追加した要素が選択され、既存の選択は引き継がない', () => {
    const { store, actions } = setup();
    actions.selectPlugin(0);
    actions.addKit();
    expect(snap(store).map.Plugins[0]!.Kits[snap(store).selection.kitIndex!]!.Name).toContain('Kit5');
    expect(snap(store).selection.pitchIndices).toEqual([]);
  });

  it('Core の編集関数が返したモデルをそのまま使っても識別キーはモデルに混入しない', () => {
    const { store } = setup();
    const m: MapData = snap(store).map;
    expect(JSON.stringify(m)).not.toMatch(/uid|__key|selectionKey/);
  });
});
