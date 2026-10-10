import { describe, expect, it } from 'vitest';
import { listDrumMapOrder, type MapData } from '../../src/core';
import { EditorStore, emptySelection } from '../../src/ui/state/editorStore';
import { createPartsActions } from '../../src/ui/editor/partsActions';

/** Part 4件（ID は非連続）。各 Part に Articulation 2件。DrumMapOrder は配列順と異なる */
function buildJson(opts: { dupPartId?: boolean; dupArticulationId?: boolean } = {}): string {
  const ids = [10, 20, 30, 40];
  const parts = ids.map((pid, pi) => ({
    ID: opts.dupPartId && pi === 3 ? 10 : pid,
    Name: `P${pi}`,
    ScorePitch: 38,
    Articulations: [0, 1].map((ai) => ({
      ID: opts.dupArticulationId && pi === 2 && ai === 1 ? pi * 10 + 1 : pi * 10 + ai + 1,
      Name: `P${pi}A${ai}`,
      Complement: 0,
      DrumMapOrder: ((pi * 2 + ai) * 3) % 8 + 1, // 配列順とは異なる一意な順序
    })),
  }));
  return JSON.stringify({
    AppName: 'QBDrumMap', ModelVersion: '1.0.0',
    Plugins: [{ ID: 1, Name: 'P', PluginType: 'GM', MidiOutDevice: '', SoundCheckChannel: 'Channel10', Kits: [{ ID: 1, Name: 'K', Pitches: [{ Pitch: 36, Name: 'x', ArticulationID: 11 }] }] }],
    Parts: parts,
  });
}

function setup(json = buildJson()) {
  const store = new EditorStore();
  expect(store.load(json, 'a.qbd').ok).toBe(true);
  const actions = createPartsActions(store, { confirm: async () => true, onError: () => undefined });
  return { store, actions };
}
const snap = (s: EditorStore) => s.getSnapshot();
const partNames = (s: EditorStore, idx: readonly number[] = snap(s).selection.partIndices) => idx.map((i) => snap(s).map.Parts[i]!.Name);
const artNames = (s: EditorStore) => {
  const { map, selection } = snap(s);
  const part = selection.partIndex !== null ? map.Parts[selection.partIndex] : undefined;
  return selection.articulationIndices.map((i) => part!.Articulations[i]!.Name);
};
const orderNames = (s: EditorStore) => {
  const m: MapData = snap(s).map;
  const list = listDrumMapOrder(m).map((r) => m.Parts[r.partIndex]!.Articulations[r.articulationIndex]!.Name);
  return snap(s).selection.orderIndices.map((i) => list[i]!);
};
const sorted = (a: readonly string[]) => [...a].sort();

describe('選択の同一性: Part', () => {
  it('単一・複数（非連続）選択が 先頭／上／下／末尾・D&D・Undo／Redo の後も同じ Part を指す。主選択も追従する', () => {
    const { store, actions } = setup();
    actions.selectPart(1);
    actions.selectPart(3, 'toggle');
    actions.moveParts('top');
    expect(snap(store).map.Parts.map((p) => p.Name)).toEqual(['P1', 'P3', 'P0', 'P2']);
    expect(sorted(partNames(store))).toEqual(['P1', 'P3']);
    expect(snap(store).map.Parts[snap(store).selection.partIndex!]!.Name).toBe('P3');
    actions.movePartsTo(0);
    actions.moveParts('bottom');
    expect(sorted(partNames(store))).toEqual(['P1', 'P3']);
    store.undo();
    store.undo();
    store.undo();
    expect(sorted(partNames(store))).toEqual(['P1', 'P3']);
    store.redo();
    store.redo();
    expect(sorted(partNames(store))).toEqual(['P1', 'P3']);
    expect(new Set(snap(store).selection.partIndices).size).toBe(2);
  });

  it('Part を削除すると、その選択と配下の Articulation の選択が解除される。残る Part の選択は維持される', async () => {
    const { store, actions } = setup();
    actions.selectPart(1);
    actions.selectPart(3, 'toggle');
    actions.selectPart(3, 'toggle'); // P3 を選択から外す（主選択は P3 のまま）。選択は [P1]
    actions.selectArticulation(1);
    expect(partNames(store)).toEqual(['P1']);
    await actions.deleteParts(); // P1 だけを削除
    expect(snap(store).map.Parts.map((p) => p.Name)).toEqual(['P0', 'P2', 'P3']);
    expect(snap(store).selection.partIndices).toEqual([]);
    expect(snap(store).map.Parts[snap(store).selection.partIndex!]!.Name).toBe('P3'); // 主選択は同じ P3
    expect(artNames(store)).toEqual(['P3A1']);
    // 主選択の Part を削除すると Articulation の選択も解除される
    actions.selectPart(2);
    await actions.deleteParts();
    const s = snap(store).selection;
    expect(s.partIndex).toBeNull();
    expect(s.articulationIndex).toBeNull();
    expect(s.articulationIndices).toEqual([]);
  });

  it('Undo で復活した Part は自動で再選択されない。ID の欠番が再利用されても、削除前の選択は引き継がれない', async () => {
    const { store, actions } = setup();
    actions.selectPart(1);
    await actions.deleteParts();
    actions.addPart(); // 削除した Part とは別の ID が付く（欠番の最小値）
    expect(snap(store).map.Parts.at(-1)).toMatchObject({ ID: 1, Name: 'Part1' }); // GetNewID は 1 からの欠番（Windows版と同じ）
    expect(partNames(store)).toEqual(['Part1']); // 追加した要素が選択される（削除前の選択ではない）
    store.undo();
    expect(snap(store).selection.partIndices).toEqual([]);
    store.undo();
    expect(snap(store).selection.partIndices).toEqual([]);
    expect(snap(store).map.Parts).toHaveLength(4);
  });

  it('Part ID が重複する異常データ: 重複した Part の選択は編集後に解除され、一意な Part は追従する', () => {
    const { store, actions } = setup(buildJson({ dupPartId: true }));
    actions.selectPart(0); // ID 10（P3 も ID 10）
    actions.selectPart(1, 'toggle');
    actions.moveParts('bottom');
    expect(partNames(store)).toEqual(['P1']); // 重複 ID の P0 は同定できないため解除。P1 は一意なので追従
  });
});

describe('選択の同一性: Articulation（Parts タブ）', () => {
  it('Part 内の並べ替え・削除・Undo／Redo で同じ Articulation を追従し、削除された要素は解除される', async () => {
    const { store, actions } = setup();
    actions.selectPart(2);
    actions.selectArticulation(0);
    actions.moveArticulations('bottom');
    expect(artNames(store)).toEqual(['P2A0']);
    expect(snap(store).selection.articulationIndices).toEqual([1]);
    store.undo();
    expect(artNames(store)).toEqual(['P2A0']);
    store.redo();
    expect(artNames(store)).toEqual(['P2A0']);
    await actions.deleteArticulations();
    expect(snap(store).selection.articulationIndices).toEqual([]);
    expect(snap(store).selection.articulationIndex).toBeNull();
    store.undo();
    expect(snap(store).selection.articulationIndices).toEqual([]); // Undo で復活しても再選択しない
    expect(snap(store).selection.partIndex).toBe(2); // 親の選択は維持
  });

  it('Part の並べ替えで主選択の Part が移動しても、その Part の Articulation 選択が追従する', () => {
    const { store, actions } = setup();
    actions.selectPart(2);
    actions.selectArticulation(1);
    actions.moveParts('top');
    expect(snap(store).selection.partIndex).toBe(0);
    expect(artNames(store)).toEqual(['P2A1']);
  });

  it('Articulation ID が重複する異常データでは、重複した Articulation の選択は編集後に解除される', () => {
    const { store, actions } = setup(buildJson({ dupArticulationId: true }));
    actions.selectPart(2);
    actions.selectArticulation(1); // ID が P2A0 と重複する Articulation
    actions.moveArticulations('top');
    expect(snap(store).map.Parts[2]!.Articulations.map((a) => a.Name)).toEqual(['P2A1', 'P2A0']); // 操作自体は行われる
    expect(artNames(store)).toEqual([]); // 同定できないため選択は解除（別の Articulation に付け替えない）
  });

  it('追加した Articulation が選択され、Part を切り替えると Articulation の選択は解除される', () => {
    const { store, actions } = setup();
    actions.selectPart(0);
    actions.addArticulation();
    expect(artNames(store)).toEqual(['P0 3']);
    actions.selectPart(1);
    expect(snap(store).selection.articulationIndices).toEqual([]);
  });
});

describe('選択の同一性: DrumMap Order', () => {
  it('並べ替え・Undo／Redo で同じ Articulation を追従する（位置ではなく ID が基準）', () => {
    const { store, actions } = setup();
    const all = listDrumMapOrder(snap(store).map).length;
    expect(all).toBe(8);
    actions.selectOrder(5);
    actions.selectOrder(1, 'toggle');
    const picked = sorted(orderNames(store));
    actions.moveOrder('top');
    expect(sorted(orderNames(store))).toEqual(picked);
    actions.moveOrderTo(7);
    expect(sorted(orderNames(store))).toEqual(picked);
    store.undo();
    expect(sorted(orderNames(store))).toEqual(picked);
    store.undo();
    store.redo();
    store.redo();
    expect(sorted(orderNames(store))).toEqual(picked);
    expect(new Set(snap(store).selection.orderIndices).size).toBe(2);
  });

  it('Parts タブでの変更（Part の並べ替え・Articulation の追加・Complement 設定）でも選択は同じ要素を指す', () => {
    const { store, actions } = setup();
    actions.selectOrder(3);
    const before = orderNames(store);
    actions.selectPart(0);
    actions.moveParts('bottom');
    expect(orderNames(store)).toEqual(before);
    actions.addArticulation(); // 末尾（最大の DrumMapOrder + 1）に追加される
    expect(orderNames(store)).toEqual(before);
    actions.updateArticulation({ Name: 'renamed' });
    expect(orderNames(store)).toEqual(before);
  });

  it('Part の削除で消えた Articulation の選択は解除され、別の Articulation に付け替わらない', async () => {
    const { store, actions } = setup();
    const names = listDrumMapOrder(snap(store).map).map((r) => snap(store).map.Parts[r.partIndex]!.Articulations[r.articulationIndex]!.Name);
    const target = names.findIndex((n) => n.startsWith('P1'));
    const keep = names.findIndex((n) => n.startsWith('P3'));
    actions.selectOrder(target);
    actions.selectOrder(keep, 'toggle');
    actions.selectPart(1);
    await actions.deleteParts();
    expect(orderNames(store).every((n) => n.startsWith('P3'))).toBe(true);
    expect(orderNames(store)).toHaveLength(1);
  });

  it('新規／開く成功で選択はリセットされ、失敗では保持される', () => {
    const { store, actions } = setup();
    actions.selectPart(1);
    actions.selectOrder(2);
    const before = snap(store);
    expect(store.load('{', 'bad.qbd').ok).toBe(false);
    expect(snap(store)).toBe(before);
    store.createNew();
    expect(snap(store).selection).toEqual(emptySelection);
  });
});
