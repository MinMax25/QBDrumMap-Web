import { describe, expect, it } from 'vitest';
import { applyKitCheck, applyKitClick, applyPluginCheck, pluginState, type TreeSelection } from '../src/ui/export/kitTreeSelection';

const V = ['a', 'b', 'c', 'd', 'e']; // Kit 全体の並び（折りたたまれていても含む）
const sel = (picked: string[], anchor: string | null): TreeSelection => ({ picked: new Set(picked), anchor });
const keys = (s: TreeSelection) => [...s.picked].sort();
const none = { toggle: false, shift: false };

describe('Kit ツリーの選択規則', () => {
  it('通常クリック: その Kit だけを選択し、基準にする', () => {
    const r = applyKitClick(V, sel(['a', 'b'], 'a'), 'c', none);
    expect(keys(r)).toEqual(['c']);
    expect(r.anchor).toBe('c');
  });

  it('Ctrl／Command＋クリック: 反転し、ほかを保持。基準にする', () => {
    const on = applyKitClick(V, sel(['a'], 'a'), 'c', { toggle: true, shift: false });
    expect(keys(on)).toEqual(['a', 'c']);
    expect(on.anchor).toBe('c');
    const off = applyKitClick(V, on, 'a', { toggle: true, shift: false });
    expect(keys(off)).toEqual(['c']);
  });

  it('Shift＋クリック: 基準からの範囲に置き換える（上向きでも）。基準は変わらない', () => {
    const down = applyKitClick(V, sel(['e'], 'b'), 'd', { toggle: false, shift: true });
    expect(keys(down)).toEqual(['b', 'c', 'd']);
    expect(down.anchor).toBe('b');
    const up = applyKitClick(V, sel([], 'd'), 'b', { toggle: false, shift: true });
    expect(keys(up)).toEqual(['b', 'c', 'd']);
  });

  it('Ctrl／Command＋Shift＋クリック: 既存の選択を保持して範囲を加える', () => {
    const r = applyKitClick(V, sel(['a'], 'c'), 'e', { toggle: true, shift: true });
    expect(keys(r)).toEqual(['a', 'c', 'd', 'e']);
    expect(r.anchor).toBe('c');
  });

  it('基準が並びに無い（削除済み）ときは、クリックした Kit だけを選び、新しい基準にする', () => {
    const r = applyKitClick(V, sel(['x'], 'x'), 'c', { toggle: false, shift: true });
    expect(keys(r)).toEqual(['c']);
    expect(r.anchor).toBe('c');
    const none2 = applyKitClick(V, sel(['a'], null), 'c', { toggle: true, shift: true });
    expect(keys(none2)).toEqual(['a', 'c']);
    expect(none2.anchor).toBe('c');
  });

  it('チェックボックス: その Kit だけ切り替え、ほかを保持。基準にする', () => {
    const on = applyKitCheck(sel(['a'], 'a'), 'c', true);
    expect(keys(on)).toEqual(['a', 'c']);
    expect(on.anchor).toBe('c');
    expect(keys(applyKitCheck(on, 'a', false))).toEqual(['c']);
  });

  it('Plugin のチェック: 配下を一括選択・解除（ほかの選択と基準は保持）。3 状態', () => {
    const cur = sel(['z'], 'z');
    const all = applyPluginCheck(cur, ['a', 'b'], true);
    expect(keys(all)).toEqual(['a', 'b', 'z']);
    expect(all.anchor).toBe('z');
    expect(pluginState(['a', 'b'], all.picked)).toBe('all');
    expect(pluginState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(pluginState(['a', 'b'], new Set(['z']))).toBe('none');
    expect(keys(applyPluginCheck(all, ['a', 'b'], false))).toEqual(['z']);
  });
});
