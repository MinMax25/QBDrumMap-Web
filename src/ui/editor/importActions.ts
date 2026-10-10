import type { FileIo } from '../services/fileIo';
import { activeKitRef, type EditorStore } from '../state/editorStore';
import type { EditorUi } from './pluginsKitsActions';
import { IMPORT_ACCEPT, importConfirmText, planImport } from './importPlan';

/**
 * 選択中の1 Kit への Import（Windows版 KitPitchesPanelViewModel.OnImport に対応）。
 * 流れ: ファイル選択 → 解析（作業モデルは変更しない）→ プレビュー付き確認 → 1回の取り消し単位で適用。
 * キャンセル・解析失敗・変更なしでは作業モデル・Dirty・選択・Undo/Redo を変更しない。
 * Import は Plugin／Kit／Pitch の ID と Pitch 番号を変更しないため、選択は既存の同一性ルールで追従する。
 */
export function createImportActions(store: EditorStore, ui: EditorUi, io: FileIo) {
  return {
    async importIntoSelectedKit(): Promise<boolean> {
      const ref = activeKitRef(store.getSnapshot().selection);
      if (!ref) return false;
      const f = await io.openText(IMPORT_ACCEPT);
      if (!f) return false;
      const startMap = store.getSnapshot().map;
      const plan = planImport(startMap, ref, f.name, f.text);
      if (!plan.ok) {
        ui.onError(plan.error);
        return false;
      }
      if (!(await ui.confirm(importConfirmText(plan.value.preview)))) return false;
      // 確認中にモデルが変わっていたら、プレビューと適用結果がずれるため適用しない
      if (store.getSnapshot().map !== startMap) {
        ui.onError({ code: 'stale-import', message: '確認中に内容が変更されたため、取り込みを中止しました。' });
        return false;
      }
      const pv = plan.value.preview;
      const changed = pv.kitNameBefore !== pv.kitNameAfter || pv.nameChanged + pv.articulationCleared + pv.articulationAssigned + pv.separatorChanged + pv.orderChanged > 0;
      if (!changed) {
        ui.notify?.('変更はありません（取り込み内容は現在の Kit と同じです）。');
        return false;
      }
      const r = store.edit('Import', () => ({ ok: true, value: { map: plan.value.next, changed: true } }));
      if (!r.ok) {
        ui.onError(r.error);
        return false;
      }
      ui.notify?.(`取り込みました: ${plan.value.preview.fileName}`);
      return true;
    },
  };
}
