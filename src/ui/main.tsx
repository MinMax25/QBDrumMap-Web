import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './app/AppShell';
import { EditorStore } from './state/editorStore';
import { SessionManager } from './state/sessionManager';

// 作業状態の自動保存・復元（IndexedDB）。ストアと管理者はページの存続期間中ひとつだけ作る
const store = new EditorStore();
const session = new SessionManager(store);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell store={store} session={session} />
  </StrictMode>,
);
