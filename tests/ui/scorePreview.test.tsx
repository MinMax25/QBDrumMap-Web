// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from '../../src/ui/app/AppShell';
import { ScoreStaff } from '../../src/ui/editor/ScoreStaff';
import { EditorStore } from '../../src/ui/state/editorStore';
import type { FileIo } from '../../src/ui/services/fileIo';
import { gmSmall } from '../fixtures';

afterEach(cleanup);

const nullIo: FileIo = { openText: async () => null, saveText: () => undefined };
function setup() {
  const store = new EditorStore();
  store.load(gmSmall, 'a.qbd');
  render(<AppShell store={store} io={nullIo} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Parts' }));
  return store;
}
const pickPart = (name: string) => fireEvent.click(within(screen.getByRole('listbox', { name: 'Part' })).getAllByText(name)[0]!);
const staff = () => screen.getByTestId('score-staff');
const els = () => [...staff().querySelectorAll('[data-el]')].map((e) => e.getAttribute('data-el'));
const ledgers = () => [...staff().querySelectorAll('[data-ledger]')].map((e) => Number(e.getAttribute('data-ledger')));

describe('ScoreStaff（SVG）', () => {
  it('五線5本と、Slash（楕円＋斜線）・Half Open（円＋縦線）の要素、加線、位置を描く', () => {
    render(<ScoreStaff scorePitch={57} noteHead="nhSl" technique="ccir" />);
    expect(staff().querySelectorAll('[data-staff]')).toHaveLength(5);
    expect(els().sort()).toEqual(['ccir', 'circ', 'nhNo', 'nhSl']);
    expect(ledgers()).toEqual([140, 150]);
    expect(staff().querySelector('[data-note="0"]')!.getAttribute('transform')).toBe('translate(100 150)');
    expect(staff().querySelector('[data-note="1"]')!.getAttribute('transform')).toBe('translate(100 115)'); // 添字15で止まる
  });

  it('Open／Half Open の円は縦線（-40〜-28）と重なる位置（中心 -34.5。Windows版の WPF の配置）', () => {
    render(<ScoreStaff scorePitch={72} noteHead="None" technique="ccir" />);
    expect(staff().querySelector('[data-el="circ"]')!.getAttribute('cy')).toBe('-34.5');
    expect(staff().querySelector('[data-el="ccir"]')!.getAttribute('y1')).toBe('-40');
  });

  it('Pitch 0 と未定義 Pitch は音符を出さない。アクセシビリティラベルに状態を示す', () => {
    const { rerender } = render(<ScoreStaff scorePitch={0} noteHead="nhdX" technique="circ" />);
    expect(staff().querySelectorAll('[data-note]')).toHaveLength(0);
    expect(staff().getAttribute('role')).toBe('img');
    rerender(<ScoreStaff scorePitch={38} noteHead="nhdX" technique="circ" />);
    expect(staff().querySelectorAll('[data-note]')).toHaveLength(0);
    expect(staff().getAttribute('aria-label')).toContain('未定義 (38)');
  });

  it('線と記号は currentColor（テーマの文字色）で描く', () => {
    render(<ScoreStaff scorePitch={72} noteHead="None" technique="stac" />);
    expect(staff().getAttribute('stroke')).toBe('currentColor');
    expect(staff().querySelector('[data-el="nhNo"]')!.getAttribute('fill')).toBe('currentColor');
  });
});

describe('Parts 画面: Score と Articulation の配置・プレビューの追従', () => {
  it('Score（属性）が上、Articulation 一覧が下。Part 未選択では案内だけで例外にならない', () => {
    setup();
    expect(screen.getByText('Part を選択すると、その Articulation と属性を表示します。')).toBeTruthy();
    expect(screen.queryByTestId('score-staff')).toBeNull();
    pickPart('Kick');
    const score = screen.getByRole('group', { name: 'Part の属性' });
    const artic = screen.getByRole('listbox', { name: 'Kick の Articulation' });
    expect(score.compareDocumentPosition(artic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Part の切替・属性の変更・Undo／Redo にプレビューが追従し、表示だけでは Dirty／履歴は増えない', () => {
    const store = setup();
    pickPart('Snare'); // ScorePitch 38（未定義）・X・Open
    expect(staff().getAttribute('aria-label')).toBe('ドラム譜プレビュー: Score Pitch 未定義 (38)、Note Head X、Technique Open');
    pickPart('Kick');
    pickPart('Snare');
    expect(store.getSnapshot().dirty).toBe(false);
    expect(store.getSnapshot().historyLength).toBe(0);

    fireEvent.change(screen.getByLabelText('Score Pitch'), { target: { value: '72' } });
    expect(els().sort()).toEqual(['circ', 'nhdX']);
    expect(staff().querySelector('[data-note="0"]')!.getAttribute('transform')).toBe('translate(100 105)'); // 添字13
    fireEvent.change(screen.getByLabelText('Note Head'), { target: { value: 'nhDi' } });
    fireEvent.change(screen.getByLabelText('Technique'), { target: { value: 'trm3' } });
    expect(els().sort()).toEqual(['nhDi', 'trm1', 'trm2', 'trm3']);

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(els().sort()).toEqual(['circ', 'nhDi']);
    fireEvent.click(screen.getByRole('button', { name: 'やり直し' }));
    expect(els().sort()).toEqual(['nhDi', 'trm1', 'trm2', 'trm3']);
  });
});

describe('Cubase 用の値は画面に出なくても保持され、保存される', () => {
  it('Score を編集して保存しても Voice／Note Head Set／Entity ID は元のまま出力される', () => {
    const store = setup();
    pickPart('Snare');
    expect(screen.queryByLabelText('Voice')).toBeNull();
    fireEvent.change(screen.getByLabelText('Score Pitch'), { target: { value: '60' } });
    const prepared = store.prepareSave();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const saved = JSON.parse(prepared.value.text) as { Parts: Record<string, unknown>[] };
    expect(saved.Parts.find((p) => p['Name'] === 'Snare')).toMatchObject({
      ScorePitch: 60, Voice: 'Down1', NoteHeadSet: 2, InstrumentEntityID: 'inst', TechniqueEntityID: 'tech',
    });
  });
});

describe('一覧操作ボタンの統一', () => {
  it('Part／Articulation／Plugin／Kit／DrumMap Order／Pitch 行: 同じ操作は同じ名前・tooltip・アイコンのみ', () => {
    setup();
    pickPart('Kick');
    const names = (g: HTMLElement) => within(g).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const iconOnly = (g: HTMLElement) => within(g).getAllByRole('button').every((b) => b.textContent === '' && b.getAttribute('title') === b.getAttribute('aria-label'));
    const move = ['先頭', '上へ', '下へ', '末尾'];
    const parts = screen.getByRole('group', { name: 'Part の並べ替え' });
    expect(names(parts)).toEqual(['Part を追加', 'Part を削除', ...move]);
    const art = screen.getByRole('group', { name: 'Articulation の並べ替え' });
    expect(names(art)).toEqual(['Articulation を追加', 'Articulation を削除', ...move]);
    expect(iconOnly(parts) && iconOnly(art)).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Plugins & Kits' }));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Plugin' })).getByText('GM'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'GM の Kit' })).getByText('GM Kit'));
    for (const n of ['Plugin', 'Kit']) {
      const g = screen.getByRole('group', { name: `${n} の並べ替え` });
      expect(names(g)).toEqual([`${n} を追加`, `${n} を削除`, ...move]);
      expect(iconOnly(g)).toBe(true);
    }
    const pitch = screen.getByRole('group', { name: 'Pitch 行の並べ替え' });
    expect(names(pitch)).toEqual(move);
    expect(iconOnly(pitch)).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: /DrumMap Order/ }));
    const order = screen.getByRole('group', { name: 'Articulation の並べ替え' });
    expect(names(order)).toEqual(move);
    expect(iconOnly(order)).toBe(true);
  });
});
