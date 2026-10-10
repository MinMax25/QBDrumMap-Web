import { cloneMap, createEmptyMap, type MapData } from './model';
import { parseQbd } from './load';
import { serializeQbd } from './save';
import type { Result } from './result';

/**
 * 作業モデルの保持者。履歴(Undo/Redo)は後続フェーズで追加する。
 * 読み込み・保存の失敗時は作業モデルを一切変更しない。
 */
export class QbdWorkspace {
  private _map: MapData = createEmptyMap();

  get map(): MapData {
    return this._map;
  }

  /** New: 空のPlugins/Parts（標準DrumMap.qbdは自動ロードしない） */
  createNew(): void {
    this._map = createEmptyMap();
  }

  /** 一時モデルで解析し、成功した場合のみ作業モデルを置換する */
  load(text: string): Result<MapData> {
    const r = parseQbd(text);
    if (r.ok) this._map = r.value;
    return r;
  }

  /** ID正規化して保存文字列を返す。成功時はWindows版同様、正規化後モデルを作業モデルにする */
  save(): Result<string> {
    const r = serializeQbd(this._map);
    if (!r.ok) return r;
    this._map = r.value.normalized;
    return { ok: true, value: r.value.text };
  }

  snapshot(): MapData {
    return cloneMap(this._map);
  }
}
