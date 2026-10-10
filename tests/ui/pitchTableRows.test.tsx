// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo } from '../../src/ui/services/fileIo';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

const nullIo: FileIo = { openText: async () => null, saveText: () => undefined };

function setup() {
  const store = new EditorStore();
  store.load(gmSmall, 'a.qbd');
  render(<AppShell store={store} io={nullIo} />);
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
  fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('GM Kit'));
  return store;
}
const table = () => screen.getByRole('table', { name: 'Pitch 表' });
const nameInput = (pitch: number) => within(table()).getByLabelText(`Pitch ${pitch} の Name`) as HTMLInputElement;
const rowOf = (pitch: number) => nameInput(pitch).closest('tr')!;
const pitchNames = (s: EditorStore) => s.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches.map((p) => `${p.Pitch}:${p.Name}`);

describe('Pitch 表の行（軽量化後）の編集', () => {
  it('Enter で確定、Escape で取消、フォーカスアウトで確定する（1確定 = 1履歴）', () => {
    const store = setup();
    const input = nameInput(36);
    fireEvent.change(input, { target: { value: 'Kick2' } });
    expect(store.getSnapshot().historyLength).toBe(0); // 入力中は履歴を積まない
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(store.getSnapshot().historyLength).toBe(1);
    expect(nameInput(36).value).toBe('Kick2');

    fireEvent.change(nameInput(36), { target: { value: 'ZZZ' } });
    fireEvent.keyDown(nameInput(36), { key: 'Escape' });
    expect(nameInput(36).value).toBe('Kick2');
    fireEvent.blur(nameInput(36));
    expect(store.getSnapshot().historyLength).toBe(1); // 取消後の blur では確定しない

    fireEvent.change(nameInput(38), { target: { value: 'Snare2' } });
    fireEvent.blur(nameInput(38));
    expect(store.getSnapshot().historyLength).toBe(2);
  });

  it('入力検証エラーは該当行にだけ表示され、aria-invalid が付く（65文字）', () => {
    setup();
    fireEvent.change(nameInput(38), { target: { value: 'x'.repeat(65) } });
    fireEvent.blur(nameInput(38));
    expect(within(table()).getAllByText('0〜64文字で入力してください')).toHaveLength(1);
    expect(nameInput(38).getAttribute('aria-invalid')).toBe('true');
    expect(nameInput(42).getAttribute('aria-invalid')).toBeNull();
  });

  it('編集中の入力値は、他の行の選択変更・他の行の更新で消えない', () => {
    const store = setup();
    fireEvent.change(nameInput(36), { target: { value: 'draft!' } });
    fireEvent.click(rowOf(38)); // 他の行を選択
    expect(nameInput(36).value).toBe('draft!');
    act(() => {
      store.edit('外部更新', (m) => ({
        ok: true,
        value: {
          changed: true,
          map: { ...m, Plugins: [{ ...m.Plugins[0]!, Kits: [{ ...m.Plugins[0]!.Kits[0]!, Pitches: m.Plugins[0]!.Kits[0]!.Pitches.map((p) => (p.Pitch === 42 ? { ...p, Name: 'HH2' } : p)) }] }] },
        },
      }));
    });
    expect(nameInput(42).value).toBe('HH2');
    expect(nameInput(36).value).toBe('draft!');
  });

  it('行を並べ替えても、編集中の入力値は同じ Pitch の行に付いて移動する（別の行に化けない）', () => {
    const store = setup();
    fireEvent.change(nameInput(42), { target: { value: 'draft-hh' } });
    fireEvent.click(rowOf(42));
    fireEvent.click(within(screen.getByRole('group', { name: 'Pitch 行の並べ替え' })).getByRole('button', { name: '先頭' }));
    expect(pitchNames(store)[0]).toBe('42:Closed HH');
    expect(nameInput(42).value).toBe('draft-hh');
    expect(nameInput(36).value).toBe('Kick');
    expect(nameInput(38).value).toBe('Snare');
  });

  it('1行の編集では他の行の DOM は更新されない（再描画が局所化されている）', () => {
    setup();
    const edited = rowOf(0);
    const observer = new MutationObserver(() => undefined);
    observer.observe(table().querySelector('tbody')!, { subtree: true, childList: true, attributes: true, characterData: true });
    fireEvent.change(nameInput(0), { target: { value: 'Pitch0 name' } });
    fireEvent.blur(nameInput(0));
    const records = observer.takeRecords();
    observer.disconnect();
    expect(records.length).toBeGreaterThan(0); // 編集した行は更新される（Name が入り Articulation／Separator が有効になる）
    expect(records.every((r) => edited.contains(r.target))).toBe(true); // 変化は編集した行の中だけ
    expect(nameInput(0).value).toBe('Pitch0 name');
  });

  it('Separator・Articulation は Name が空の行で無効、Separator 変更は反映される', () => {
    const store = setup();
    const sep = within(table()).getByLabelText('Pitch 0 の Separator') as HTMLSelectElement;
    expect(sep.disabled).toBe(true);
    fireEvent.change(within(table()).getByLabelText('Pitch 38 の Separator'), { target: { value: 'Duplicate' } });
    expect(store.getSnapshot().map.Plugins[0]!.Kits[0]!.Pitches[2]!.Separator).toBe('Duplicate');
  });
});
