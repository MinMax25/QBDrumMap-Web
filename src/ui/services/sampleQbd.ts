import type { QbdError } from '../../core';

/** 公開サンプル QBD の配置（public/samples。ビルド後は dist-web/samples） */
export const SAMPLE_PATH = 'samples/DrumMap.qbd';
/** サンプルを開いたときのファイル名（保存名の提案に使う。「サンプル」の表示とは別） */
export const SAMPLE_FILE_NAME = 'DrumMap.qbd';

export interface SampleFile {
  name: string;
  text: string;
}

export type SampleResult = { ok: true; value: SampleFile } | { ok: false; error: QbdError };

/**
 * サンプルの取得先。base（Vite の BASE_URL。`/`・`./`・`/repo/` など）を基準に結合する。
 * ルート絶対パスを決め打ちせず、二重スラッシュも作らない。相対 base はページの URL を基準に解決される。
 */
export function sampleUrl(base: string = import.meta.env.BASE_URL): string {
  const b = base === '' ? './' : base;
  return `${b.endsWith('/') ? b : `${b}/`}${SAMPLE_PATH.replace(/^\/+/, '')}`;
}

/**
 * サンプルをサイトから取得する（読むだけ。サーバー上のサンプルへは書き戻さない）。
 * 本文は文字を変換せずそのまま渡す（パースは通常の「開く」と同じ EditorStore.load）。
 * HTTP エラー・通信エラー・空の内容は QbdError にして返す。
 */
export async function fetchSample(
  fetchFn: typeof fetch = (...a) => fetch(...a),
  base: string = import.meta.env.BASE_URL,
): Promise<SampleResult> {
  let res: Response;
  try {
    res = await fetchFn(sampleUrl(base), { cache: 'no-cache' });
  } catch (e) {
    return { ok: false, error: { code: 'sample-network-error', message: e instanceof Error ? e.message : String(e) } };
  }
  if (!res.ok) return { ok: false, error: { code: 'sample-http-error', message: `HTTP ${res.status} ${res.statusText}`.trim() } };
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, error: { code: 'sample-network-error', message: e instanceof Error ? e.message : String(e) } };
  }
  if (text.trim() === '') return { ok: false, error: { code: 'sample-empty', message: 'サンプルの内容が空です' } };
  return { ok: true, value: { name: SAMPLE_FILE_NAME, text } };
}
