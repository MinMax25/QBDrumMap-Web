import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Paper, TextField, Typography,
} from '@mui/material';
import { NOTICE_DOWNLOAD_STARTED } from '../app/fileActions';
import { useEditorState } from '../app/useEditorStore';
import type { EditorUi } from '../editor/pluginsKitsActions';
import type { FileIo } from '../services/fileIo';
import type { EditorStore } from '../state/editorStore';
import { toUserMessage } from '../services/errorMessages';
import { useSettings, type SettingsStore } from '../settings/settingsStore';
import { buildExport, EXPORT_FORMATS, type ExportBlocker, type UiExportFormat } from './exportPlan';
import { KitTree, listKits } from './KitTree';

const MAX_ROWS = 10;

function BlockerView({ b }: { b: ExportBlocker }) {
  const m = toUserMessage(b.error);
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2">
        {b.pluginName} / {b.kitName}{b.baseOn && b.separatorRows.length > 0 ? '（Base Kit 側に原因があります）' : b.baseOn ? '（Base Kit）' : ''}
      </Typography>
      {b.resolvedInstead && (
        <Typography variant="body2">同名の Kit が先にあるため、この Kit の代わりに「{b.resolvedInstead}」の内容が出力されてしまいます。Kit 名を変更して一意にしてください。</Typography>
      )}
      {b.separatorRows.length === 0 && !b.resolvedInstead && <Typography variant="body2">{m.title}</Typography>}
      {b.separatorRows.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {b.separatorRows.slice(0, MAX_ROWS).map((r) => (
            <li key={`${r.pluginIndex}:${r.kitIndex}:${r.pitchIndex}`}>
              <Typography variant="body2">
                {r.pluginName} / {r.kitName} ／ Pitch {r.pitch}「{r.name}」 Separator の値 {r.value}
              </Typography>
            </li>
          ))}
          {b.separatorRows.length > MAX_ROWS && <li><Typography variant="body2">…ほか {b.separatorRows.length - MAX_ROWS} 行</Typography></li>}
        </Box>
      )}
      {b.separatorRows.length === 0 && <Typography variant="caption" color="text.secondary">[{b.error.code}] {b.error.message}</Typography>}
    </Box>
  );
}

/**
 * Export ページ（Windows版 ExportPage / ExportViewModel に対応）。形式・対象 Kit（複数）・必要なら Base Kit を選んで出力する。
 * 出力は作業モデル・Undo 履歴・Dirty を変更しない。エラー時は何も出力せず、原因の Kit とエラーを示す（自動修正しない）。
 * 出力が複数ファイルなら ZIP（Plugin 別階層）、1ファイルならそのファイルをダウンロードする。
 */
export function ExportPage({ store, ui, io, settingsStore }: { store: EditorStore; ui: EditorUi; io: FileIo; settingsStore: SettingsStore }) {
  const { map } = useEditorState(store);
  const { settings } = useSettings(settingsStore);
  const [format, setFormat] = useState<UiExportFormat>('studioOne');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [baseOnKey, setBaseOnKey] = useState('');
  const [blocked, setBlocked] = useState<{ blockers: ExportBlocker[]; title: string; hint?: string } | null>(null);
  const [result, setResult] = useState<{ fileName: string; files: string[] } | null>(null);

  const rows = useMemo(() => listKits(map), [map]);
  const def = EXPORT_FORMATS.find((f) => f.id === format)!;
  // 現在のモデルに存在する選択だけが有効（Undo 等で対応しなくなったものは除く）
  const selectedRows = rows.filter((r) => picked.has(r.key));
  const baseOnRow = rows.find((r) => r.key === baseOnKey);
  const canExport = selectedRows.length > 0 && (!def.needsBaseOn || baseOnRow !== undefined);

  const run = () => {
    setResult(null);
    const out = buildExport(map, { format, kits: selectedRows.map((r) => r.ref), baseOn: def.needsBaseOn && baseOnRow ? baseOnRow.ref : null }, {
      useArticulation: settings.useArticulation, useArticulationPitchName: settings.useArticulationPitchName,
    });
    if (!out.ok) {
      const m = toUserMessage(out.error);
      if (out.blockers.length > 0) setBlocked({ blockers: out.blockers, title: m.title, hint: m.hint });
      else ui.onError(out.error);
      return;
    }
    const { download, files } = out.bundle;
    try {
      if (!io.saveBytes) throw new Error('この環境ではバイナリのダウンロードを開始できません。');
      io.saveBytes(download.fileName, download.bytes, download.mime);
    } catch (e) {
      ui.onError({ code: 'download-failed', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setResult({ fileName: download.fileName, files: files.map((f) => f.path) });
    ui.notify?.(NOTICE_DOWNLOAD_STARTED);
  };

  if (rows.length === 0) {
    return <Typography color="text.secondary">Kit がありません。QBD ファイルを開くか、Map Editor で Kit を作成してください。</Typography>;
  }

  const outputNote = format === 'noteMapper'
    ? 'Templates.txt を1つ出力します。'
    : selectedRows.length > 1 ? 'ZIP（Plugin 別フォルダ）としてダウンロードします。' : '1ファイルをそのままダウンロードします。';

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Paper variant="outlined" sx={{ p: 1.5, width: 420, maxWidth: '100%', display: 'grid', gap: 1.5 }}>
        <TextField
          select size="small" label="出力形式" value={format} helperText={def.help}
          onChange={(e) => { setFormat(e.target.value as UiExportFormat); setResult(null); }}
        >
          {EXPORT_FORMATS.map((f) => <MenuItem key={f.id} value={f.id}>{f.label}</MenuItem>)}
        </TextField>
        {def.needsBaseOn && (
          <TextField select size="small" label="Base Kit" value={baseOnKey} onChange={(e) => setBaseOnKey(e.target.value)} helperText="Plugin 名 / Kit 名で選びます">
            {rows.map((r) => <MenuItem key={r.key} value={r.key}>{r.pluginName} / {r.kitName}</MenuItem>)}
          </TextField>
        )}
        <Alert severity="info" variant="outlined" data-testid="export-settings">
          出力設定（Settings で変更）: UseArticulation = {String(settings.useArticulation)}、
          UseArticulationPitchName = {String(settings.useArticulationPitchName)}。
          Studio One／Cubase の出力に反映されます。
        </Alert>
        <Typography variant="body2">選択中の Kit: {selectedRows.length} 件。{outputNote}</Typography>
        <Button variant="contained" disabled={!canExport} onClick={run}>Export を実行</Button>
        <Typography variant="caption" color="text.secondary">
          ダウンロードを開始するだけで、ディスクへの保存完了は確認できません。Export は編集中のデータを変更しません。
        </Typography>
        {result && (
          <Alert severity="success" role="status" data-testid="export-result">
            ダウンロードを開始しました: {result.fileName}（{result.files.length} ファイル）
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {result.files.slice(0, MAX_ROWS).map((f) => <li key={f}>{f}</li>)}
              {result.files.length > MAX_ROWS && <li>…ほか {result.files.length - MAX_ROWS} ファイル</li>}
            </Box>
          </Alert>
        )}
      </Paper>
      <KitTree rows={rows} picked={picked} onChange={setPicked} label="出力する Kit" />
      <Dialog open={blocked !== null} onClose={() => setBlocked(null)} scroll="paper" maxWidth="md" fullWidth>
        <DialogTitle>出力できません</DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 1 }}>{blocked?.title}</DialogContentText>
          {blocked?.hint && <DialogContentText sx={{ mb: 1.5 }}>{blocked.hint}</DialogContentText>}
          <DialogContentText sx={{ mb: 1.5 }}>
            何も出力していません。データは自動修正されません。Map Editor で修正してから、もう一度実行してください。
          </DialogContentText>
          {blocked?.blockers.map((b, i) => <BlockerView key={i} b={b} />)}
        </DialogContent>
        <DialogActions><Button onClick={() => setBlocked(null)}>閉じる</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
