import type { QbdError } from '../../core';

export interface UserMessage {
  /** 利用者向けの要約 */
  title: string;
  /** 補足・対処のヒント */
  hint?: string;
  /** 技術的な詳細（折りたたみ表示用）。Coreのコード・メッセージ・パス */
  detail: string;
}

/** Coreのエラーコード → 利用者向けメッセージ。未登録コードは汎用文言にフォールバックする。 */
const TABLE: Record<string, { title: string; hint?: string }> = {
  'invalid-json': { title: 'QBDファイルを読み込めませんでした（JSONとして解釈できません）。', hint: 'ファイルが壊れていないか、QBDファイルかを確認してください。' },
  'sample-network-error': { title: 'サンプルを取得できませんでした（通信エラー）。', hint: '通信状況を確認して、もう一度お試しください。現在の作業内容は変更されていません。' },
  'sample-http-error': { title: 'サンプルを取得できませんでした（サーバーがエラーを返しました）。', hint: '現在の作業内容は変更されていません。' },
  'sample-empty': { title: 'サンプルの内容が空です。', hint: '現在の作業内容は変更されていません。' },
  'null-document': { title: 'QBDファイルの内容が空です。' },
  'duplicate-articulation-id': { title: 'Articulation の ID が重複しているため保存できません。', hint: '重複しているArticulationを削除または作り直してください。' },
  'kit-not-found': { title: '指定された Kit が見つかりません。', hint: 'Kitの選択をやり直してください。' },
  'base-on-required': { title: 'Base Kit を選択してください。' },
  'no-target': { title: '対象の Kit を1つ以上選択してください。' },
  'pitch-out-of-range': { title: 'Pitch が 0〜127 の範囲外です。' },
  'undefined-separator': {
    title: '未定義の Separator 値があるため出力できません。',
    hint: '該当の Plugin / Kit / Pitch の Separator を None / Separate / Unload / Duplicate のいずれかに直してください。',
  },
  'invalid-xml': { title: 'ファイルを XML として解釈できません。' },
  'invalid-xml-char': { title: 'XML で使えない文字が含まれています。' },
  'invalid-pitchlist': { title: 'Studio One の pitchlist として解釈できません。' },
  'invalid-drm': { title: 'Cubase の drm として解釈できません。' },
  'invalid-tsv': { title: 'TSV として解釈できません。' },
  'unsupported-format': { title: 'この MIDI ファイル形式（Format 2）には対応していません。', hint: 'Format 0 または Format 1 の MIDI ファイルを使ってください。' },
  'bad-header': { title: 'MIDI ファイルとして読み込めません（ヘッダーが不正です）。' },
  'truncated': { title: 'MIDI ファイルが途中で終わっています。' },
  'validation-failed': { title: '名前の入力エラーがあるため保存できません。', hint: '詳細に示された項目の名前を直してから、もう一度保存してください。' },
  'download-failed': { title: 'ダウンロードを開始できませんでした。', hint: 'ブラウザの設定を確認してください。データは変更されておらず、未保存の状態のままです。' },
  'index-out-of-range': { title: '対象の項目が見つかりません。', hint: '選択をやり直してください。' },
  'empty-name-row': { title: 'Name が空の行には Articulation / Separator を設定できません。' },
  'articulation-not-found': { title: '指定された Articulation が存在しません。' },
  'ambiguous-articulation-id': { title: '同じ ID の Articulation が複数あるため、参照先を特定できません。', hint: 'Articulation の ID が重複しています。重複した Articulation を削除または作り直してください。' },
  'same-kit': { title: 'コピー元とコピー先が同じ Kit です。', hint: '別の Kit をコピー元に選んでください。' },
  'ambiguous-kit-name': {
    title: '同じ名前の Kit があり、選択した Kit を特定できないため出力できません。',
    hint: 'この形式は Kit 名で出力対象を引くため、先にある同名の Kit の内容が出力されてしまいます。Kit 名を変更して一意にしてから、もう一度実行してください。',
  },
  'ambiguous-pitch': {
    title: '同じ Pitch 番号の行が複数あるため、コピーの対応づけを特定できません。',
    hint: 'データは変更されていません。詳細に示された Pitch の重複を解消してから、もう一度実行してください。',
  },
  'invalid-value': { title: '入力された値が正しくありません。', hint: 'データは変更されていません。値を確認してください。' },
  'unsupported-import-extension': { title: 'この拡張子のファイルは取り込めません。', hint: '.pitchlist / .drm / .tsv のいずれかを選んでください。データは変更されていません。' },
  'stale-import': { title: '確認中に内容が変更されたため、取り込みを中止しました。', hint: 'データは変更されていません。もう一度 Import を実行してください。' },
  'zip-too-large': { title: '出力が大きすぎて ZIP を作れません。', hint: '対象の Kit を減らして、複数回に分けて出力してください。' },
  'invalid-part-value': { title: 'Part の ScorePitch / NoteHeadSet が負数のため、Cubase 形式では出力できません。', hint: 'Parts タブで該当 Part の値を修正してください。' },
  'empty-midi-file': { title: 'MIDI ファイルが空です。', hint: '別の MIDI ファイルを選んでください。' },
  'no-output': { title: '出力するファイルがありません。' },
  'midi-read-failed': { title: 'MIDI ファイルを読み込めませんでした。', hint: 'ファイルが開けない、または読み取り中に失敗しました。もう一度選び直してください。' },
  'bad-format': { title: 'MIDI ファイルの形式情報が不正です。' },
  'bad-division': { title: 'MIDI ファイルの分解能（Division）が不正です。' },
  'bad-delta': { title: 'MIDI ファイルのイベント時刻が不正です。' },
  'bad-varlen': { title: 'MIDI ファイルの可変長数値が不正です。' },
  'bad-data-byte': { title: 'MIDI ファイルのイベントデータが不正です。' },
  'bad-running-status': { title: 'MIDI ファイルのランニングステータスが不正です。' },
  'no-tracks': { title: 'MIDI ファイルにトラックがありません。' },
  'event-order': { title: 'MIDI ファイルのイベントの時刻順が不正です。' },
  'unsupported-system': { title: 'MIDI ファイルに対応していないシステムイベントが含まれています。' },
  unexpected: { title: '予期しないエラーが発生しました。', hint: '操作は取り消され、データは変更されていません。' },
};

export function toUserMessage(error: QbdError): UserMessage {
  const known = TABLE[error.code];
  const detail = `[${error.code}] ${error.message}${error.path ? ` (${error.path})` : ''}`;
  if (known) return { ...known, detail };
  return { title: '処理に失敗しました。', hint: 'データは変更されていません。', detail };
}
