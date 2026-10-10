import { useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from '../state/editorStore';

export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
