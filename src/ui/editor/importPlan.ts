import {
  importDrm, importPitchlist, importTsv, separatorValue,
  type Kit, type KitRef, type MapData, type QbdError, type Result,
} from '../../core';

export type ImportFormat = 'pitchlist' | 'drm' | 'tsv';

/** ファイル選択で受け付ける拡張子（Windows版 OnImport のフィルター `*.pitchlist;*.drm;*.tsv` と同じ） */
export const IMPORT_ACCEPT = '.pitchlist,.drm,.tsv';

export const FORMAT_LABEL: Record<ImportFormat, string> = { pitchlist: 'Studio One .pitchlist', drm: 'Cubase .drm', tsv: 'Text .tsv' };

/**
 * 拡張子から形式を決める。Windows版は小文字の拡張子だけを受け付けるが、Web版は大文字小文字を区別しない（Web改善）。
 * 判別できない拡張子は取り込まない。
 */
export function detectImportFormat(fileName: string): ImportFormat | null {
  const ext = /\.([^.\/]*)$/.exec(fileName)?.[1]?.toLowerCase();
  return ext === 'pitchlist' || ext === 'drm' || ext === 'tsv' ? ext : null;
}

export interface ImportPreview {
  format: ImportFormat;
  fileName: string;
  kitNameBefore: string;
  kitNameAfter: string;
  /** 取り込み先Kitの行数（取り込みで増減しない） */
  rows: number;
  /** Name が変わる行 */
  nameChanged: number;
  /** 取り込みで空になる行（Name が空になる／もとは名前があった行） */
  nameCleared: number;
  /** Articulation 割当が外れる行（割当ありの行が取り込み後に 0 になる） */
  articulationCleared: number;
  /** Articulation が新たに割り当てられる行（TSVのみ起こり得る） */
  articulationAssigned: number;
  /** Separator が変わる行 */
  separatorChanged: number;
  /** DisplayOrder が変わる行 */
  orderChanged: number;
  /** 取り込み後のKit名が他のKitと重複する場合、その重複先（Plugin名 / Kit名） */
  duplicateKitNames: string[];
  /** 取り込み後のKit名が空（保存時の検証で止まる） */
  emptyKitName: boolean;
  /** 他のKitや他のPlugin・Partは変更されない */
  otherKitsChanged: 0;
}

export interface ImportPlan {
  next: MapData;
  preview: ImportPreview;
}

const nameOf = (s: string | null): string => s ?? '';

function previewOf(before: MapData, after: MapData, ref: KitRef, format: ImportFormat, fileName: string): ImportPreview {
  const kb = before.Plugins[ref.pluginIndex]!.Kits[ref.kitIndex]!;
  const ka = after.Plugins[ref.pluginIndex]!.Kits[ref.kitIndex]!;
  const p = {
    nameChanged: 0, nameCleared: 0, articulationCleared: 0, articulationAssigned: 0, separatorChanged: 0, orderChanged: 0,
  };
  kb.Pitches.forEach((b, i) => {
    const a = ka.Pitches[i]!;
    if (nameOf(b.Name) !== nameOf(a.Name)) p.nameChanged++;
    if (nameOf(b.Name) !== '' && nameOf(a.Name) === '') p.nameCleared++;
    if (b.ArticulationID !== 0 && a.ArticulationID === 0) p.articulationCleared++;
    if (b.ArticulationID === 0 && a.ArticulationID !== 0) p.articulationAssigned++;
    if (separatorValue(b.Separator) !== separatorValue(a.Separator)) p.separatorChanged++;
    if (b.DisplayOrder !== a.DisplayOrder) p.orderChanged++;
  });
  const duplicateKitNames: string[] = [];
  after.Plugins.forEach((pl, pi) => pl.Kits.forEach((k: Kit, ki) => {
    if (pi === ref.pluginIndex && ki === ref.kitIndex) return;
    if (k.Name === ka.Name) duplicateKitNames.push(`${pl.Name} / ${k.Name}`);
  }));
  return {
    format, fileName, kitNameBefore: kb.Name, kitNameAfter: ka.Name, rows: kb.Pitches.length, ...p,
    duplicateKitNames, emptyKitName: ka.Name.length === 0, otherKitsChanged: 0,
  };
}

/**
 * 取り込みを作業モデルに触れずに実行し、結果のモデルとプレビューを返す。
 * Coreの importPitchlist / importDrm / importTsv は入力を複製した新しいモデルを返すため、失敗しても何も変更しない。
 */
export function planImport(map: MapData, ref: KitRef, fileName: string, text: string): Result<ImportPlan> {
  const format = detectImportFormat(fileName);
  if (!format) {
    const err: QbdError = { code: 'unsupported-import-extension', message: `拡張子が .pitchlist / .drm / .tsv ではありません: ${fileName}` };
    return { ok: false, error: err };
  }
  const r = format === 'pitchlist' ? importPitchlist(map, ref, text, fileName)
    : format === 'drm' ? importDrm(map, ref, text)
      : importTsv(map, ref, text, fileName);
  if (!r.ok) return r;
  return { ok: true, value: { next: r.value, preview: previewOf(map, r.value, ref, format, fileName) } };
}

/** 確認ダイアログに出す文面。算出済みの値だけを示す */
export function importConfirmText(pv: ImportPreview): string {
  const lines = [
    `${FORMAT_LABEL[pv.format]} を選択中の Kit に取り込みます（${pv.fileName}）。`,
    '',
    `Kit 名: 「${pv.kitNameBefore}」→「${pv.kitNameAfter}」`,
    `Pitch 行（${pv.rows} 行）のうち、Name が変わる行: ${pv.nameChanged}（空になる行: ${pv.nameCleared}）`,
    `Articulation の割当が外れる行: ${pv.articulationCleared}${pv.articulationAssigned > 0 ? `／新たに割り当てられる行: ${pv.articulationAssigned}` : ''}`,
    `Separator が変わる行: ${pv.separatorChanged}／並び順（DisplayOrder）が変わる行: ${pv.orderChanged}`,
    '他の Kit・Plugin・Part・Articulation は変更されません。取り込み後は「元に戻す」で1回で戻せます。',
  ];
  if (pv.duplicateKitNames.length > 0) {
    lines.push('', `警告: 取り込み後の Kit 名が他の Kit と重複します（${pv.duplicateKitNames.slice(0, 5).join('、')}${pv.duplicateKitNames.length > 5 ? ' ほか' : ''}）。重複したままだと、保存時の入力検証でエラーになり保存できません。取り込み後に Kit 名を変更してください。`);
  }
  if (pv.emptyKitName) lines.push('', '警告: 取り込み後の Kit 名が空です。保存時の入力検証でエラーになるため、Kit 名を入力してください。');
  return lines.join('\n');
}

