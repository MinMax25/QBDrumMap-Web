import { getCubaseDrumMap, serializeCubaseDrm } from './cubase';
import { kitAt, failure, ok, type ExportSettings, type KitRef } from './exportCommon';
import type { MapData } from './model';
import { getNoteMapperTemplate } from './noteMapperCsv';
import { getStudioOnePitchList, serializePitchList } from './pitchlist';
import { getQbDrummerCsv } from './qbDrummerCsv';
import type { Result } from './result';
import { getTsvTextAt } from './tsv';
import { dedupePaths, toSafeFileName, type ExportFile } from './text';

export type ExportFormat = 'studioOne' | 'cubase' | 'cubaseBaseOn' | 'tsv' | 'qbDrummer';

/**
 * 選択Kitごとの出力ファイル一覧を作る（Windows版 ExportViewModel の各 OnExport* に対応）。
 * 出力パスは `{Plugin名}/{Kit名}.{拡張子}`（Windows版のPlugin別フォルダ構成。名前は出力時のみ安全化し、モデルは変更しない）。
 * 入力モデルは変更しない。いずれかのKitでエラーになった場合は、ファイルを返さずそのエラーを返す（部分出力しない）。
 * - cubaseBaseOn は options.baseOn（Base Kit）が必要。
 * - 同じパスのファイル（大文字小文字を区別しない）がある場合は、拡張子の前に ` (2)`、` (3)` を付けて衝突を避ける。
 * - ファイルのBOM: Studio One / Cubase は付ける、TSV / QBDrummer CSV は付けない（Windows版の書込み方法に合わせる）。
 */
export function exportKits(
  map: MapData, format: ExportFormat, kits: KitRef[], settings: ExportSettings, options: { baseOn?: KitRef } = {},
): Result<ExportFile[]> {
  const baseOnKit = options.baseOn ? kitAt(map, options.baseOn) : undefined;
  if (format === 'cubaseBaseOn' && !baseOnKit) return failure('base-on-required', 'Base Kit が必要です');

  const files: ExportFile[] = [];
  for (const ref of kits) {
    const kit = kitAt(map, ref);
    const plugin = map.Plugins[ref.pluginIndex];
    if (!kit || !plugin) return failure('kit-not-found', 'Kit not found.');
    const dir = toSafeFileName(plugin.Name);
    const base = `${dir}/${toSafeFileName(kit.Name)}`;

    switch (format) {
      case 'studioOne': {
        const list = getStudioOnePitchList(map, kit.Name, settings);
        if (!list.ok) return list;
        files.push({ path: `${dir}/${toSafeFileName(list.value.Title)}.pitchlist`, content: serializePitchList(list.value), bom: true });
        break;
      }
      case 'cubase':
      case 'cubaseBaseOn': {
        const dm = getCubaseDrumMap(map, kit.Name, format === 'cubaseBaseOn' ? baseOnKit!.Name : null, settings);
        if (!dm.ok) return dm;
        const xml = serializeCubaseDrm(dm.value);
        if (!xml.ok) return xml;
        files.push({ path: `${base}.drm`, content: xml.value, bom: true });
        break;
      }
      case 'tsv':
        files.push({ path: `${base}.tsv`, content: getTsvTextAt(map, ref), bom: false });
        break;
      case 'qbDrummer': {
        const csv = getQbDrummerCsv(map, kit.Name);
        if (!csv.ok) return csv;
        files.push({ path: `${base}.csv`, content: csv.value, bom: false });
        break;
      }
    }
  }
  const paths = dedupePaths(files.map((f) => f.path));
  return ok(files.map((f, i) => ({ ...f, path: paths[i]! })));
}

/** NoteMapper の Templates.txt（選択Kit全体で1ファイル。UTF-8 BOM付き） */
export function exportNoteMapper(map: MapData, baseOn: KitRef, kits: KitRef[]): Result<ExportFile> {
  const t = getNoteMapperTemplate(map, baseOn, kits);
  return t.ok ? ok({ path: 'Templates.txt', content: t.value, bom: true }) : t;
}

