import { useSyncExternalStore } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import type { SessionManager, SessionStatus } from '../state/sessionManager';

export function useSessionStatus(manager: SessionManager): SessionStatus {
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot);
}

export interface SessionBannerProps {
  manager: SessionManager;
  confirm(message: string): Promise<boolean>;
  /** 復元できなかった保存データの書き出し（ダウンロード） */
  exportRaw(raw: unknown): void;
  /** 復元の再試行の結果の反映（復元できたら画面状態も適用する） */
  onRetry(): void;
  /** 保存データの破棄（確認と画面の初期化を含む） */
  onDiscard(): void;
}

export const TAKEOVER_CONFIRM =
  'このタブの現在の内容で作業状態の自動保存を引き継ぎます。他のタブが保存していた作業状態は、このタブの内容で置き換わります。続行しますか？';

/** 自動保存・復元の状態の通知（通常は何も表示しない。問題があるときだけ出す） */
export function SessionBanner({ manager, confirm, exportRaw, onRetry, onDiscard }: SessionBannerProps) {
  const st = useSessionStatus(manager);
  if (!st.ready) return null;
  return (
    <Stack spacing={1} sx={{ mb: 1 }}>
      {st.loadProblem && (
        <Alert
          severity="warning"
          role="alert"
          action={
            <Stack direction="row" spacing={1}>
              {st.loadProblem.kind === 'invalid' && st.loadProblem.raw !== undefined && (
                <Button size="small" color="inherit" onClick={() => exportRaw(st.loadProblem?.raw)}>保存データを書き出す</Button>
              )}
              {st.loadProblem.kind === 'unreadable' && <Button size="small" color="inherit" onClick={onRetry}>再試行</Button>}
              <Button size="small" color="inherit" onClick={onDiscard}>保存データを破棄して続ける</Button>
            </Stack>
          }
        >
          前回の作業状態を復元できませんでした。{st.loadProblem.reason}。保存データは削除していません（破棄するまで自動保存は止まっています）。
        </Alert>
      )}
      {st.ownership === 'other' && (
        <Alert
          severity="info"
          action={
            <Button size="small" color="inherit" onClick={() => void confirm(TAKEOVER_CONFIRM).then((ok) => { if (ok) void manager.takeOver(); })}>
              このタブで引き継ぐ
            </Button>
          }
        >
          別のタブが作業状態を自動保存しています。このタブの編集は自動保存されません。
        </Alert>
      )}
      {st.ownership === 'unsupported' && (
        <Alert severity="warning">
          このブラウザは自動保存に必要な機能（Web Locks）に対応していないため、作業状態の自動保存を行いません。QBD ファイルとして保存してください。
        </Alert>
      )}
      {st.saveError && (
        <Alert severity="error" role="alert">
          作業状態の自動保存ができません。QBD ファイルとして保存してください。（{st.saveError}）
        </Alert>
      )}
    </Stack>
  );
}

export interface SessionPanelProps {
  manager: SessionManager;
  onDiscard(): void;
}

/** Settings に置く、作業状態の自動復元の説明と破棄。アプリ設定（Theme・辞書など）は対象外 */
export function SessionPanel({ manager, onDiscard }: SessionPanelProps) {
  const st = useSessionStatus(manager);
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }} component="section" aria-label="作業状態の自動復元">
      <Typography variant="subtitle1" component="h3" gutterBottom>作業状態の自動復元</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        編集中の QBD、保存基準（未保存かどうか）、開いている画面と選択を、このブラウザ（このサイトの URL ごと）の IndexedDB に自動で保存し、
        次に開いたときに復元します。サーバー・GitHub へは送信されません。QBD ファイルとして保存したことにはならないため、必要な内容は「保存」で
        ファイルにしてください。Undo/Redo の履歴、Convert MIDI の MIDI ファイル、Export の一時結果は復元しません。
        localhost と本番の URL では保存領域が別です。サイトデータの削除やプライベートモードでは消えます。
      </Typography>
      <Box>
        <Button variant="outlined" color="error" size="small" disabled={!st.ready || st.ownership !== 'owner'} onClick={onDiscard}>
          前回の作業状態を破棄
        </Button>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
          保存済みの作業状態を削除し、新規の状態に戻します（Theme・辞書などのアプリ設定は変わりません）。
          {st.ownership === 'other' ? ' 他のタブが保存中のため、このタブでは実行できません。' : ''}
        </Typography>
      </Box>
    </Paper>
  );
}
