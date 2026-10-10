import type { MapData } from './model';

/** Name長の上限（Windows版 ExModel.NAME_MAX_LENGTH） */
export const NAME_MAX_LENGTH = 64;

export type NameTarget = 'Plugin' | 'Kit' | 'Part' | 'Articulation' | 'KitPitch';

export interface NameIssue {
  kind: 'length' | 'duplicate';
  target: NameTarget;
  name: string;
  path: string;
}

/** 長さ検証。KitPitchのみ0文字を許可、他は1文字以上（Windows版の検証属性と同じ） */
export function isValidNameLength(target: NameTarget, name: string | null): boolean {
  const len = name?.length ?? 0;
  return len >= (target === 'KitPitch' ? 0 : 1) && len <= NAME_MAX_LENGTH;
}

interface Entry {
  name: string | null;
  path: string;
}

/**
 * 編集時の入力制約チェック（Plugin名/Part名は全体、Kit名は全Plugin横断、Articulation名は全Part横断で一意。KitPitch名は重複可）。
 * Load拒否には使わない（異常・旧QBDは読み込めること）。UIの編集確定時や保存前の警告表示向け。
 * 重複判定は同一要素を除いた名前の完全一致（Windows版はID比較。Webは要素の同一性で比較する）。
 */
export function validateNames(map: MapData): NameIssue[] {
  const issues: NameIssue[] = [];
  const check = (target: NameTarget, entries: Entry[], unique: boolean): void => {
    entries.forEach((e, i) => {
      if (!isValidNameLength(target, e.name)) {
        issues.push({ kind: 'length', target, name: e.name ?? '', path: e.path });
      }
      if (unique && entries.some((o, j) => j !== i && o.name === e.name)) {
        issues.push({ kind: 'duplicate', target, name: e.name ?? '', path: e.path });
      }
    });
  };

  check('Plugin', map.Plugins.map((pl, i) => ({ name: pl.Name, path: `Plugins[${i}]` })), true);
  check('Kit', map.Plugins.flatMap((pl, i) =>
    pl.Kits.map((k, j) => ({ name: k.Name, path: `Plugins[${i}].Kits[${j}]` }))), true);
  check('KitPitch', map.Plugins.flatMap((pl, i) => pl.Kits.flatMap((k, j) =>
    k.Pitches.map((p, n) => ({ name: p.Name, path: `Plugins[${i}].Kits[${j}].Pitches[${n}]` })))), false);
  check('Part', map.Parts.map((pt, i) => ({ name: pt.Name, path: `Parts[${i}]` })), true);
  check('Articulation', map.Parts.flatMap((pt, i) =>
    pt.Articulations.map((a, j) => ({ name: a.Name, path: `Parts[${i}].Articulations[${j}]` }))), true);
  return issues;
}
