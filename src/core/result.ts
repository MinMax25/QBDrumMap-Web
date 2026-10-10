export interface QbdError {
  code: string;
  message: string;
  /** 例: Plugins[0].Kits[1].Pitches[3].Pitch */
  path?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: QbdError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: string, message: string, path?: string): Result<T> => ({
  ok: false,
  error: path === undefined ? { code, message } : { code, message, path },
});
