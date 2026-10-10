import { failure, ok, type KitRef, kitAt } from './exportCommon';
import type { Kit, MapData } from './model';
import { getArticulationMap } from './resolver';
import type { Result } from './result';
import { CRLF } from './text';

/** 対象Kit（選択Kit）。Windows版 KitListItem 相当の並び替えキーを持つ */
function selectedKitInfo(map: MapData, refs: KitRef[]): { kit: Kit; pluginOrder: number; kitOrder: number }[] {
  return refs.flatMap((r) => {
    const kit = kitAt(map, r);
    const plugin = map.Plugins[r.pluginIndex];
    return kit && plugin ? [{ kit, pluginOrder: plugin.DisplayOrder, kitOrder: kit.DisplayOrder }] : [];
  });
}

/** From>To の対応ペア文字列。To は Resolver の Item の先頭Pitch（Itemが無ければペア無し、Pitchが空なら 0。Windows版と同じ） */
function pairs(kit: Kit, resolverItems: { ID: number; Pitches: number[] }[]): string {
  return [...kit.Pitches]
    .filter((p) => p.ArticulationID > 0)
    .sort((a, b) => a.Pitch - b.Pitch)
    .flatMap((p) => {
      const target = resolverItems.find((x) => x.ID === p.ArticulationID);
      return target ? [`${p.Pitch}>${target.Pitches[0] ?? 0}`] : [];
    })
    .join(',');
}

/**
 * Windows版 ExportViewModel.OnExportNoteMapper が書く Templates.txt の内容（CRLF）。
 *
 * >Forward Conversion の後に「{BaseOn} To {Kit};0,127;{From>To,...}」を選択Kitごとに、
 * >Reverse Conversion の後に「{Kit} To {BaseOn};0,127;{From>To,...}」を選択Kitごとに並べる。
 * - 選択Kitは Plugin.DisplayOrder → Kit.DisplayOrder の順（同値は渡された順）。
 * - Forward のペア: BaseOn の ArticulationID > 0 の行を Pitch 昇順に、対象Kit の Resolver で ArticulationID に対応する Item の先頭Pitchへ。
 * - Reverse のペア: 対象Kit の行を、BaseOn の Resolver（BaseOn名で引く）で対応づける。対象Kitは Kit.ID で引く（Windows版と同じ）。
 * ファイルは UTF-8 BOM付き。Resolverがエラーになる場合はそのエラー。
 */
export function getNoteMapperTemplate(map: MapData, baseOnRef: KitRef, selected: KitRef[]): Result<string> {
  const baseOn = kitAt(map, baseOnRef);
  if (!baseOn) return failure('kit-not-found', 'Base Kit not found.');
  const kits = selectedKitInfo(map, selected)
    .map((k, i) => ({ ...k, i }))
    .sort((a, b) => a.pluginOrder - b.pluginOrder || a.kitOrder - b.kitOrder || a.i - b.i);

  let out = `>Forward Conversion${CRLF}`;
  for (const { kit } of kits) {
    const am = getArticulationMap(map, kit.Name);
    if (!am.ok) return am;
    out += `${baseOn.Name} To ${kit.Name};0,127;${pairs(baseOn, am.value.Items)}${CRLF}`;
  }

  out += `>Reverse Conversion${CRLF}`;
  const baseMap = getArticulationMap(map, baseOn.Name);
  if (!baseMap.ok) return baseMap;
  for (const { kit } of kits) {
    out += `${kit.Name} To ${baseOn.Name};0,127;`;
    const target = map.Plugins.flatMap((p) => p.Kits).find((k) => k.ID === kit.ID);
    if (!target) return failure('kit-not-found', 'Kit not found.');
    out += `${pairs(target, baseMap.value.Items)}${CRLF}`;
  }
  return ok(out);
}
