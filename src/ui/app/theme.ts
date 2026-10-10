import { createTheme, type Theme } from '@mui/material/styles';
import type { ThemeMode } from '../settings/appSettings';

/**
 * 画面テーマ（Dark／Light）。MUI の標準パレットを使い、モードだけを切り替える。
 * ネイティブの入力欄・select・スクロールバーの配色は、CssBaseline の enableColorScheme（color-scheme）で揃える。
 * テーマは表示だけで、QBD・Dirty・Undo には関係しない。
 */
const themes: Record<ThemeMode, Theme> = {
  dark: createTheme({ palette: { mode: 'dark' } }),
  light: createTheme({ palette: { mode: 'light' } }),
};

export function appTheme(mode: ThemeMode): Theme {
  return themes[mode];
}
