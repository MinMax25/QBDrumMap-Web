import { useMemo, useState } from 'react';
import { Box, Button, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { defaultPartNameDictionary, enumToString, PLUGIN_TYPES, validateNames, type PluginType } from '../../core';
import type { EditorStore } from '../state/editorStore';
import { useEditorState } from '../app/useEditorStore';
import { NameField } from './NameField';
import { OrderList } from './OrderList';
import { ISSUE_TEXT } from './issueText';
import { PitchTable } from './PitchTable';
import type { FileIo } from '../services/fileIo';
import { createImportActions } from './importActions';
import type { SettingsStore } from '../settings/settingsStore';
import { createPluginsKitsActions, type EditorUi } from './pluginsKitsActions';

/** Map Editor の Plugins & Kits タブ。表示と操作の受け付けだけを行い、モデル変更は Core の純粋関数（actions 経由）が行う */
export function PluginsKitsTab({ store, ui, io, settingsStore }: { store: EditorStore; ui: EditorUi; io?: FileIo; settingsStore?: SettingsStore }) {
  const state = useEditorState(store);
  // 辞書は Auto Assign の実行時に設定から取得する（編集した内容が次の実行に反映される）
  const actions = useMemo(
    () => createPluginsKitsActions(store, ui, () => settingsStore?.getSnapshot().settings.partNameDictionary ?? defaultPartNameDictionary()),
    [store, ui, settingsStore],
  );
  const importActions = useMemo(() => (io ? createImportActions(store, ui, io) : null), [store, ui, io]);
  const { map, selection: sel } = state;
  // Plugin 属性欄の開閉（表示だけの状態。編集履歴・Dirty には影響しない）。既定は折りたたみ
  const [attrOpen, setAttrOpen] = useState(false);

  // 入力検証（validateNames）。編集は許可し、エラーを該当箇所に表示する。エラーがあると保存できない（Windows版と同じ）
  const errors = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of validateNames(map)) if (!m.has(i.path)) m.set(i.path, ISSUE_TEXT[i.kind](i.target));
    return m;
  }, [map]);

  const plugin = sel.pluginIndex !== null ? map.Plugins[sel.pluginIndex] : undefined;
  const kit = plugin && sel.kitIndex !== null ? plugin.Kits[sel.kitIndex] : undefined;

  return (
    // 画面の高さに追従する（AppShell の main が Plugins & Kits のときだけ高さを固定する）。極端に低い画面ではページスクロール
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: 'nowrap', flex: '1 1 auto', minHeight: 0, '@media (max-height: 639px)': { flex: 'none' } }}>
      <Box sx={{ display: 'flex', gap: 1, flex: '0 0 auto', minHeight: 0 }}>
        <Box sx={{ width: 'clamp(184px, 13.5vw, 200px)', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
          <OrderList
            compact
            title="Plugin" heading="Plugins" noun="Plugin" emptyText="Plugin がありません。「Plugin を追加」で作成するか、QBD ファイルを開いてください。"
            items={map.Plugins.map((p, i) => ({ key: `${i}:${p.ID}`, label: p.Name, error: errors.get(`Plugins[${i}]`) }))}
            selected={sel.pluginIndices} active={sel.pluginIndex}
            onSelect={actions.selectPlugin} onAdd={actions.addPlugin} onDelete={() => void actions.deletePlugins()}
            onMove={actions.movePlugins} onDropTo={actions.movePluginsTo}
          />
          {plugin && sel.pluginIndex !== null && (
            <Paper variant="outlined" sx={{ p: 0.5, flex: '0 0 auto' }}>
              <Button
                size="small" fullWidth sx={{ justifyContent: 'flex-start' }} aria-expanded={attrOpen} aria-controls="plugin-attributes"
                onClick={() => setAttrOpen((o) => !o)}
              >
                {attrOpen ? '▼' : '▶'}　Plugin 属性
              </Button>
              {/* 閉じていても子は残す（入力途中の下書きを保つ）。アニメーションに依存せず display で切り替える */}
              <Box id="plugin-attributes" hidden={!attrOpen}>
                <Box sx={{ display: attrOpen ? 'grid' : 'none', gap: 1, p: 0.5, pt: 1 }}>
                  <NameField
                    label="Plugin 名" value={plugin.Name} error={errors.get(`Plugins[${sel.pluginIndex}]`)}
                    onCommit={(v) => actions.updatePlugin(sel.pluginIndex!, { Name: v })}
                  />
                  <TextField
                    select size="small" label="Plugin Type" value={enumToString(PLUGIN_TYPES, 0, plugin.PluginType)}
                    onChange={(e) => actions.setPluginType(sel.pluginIndex!, e.target.value as PluginType)}
                    helperText="GM / GM2 / GS / XG は Auto Assign の GM 音名表に関係します"
                  >
                    {PLUGIN_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </TextField>
                </Box>
              </Box>
            </Paper>
          )}
        </Box>
        <Box sx={{ width: 'clamp(210px, 16.3vw, 272px)', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
          {plugin && sel.pluginIndex !== null ? (
            <>
              <OrderList
                compact
                title={`${plugin.Name} の Kit`} heading="Kits" noun="Kit" emptyText="Kit がありません。「Kit を追加」で作成してください。"
                items={plugin.Kits.map((k, i) => ({ key: `${i}:${k.ID}`, label: k.Name, error: errors.get(`Plugins[${sel.pluginIndex}].Kits[${i}]`) }))}
                selected={sel.kitIndices} active={sel.kitIndex}
                onSelect={actions.selectKit} onAdd={actions.addKit} onDelete={() => void actions.deleteKits()}
                onMove={actions.moveKits} onDropTo={actions.moveKitsTo}
              />
              {kit && sel.kitIndex !== null && (
                <Paper variant="outlined" sx={{ p: 1, flex: '0 0 auto' }}>
                  <NameField
                    label="Kit 名" value={kit.Name} error={errors.get(`Plugins[${sel.pluginIndex}].Kits[${sel.kitIndex}]`)}
                    onCommit={(v) => actions.updateKit({ Name: v })}
                  />
                </Paper>
              )}
            </>
          ) : (
            <Typography color="text.secondary">Plugin を選択すると、その Kit を表示します。</Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {kit && sel.pluginIndex !== null && sel.kitIndex !== null ? (
          <PitchTable
            key={`${sel.pluginIndex}:${sel.kitIndex}`}
            map={map} kit={kit} selected={sel.pitchIndices} actions={actions} errors={errors}
            pathPrefix={`Plugins[${sel.pluginIndex}].Kits[${sel.kitIndex}]`}
            kitRef={{ pluginIndex: sel.pluginIndex, kitIndex: sel.kitIndex }}
            onImport={importActions ? () => void importActions.importIntoSelectedKit() : undefined}
          />
        ) : (
          <Typography color="text.secondary">Kit を選択すると、Pitch 表を表示します。</Typography>
        )}
      </Box>
    </Box>
  );
}
