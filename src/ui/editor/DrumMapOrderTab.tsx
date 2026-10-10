import { useMemo } from 'react';
import { Typography } from '@mui/material';
import { listDrumMapOrder, studioOneColorToCss } from '../../core';
import type { EditorStore } from '../state/editorStore';
import { useEditorState } from '../app/useEditorStore';
import { OrderList } from './OrderList';
import { createPartsActions } from './partsActions';
import type { EditorUi } from './pluginsKitsActions';

/**
 * Map Editor の DrumMap Order タブ（Windows版 ArticulationsPage）。全 Part の Articulation を DrumMapOrder 順に並べ、
 * Part の色・Articulation 名・Part 名を表示する。並べ替えだけを行う（追加・削除・名前の編集は Parts タブ）。
 * Windows版はボタンのみで、Web版はボタン・Alt+矢印キー・ドラッグ&ドロップで並べ替えられる。フィルタは設けない（Windows版にない）。
 */
export function DrumMapOrderTab({ store, ui }: { store: EditorStore; ui: EditorUi }) {
  const state = useEditorState(store);
  const actions = useMemo(() => createPartsActions(store, ui), [store, ui]);
  const { map, selection: sel } = state;
  const items = useMemo(
    () =>
      listDrumMapOrder(map).map((r) => {
        const part = map.Parts[r.partIndex]!;
        const a = part.Articulations[r.articulationIndex]!;
        return { key: `${a.ID}:${r.partIndex}:${r.articulationIndex}`, label: a.Name, detail: part.Name, swatch: studioOneColorToCss(part.Color) };
      }),
    [map],
  );
  return (
    <>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        DAW への出力順を決める、全 Part 共通の Articulation の順序です。行を選んで「先頭／上へ／下へ／末尾」、Alt+↑／↓／Home／End、またはドラッグ&ドロップで並べ替えます。
      </Typography>
      <OrderList
        title="Articulation（DrumMap Order）" noun="Articulation" reorderOnly maxHeight={560}
        emptyText="Articulation がありません。Parts タブで Part と Articulation を作成してください。"
        items={items} selected={sel.orderIndices} active={sel.orderIndices.at(-1) ?? null}
        onSelect={actions.selectOrder} onAdd={() => undefined} onDelete={() => undefined}
        onMove={actions.moveOrder} onDropTo={actions.moveOrderTo}
      />
    </>
  );
}
