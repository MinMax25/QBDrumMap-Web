import { parseCubaseDrm } from './cubase';
import { enumFromNumber, parseEnumText } from './enums';
import { failure, kitAt, ok, type KitRef } from './exportCommon';
import { cloneMap, SEPARATORS, type Kit, type MapData } from './model';
import type { Result } from './result';
import { left, parseDotNetInt } from './text';
import { NAME_MAX_LENGTH } from './validate';
import { parseXml, XmlParseError } from './xml';

const WS = /^[\p{Zs}\p{Zl}\p{Zp}\t-\r\u0085]*$/u;

/** Path.GetFileNameWithoutExtension 相当（名前単体を受け取る。最後の `.` 以降を除く） */
export function fileNameWithoutExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(0, dot) : base;
}

/** 入力を複製して対象Kitを取り出す。元のモデルは変更しない（取り込みは新しいモデルを返す） */
function withKit(map: MapData, ref: KitRef): { copy: MapData; kit: Kit } | undefined {
  if (!kitAt(map, ref)) return undefined;
  const copy = cloneMap(map);
  return { copy, kit: kitAt(copy, ref)! };
}

/**
 * Windows版の取り込み末尾: DisplayOrder順（同値は元の配列順）に 1.. を振り直す。
 * Windows版の SortRefresh は表示用のビュー並びを設定するだけで、基の配列順は変えない（Web版も配列順は変えない）。
 */
function renumber(kit: Kit, thenByPitch: boolean): void {
  kit.Pitches
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.DisplayOrder - b.p.DisplayOrder || (thenByPitch ? a.p.Pitch - b.p.Pitch : 0) || a.i - b.i)
    .forEach((x, i) => {
      x.p.DisplayOrder = i + 1;
    });
}

function clearPitch(kit: Kit, pitchIndex: number, name: string, displayOrder: number): void {
  const p = kit.Pitches[pitchIndex]!;
  p.Name = name;
  p.ArticulationID = 0;
  p.Separator = 'None';
  p.DisplayOrder = displayOrder;
}

/**
 * Studio One .pitchlist を選択Kitへ取り込む（Windows版 ImportPitchlist）。
 * - Kit名 = title 属性（空白のみなら拡張子を除いたファイル名）を64文字まで。
 * - Kitの各Pitchについて、pitch属性が一致する最初の項目の name（64文字まで）を適用し、ArticulationID=0・Separator=None、
 *   DisplayOrder=ファイル内の位置(1始まり)。ファイルに無いPitchは Name を空にし、末尾側(1000+Pitch)へ。最後に 1.. へ詰め直す（配列順は変えない）。
 * - ルート要素は Music.PitchNameList、pitch属性は 0–255 の整数（欠落は0）。それ以外はエラー。
 * 差異: Windows版は途中で失敗するとKitが部分的に更新されるが、Web版は新しいモデルか失敗かのどちらかで、失敗時は何も変えない。
 */
export function importPitchlist(map: MapData, ref: KitRef, text: string, fileName: string): Result<MapData> {
  const w = withKit(map, ref);
  if (!w) return failure('kit-not-found', 'Kit not found.');
  const items: { pitch: number; name: string }[] = [];
  let title: string;
  try {
    const root = parseXml(text);
    if (root.name !== 'Music.PitchNameList' || (root.attrs['xmlns'] ?? '') !== '') {
      return failure('invalid-pitchlist', 'ルート要素が Music.PitchNameList ではありません');
    }
    title = root.attrs['title'] ?? '';
    for (const c of root.children) {
      if (c.name !== 'Music.PitchName') continue;
      const raw = c.attrs['pitch'];
      const n = raw === undefined ? 0 : parseDotNetInt(raw);
      if (n === undefined || n < 0 || n > 255) return failure('invalid-pitchlist', `pitch属性が不正です: ${raw}`);
      items.push({ pitch: n, name: c.attrs['name'] ?? '' });
    }
  } catch (e) {
    if (e instanceof XmlParseError) return failure('invalid-xml', e.message);
    throw e;
  }
  if (WS.test(title)) title = fileNameWithoutExtension(fileName);

  w.kit.Name = left(title, NAME_MAX_LENGTH);
  w.kit.Pitches.forEach((p, idx) => {
    const pos = items.findIndex((x) => x.pitch === p.Pitch);
    if (pos >= 0) clearPitch(w.kit, idx, left(items[pos]!.name, NAME_MAX_LENGTH), pos + 1);
    else clearPitch(w.kit, idx, '', 1000 + p.Pitch);
  });
  renumber(w.kit, false);
  return ok(w.copy);
}

/**
 * Cubase .drm を選択Kitへ取り込む（Windows版 ImportDrm）。
 * - Kit名 = DrumMap の Name（64文字まで）。INote が Pitch に一致する最初の Map 項目の Name を適用し、ArticulationID=0・Separator=None。
 * - DisplayOrder = Order リスト内での Pitch の位置(1始まり)。Orderに無い場合は 0（Windows版は IndexOf+1 で 0 になり先頭側に並ぶ）。
 * - drm に無い INote のPitchは Name を空にし、1000+Pitch。最後に 1.. へ詰め直す（配列順は変えない）。
 */
export function importDrm(map: MapData, ref: KitRef, text: string): Result<MapData> {
  const w = withKit(map, ref);
  if (!w) return failure('kit-not-found', 'Kit not found.');
  const drm = parseCubaseDrm(text);
  if (!drm.ok) return drm;
  const dm = drm.value;
  w.kit.Name = left(dm.Name, NAME_MAX_LENGTH);
  w.kit.Pitches.forEach((p, idx) => {
    const mi = dm.Map.find((x) => x['INote'] === p.Pitch);
    if (mi) clearPitch(w.kit, idx, left(mi['Name'] as string, NAME_MAX_LENGTH), dm.Order.indexOf(p.Pitch) + 1);
    else clearPitch(w.kit, idx, '', 1000 + p.Pitch);
  });
  renumber(w.kit, false);
  return ok(w.copy);
}

const TSV_HEADER = ['Pitch', 'Note', 'Name', 'Articulation', 'Separator'];

/**
 * TSV を選択Kitへ取り込む（Windows版 ImportTSVText）。
 * - Kit名 = 拡張子を除いたファイル名（64文字まで）。1行目は5列のヘッダーと完全一致が必要。
 * - 各行は5列。Pitch は整数で、Kitに存在するPitchであること（Note列は参考表示で、対応づけには使わない）。違反はエラー。
 * - Name は64文字まで。Name が空白のみなら Articulation / Separator は空として扱う。
 * - Articulation は名前が一致する最初のArticulationのID（見つからなければ0。空名のArticulationがあれば空文字も一致する: Windows版と同じ）。
 * - Separator は Enum.TryParse（大文字小文字を区別、数値文字列・"A,B" も可。解釈不能なら None。未定義の整数は数値のまま保持）。
 * - 行順が DisplayOrder になる（ファイルに無いPitchは末尾側に元の順で並ぶ）。
 * 差異: Windows版は改行を CRLF のみで分割する。Web版は CRLF と LF の両方を受け付ける（LF のみのファイルも読める）。
 *       Windows版は失敗時にKitが部分的に更新されるが、Web版は失敗時に何も変えない。
 */
export function importTsv(map: MapData, ref: KitRef, text: string, fileName: string): Result<MapData> {
  const w = withKit(map, ref);
  if (!w) return failure('kit-not-found', 'Kit not found.');
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n/).filter((l) => l !== '');
  if (lines.length === 0) return failure('invalid-tsv', 'TSVが空です');
  const header = lines[0]!.split('\t');
  if (header.length !== TSV_HEADER.length || header.some((h, i) => h !== TSV_HEADER[i])) {
    return failure('invalid-tsv', 'ヘッダーが Pitch / Note / Name / Articulation / Separator ではありません');
  }

  w.kit.Name = left(fileNameWithoutExtension(fileName), NAME_MAX_LENGTH);
  w.kit.Pitches.forEach((p) => {
    p.DisplayOrder = 999;
  });
  const artics = w.copy.Parts.flatMap((p) => p.Articulations);
  let order = 1;
  for (const [ln, line] of lines.slice(1).entries()) {
    const cols = line.split('\t');
    if (cols.length !== 5) return failure('invalid-tsv', `${ln + 2}行目: 列数が5ではありません`);
    const pitch = parseDotNetInt(cols[0]!);
    if (pitch === undefined) return failure('invalid-tsv', `${ln + 2}行目: Pitchが整数ではありません`);
    const name = left(cols[2], NAME_MAX_LENGTH);
    let articName = cols[3]!;
    let sepName = cols[4]!;
    if (WS.test(name)) {
      articName = '';
      sepName = '';
    }
    const articulationID = artics.find((a) => a.Name === articName)?.ID ?? 0;
    const sepNum = parseEnumText(sepName, SEPARATORS, 0, false);
    const target = w.kit.Pitches.find((x) => x.Pitch === pitch);
    if (!target) return failure('invalid-tsv', `${ln + 2}行目: Kitに存在しないPitchです: ${pitch}`);
    target.Name = name;
    target.ArticulationID = articulationID;
    target.Separator = sepNum === undefined ? 'None' : enumFromNumber(SEPARATORS, 0, sepNum);
    target.DisplayOrder = order++;
  }
  renumber(w.kit, true);
  return ok(w.copy);
}
