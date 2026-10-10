import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Paper, TextField, Typography,
} from '@mui/material';
import { NOTICE_DOWNLOAD_STARTED } from '../app/fileActions';
import { useEditorState } from '../app/useEditorStore';
import type { EditorUi } from '../editor/pluginsKitsActions';
import type { ExportBlocker } from '../export/exportPlan';
import { KitTree, listKits } from '../export/KitTree';
import { toUserMessage } from '../services/errorMessages';
import type { FileIo } from '../services/fileIo';
import { useSettings, type SettingsStore } from '../settings/settingsStore';
import type { EditorStore } from '../state/editorStore';
import { planConvert } from './convertPlan';

export const MIDI_ACCEPT = '.mid,.midi,audio/midi';
const MAX_ROWS = 10;

function Blockers({ list }: { list: ExportBlocker[] }) {
  return (
    <>
      {list.map((b, i) => (
        <Box key={i} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2">{b.pluginName} / {b.kitName}{b.baseOn ? '（Base Kit）' : ''}</Typography>
          {b.resolvedInstead && (
            <Typography variant="body2">同名の Kit が先にあるため、この Kit の代わりに「{b.resolvedInstead}」が使われてしまいます。Kit 名を変更して一意にしてください。</Typography>
          )}
        </Box>
      ))}
    </>
  );
}

/**
 * Convert MIDI ページ（Windows版 ConvertMidiPage / ConvertMidiViewModel に対応）。
 * MIDI ファイル（バイナリのまま読む）・Base Kit・変換先 Kit（複数）を選んで変換する。出力形式は Settings の ConvertMIDIFormat。
 * 変換は作業モデル・Undo 履歴・Dirty・選択を変更しない（成功・失敗とも）。
 */
export function ConvertMidiPage({ store, ui, io, settingsStore }: { store: EditorStore; ui: EditorUi; io: FileIo; settingsStore: SettingsStore }) {
  const { map } = useEditorState(store);
  const { settings } = useSettings(settingsStore);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [baseOnKey, setBaseOnKey] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [blocked, setBlocked] = useState<{ title: string; blockers: ExportBlocker[] } | null>(null);
  const [result, setResult] = useState<{ fileName: string; files: string[]; inZip: boolean } | null>(null);

  const rows = useMemo(() => listKits(map), [map]);
  const targets = rows.filter((r) => picked.has(r.key));
  const baseOnRow = rows.find((r) => r.key === baseOnKey);
  const reasons: string[] = [];
  if (!file) reasons.push('MIDI ファイルを選んでください');
  if (!baseOnRow) reasons.push('Base Kit を選んでください');
  if (targets.length === 0) reasons.push('変換先の Kit を 1 つ以上選んでください');
  const canConvert = reasons.length === 0;

  const pickFile = async () => {
    setResult(null);
    if (!io.openBinary) {
      ui.onError({ code: 'midi-read-failed', message: 'この環境ではファイルをバイナリで読み込めません。' });
      return;
    }
    try {
      const f = await io.openBinary(MIDI_ACCEPT);
      if (f) setFile(f);
    } catch (e) {
      ui.onError({ code: 'midi-read-failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const run = () => {
    setResult(null);
    if (!file || !baseOnRow) return;
    const out = planConvert(map, {
      input: file.bytes, fileName: file.name, baseOn: baseOnRow.ref, targets: targets.map((t) => t.ref), format: settings.convertMidiFormat,
    });
    if (!out.ok) {
      if (out.blockers.length > 0) setBlocked({ title: toUserMessage(out.error).title, blockers: out.blockers });
      else ui.onError(out.error);
      return;
    }
    const { download } = out.result;
    try {
      if (!io.saveBytes) throw new Error('この環境ではバイナリのダウンロードを開始できません。');
      io.saveBytes(download.fileName, download.bytes, download.mime);
    } catch (e) {
      ui.onError({ code: 'download-failed', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setResult({ fileName: download.fileName, files: out.result.files, inZip: out.result.inZip });
    ui.notify?.(NOTICE_DOWNLOAD_STARTED);
  };

  if (rows.length === 0) {
    return <Typography color="text.secondary">Kit がありません。QBD ファイルを開くか、Map Editor で Kit を作成してください。</Typography>;
  }
  const format = settings.convertMidiFormat;
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Paper variant="outlined" sx={{ p: 1.5, width: 440, maxWidth: '100%', display: 'grid', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => void pickFile()}>MIDI ファイルを選ぶ…</Button>
          <Typography variant="body2" data-testid="midi-file">{file ? `${file.name}（${file.bytes.length} バイト）` : '未選択（.mid / .midi）'}</Typography>
        </Box>
        <TextField select size="small" label="Base Kit" value={baseOnKey} onChange={(e) => setBaseOnKey(e.target.value)} helperText="入力 MIDI の Pitch がこの Kit のものとして解釈されます">
          {rows.map((r) => <MenuItem key={r.key} value={r.key}>{r.pluginName} / {r.kitName}</MenuItem>)}
        </TextField>
        <Alert severity="info" variant="outlined" data-testid="midi-summary">
          出力形式（Settings で変更）: Format {format}。{format === 0
            ? '変換結果は ZIP（Kit ごとの .mid）でダウンロードします。ファイル数は変換後に表示します。'
            : `変換先 ${targets.length} 件を 1 つのファイルにまとめます${file ? `（${file.name.replace(/\.[^.\\/]*$/, '')} Converted.mid）` : ''}。`}
        </Alert>
        <Typography variant="body2">変換先の Kit: {targets.length} 件。</Typography>
        {!canConvert && <Typography variant="caption" color="text.secondary" role="status">{reasons.join('／')}</Typography>}
        <Button variant="contained" disabled={!canConvert} onClick={run}>MIDI を変換</Button>
        <Typography variant="caption" color="text.secondary">
          ダウンロードを開始するだけで、ディスクへの保存完了は確認できません。変換は編集中のデータを変更しません。
        </Typography>
        {result && (
          <Alert severity="success" role="status" data-testid="midi-result">
            ダウンロードを開始しました: {result.fileName}{result.inZip ? `（ZIP・${result.files.length} ファイル）` : ''}
            {result.inZip && (
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {result.files.slice(0, MAX_ROWS).map((f) => <li key={f}>{f}</li>)}
                {result.files.length > MAX_ROWS && <li>…ほか {result.files.length - MAX_ROWS} ファイル</li>}
              </Box>
            )}
          </Alert>
        )}
      </Paper>
      <KitTree rows={rows} picked={picked} onChange={setPicked} label="変換先の Kit" />
      <Dialog open={blocked !== null} onClose={() => setBlocked(null)} scroll="paper" maxWidth="md" fullWidth>
        <DialogTitle>変換できません</DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 1 }}>{blocked?.title}</DialogContentText>
          <DialogContentText sx={{ mb: 1.5 }}>何も出力していません。Kit 名を変更して一意にしてから、もう一度実行してください。</DialogContentText>
          {blocked && <Blockers list={blocked.blockers} />}
        </DialogContent>
        <DialogActions><Button onClick={() => setBlocked(null)}>閉じる</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
