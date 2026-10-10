// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KitTree, listKits } from '../../src/ui/export/KitTree';
import { parseQbd } from '../../src/core';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

/** Plugin A（K1〜K3）・B（K4〜K5）・C（K6）の 3 Plugin */
const model = () => {
  const r = parseQbd(gmSmall);
  if (!r.ok) throw new Error('fixture');
  const kit = (id: number, name: string) => ({ ...r.value.Plugins[0]!.Kits[0]!, ID: id, Name: name });
  const pl = (id: number, name: string, kits: [number, string][]) => ({ ...r.value.Plugins[0]!, ID: id, Name: name, Kits: kits.map(([i, n]) => kit(i, n)) });
  return { ...r.value, Plugins: [pl(1, 'A', [[1, 'K1'], [2, 'K2'], [3, 'K3']]), pl(2, 'B', [[4, 'K4'], [5, 'K5']]), pl(3, 'C', [[6, 'K6']])] };
};

let latest: ReadonlySet<string> = new Set();
function Host({ map }: { map: ReturnType<typeof model> }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  latest = picked;
  return <KitTree rows={listKits(map)} picked={picked} onChange={setPicked} label="出力する Kit" />;
}
const names = () => {
  const m = model();
  const byKey = new Map(listKits(m).map((r) => [r.key, r.kitName]));
  return [...latest].map((k) => byKey.get(k)!).sort();
};
const box = (n: string) => screen.getByRole('checkbox', { name: n });
const kit = (n: string) => box(n).closest('[role=treeitem]') as HTMLElement;
const click = (n: string, init?: MouseEventInit) => fireEvent.click(kit(n), init);
const count = () => screen.getByTestId('kit-count').textContent;

describe('KitTree（Export・Convert MIDI 共通）', () => {
  it('ヘッダー（すべて選択・選択を解除・件数）はスクロールするツリーの外にある。件数は実際の選択数', () => {
    render(<Host map={model()} />);
    const tree = screen.getByRole('tree');
    for (const el of [screen.getByRole('button', { name: 'すべて選択' }), screen.getByRole('button', { name: '選択を解除' }), screen.getByTestId('kit-count')]) {
      expect(tree.contains(el)).toBe(false);
    }
    expect(count()).toBe('選択中: 0 Kits');
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }));
    expect(count()).toBe('選択中: 6 Kits');
    fireEvent.click(screen.getByRole('button', { name: '選択を解除' }));
    expect(count()).toBe('選択中: 0 Kits');
  });

  it('初期はすべて展開。Plugin は Kit 件数と 3 状態（未選択／一部／全選択）を表示する', () => {
    render(<Host map={model()} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(3 + 6);
    expect((box('A（3）').closest('[role=treeitem]') as HTMLElement).getAttribute('aria-expanded')).toBe('true');
    const a = box('A（3）') as HTMLInputElement;
    expect(a.checked).toBe(false);
    fireEvent.click(box('K1'));
    expect(a.getAttribute('data-indeterminate')).toBe('true');
    fireEvent.click(box('K2')); fireEvent.click(box('K3'));
    expect(a.checked).toBe(true);
    expect(a.getAttribute('data-indeterminate')).not.toBe('true');
  });

  it('Plugin のチェックは折りたたみ中の Kit も含めて一括選択・解除し、展開・折りたたみは選択を変えない', () => {
    render(<Host map={model()} />);
    fireEvent.click(screen.getByRole('button', { name: 'A を折りたたむ' }));
    expect(screen.queryByRole('checkbox', { name: 'K1' })).toBeNull();
    expect((box('A（3）').closest('[role=treeitem]') as HTMLElement).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(box('A（3）'));
    expect(names()).toEqual(['K1', 'K2', 'K3']);
    expect(count()).toBe('選択中: 3 Kits');
    fireEvent.click(screen.getByRole('button', { name: 'A を展開する' }));
    expect(names()).toEqual(['K1', 'K2', 'K3']);
    fireEvent.click(box('B（2）'));
    fireEvent.click(box('A（3）')); // A だけ解除。B は維持
    expect(names()).toEqual(['K4', 'K5']);
  });

  it('通常クリックは単独選択、Ctrl／Command は反転、Shift は範囲、Ctrl＋Shift は範囲の追加（Plugin 見出しをまたいでも Kit だけを数える）', () => {
    render(<Host map={model()} />);
    click('K2');
    expect(names()).toEqual(['K2']);
    click('K5', { ctrlKey: true });
    expect(names()).toEqual(['K2', 'K5']);
    click('K1', { metaKey: true });
    expect(names()).toEqual(['K1', 'K2', 'K5']);
    click('K4');
    click('K6', { shiftKey: true });
    expect(names()).toEqual(['K4', 'K5', 'K6']);
    click('K1', { ctrlKey: true, shiftKey: true }); // 基準は K4（Shift では変わらない）
    expect(names()).toEqual(['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  });

  it('Plugin を折りたたんでいても範囲選択できる（折りたたみ中の Kit も範囲に含まれ、基準が畳まれていても有効）', () => {
    render(<Host map={model()} />);
    click('K1');
    fireEvent.click(screen.getByRole('button', { name: 'B を折りたたむ' }));
    click('K6', { shiftKey: true });
    expect(names()).toEqual(['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
    // 基準 K1 を含む A を折りたたんでも、基準は有効のまま
    fireEvent.click(screen.getByRole('button', { name: 'A を折りたたむ' }));
    fireEvent.click(screen.getByRole('button', { name: 'B を展開する' }));
    click('K5', { shiftKey: true });
    expect(names()).toEqual(['K1', 'K2', 'K3', 'K4', 'K5']);
    click('K6', { ctrlKey: true, shiftKey: true });
    expect(names()).toEqual(['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  });

  it('チェックボックスはその Kit だけを切り替え、行クリックと二重に動かない。基準にする', () => {
    render(<Host map={model()} />);
    click('K1');
    fireEvent.click(box('K3'));
    expect(names()).toEqual(['K1', 'K3']); // 行クリック（単独選択）が重ねて起きていない
    click('K5', { shiftKey: true }); // チェックした K3 が基準
    expect(names()).toEqual(['K3', 'K4', 'K5']);
    fireEvent.click(box('K4'));
    expect(names()).toEqual(['K3', 'K5']);
  });

  it('キーボード: 1 行だけが Tab で入れる。矢印で移動、Space で切り替え、Enter／矢印で展開', () => {
    render(<Host map={model()} />);
    const items = screen.getAllByRole('treeitem');
    expect(items.filter((i) => (i as HTMLElement).tabIndex === 0)).toHaveLength(1);
    const first = items[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(kit('K1'));
    fireEvent.keyDown(kit('K1'), { key: ' ' });
    expect(names()).toEqual(['K1']);
    fireEvent.keyDown(kit('K1'), { key: ' ' });
    expect(names()).toEqual([]);
    fireEvent.keyDown(kit('K1'), { key: 'ArrowLeft' }); // 親の Plugin へ
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: ' ' }); // Plugin 全選択
    expect(names()).toEqual(['K1', 'K2', 'K3']);
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(first.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(first.getAttribute('aria-expanded')).toBe('true');
  });

  it('長い名前は省略表示で、tooltip（title）に全文がある', () => {
    const m = model();
    m.Plugins[0]!.Name = 'とても長い Plugin 名'.repeat(6);
    m.Plugins[0]!.Kits[0]!.Name = 'とても長い Kit 名'.repeat(8);
    render(<Host map={m} />);
    expect(screen.getByTitle('とても長い Kit 名'.repeat(8))).toBeTruthy();
    expect(screen.getByTitle(`${'とても長い Plugin 名'.repeat(6)}（3 Kits）`)).toBeTruthy();
  });
});
