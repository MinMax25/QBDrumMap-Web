import {
  defaultExportSettings, exportKits, exportNoteMapper, findKitByName, findUndefinedSeparators, kitAt, toSafeFileName, utf8Bytes,
  type ExportFile, type ExportSettings, type KitRef, type MapData, type QbdError, type Result, type UndefinedSeparator,
} from '../../core';
import { createZip, ZipTooLargeError } from '../services/zip';

export type UiExportFormat = 'studioOne' | 'cubase' | 'cubaseBaseOn' | 'tsv' | 'noteMapper' | 'qbDrummer';

export interface FormatDef {
  id: UiExportFormat;
  label: string;
  /** Base Kit が必要か（Windows版: Cubase Base-On と NoteMapper） */
  needsBaseOn: boolean;
  help: string;
}

export const EXPORT_FORMATS: readonly FormatDef[] = [
  { id: 'studioOne', label: 'Studio One .pitchlist', needsBaseOn: false, help: 'Kit ごとに {Plugin名}/{Kit名}.pitchlist を出力します。' },
  { id: 'cubase', label: 'Cubase .drm', needsBaseOn: false, help: 'Kit ごとに {Plugin名}/{Kit名}.drm を出力します。' },
  { id: 'cubaseBaseOn', label: 'Cubase .drm（Base-On）', needsBaseOn: true, help: 'Base Kit の並びで、選択 Kit の代表 Pitch へ変換する .drm を出力します。' },
  { id: 'tsv', label: 'Text .tsv', needsBaseOn: false, help: 'Kit ごとに {Plugin名}/{Kit名}.tsv を出力します（Import で読み戻せる形式）。' },
  { id: 'noteMapper', label: 'NoteMapper テンプレート', needsBaseOn: true, help: '選択 Kit 全体で Templates.txt を1つ出力します。' },
  { id: 'qbDrummer', label: 'QB Drummer プリセット .csv', needsBaseOn: false, help: 'Kit ごとに {Plugin名}/{Kit名}.csv を出力します。' },
];

/** 形式ごとに、未定義の Separator が Core の出力エラーになるか（Studio One と Cubase 系だけ） */
export const SEPARATOR_SENSITIVE: ReadonlySet<UiExportFormat> = new Set(['studioOne', 'cubase', 'cubaseBaseOn']);

export interface ExportRequest {
  format: UiExportFormat;
  kits: KitRef[];
  baseOn: KitRef | null;
}

export interface ExportBlocker {
  /** 出力対象のKit（Plugin名 / Kit名）。未定義Separatorが Base Kit 側にあるときは baseOn:true（行は Base Kit のもの） */
  pluginName: string;
  kitName: string;
  baseOn: boolean;
  /** Coreのエラー */
  error: QbdError;
  /** 未定義 Separator の行（原因が undefined-separator のとき） */
  separatorRows: UndefinedSeparator[];
  /** 同名Kitで特定できないとき、Core が代わりに使う先の Kit（Plugin名 / Kit名） */
  resolvedInstead?: string;
}

export interface ExportBundle {
  /** 出力ファイル。1件ならそのままダウンロード、複数ならZIP */
  files: ExportFile[];
  download: { fileName: string; mime: string; bytes: Uint8Array };
}

export type ExportOutcome =
  | { ok: true; bundle: ExportBundle }
  | { ok: false; error: QbdError; blockers: ExportBlocker[] };

const FORMAT_FILE_LABEL: Record<UiExportFormat, string> = {
  studioOne: 'Studio One', cubase: 'Cubase', cubaseBaseOn: 'Cubase Base-On', tsv: 'Text', noteMapper: 'NoteMapper', qbDrummer: 'QB Drummer',
};

const MIME_BY_EXT: Record<string, string> = {
  pitchlist: 'application/xml', drm: 'application/xml', tsv: 'text/tab-separated-values', csv: 'text/csv', txt: 'text/plain',
};

/** ZIP（複数ファイル時）のダウンロード名。形式名は出力名として安全化する */
export function archiveNameFor(format: UiExportFormat): string {
  return `${toSafeFileName(`QBDrumMap Export (${FORMAT_FILE_LABEL[format]})`)}.zip`;
}

function runCore(map: MapData, req: ExportRequest, settings: ExportSettings): Result<ExportFile[]> {
  if (req.format === 'noteMapper') {
    if (!req.baseOn) return { ok: false, error: { code: 'base-on-required', message: 'Base Kit が必要です' } };
    const r = exportNoteMapper(map, req.baseOn, req.kits);
    return r.ok ? { ok: true, value: [r.value] } : r;
  }
  return exportKits(map, req.format, req.kits, settings, req.baseOn ? { baseOn: req.baseOn } : {});
}

/**
 * Coreの出力が失敗したとき、どのKitが原因かを特定する。Coreは最初のエラーで止まるため、対象Kitを1つずつ再実行して全件を洗い出す。
 * 未定義Separatorの行は findUndefinedSeparators から、Coreが実際に参照するKit（Kit名の最初の一致。Base-Onでは Base Kit）の
 * 「Name があり ArticulationID≠0」の行を示す。ブロックの有無そのものは常に Core の実行結果で決める（事前に推測しない）。
 */
function diagnose(map: MapData, req: ExportRequest, settings: ExportSettings): ExportBlocker[] {
  const undef = findUndefinedSeparators(map);
  const rowsOf = (kitName: string): UndefinedSeparator[] => {
    const used = findKitByName(map, kitName);
    return undef.filter((u) => {
      const k = map.Plugins[u.pluginIndex]?.Kits[u.kitIndex];
      if (!k || k !== used || !u.hasName) return false;
      return (k.Pitches[u.pitchIndex]?.ArticulationID ?? 0) !== 0;
    });
  };
  const blockers: ExportBlocker[] = [];
  if (req.format === 'noteMapper') return blockers; // 全体で1ファイル。個別Kitに分解しない
  for (const ref of req.kits) {
    const kit = kitAt(map, ref);
    const plugin = map.Plugins[ref.pluginIndex];
    if (!kit || !plugin) continue;
    const r = runCore(map, { ...req, kits: [ref] }, settings);
    if (r.ok) continue;
    // Base-On の入力Pitch・Separator は Base Kit から読まれるため、未定義Separatorの原因は Base Kit 側にある
    const baseOnKit = req.format === 'cubaseBaseOn' && req.baseOn ? kitAt(map, req.baseOn) : undefined;
    const rows = r.error.code === 'undefined-separator' ? rowsOf(baseOnKit ? baseOnKit.Name : kit.Name) : [];
    blockers.push({ pluginName: plugin.Name, kitName: kit.Name, baseOn: baseOnKit !== undefined && rows.length > 0, error: r.error, separatorRows: rows });
  }
  return blockers;
}

/**
 * Core が Kit 名で対象を引く形式（Studio One・Cubase 系・QB Drummer・NoteMapper）では、同名の Kit が複数あると、
 * 2つ目以降の Kit を選んでも Kit 名の最初の一致（findKitByName）の内容が出力されてしまう。選んだ Kit と Core が実際に
 * 使う Kit が一致しない場合は、警告だけで続行せず出力を中止する（Core の挙動は変更しない）。
 * TSV は位置（Plugin・Kit の添字）で引くため対象外。Base Kit（Base-On・NoteMapper）も同じ規則で調べる。
 */
export const NAME_RESOLVED_FORMATS: ReadonlySet<UiExportFormat> = new Set(['studioOne', 'cubase', 'cubaseBaseOn', 'noteMapper', 'qbDrummer']);

export function findAmbiguousKits(map: MapData, req: ExportRequest): ExportBlocker[] {
  if (!NAME_RESOLVED_FORMATS.has(req.format)) return [];
  const targets: { ref: KitRef; baseOn: boolean }[] = req.kits.map((ref) => ({ ref, baseOn: false }));
  if ((req.format === 'cubaseBaseOn' || req.format === 'noteMapper') && req.baseOn) targets.push({ ref: req.baseOn, baseOn: true });
  return findAmbiguousTargets(map, targets);
}

/** 選んだ Kit を Kit 名で引く処理（Export の名前引き形式・MIDI 変換）に共通の、同名 Kit の検出 */
export function findAmbiguousTargets(map: MapData, targets: { ref: KitRef; baseOn: boolean }[]): ExportBlocker[] {
  const out: ExportBlocker[] = [];
  for (const { ref, baseOn } of targets) {
    const kit = kitAt(map, ref);
    const plugin = map.Plugins[ref.pluginIndex];
    if (!kit || !plugin) continue;
    const used = findKitByName(map, kit.Name);
    if (!used || used === kit) continue;
    const owner = map.Plugins.find((p) => p.Kits.includes(used));
    out.push({
      pluginName: plugin.Name, kitName: kit.Name, baseOn, separatorRows: [],
      error: { code: 'ambiguous-kit-name', message: `Kit 名「${kit.Name}」は複数あり、${owner?.Name ?? ''} / ${used.Name} が使われます` },
      resolvedInstead: `${owner?.Name ?? ''} / ${used.Name}`,
    });
  }
  return out;
}

/**
 * 出力を作る（作業モデルは変更しない）。1件でもエラーなら何も出力せず、原因のKitとエラーを返す。
 * 出力が1ファイルならそのファイル、複数ならZIP（Plugin別階層を維持）にする。
 */
export function buildExport(map: MapData, req: ExportRequest, settings: ExportSettings = defaultExportSettings): ExportOutcome {
  if (req.kits.length === 0) return { ok: false, error: { code: 'no-target', message: '対象の Kit がありません' }, blockers: [] };
  const ambiguous = findAmbiguousKits(map, req);
  if (ambiguous.length > 0) return { ok: false, error: ambiguous[0]!.error, blockers: ambiguous };
  const r = runCore(map, req, settings);
  if (!r.ok) return { ok: false, error: r.error, blockers: diagnose(map, req, settings) };
  const files = r.value;
  try {
    if (files.length === 1) {
      const f = files[0]!;
      const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
      const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
      return { ok: true, bundle: { files, download: { fileName, mime: MIME_BY_EXT[ext] ?? 'application/octet-stream', bytes: utf8Bytes(f.content, f.bom) } } };
    }
    const zip = createZip(files.map((f) => ({ path: f.path, bytes: utf8Bytes(f.content, f.bom) })));
    return { ok: true, bundle: { files, download: { fileName: archiveNameFor(req.format), mime: 'application/zip', bytes: zip } } };
  } catch (e) {
    if (e instanceof ZipTooLargeError) return { ok: false, error: { code: 'zip-too-large', message: e.message }, blockers: [] };
    throw e;
  }
}
