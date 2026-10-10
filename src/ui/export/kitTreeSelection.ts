/**
 * Kit ツリーの選択規則（Windows版の DataGrid の Ctrl／Shift 選択に相当）。画面に依存しない純粋関数。
 * 範囲は Kit 全体の並び順（画面の上から下。Plugin を折りたたんでいても含める）を基準にする。Plugin 見出しは含めない。
 */

export interface TreeSelection {
  picked: ReadonlySet<string>;
  /** 範囲選択の基準 Kit。無い・並びに無いときは null として扱う */
  anchor: string | null;
}

export interface ClickModifiers {
  /** Ctrl（macOS では Command） */
  toggle: boolean;
  shift: boolean;
}

const rangeKeys = (visible: readonly string[], from: string | null, to: string): string[] => {
  const t = visible.indexOf(to);
  const f = from === null ? -1 : visible.indexOf(from);
  // 基準が削除済み（並びに無い）なら、クリックした Kit だけを範囲とし、それを新しい基準にする
  if (t < 0) return [];
  if (f < 0) return [to];
  const [a, b] = f <= t ? [f, t] : [t, f];
  return visible.slice(a, b + 1);
};

/**
 * Kit 行のクリック。
 * - 修飾なし：その Kit だけを選択し、基準にする。
 * - Ctrl／Command：その Kit を反転し、ほかを保持。基準にする。
 * - Shift：基準からクリックまでの範囲に置き換える（基準は変えない。基準が無効ならクリックを新しい基準にして、その Kit だけ）。
 * - Ctrl／Command＋Shift：既存の選択を保持して範囲を加える（基準の扱いは Shift と同じ）。
 */
export function applyKitClick(visible: readonly string[], cur: TreeSelection, key: string, mods: ClickModifiers): TreeSelection {
  if (mods.shift) {
    const anchorValid = cur.anchor !== null && visible.includes(cur.anchor);
    const range = rangeKeys(visible, cur.anchor, key);
    const picked = new Set(mods.toggle ? cur.picked : []);
    for (const k of range) picked.add(k);
    return { picked, anchor: anchorValid ? cur.anchor : key };
  }
  if (mods.toggle) {
    const picked = new Set(cur.picked);
    if (picked.has(key)) picked.delete(key); else picked.add(key);
    return { picked, anchor: key };
  }
  return { picked: new Set([key]), anchor: key };
}

/** Kit のチェックボックス直接操作：その Kit だけ反転し、ほかは保持。基準にする（行クリックとの二重発火は呼び出し側で止める） */
export function applyKitCheck(cur: TreeSelection, key: string, on: boolean): TreeSelection {
  const picked = new Set(cur.picked);
  if (on) picked.add(key); else picked.delete(key);
  return { picked, anchor: key };
}

/** Plugin のチェック：配下の Kit（折りたたみ中も含む）をすべて選択／解除。ほかの Plugin の選択と基準は保持 */
export function applyPluginCheck(cur: TreeSelection, kitKeys: readonly string[], on: boolean): TreeSelection {
  const picked = new Set(cur.picked);
  for (const k of kitKeys) { if (on) picked.add(k); else picked.delete(k); }
  return { picked, anchor: cur.anchor };
}

/** 3 状態（未選択／一部選択／全選択） */
export function pluginState(kitKeys: readonly string[], picked: ReadonlySet<string>): 'none' | 'some' | 'all' {
  const n = kitKeys.filter((k) => picked.has(k)).length;
  return n === 0 ? 'none' : n === kitKeys.length ? 'all' : 'some';
}
