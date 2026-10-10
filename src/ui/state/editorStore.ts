import {
  cloneMap, createEmptyMap, normalizeIds, parseQbd, serializeQbd,
  type EditResult, type KitRef, type MapData, type QbdError, type Result,
} from '../../core';
import { remapSelection } from './selectionIdentity';

/**
 * 編集状態の保持者（UI非依存。Reactからは subscribe / getSnapshot で購読する）。
 *
 * 方針（UI Phase 2 の確定方針に基づく）:
 * - 履歴: 操作単位のモデル・スナップショット。1回の複合操作 = 1履歴。上限 DEFAULT_HISTORY_LIMIT（暫定30。実測で見直す）。
 *   Coreの編集関数は変更した経路だけを複製して返すため、スナップショットは構造共有される（edit()）。
 * - Dirty: 基準モデル（最後に正常に読み込んだ／保存を開始した時点）との**内容比較**。履歴位置では判定しない。
 *   内容比較は Articulation / Plugin / Kit の ID 採番の違いを無視する（normalizeIds 後の内容で比較）。
 *   Undoで内容が一致すれば解消する。
 * - 保存: 作業モデルは置換しない（ID正規化したモデルは保存テキストにだけ使う）。履歴中のスナップショットは
 *   互いに自己完結しており、保存をまたぐUndo/Redoでも参照不整合は起きない。基準モデルの更新は commitSave。
 * - 選択は履歴に含めない。編集・Undo・Redo のたびに、選択を「同じ要素」で追従させ直す（selectionIdentity.ts。
 *   Plugin／Kit は ID、KitPitch は所属Kit内の Pitch 番号が基準。存在しない・同定できない要素は解除する）。読込・新規は選択をリセットする。
 * 失敗した操作は作業モデル・履歴・Dirtyを一切変更しない。
 */
export const DEFAULT_HISTORY_LIMIT = 30;

export interface Selection {
  /** 表示するPlugin（一覧の主選択） */
  pluginIndex: number | null;
  /** 複数選択（削除・並べ替えの対象）。主選択を含む */
  pluginIndices: number[];
  kitIndex: number | null;
  kitIndices: number[];
  pitchIndices: number[];
  /** Parts タブ: 表示する Part（一覧の主選択） */
  partIndex: number | null;
  /** Parts タブ: 複数選択（削除・並べ替えの対象）。主選択を含む */
  partIndices: number[];
  /** Parts タブ: 主選択の Part 内の Articulation 位置（主選択と複数選択） */
  articulationIndex: number | null;
  articulationIndices: number[];
  /** DrumMap Order タブ: 一覧（listDrumMapOrder の表示順）内の位置 */
  orderIndices: number[];
}

export interface EditorState {
  readonly map: MapData;
  readonly fileName: string | null;
  /** 公開サンプルから開いた文書か（タイトルの表示用。保存名・Dirty には影響しない） */
  readonly sample: boolean;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** 直前に取り消し／やり直しできる操作の表示名 */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly historyLength: number;
  readonly busy: boolean;
  readonly selection: Selection;
}

export type StoreResult<T = void> = { ok: true; value: T } | { ok: false; error: QbdError };

/** 保存の準備結果。ダウンロード開始に成功したら commitSave に渡す */
export interface PreparedSave {
  text: string;
  fileName: string | null;
  baselineMap: MapData;
}

interface HistoryEntry {
  label: string;
  before: MapData;
  after: MapData;
}

export const emptySelection: Selection = {
  pluginIndex: null, pluginIndices: [], kitIndex: null, kitIndices: [], pitchIndices: [], partIndex: null,
  partIndices: [], articulationIndex: null, articulationIndices: [], orderIndices: [],
};

/** 主選択のKit位置（Plugin・Kit のどちらかが未選択なら null） */
export function activeKitRef(s: Selection): KitRef | null {
  return s.pluginIndex !== null && s.kitIndex !== null ? { pluginIndex: s.pluginIndex, kitIndex: s.kitIndex } : null;
}

/**
 * 内容比較用のキー。オブジェクトのキー順に依存しないよう、キーを整列して直列化する
 * （読込直後のモデルと cloneMap 後のモデルはキー順が異なるため、単純な JSON.stringify では誤判定する）。
 * Extra（未知フィールド）も含めて比較する。
 */
export function contentKey(map: MapData): string {
  return JSON.stringify(map, (_k, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Dirty判定用のキー: ID正規化後の内容（正規化できない異常データは生の内容） */
export function dirtyKey(map: MapData): string {
  const n = normalizeIds(map);
  return n.ok ? `N${contentKey(n.value)}` : `R${contentKey(map)}`;
}

const inRange = (list: readonly number[], len: number): number[] => list.filter((i) => Number.isInteger(i) && i >= 0 && i < len);

/** 範囲外・存在しない選択を取り除く（Undo/Redo/削除/読込の後の補正） */
export function sanitizeSelection(map: MapData, s: Selection): Selection {
  const pluginIndices = inRange(s.pluginIndices, map.Plugins.length);
  const pluginIndex = s.pluginIndex !== null && s.pluginIndex < map.Plugins.length && s.pluginIndex >= 0 ? s.pluginIndex : null;
  const plugin = pluginIndex !== null ? map.Plugins[pluginIndex] : undefined;
  const kitLen = plugin?.Kits.length ?? 0;
  const kitIndex = plugin && s.kitIndex !== null && s.kitIndex >= 0 && s.kitIndex < kitLen ? s.kitIndex : null;
  const kitIndices = plugin ? inRange(s.kitIndices, kitLen) : [];
  const kit = kitIndex !== null ? plugin?.Kits[kitIndex] : undefined;
  const pitchIndices = kit ? inRange(s.pitchIndices, kit.Pitches.length) : [];
  const partIndex = s.partIndex !== null && s.partIndex >= 0 && s.partIndex < map.Parts.length ? s.partIndex : null;
  const partIndices = inRange(s.partIndices, map.Parts.length);
  const articulations = partIndex !== null ? map.Parts[partIndex]!.Articulations : undefined;
  const articulationIndex =
    articulations && s.articulationIndex !== null && s.articulationIndex >= 0 && s.articulationIndex < articulations.length ? s.articulationIndex : null;
  const articulationIndices = articulations ? inRange(s.articulationIndices, articulations.length) : [];
  const orderIndices = inRange(s.orderIndices, map.Parts.reduce((n, p) => n + p.Articulations.length, 0));
  const same =
    pluginIndex === s.pluginIndex && kitIndex === s.kitIndex && partIndex === s.partIndex && articulationIndex === s.articulationIndex &&
    pluginIndices.length === s.pluginIndices.length && kitIndices.length === s.kitIndices.length &&
    pitchIndices.length === s.pitchIndices.length && partIndices.length === s.partIndices.length &&
    articulationIndices.length === s.articulationIndices.length && orderIndices.length === s.orderIndices.length;
  return same ? s : {
    pluginIndex, pluginIndices, kitIndex, kitIndices, pitchIndices, partIndex, partIndices, articulationIndex, articulationIndices, orderIndices,
  };
}

export class EditorStore {
  private _map: MapData = createEmptyMap();
  private _fileName: string | null = null;
  private _sample = false;
  private _baselineMap: MapData = this._map;
  private _baselineKey: string | null = null;
  private _undo: HistoryEntry[] = [];
  private _redo: HistoryEntry[] = [];
  private _busy = false;
  private _selection: Selection = emptySelection;
  private _listeners = new Set<() => void>();
  private _state: EditorState;
  /** dirtyKey は大きなモデルで重いため、モデルが変わったときだけ再計算する */
  private _keyMemo: { map: MapData; key: string } | null = null;

  constructor(private readonly historyLimit: number = DEFAULT_HISTORY_LIMIT) {
    this._state = this.compute();
  }

  // --- 購読（useSyncExternalStore 用） ---
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this._state;

  private emit(): void {
    this._state = this.compute();
    this._listeners.forEach((l) => l());
  }

  private keyOf(map: MapData): string {
    if (this._keyMemo?.map !== map) this._keyMemo = { map, key: dirtyKey(map) };
    return this._keyMemo.key;
  }

  private isDirty(): boolean {
    if (this._map === this._baselineMap) return false; // 基準そのもの（Undoで基準のスナップショットへ戻った場合を含む）
    if (this._baselineKey === null) this._baselineKey = dirtyKey(this._baselineMap);
    return this.keyOf(this._map) !== this._baselineKey;
  }

  private compute(): EditorState {
    return {
      map: this._map,
      fileName: this._fileName,
      sample: this._sample,
      dirty: this.isDirty(),
      canUndo: this._undo.length > 0,
      canRedo: this._redo.length > 0,
      undoLabel: this._undo.at(-1)?.label ?? null,
      redoLabel: this._redo.at(-1)?.label ?? null,
      historyLength: this._undo.length,
      busy: this._busy,
      selection: this._selection,
    };
  }

  // --- ファイル単位の操作（読込・新規は履歴を破棄して新しい基準にする） ---
  createNew(): void {
    this.replaceAll(createEmptyMap(), null);
  }

  /** 解析に失敗した場合は何も変更しない */
  load(text: string, fileName: string | null, options: { sample?: boolean } = {}): StoreResult {
    const r = parseQbd(text);
    if (!r.ok) return r;
    this.replaceAll(r.value, fileName, options.sample === true);
    return { ok: true, value: undefined };
  }

  /**
   * 保存テキストを作る（状態は変更しない）。ID正規化はテキストにだけ反映し、作業モデルは置換しない。
   * ダウンロードの開始に成功したら commitSave を呼ぶ。失敗・キャンセル時は呼ばない（Dirtyは解除されない）。
   */
  prepareSave(fileName: string | null = this._fileName): StoreResult<PreparedSave> {
    const r = serializeQbd(this._map);
    if (!r.ok) return r;
    return { ok: true, value: { text: r.value.text, fileName, baselineMap: this._map } };
  }

  /** 保存（ダウンロード）を開始できた時点を基準にする。履歴は維持する */
  commitSave(prepared: PreparedSave): void {
    this._baselineMap = prepared.baselineMap;
    this._baselineKey = null;
    this._fileName = prepared.fileName;
    this.emit();
  }

  /** 保存基準のモデル（Dirty 判定の基準。作業状態の自動保存が、未保存のときだけ併せて保存する） */
  get baselineMap(): MapData {
    return this._baselineMap;
  }

  /**
   * 前回の作業状態の復元（読込・新規と同様に履歴は破棄する。Undo/Redo は復元しない）。
   * baselineMap が null のときは保存済み（作業モデルが基準）として扱う。選択は現在のモデルに合わせて補正する。
   */
  restore(map: MapData, baselineMap: MapData | null, fileName: string | null, selection: Selection, sample = false): void {
    this._sample = sample;
    this._map = map;
    this._baselineMap = baselineMap ?? map;
    this._baselineKey = null;
    this._fileName = fileName;
    this._undo = [];
    this._redo = [];
    this._selection = sanitizeSelection(map, selection);
    this.emit();
  }

  private replaceAll(map: MapData, fileName: string | null, sample = false): void {
    this._sample = sample;
    this._map = map;
    this._baselineMap = map;
    this._baselineKey = null;
    this._fileName = fileName;
    this._undo = [];
    this._redo = [];
    this._selection = emptySelection;
    this.emit();
  }

  // --- 編集操作 ---
  private push(label: string, next: MapData, selection?: Partial<Selection>): void {
    const entry: HistoryEntry = { label, before: this._map, after: next };
    this._map = next;
    this._undo.push(entry);
    if (this._undo.length > this.historyLimit) this._undo.shift();
    this._redo = [];
    // 既存の選択を同じ要素で追従させ、そのうえで操作が指定した選択（追加した要素の選択など）を反映する
    this._selection = sanitizeSelection(next, { ...remapSelection(entry.before, next, this._selection), ...selection });
    this.emit();
  }

  /**
   * Coreの編集関数（変更した経路だけを複製して EditResult を返す）を1回の取り消し単位として適用する。
   * 結果は複製せずに保持する（構造共有）。changed:false は何も変更せず履歴にも積まない。
   * 失敗（ok:false）または例外のときは何も変更しない。`selection` は成功時に選択へ反映する（無効な選択は補正）。
   */
  edit(
    label: string,
    recipe: (current: MapData) => Result<EditResult>,
    selection?: (r: EditResult) => Partial<Selection>,
  ): StoreResult<EditResult> {
    let r: Result<EditResult>;
    try {
      r = recipe(this._map);
    } catch (e) {
      return { ok: false, error: { code: 'unexpected', message: e instanceof Error ? e.message : String(e) } };
    }
    if (!r.ok) return r;
    if (!r.value.changed) return { ok: true, value: r.value };
    this.push(label, r.value.map, selection?.(r.value));
    return { ok: true, value: r.value };
  }

  /**
   * 任意の編集関数（Auto Assign など、構造共有しない関数）を1回の取り消し単位として適用する。
   * 結果は複製して保持する（呼び出し側が後で書き換えても履歴を壊さない）。失敗・例外時は何も変更しない。
   */
  apply(label: string, recipe: (current: MapData) => StoreResult<MapData> | { ok: true; value: MapData }): StoreResult {
    let next: StoreResult<MapData>;
    try {
      next = recipe(this._map);
    } catch (e) {
      return { ok: false, error: { code: 'unexpected', message: e instanceof Error ? e.message : String(e) } };
    }
    if (!next.ok) return next;
    this.push(label, cloneMap(next.value));
    return { ok: true, value: undefined };
  }

  undo(): boolean {
    const e = this._undo.pop();
    if (!e) return false;
    this._selection = sanitizeSelection(e.before, remapSelection(this._map, e.before, this._selection));
    this._map = e.before;
    this._redo.push(e);
    this.emit();
    return true;
  }

  redo(): boolean {
    const e = this._redo.pop();
    if (!e) return false;
    this._selection = sanitizeSelection(e.after, remapSelection(this._map, e.after, this._selection));
    this._map = e.after;
    this._undo.push(e);
    this.emit();
    return true;
  }

  // --- 選択・処理中（履歴・Dirtyに影響しない） ---
  select(partial: Partial<Selection>): void {
    this._selection = sanitizeSelection(this._map, { ...this._selection, ...partial });
    this.emit();
  }

  /** 処理中フラグつきで非同期処理を実行する。二重実行は拒否する。 */
  async runBusy<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (this._busy) return undefined;
    this._busy = true;
    this.emit();
    try {
      return await task();
    } finally {
      this._busy = false;
      this.emit();
    }
  }
}
