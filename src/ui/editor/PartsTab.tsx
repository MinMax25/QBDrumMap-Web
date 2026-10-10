import { useMemo, useState } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import { findArticulation, studioOneColorToCss, validateNames } from '../../core';
import type { EditorStore } from '../state/editorStore';
import { useEditorState } from '../app/useEditorStore';
import { ArticulationPickerDialog } from './ArticulationPickerDialog';
import { ISSUE_TEXT } from './issueText';
import { NameField } from './NameField';
import { OrderList } from './OrderList';
import { PartAttributes } from './PartAttributes';
import { createPartsActions } from './partsActions';
import type { EditorUi } from './pluginsKitsActions';

/**
 * Map Editor の Parts タブ（Windows版 PartsPage / PartPanel）。左: Part 一覧（追加・削除・並べ替え・名前）、
 * 右: 選択した Part の Score（譜面プレビューと属性。上）と Articulation 一覧（追加・削除・並べ替え・名前・Complement。下）。
 * 表示と操作の受け付けだけを行い、モデル変更は Core の純粋関数（actions 経由）が行う。
 */
export function PartsTab({ store, ui }: { store: EditorStore; ui: EditorUi }) {
  const state = useEditorState(store);
  const actions = useMemo(() => createPartsActions(store, ui), [store, ui]);
  const [picking, setPicking] = useState(false);
  const { map, selection: sel } = state;

  const errors = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of validateNames(map)) if (!m.has(i.path)) m.set(i.path, ISSUE_TEXT[i.kind](i.target));
    return m;
  }, [map]);

  const part = sel.partIndex !== null ? map.Parts[sel.partIndex] : undefined;
  const articulation = part && sel.articulationIndex !== null ? part.Articulations[sel.articulationIndex] : undefined;
  const complement = articulation && articulation.Complement !== 0 ? articulation.Complement : 0;
  const complementTarget = complement !== 0 ? findArticulation(map, complement) : undefined;

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Box sx={{ width: 400, maxWidth: '100%' }}>
        <OrderList
          title="Part" noun="Part" emptyText="Part がありません。「Part を追加」で作成するか、QBD ファイルを開いてください。" maxHeight={420}
          items={map.Parts.map((p, i) => ({
            key: `${i}:${p.ID}`, label: p.Name, error: errors.get(`Parts[${i}]`), swatch: studioOneColorToCss(p.Color),
            detail: `Articulation ${p.Articulations.length} 件`,
          }))}
          selected={sel.partIndices} active={sel.partIndex}
          onSelect={actions.selectPart} onAdd={actions.addPart} onDelete={() => void actions.deleteParts()}
          onMove={actions.moveParts} onDropTo={actions.movePartsTo}
        />
        {part && sel.partIndex !== null && (
          <Paper variant="outlined" sx={{ p: 1 }}>
            <NameField label="Part 名" value={part.Name} error={errors.get(`Parts[${sel.partIndex}]`)} onCommit={(v) => actions.updatePart({ Name: v })} />
          </Paper>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 460, display: 'grid', gap: 2 }}>
        {part && sel.partIndex !== null ? (
          <>
            <PartAttributes part={part} actions={actions} onInvalid={ui.onError} />
            <Box>
              <OrderList
                title={`${part.Name} の Articulation`} noun="Articulation" maxHeight={300}
                emptyText="Articulation がありません。「Articulation を追加」で作成してください。"
                items={part.Articulations.map((a, i) => ({
                  key: `${i}:${a.ID}`, label: a.Name, error: errors.get(`Parts[${sel.partIndex}].Articulations[${i}]`),
                  detail: a.Complement === 0 ? undefined : `Complement: ${findArticulation(map, a.Complement)?.Name ?? `（不明 ID ${a.Complement}）`}`,
                }))}
                selected={sel.articulationIndices} active={sel.articulationIndex}
                onSelect={actions.selectArticulation} onAdd={actions.addArticulation} onDelete={() => void actions.deleteArticulations()}
                onMove={actions.moveArticulations} onDropTo={actions.moveArticulationsTo}
              />
              {articulation && sel.articulationIndex !== null && (
                <Paper variant="outlined" sx={{ p: 1, display: 'grid', gap: 1 }}>
                  <NameField
                    label="Articulation 名" value={articulation.Name}
                    error={errors.get(`Parts[${sel.partIndex}].Articulations[${sel.articulationIndex}]`)}
                    onCommit={(v) => actions.updateArticulation({ Name: v })}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2">Complement:</Typography>
                    <Button size="small" variant="outlined" onClick={() => setPicking(true)} aria-label="Complement を選択">
                      {complement === 0 ? '（なし）' : (complementTarget?.Name ?? `（不明 ID ${complement}）`)}
                    </Button>
                    <Button size="small" disabled={complement === 0} onClick={() => void actions.clearComplement()} aria-label="Complement を解除">解除</Button>
                    {complement !== 0 && !complementTarget && (
                      <Typography variant="caption" color="error" role="alert">
                        参照先の Articulation が存在しません（保存時は 0 になります）。選び直すか解除してください。
                      </Typography>
                    )}
                  </Box>
                </Paper>
              )}
            </Box>
          </>
        ) : (
          <Typography color="text.secondary">Part を選択すると、その Articulation と属性を表示します。</Typography>
        )}
      </Box>

      <ArticulationPickerDialog
        open={picking} map={map} current={complement}
        onClose={() => setPicking(false)}
        onPick={(id) => { setPicking(false); actions.updateArticulation({ Complement: id }); }}
      />
    </Box>
  );
}
