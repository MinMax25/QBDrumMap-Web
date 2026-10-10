import { validateNames, type NameIssue, type QbdError } from '../../core';
import type { EditorStore } from '../state/editorStore';
import { suggestQbdFileName, type FileIo } from '../services/fileIo';
import { fetchSample, type SampleResult } from '../services/sampleQbd';

/** UIが提供する確認ダイアログ。true=続行 */
export type Confirm = (message: string) => Promise<boolean>;

export interface FileActionDeps {
  store: EditorStore;
  io: FileIo;
  confirm: Confirm;
  /** Coreエラーの通知（UIがメッセージ変換して表示する） */
  onError: (error: QbdError) => void;
  /** 情報通知（例: ダウンロード開始） */
  onNotice?: (message: string) => void;
  /** 公開サンプルの取得（テストで差し替える。省略時は fetch でサイトから取得） */
  loadSample?: () => Promise<SampleResult>;
}

export const NOTICE_DOWNLOAD_STARTED = 'ダウンロードを開始しました（ディスクへの保存完了は確認できません）。';

const ISSUE_LABEL: Record<NameIssue['kind'], string> = { length: '長さが不正（1〜64文字。KitPitchは0〜64文字）', duplicate: '名前が重複' };

/** 保存前の入力検証エラー（Windows版は HasError で保存を中止する）。詳細は最大10件を列挙する */
export function validationError(issues: readonly NameIssue[]): QbdError {
  const lines = issues.slice(0, 10).map((i) => `${i.target} ${i.path}: ${ISSUE_LABEL[i.kind]}「${i.name}」`);
  const more = issues.length > 10 ? `\n…ほか ${issues.length - 10} 件` : '';
  return { code: 'validation-failed', message: `${issues.length} 件の入力エラー\n${lines.join('\n')}${more}` };
}

export const CONFIRM_DISCARD = '未保存の変更があります。破棄して続行しますか？';

/**
 * 新規・開く・保存の操作フロー（Windows版 ShellViewModel の OnNewFile / OnOpenFile / OnSaveFile に対応）。
 * 差異: Windows版もDirtyの時だけ確認する。Web版の保存はダウンロードになる。
 */
export function createFileActions({ store, io, confirm, onError, onNotice, loadSample = () => fetchSample() }: FileActionDeps) {
  const guardDirty = async (): Promise<boolean> => !store.getSnapshot().dirty || (await confirm(CONFIRM_DISCARD));

  return {
    async newFile(): Promise<void> {
      if (!(await guardDirty())) return;
      store.createNew();
    },
    async openFile(): Promise<void> {
      if (!(await guardDirty())) return;
      const f = await io.openText('.qbd,application/json');
      if (!f) return;
      const r = store.load(f.text, f.name);
      if (!r.ok) onError(r.error);
    },
    /**
     * 公開サンプルを開く。未保存の確認は「新規」「開く」と同じ。取得（読むだけ）に成功してから、通常の「開く」と同じ
     * store.load に渡す。確認のキャンセル・取得失敗・解析失敗では、作業中のデータも自動保存データも変更しない。
     * 取得中は busy にして、連打・再実行を防ぐ。
     */
    async openSample(): Promise<void> {
      if (store.getSnapshot().busy) return;
      if (!(await guardDirty())) return;
      await store.runBusy(async () => {
        const r = await loadSample();
        if (!r.ok) {
          onError(r.error);
          return;
        }
        const l = store.load(r.value.text, r.value.name, { sample: true });
        if (!l.ok) onError(l.error);
      });
    },
    /**
     * 保存 = ダウンロードの開始。ブラウザは保存の完了・キャンセルを通知しないため、
     * 開始（ダウンロード要求の発行）に成功した時点を基準にする。開始で例外が出たときは基準を更新せず Dirty も解除しない。
     * 検出できない失敗（ブロック、保存先でのキャンセル、ディスク書き込み失敗）は制限として残る。
     */
    async saveFile(): Promise<void> {
      const issues = validateNames(store.getSnapshot().map);
      if (issues.length > 0) {
        onError(validationError(issues));
        return;
      }
      const name = suggestQbdFileName(store.getSnapshot().fileName);
      const r = store.prepareSave(name);
      if (!r.ok) {
        onError(r.error);
        return;
      }
      try {
        io.saveText(name, r.value.text, 'application/json');
      } catch (e) {
        onError({ code: 'download-failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      store.commitSave(r.value);
      onNotice?.(NOTICE_DOWNLOAD_STARTED);
    },
  };
}
