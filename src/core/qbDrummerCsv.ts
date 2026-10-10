import { ok } from './exportCommon';
import type { MapData } from './model';
import { getArticulationMap } from './resolver';
import type { Result } from './result';
import { CRLF } from './text';

/**
 * Windows版 ExportViewModel.OnExportQBDrummer のCSV（QBDrummerプリセット）。ヘッダー `ID,Sub,Name,Pitchs`。
 * - 行は Resolver の Item を ID 昇順（同値は元の順）に並べたもの。全Articulation（Pitchが無いものも）が対象。
 * - Sub は IsSub（補間前に確定した「直接割当なし」）を 1/0。補間で Pitch が入っても Sub=1 のまま。
 * - Pitchs は複数Pitchを `|` で連結（Resolver補間後の全Pitch）。
 * - Windows版の挙動（要記録）: Name は CSV のエスケープ・引用をしない。`,` や改行を含む名前では列がずれる。
 * - 各行はCRLFで終わる。ファイルは UTF-8（BOMなし）。
 */
export function getQbDrummerCsv(map: MapData, kitName: string): Result<string> {
  const am = getArticulationMap(map, kitName);
  if (!am.ok) return am;
  let out = `ID,Sub,Name,Pitchs${CRLF}`;
  const items = am.value.Items.map((it, i) => ({ it, i })).sort((a, b) => a.it.ID - b.it.ID || a.i - b.i);
  for (const { it } of items) {
    out += `${it.ID},${it.IsSub ? 1 : 0},${it.Name},${it.Pitches.join('|')}${CRLF}`;
  }
  return ok(out);
}
