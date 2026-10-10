import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppBar, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  CssBaseline, Drawer, List, ListItemButton, ListItemText, Snackbar, Tab, Tabs, Toolbar, Typography,
} from '@mui/material';
import type { QbdError } from '../../core';
import { EditorStore } from '../state/editorStore';
import type { SessionManager } from '../state/sessionManager';
import { SessionBanner, SessionPanel } from './SessionUi';
import { browserFileIo, type FileIo } from '../services/fileIo';
import { toUserMessage, type UserMessage } from '../services/errorMessages';
import { createFileActions } from './fileActions';
import { MAP_EDITOR_TABS, PAGES, type PageDef } from './pages';
import { useEditorState } from './useEditorStore';
import { DrumMapOrderTab } from '../editor/DrumMapOrderTab';
import { PartsTab } from '../editor/PartsTab';
import { PluginsKitsTab } from '../editor/PluginsKitsTab';
import { ExportPage } from '../export/ExportPage';
import { ConvertMidiPage } from '../convertMidi/ConvertMidiPage';
import { SettingsPage } from '../settings/SettingsPage';
import { SettingsStore, useSettings } from '../settings/settingsStore';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from './theme';
import type { EditorUi } from '../editor/pluginsKitsActions';

const DRAWER_WIDTH = 200;

/** 画面高に固定する main（Plugins & Kits）。高さが 640px 未満のときは固定せず、ページ全体をスクロールさせる */
const fixedMainSx = {
  flexGrow: 1, p: 3, minWidth: 0, display: 'flex', flexDirection: 'column',
  height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, overflow: 'hidden',
  '@media (max-height: 639px)': { height: 'auto', overflow: 'visible' },
} as const;

export interface AppShellProps {
  store?: EditorStore;
  io?: FileIo;
  /** アプリ設定（QBD とは独立）。省略時はブラウザの localStorage を使う */
  settings?: SettingsStore;
  /** 作業状態の自動保存・復元。省略時は行わない（本番は main.tsx が渡す） */
  session?: SessionManager | null;
}

interface ConfirmRequest {
  message: string;
  resolve: (ok: boolean) => void;
}

export function AppShell({ store: injected, io = browserFileIo, settings: injectedSettings, session = null }: AppShellProps) {
  const store = useMemo(() => injected ?? new EditorStore(), [injected]);
  const settingsStore = useMemo(() => injectedSettings ?? new SettingsStore(), [injectedSettings]);
  const state = useEditorState(store);
  // 画面テーマ（設定から。変更は即時に全体へ反映される。QBD の Dirty・Undo には関係しない）
  const { settings: appSettings } = useSettings(settingsStore);
  const theme = appTheme(appSettings.theme);
  const [pageId, setPageId] = useState<PageDef['id']>('mapEditor');
  const [tabId, setTabId] = useState<string>(MAP_EDITOR_TABS[0]!.id);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<UserMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const applySessionUi = (ui: { pageId: string; tabId: string } | null) => {
    const pg = ui ? PAGES.find((p) => p.id === ui.pageId) : undefined;
    if (!ui || !pg) return;
    setPageId(pg.id);
    if (pg.subPages?.some((t) => t.id === ui.tabId)) setTabId(ui.tabId);
  };
  const confirmRef = useRef(setConfirmReq);
  confirmRef.current = setConfirmReq;

  const ui = useMemo<EditorUi>(
    () => ({
      confirm: (message) => new Promise<boolean>((resolve) => confirmRef.current({ message, resolve })),
      onError: (e: QbdError) => setError(toUserMessage(e)),
      notify: (message: string) => setNotice(message),
    }),
    [],
  );
  const actions = useMemo(
    () => createFileActions({ store, io, confirm: ui.confirm, onError: ui.onError, onNotice: setNotice }),
    [store, io, ui],
  );

  // 作業状態の復元（起動時に1回）。復元できたら画面（ページ・タブ）も戻し、軽く通知する
  useEffect(() => {
    if (!session) return;
    let alive = true;
    void session.startOnce().then((r) => {
      if (!alive || !r.restored) return;
      applySessionUi(r.ui);
      setNotice('前回の作業状態を復元しました');
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 起動時の1回だけ
  }, [session]);

  // 画面の変更を自動保存へ伝える。非表示・離脱ではベストエフォートで即時に保存を開始する
  useEffect(() => { session?.setUi({ pageId, tabId }); }, [session, pageId, tabId]);
  useEffect(() => {
    if (!session) return;
    const onHide = () => { if (document.visibilityState === 'hidden') session.flush(); };
    const onPageHide = () => session.flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [session]);

  // 未保存の変更があるままタブを閉じる／離れるときのブラウザ標準確認（Windows版 OnWindowClosingAsync に相当）
  useEffect(() => {
    if (!state.dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.dirty]);

  // Ctrl+Z / Ctrl+Y（Windows版 ShellWindow.InputBindings と同じ割り当て）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 入力欄ではブラウザ標準のテキスト取り消しを優先
      if (e.key === 'z') { e.preventDefault(); store.undo(); }
      else if (e.key === 'y') { e.preventDefault(); store.redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);

  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0]!;
  const title = `QBDrumMap Web${state.fileName ? ` (${state.fileName.replace(/\.qbd$/i, '')}${state.sample ? '（サンプル）' : ''})` : ''}${state.dirty ? ' *' : ''}`;
  const disabled = state.busy;
  // Plugins & Kits は画面の高さに追従させる（極端に低い画面ではページスクロールに戻す）。他の画面は従来どおり
  const fixedHeight = pageId === 'mapEditor' && tabId === 'pluginsKits';
  const discardSession = async () => {
    if (!session) return;
    const msg = state.dirty
      ? '未保存の変更があります。前回の作業状態（保存データ）を破棄し、編集中の内容も失って新規の状態に戻します。続行しますか？\nQBD ファイルに保存していない内容は戻せません。'
      : '前回の作業状態（保存データ）を破棄し、新規の状態に戻します。続行しますか？';
    if (!(await ui.confirm(msg))) return;
    await session.discard();
    store.createNew();
    setPageId('mapEditor');
    setTabId(MAP_EDITOR_TABS[0]!.id);
    setNotice('前回の作業状態を破棄しました');
  };
  const retrySession = () => {
    if (!session) return;
    void session.start().then((r) => { if (r.restored) { applySessionUi(r.ui); setNotice('前回の作業状態を復元しました'); } });
  };
  const exportSessionRaw = (raw: unknown) => {
    try {
      io.saveText('QBDrumMap_session_backup.json', JSON.stringify(raw), 'application/json');
    } catch (e) {
      setError(toUserMessage({ code: 'download-failed', message: e instanceof Error ? e.message : String(e) }));
    }
  };
  const closeConfirm = (ok: boolean) => { confirmReq?.resolve(ok); setConfirmReq(null); };

  return (
    <ThemeProvider theme={theme}>
    <CssBaseline enableColorScheme />
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }} data-testid="app-title" title={state.dirty ? "* = 最後に読み込んだ／ダウンロードを開始した内容からの変更があります" : undefined}>{title}</Typography>
          <Button color="inherit" disabled={disabled} onClick={() => void actions.newFile()}>新規</Button>
          <Button color="inherit" disabled={disabled} onClick={() => void actions.openFile()}>開く</Button>
          <Button color="inherit" disabled={disabled} onClick={() => void actions.openSample()} aria-label="サンプルを開く" title="公開サンプル（DrumMap.qbd）を開く。サーバー上のサンプルは変更されません">サンプルを開く</Button>
          <Button color="inherit" disabled={disabled} onClick={() => void actions.saveFile()}>保存</Button>
          <Button color="inherit" disabled={!state.canUndo || disabled} onClick={() => store.undo()} title={state.undoLabel ?? undefined}>元に戻す</Button>
          <Button color="inherit" disabled={!state.canRedo || disabled} onClick={() => store.redo()} title={state.redoLabel ?? undefined}>やり直し</Button>
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{ width: DRAWER_WIDTH, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}>
        <Toolbar variant="dense" />
        <List component="nav" aria-label="ページ">
          {PAGES.map((p) => (
            <ListItemButton key={p.id} selected={p.id === pageId} onClick={() => setPageId(p.id)}>
              <ListItemText primary={p.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={fixedHeight ? fixedMainSx : { flexGrow: 1, p: 3 }}>
        <Toolbar variant="dense" />
        {session && (
          <SessionBanner manager={session} confirm={ui.confirm} exportRaw={exportSessionRaw} onRetry={retrySession} onDiscard={() => void discardSession()} />
        )}
        <Typography variant="h5" component="h2" gutterBottom>{page.label}</Typography>
        {page.subPages && (
          <Tabs value={tabId} onChange={(_e, v: string) => setTabId(v)} aria-label="Map Editor" sx={{ mb: 2 }}>
            {page.subPages.map((t) => <Tab key={t.id} value={t.id} label={t.label} />)}
          </Tabs>
        )}
        {pageId === 'mapEditor' && tabId === 'pluginsKits' ? (
          <PluginsKitsTab store={store} ui={ui} io={io} settingsStore={settingsStore} />
        ) : pageId === 'mapEditor' && tabId === 'parts' ? (
          <PartsTab store={store} ui={ui} />
        ) : pageId === 'mapEditor' && tabId === 'drumMapOrder' ? (
          <DrumMapOrderTab store={store} ui={ui} />
        ) : pageId === 'export' ? (
          <ExportPage store={store} ui={ui} io={io} settingsStore={settingsStore} />
        ) : pageId === 'convertMidi' ? (
          <ConvertMidiPage store={store} ui={ui} io={io} settingsStore={settingsStore} />
        ) : pageId === 'settings' ? (
          <>
            <SettingsPage store={settingsStore} confirm={ui.confirm} />
            {session && <SessionPanel manager={session} onDiscard={() => void discardSession()} />}
          </>
        ) : (
          <>
            <Typography color="text.secondary" gutterBottom>
              この画面は {(page.subPages?.find((t) => t.id === tabId) ?? page).plannedPhase} で実装予定です。
            </Typography>
            <Typography data-testid="map-summary">
              読み込み済み: Plugin {state.map.Plugins.length} 件 / Part {state.map.Parts.length} 件
            </Typography>
          </>
        )}
      </Box>

      <Dialog open={confirmReq !== null} onClose={() => closeConfirm(false)}>
        <DialogTitle>確認</DialogTitle>
        <DialogContent><DialogContentText sx={{ whiteSpace: 'pre-line' }}>{confirmReq?.message}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => closeConfirm(false)}>キャンセル</Button>
          <Button onClick={() => closeConfirm(true)} autoFocus>続行</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={notice !== null} autoHideDuration={6000} onClose={() => setNotice(null)} message={notice} />

      <Dialog open={error !== null} onClose={() => setError(null)}>
        <DialogTitle>エラー</DialogTitle>
        <DialogContent>
          <DialogContentText>{error?.title}</DialogContentText>
          {error?.hint && <DialogContentText>{error.hint}</DialogContentText>}
          <Typography variant="caption" color="text.secondary" component="pre" sx={{ whiteSpace: 'pre-wrap' }}>{error?.detail}</Typography>
        </DialogContent>
        <DialogActions><Button onClick={() => setError(null)}>閉じる</Button></DialogActions>
      </Dialog>
    </Box>
    </ThemeProvider>
  );
}
