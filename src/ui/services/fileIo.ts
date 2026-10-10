/**
 * ブラウザのファイル操作の境界。UI/ストアはこのインターフェースだけに依存し、
 * テストでは差し替える。サーバー不要（静的ホスティングで動く）。
 */
export interface OpenedFile {
  name: string;
  text: string;
}

export interface OpenedBinary {
  name: string;
  bytes: Uint8Array;
}

export interface FileIo {
  /** ユーザーにファイルを選ばせて読む。キャンセル時は null */
  openText(accept: string): Promise<OpenedFile | null>;
  /** ユーザーにファイルを選ばせてバイナリのまま読む（文字列変換しない）。キャンセル時は null。未提供の実装では MIDI を読めない */
  openBinary?(accept: string): Promise<OpenedBinary | null>;
  /** ダウンロードとして保存する（ブラウザは保存先を確定できない） */
  saveText(fileName: string, text: string, mime: string): void;
  /** バイト列をダウンロードとして保存する（ZIP・BOM付きテキスト用）。未提供の実装ではExportできない */
  saveBytes?(fileName: string, bytes: Uint8Array, mime: string): void;
}

/** 保存ファイル名の提案（拡張子 .qbd を保証。空なら DrumMap.qbd） */
export function suggestQbdFileName(current: string | null): string {
  const base = (current ?? '').trim();
  if (base === '') return 'DrumMap.qbd';
  return /\.qbd$/i.test(base) ? base : `${base}.qbd`;
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** <input type=file> とアンカーのダウンロードによる標準実装（File System Access API は Phase 2 以降で検討） */
export const browserFileIo: FileIo = {
  openText(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, text: await f.text() } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
  openBinary(accept) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        try {
          resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        } catch (e) {
          reject(e);
        }
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
  saveText(fileName, text, mime) {
    downloadBlob(fileName, new Blob([text], { type: mime }));
  },
  saveBytes(fileName, bytes, mime) {
    downloadBlob(fileName, new Blob([bytes as BlobPart], { type: mime }));
  },
};
