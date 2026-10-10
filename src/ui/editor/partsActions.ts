import {
  addArticulation, addPart, countClearedReferences, deleteArticulations, deleteParts, moveArticulations, moveArticulationsTo,
  moveDrumMapOrder, moveDrumMapOrderTo, moveParts, movePartsTo, updateArticulation, updatePart,
  type ArticulationPatch, type EditResult, type MoveDirection, type PartPatch,
} from '../../core';
import type { EditorStore, Selection } from '../state/editorStore';
import { deleteMessage, type EditorUi } from './pluginsKitsActions';

export type PickMode = 'single' | 'toggle' | 'range';

/** クリック・Ctrl+クリック・Shift+クリックによる複数選択。範囲選択の起点は主選択（active） */
function pick(current: readonly number[], active: number | null, index: number, mode: PickMode): number[] {
  if (mode === 'toggle') return current.includes(index) ? current.filter((i) => i !== index) : [...current, index];
  if (mode === 'range' && active !== null) {
    const [a, b] = [Math.min(active, index), Math.max(active, index)];
    return Array.from({ length: b - a + 1 }, (_, k) => a + k);
  }
  return [index];
}

/**
 * Parts タブ・DrumMap Order タブの操作。モデル変更はすべて Core の純粋関数（editParts.ts）で行い、ここは
 * 「どの関数を・どの選択で呼ぶか」と確認・結果の選択への反映だけを担う。並べ替え・削除での選択の追従と解除は
 * ストア（selectionIdentity）が行う。失敗時は何も変更せずエラーを通知する。
 */
export function createPartsActions(store: EditorStore, ui: EditorUi) {
  const sel = (): Selection => store.getSnapshot().selection;
  const map = () => store.getSnapshot().map;
  const run = (label: string, recipe: Parameters<EditorStore['edit']>[1], select?: (r: EditResult) => Partial<Selection>): boolean => {
    const r = store.edit(label, recipe, select);
    if (!r.ok) ui.onError(r.error);
    return r.ok && r.value.changed;
  };

  /** 削除で解除される参照（削除の結果から数えるため、実際の処理と一致する） */
  const clearedRefs = (after: EditResult | undefined): string[] => {
    const c = after ? countClearedReferences(map(), after.map) : { kitPitches: 0, complements: 0 };
    const refs: string[] = [];
    if (c.kitPitches > 0) refs.push(`それを参照する KitPitch の Articulation の割り当て ${c.kitPitches} 件`);
    if (c.complements > 0) refs.push(`他の Articulation の Complement ${c.complements} 件`);
    return refs;
  };

  return {
    // --- 選択 ---
    selectPart(index: number, mode: PickMode = 'single'): void {
      const s = sel();
      store.select({
        partIndex: index, partIndices: pick(s.partIndices, s.partIndex, index, mode),
        ...(s.partIndex === index ? {} : { articulationIndex: null, articulationIndices: [] }),
      });
    },
    selectArticulation(index: number, mode: PickMode = 'single'): void {
      const s = sel();
      store.select({ articulationIndex: index, articulationIndices: pick(s.articulationIndices, s.articulationIndex, index, mode) });
    },
    /** DrumMap Order の一覧内の位置を選択する。範囲選択の起点は最後に選んだ位置 */
    selectOrder(position: number, mode: PickMode = 'single'): void {
      const s = sel();
      store.select({ orderIndices: pick(s.orderIndices, s.orderIndices.at(-1) ?? null, position, mode) });
    },

    // --- Part ---
    addPart: () =>
      run('Part を追加', (m) => addPart(m), (r) => ({
        partIndex: r.indices![0]!, partIndices: r.indices!, articulationIndex: null, articulationIndices: [],
      })),
    async deleteParts(): Promise<boolean> {
      const s = sel();
      if (s.partIndices.length === 0) return false;
      const m = map();
      const names = s.partIndices.map((i) => m.Parts[i]?.Name ?? '');
      const removed = s.partIndices.reduce((n, i) => n + (m.Parts[i]?.Articulations.length ?? 0), 0);
      const preview = deleteParts(m, s.partIndices);
      const refs = clearedRefs(preview.ok ? preview.value : undefined);
      const text = `${deleteMessage('Part', names)} 配下の Articulation ${removed} 件を削除${refs.length > 0 ? `し、${refs.join('と')}を解除します` : 'します'}。`;
      if (!(await ui.confirm(text))) return false;
      return run('Part を削除', (cur) => deleteParts(cur, s.partIndices));
    },
    moveParts: (dir: MoveDirection) => run(`Part を移動（${dir}）`, (m) => moveParts(m, sel().partIndices, dir)),
    movePartsTo: (to: number) => run('Part を移動（D&D）', (m) => movePartsTo(m, sel().partIndices, to)),
    updatePart(patch: PartPatch): boolean {
      const pi = sel().partIndex;
      return pi === null ? false : run('Part を編集', (m) => updatePart(m, pi, patch));
    },

    // --- Articulation（主選択の Part 内） ---
    addArticulation(): boolean {
      const pi = sel().partIndex;
      if (pi === null) return false;
      return run('Articulation を追加', (m) => addArticulation(m, pi), (r) => ({ articulationIndex: r.indices![0]!, articulationIndices: r.indices! }));
    },
    async deleteArticulations(): Promise<boolean> {
      const s = sel();
      if (s.partIndex === null || s.articulationIndices.length === 0) return false;
      const pi = s.partIndex;
      const m = map();
      const names = s.articulationIndices.map((i) => m.Parts[pi]?.Articulations[i]?.Name ?? '');
      const preview = deleteArticulations(m, pi, s.articulationIndices);
      const refs = clearedRefs(preview.ok ? preview.value : undefined);
      const text = deleteMessage('Articulation', names) + (refs.length > 0 ? ` ${refs.join('と')}を解除します。` : '');
      if (!(await ui.confirm(text))) return false;
      return run('Articulation を削除', (cur) => deleteArticulations(cur, pi, s.articulationIndices));
    },
    moveArticulations(dir: MoveDirection): boolean {
      const s = sel();
      const pi = s.partIndex;
      return pi === null ? false : run(`Articulation を移動（${dir}）`, (m) => moveArticulations(m, pi, s.articulationIndices, dir));
    },
    moveArticulationsTo(to: number): boolean {
      const s = sel();
      const pi = s.partIndex;
      return pi === null ? false : run('Articulation を移動（D&D）', (m) => moveArticulationsTo(m, pi, s.articulationIndices, to));
    },
    updateArticulation(patch: ArticulationPatch): boolean {
      const s = sel();
      if (s.partIndex === null || s.articulationIndex === null) return false;
      const [pi, ai] = [s.partIndex, s.articulationIndex];
      return run(patch.Complement !== undefined ? 'Complement を設定' : 'Articulation を編集', (m) => updateArticulation(m, pi, ai, patch));
    },
    /** Complement の解除（確認付き。Windows版 OnClearComplement） */
    async clearComplement(): Promise<boolean> {
      const s = sel();
      if (s.partIndex === null || s.articulationIndex === null) return false;
      const [pi, ai] = [s.partIndex, s.articulationIndex];
      if (!(await ui.confirm('Complement を解除しますか？'))) return false;
      return run('Complement を解除', (m) => updateArticulation(m, pi, ai, { Complement: 0 }));
    },

    // --- DrumMap Order ---
    moveOrder: (dir: MoveDirection) => run(`DrumMap Order を移動（${dir}）`, (m) => moveDrumMapOrder(m, sel().orderIndices, dir)),
    moveOrderTo: (to: number) => run('DrumMap Order を移動（D&D）', (m) => moveDrumMapOrderTo(m, sel().orderIndices, to)),
  };
}

export type PartsActions = ReturnType<typeof createPartsActions>;
