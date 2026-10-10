import type { NameIssue } from '../../core';

/** 入力検証（validateNames）のエラー文言。Plugins & Kits・Parts の各画面で共通 */
export const ISSUE_TEXT: Record<NameIssue['kind'], (target: NameIssue['target']) => string> = {
  length: (t) => (t === 'KitPitch' ? '0〜64文字で入力してください' : '1〜64文字で入力してください'),
  duplicate: () => '同じ名前が他にあります（一意にしてください）',
};
