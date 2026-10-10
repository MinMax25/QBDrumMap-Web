/**
 * 画面構成（仕様書 v0.7.0 §6）: 上位画面は Map Editor / Export / Convert MIDI、Settings は別導線。
 * Map Editor 内に Plugins & Kits / Parts / DrumMap Order を配置する。
 * Windows版は Plugin / Parts / Articulations / Export / Convert MIDI / Settings の6ページ構成（ShellViewModel.MenuItems）。
 * plannedPhase は実装予定フェーズ（骨組みでは表示のみ。分割案は提案であり未承認）。
 */
export interface SubPageDef {
  id: string;
  label: string;
  plannedPhase: string;
  /** 対応するWindows版ページ */
  windowsPage: string;
}

export interface PageDef {
  id: 'mapEditor' | 'export' | 'convertMidi' | 'settings';
  label: string;
  plannedPhase: string;
  subPages?: readonly SubPageDef[];
}

export const MAP_EDITOR_TABS: readonly SubPageDef[] = [
  { id: 'pluginsKits', label: 'Plugins & Kits', plannedPhase: 'UI Phase 2', windowsPage: 'Plugin（KitPanel / KitPitchesPanel）' },
  { id: 'parts', label: 'Parts', plannedPhase: 'UI Phase 3', windowsPage: 'Parts（PartPanel）' },
  { id: 'drumMapOrder', label: 'DrumMap Order', plannedPhase: 'UI Phase 3', windowsPage: 'Articulations' },
];

export const PAGES: readonly PageDef[] = [
  { id: 'mapEditor', label: 'Map Editor', plannedPhase: 'UI Phase 2〜3', subPages: MAP_EDITOR_TABS },
  { id: 'export', label: 'Export', plannedPhase: 'UI Phase 5' },
  { id: 'convertMidi', label: 'Convert MIDI', plannedPhase: 'UI Phase 6' },
  { id: 'settings', label: 'Settings', plannedPhase: 'UI Phase 6' },
];
