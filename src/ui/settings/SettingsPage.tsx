import { Alert, Box, Button, FormControlLabel, MenuItem, Paper, Switch, TextField, Typography } from '@mui/material';
import type { MidiConvertFormat } from '../../core';
import type { ThemeMode } from './appSettings';
import { PartNameDictionaryEditor } from './PartNameDictionaryEditor';
import { useSettings, type SettingsStore } from './settingsStore';

const RESTORE_TEXT: Record<string, string> = {
  invalid: '保存されていた設定が壊れていた、または値が不正だったため、既定値に戻しました。',
  'unknown-version': '保存されていた設定は未知のバージョン（新しいアプリで保存された可能性）のため、既定値で起動しました。設定を変更すると、保存内容は上書きされます。',
};

/**
 * Settings ページ（Windows版 SettingPage のうち、Core が対応する 3 項目と Part Name Dictionary）。
 * 設定は QBD とは独立で、変更しても QBD の Dirty・Undo/Redo・保存内容は変わらない。
 * Language の編集は後続課題（画面テーマは UI Phase 7 で追加）。
 */
export function SettingsPage({ store, confirm }: { store: SettingsStore; confirm: (message: string) => Promise<boolean> }) {
  const { settings: s, persistent, restore, saveError } = useSettings(store);
  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 640 }}>
      {!persistent && (
        <Alert severity="warning" role="alert" data-testid="settings-not-persistent">
          この環境では設定をブラウザに保存できません。設定はこのタブを開いている間だけ有効で、再読み込みすると既定値に戻ります。
          {saveError ? `（${saveError}）` : ''}
        </Alert>
      )}
      {RESTORE_TEXT[restore] && <Alert severity="info" role="status">{RESTORE_TEXT[restore]}</Alert>}
      <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1 }}>
        <Typography variant="subtitle1" component="h3">表示</Typography>
        <TextField
          select size="small" label="画面テーマ" value={s.theme}
          onChange={(e) => store.update({ theme: e.target.value as ThemeMode })}
          helperText="変更はすぐに画面全体へ反映されます。OS のテーマには追従しません。既定は Dark です。"
        >
          <MenuItem value="dark">Dark</MenuItem>
          <MenuItem value="light">Light</MenuItem>
        </TextField>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1 }}>
        <Typography variant="subtitle1" component="h3">出力</Typography>
        <FormControlLabel
          control={<Switch checked={s.useArticulation} onChange={(e) => store.update({ useArticulation: e.target.checked })} />}
          label="UseArticulation"
        />
        <Typography variant="caption" color="text.secondary">
          オンのとき、Articulation 順の並びと Part の属性（色・音符頭など）を Studio One／Cubase の出力に含めます。
        </Typography>
        <FormControlLabel
          control={<Switch checked={s.useArticulationPitchName} onChange={(e) => store.update({ useArticulationPitchName: e.target.checked })} />}
          label="UseArticulationPitchName"
        />
        <Typography variant="caption" color="text.secondary">
          オンのとき、Pitch の名前を Articulation 名で置き換えて出力します。
        </Typography>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1 }}>
        <Typography variant="subtitle1" component="h3">MIDI 変換</Typography>
        <TextField
          select size="small" label="出力形式（ConvertMIDIFormat）" value={s.convertMidiFormat}
          onChange={(e) => store.update({ convertMidiFormat: Number(e.target.value) as MidiConvertFormat })}
          helperText="Format 1: 1ファイル。Format 0: Kit ごとのファイルを ZIP にまとめます。Windows版の既定は Format 1 です。"
        >
          <MenuItem value={1}>Format 1</MenuItem>
          <MenuItem value={0}>Format 0</MenuItem>
        </TextField>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <PartNameDictionaryEditor store={store} confirm={confirm} />
      </Paper>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={() => store.reset()}>既定値に戻す</Button>
        <Typography variant="caption" color="text.secondary">
          設定はこのブラウザにだけ保存され、QBD ファイルには含まれません。設定の変更は編集履歴（元に戻す）や未保存の表示に影響しません。「既定値に戻す」は Part Name Dictionary を変更しません（辞書は専用の「初期辞書に戻す」で戻します）。
        </Typography>
      </Box>
    </Box>
  );
}
