import {
  applyAutoAssign, compressForward, copyArticulations, defaultPartNameDictionary, findUndefinedSeparators, resetOrderByPitch,
  type AutoAssignEditResult, type CopyArticulationResult, type KitRef,
  addKit, addPlugin, clearKitPitches, deleteKits, deletePlugins, moveKitPitches, moveKitPitchesTo, moveKits, moveKitsTo,
  movePlugins, movePluginsTo, setArticulationForSameName, updateKit, updateKitPitch, updatePlugin,
  type EditResult, type EnumValue, type KitPatch, type KitPitchPatch, type MoveDirection, type PluginPatch, type PluginType,
  type PartNameAlias, type QbdError, type Separator,
} from '../../core';
import { activeKitRef, type EditorStore, type Selection } from '../state/editorStore';

/** UIが提供する機能（確認ダイアログ・エラー通知）。テストでは差し替える */
export interface EditorUi {
  confirm(message: string): Promise<boolean>;
  onError(error: QbdError): void;
  /** 操作結果の通知（Auto Assign の件数など）。未提供なら通知しない */
  notify?(message: string): void;
}

export const deleteMessage = (kind: string, names: readonly string[]): string => `${kind} を削除しますか？: ${names.join(', ')}`;

/**
 * Plugins & Kits タブの操作。モデル変更はすべて Core の純粋関数で行い、ここは「どの関数を・どの選択で呼ぶか」と
 * 結果の選択への反映だけを担う。失敗時は何も変更せずエラーを通知する。
 */
export function createPluginsKitsActions(
  store: EditorStore, ui: EditorUi, getDictionary: () => readonly PartNameAlias[] = defaultPartNameDictionary,
) {
  const sel = (): Selection => store.getSnapshot().selection;
  const run = (label: string, recipe: Parameters<EditorStore['edit']>[1], select?: (r: EditResult) => Partial<Selection>): boolean => {
    const r = store.edit(label, recipe, select);
    if (!r.ok) ui.onError(r.error);
    return r.ok && r.value.changed;
  };

  const updatePitch = (pitchIndex: number, patch: KitPitchPatch): boolean => {
    const ref = activeKitRef(sel());
    return ref ? run('Pitch を編集', (m) => updateKitPitch(m, ref, pitchIndex, patch)) : false;
  };

  return {
    // --- 選択 ---
    selectPlugin(index: number, mode: 'single' | 'toggle' | 'range' = 'single'): void {
      const s = sel();
      let indices: number[];
      if (mode === 'toggle') indices = s.pluginIndices.includes(index) ? s.pluginIndices.filter((i) => i !== index) : [...s.pluginIndices, index];
      else if (mode === 'range' && s.pluginIndex !== null) {
        const [a, b] = [Math.min(s.pluginIndex, index), Math.max(s.pluginIndex, index)];
        indices = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      } else indices = [index];
      const keepKit = s.pluginIndex === index;
      store.select({
        pluginIndex: index, pluginIndices: indices,
        ...(keepKit ? {} : { kitIndex: null, kitIndices: [], pitchIndices: [] }),
      });
    },
    selectKit(index: number, mode: 'single' | 'toggle' | 'range' = 'single'): void {
      const s = sel();
      let indices: number[];
      if (mode === 'toggle') indices = s.kitIndices.includes(index) ? s.kitIndices.filter((i) => i !== index) : [...s.kitIndices, index];
      else if (mode === 'range' && s.kitIndex !== null) {
        const [a, b] = [Math.min(s.kitIndex, index), Math.max(s.kitIndex, index)];
        indices = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      } else indices = [index];
      store.select({ kitIndex: index, kitIndices: indices, ...(s.kitIndex === index ? {} : { pitchIndices: [] }) });
    },
    selectPitch(index: number, mode: 'single' | 'toggle' | 'range' = 'single', visible?: readonly number[]): void {
      const s = sel();
      let indices: number[];
      if (mode === 'toggle') indices = s.pitchIndices.includes(index) ? s.pitchIndices.filter((i) => i !== index) : [...s.pitchIndices, index];
      else if (mode === 'range' && s.pitchIndices.length > 0) {
        const anchor = s.pitchIndices[s.pitchIndices.length - 1]!;
        const list = visible ?? Array.from({ length: 128 }, (_, i) => i);
        const [a, b] = [list.indexOf(anchor), list.indexOf(index)];
        indices = a < 0 || b < 0 ? [index] : list.slice(Math.min(a, b), Math.max(a, b) + 1);
      } else indices = [index];
      store.select({ pitchIndices: indices });
    },

    // --- Plugin ---
    addPlugin: () =>
      run('Plugin を追加', (m) => addPlugin(m), (r) => ({
        pluginIndex: r.indices![0]!, pluginIndices: r.indices!, kitIndex: null, kitIndices: [], pitchIndices: [],
      })),
    async deletePlugins(): Promise<boolean> {
      const s = sel();
      if (s.pluginIndices.length === 0) return false;
      const names = s.pluginIndices.map((i) => store.getSnapshot().map.Plugins[i]?.Name ?? '');
      if (!(await ui.confirm(deleteMessage('Plugin', names)))) return false;
      return run('Plugin を削除', (m) => deletePlugins(m, s.pluginIndices)); // 削除された要素と配下の選択はストアが解除する
    },
    movePlugins(dir: MoveDirection): boolean {
      const s = sel();
      return run(`Plugin を移動（${dir}）`, (m) => movePlugins(m, s.pluginIndices, dir)); // 選択は同じ要素へストアが追従させる
    },
    movePluginsTo(to: number): boolean {
      const s = sel();
      return run('Plugin を移動（D&D）', (m) => movePluginsTo(m, s.pluginIndices, to));
    },
    updatePlugin: (pluginIndex: number, patch: PluginPatch) => run('Plugin を編集', (m) => updatePlugin(m, pluginIndex, patch)),
    setPluginType: (pluginIndex: number, type: EnumValue<PluginType>) =>
      run('Plugin を編集', (m) => updatePlugin(m, pluginIndex, { PluginType: type })),

    // --- Kit ---
    addKit(): boolean {
      const s = sel();
      if (s.pluginIndex === null) return false;
      const pi = s.pluginIndex;
      return run('Kit を追加', (m) => addKit(m, pi), (r) => ({ kitIndex: r.indices![0]!, kitIndices: r.indices!, pitchIndices: [] }));
    },
    async deleteKits(): Promise<boolean> {
      const s = sel();
      if (s.pluginIndex === null || s.kitIndices.length === 0) return false;
      const pi = s.pluginIndex;
      const plugin = store.getSnapshot().map.Plugins[pi];
      const names = s.kitIndices.map((i) => plugin?.Kits[i]?.Name ?? '');
      if (!(await ui.confirm(deleteMessage('Kit', names)))) return false;
      return run('Kit を削除', (m) => deleteKits(m, pi, s.kitIndices));
    },
    moveKits(dir: MoveDirection): boolean {
      const s = sel();
      if (s.pluginIndex === null) return false;
      const pi = s.pluginIndex;
      return run(`Kit を移動（${dir}）`, (m) => moveKits(m, pi, s.kitIndices, dir));
    },
    moveKitsTo(to: number): boolean {
      const s = sel();
      if (s.pluginIndex === null) return false;
      const pi = s.pluginIndex;
      return run('Kit を移動（D&D）', (m) => moveKitsTo(m, pi, s.kitIndices, to));
    },
    updateKit(patch: KitPatch): boolean {
      const ref = activeKitRef(sel());
      return ref ? run('Kit を編集', (m) => updateKit(m, ref, patch)) : false;
    },

    // --- KitPitch ---
    updatePitch,
    setSeparator: (pitchIndex: number, value: Separator) => updatePitch(pitchIndex, { Separator: value }),
    /** Articulation の設定。同名の行が他にもあるときは「すべての同名の行に設定するか」を確認する（Windows版 OnSearchArticulation） */
    async setArticulation(pitchIndex: number, articulationId: number): Promise<boolean> {
      const ref = activeKitRef(sel());
      if (!ref) return false;
      const kit = store.getSnapshot().map.Plugins[ref.pluginIndex]?.Kits[ref.kitIndex];
      const row = kit?.Pitches[pitchIndex];
      if (!kit || !row) return false;
      const sameName = kit.Pitches.filter((p) => p.Name === row.Name).length > 1;
      if (sameName && (await ui.confirm('同じ名前の他の行にも、この Articulation を設定しますか？'))) {
        return run('Articulation を設定（同名の行）', (m) => setArticulationForSameName(m, ref, pitchIndex, articulationId));
      }
      return run('Articulation を設定', (m) => updateKitPitch(m, ref, pitchIndex, { ArticulationID: articulationId }));
    },
    async clearSelectedPitches(): Promise<boolean> {
      const s = sel();
      const ref = activeKitRef(s);
      if (!ref || s.pitchIndices.length === 0) return false;
      if (!(await ui.confirm('選択した行の Name・Articulation・Separator をクリアしますか？'))) return false;
      return run('Pitch をクリア', (m) => clearKitPitches(m, ref, s.pitchIndices));
    },
    movePitches(dir: MoveDirection): boolean {
      const s = sel();
      const ref = activeKitRef(s);
      if (!ref) return false;
      return run(`Pitch 行を移動（${dir}）`, (m) => moveKitPitches(m, ref, s.pitchIndices, dir));
    },
    /** Windows版 ResetOrderByPitch: Pitch 番号順に整列する（確認あり）。選択は Pitch 番号で追従する */
    async resetOrderByPitch(): Promise<boolean> {
      const ref = activeKitRef(sel());
      if (!ref) return false;
      if (!(await ui.confirm('Pitch 番号の順に並べ替えますか？'))) return false;
      return run('Pitch 行を Pitch 順に整列', (m) => resetOrderByPitch(m, ref));
    },
    /** Windows版 CompressForward: Name のある行を前に、空の行を後ろに詰める（確認あり） */
    async compressForward(): Promise<boolean> {
      const ref = activeKitRef(sel());
      if (!ref) return false;
      if (!(await ui.confirm('Name のある行を前に詰め、空の行を後ろに寄せますか？'))) return false;
      return run('Pitch 行を前詰め', (m) => compressForward(m, ref));
    },
    /** Windows版 CopyArticulation の Web版: 他の Kit から、同じ Pitch 番号の行の Articulation・Separator をコピーする（確認あり） */
    async copyArticulation(source: KitRef): Promise<boolean> {
      const ref = activeKitRef(sel());
      if (!ref) return false;
      if (!(await ui.confirm('コピー元 Kit の Articulation と Separator を、同じ Pitch 番号の行へコピーします。コピー先の既存の割当は上書きされます。実行しますか？'))) {
        return false;
      }
      let detail: CopyArticulationResult | undefined;
      const changed = run('Articulation をコピー', (m) => {
        const r = copyArticulations(m, source, ref);
        if (r.ok) detail = r.value;
        return r;
      });
      if (detail) {
        const parts = [`${detail.copied} 行をコピーしました`];
        if (detail.cleared > 0) parts.push(`${detail.cleared} 行は Name が空のため割当を外しました`);
        if (detail.missingInSource > 0) parts.push(`${detail.missingInSource} 行はコピー元に同じ Pitch の行がないため変更していません`);
        ui.notify?.(changed ? `${parts.join('。')}。` : `変更はありません。${detail.missingInSource > 0 ? `${detail.missingInSource} 行はコピー元に同じ Pitch の行がありません。` : ''}`);
      }
      return changed;
    },
    /** Auto Assign（mode:'web'、辞書は実行時に getDictionary で取得した Part 名辞書）。確認のうえ1操作で適用し、件数を通知する。未定義の Separator は自動修正しない */
    async autoAssign(): Promise<boolean> {
      const ref = activeKitRef(sel());
      if (!ref) return false;
      if (!(await ui.confirm('この Kit の Articulation を、Part 名の辞書と他の Kit の割当に基づいて自動で割り当てます。実行しますか？'))) return false;
      let detail: AutoAssignEditResult | undefined;
      const changed = run('Articulation を自動割当', (m) => {
        const r = applyAutoAssign(m, ref, getDictionary(), { mode: 'web' });
        if (r.ok) detail = r.value;
        return r;
      });
      if (detail) {
        let text = `${detail.assigned} 行に割り当てました。${detail.skipped} 行は一致する候補がなく、割り当てていません。`;
        if (!changed) text = `変更はありません。${text}`;
        const undef = findUndefinedSeparators(store.getSnapshot().map).length;
        if (undef > 0) text += ` 未定義の Separator 値が ${undef} 行あります（自動修正していません）。`;
        ui.notify?.(text);
      }
      return changed;
    },
    movePitchesTo(to: number): boolean {
      const s = sel();
      const ref = activeKitRef(s);
      if (!ref) return false;
      return run('Pitch 行を移動（D&D）', (m) => moveKitPitchesTo(m, ref, s.pitchIndices, to));
    },
  };
}

export type PluginsKitsActions = ReturnType<typeof createPluginsKitsActions>;
