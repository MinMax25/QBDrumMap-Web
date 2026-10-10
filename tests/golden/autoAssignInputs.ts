// Auto Assign の差分検証用の入力生成（決定的な疑似乱数）。autoAssignInputs.json を出力する。
// 各入力 = { map: QBD JSON, dictionary: PartNameAlias[], kit: [pluginIndex, kitIndex] }。
// 生成した入力を Windows版C#コード(ハーネス)に与えて autoAssignExpected.json を作り、Web Coreの出力と照合する。

export interface AutoAssignInput {
  map: Record<string, unknown>;
  dictionary: { CanonicalName: string; Aliases: string }[];
  kit: [number, number];
  tag: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_DICT = [
  { CanonicalName: 'Kick', Aliases: 'Bass Drum,BD' },
  { CanonicalName: 'Snare', Aliases: 'SD' },
  { CanonicalName: 'Hi-Hat', Aliases: 'HiHat,HH,Hat' },
  { CanonicalName: 'Tom', Aliases: 'Floor Tom' },
  { CanonicalName: 'Ride', Aliases: 'Ride Cymbal' },
  { CanonicalName: 'Crash', Aliases: 'Crash Cymbal' },
  { CanonicalName: 'Cymbal', Aliases: '' },
];
const ODD_DICTS: { CanonicalName: string; Aliases: string }[][] = [
  [],
  [{ CanonicalName: '', Aliases: 'Kick,BD' }, { CanonicalName: 'Snare', Aliases: ' SD , , ,Sn,,' }],
  [{ CanonicalName: ' Kick ', Aliases: 'bass drum' }, { CanonicalName: 'HI-HAT', Aliases: 'hh,Hi Hat,ＨＨ' }, { CanonicalName: 'Tom', Aliases: 'Tom Tom,Floor' }],
  [{ CanonicalName: 'Snare', Aliases: 'Snare Drum,Rim' }, { CanonicalName: 'Snare Rim', Aliases: 'Rimshot' }, { CanonicalName: 'Kick', Aliases: 'Kick Drum' }],
  [{ CanonicalName: 'Ride', Aliases: 'Ride Bell,Bell' }, { CanonicalName: 'Crash', Aliases: 'Ride' }, { CanonicalName: 'Cymbal', Aliases: 'Splash,China' }],
  [{ CanonicalName: 'Hat', Aliases: 'HiHat' }, { CanonicalName: 'Hat', Aliases: 'Hi-Hat' }, { CanonicalName: 'Kick', Aliases: 'Hat' }],
  [{ CanonicalName: 'Straße', Aliases: 'STRASSE,ǅ,İ,ı' }, { CanonicalName: 'スネア', Aliases: 'ｽﾈｱ' }, { CanonicalName: 'Kick', Aliases: '😀' }],
];

const BASE_PARTS: { name: string; arts: string[] }[] = [
  { name: 'Kick', arts: ['Kick', 'Kick 2', 'Soft Kick'] },
  { name: 'Snare', arts: ['Snare', 'Snare Rim', 'Rimshot', 'Side Stick', 'Snare Ghost'] },
  { name: 'Hi-Hat', arts: ['Closed', 'Open', 'Pedal', 'Hi-Hat Closed', 'Half Open'] },
  { name: 'Tom', arts: ['Tom 1', 'Tom 2', 'Tom 3', 'Floor Tom', 'High Tom'] },
  { name: 'Ride', arts: ['Ride', 'Ride Bell', 'Ride Edge'] },
  { name: 'Crash', arts: ['Crash', 'Crash 2', 'Crash Edge', 'Open'] }, // "Open" は Hi-Hat とも重複
  { name: 'Cymbal', arts: ['Splash', 'China', 'Open'] },
  { name: 'Misc', arts: ['Clap', 'Cowbell', 'Tambourine', 'snare', 'KICK'] }, // 大文字小文字違いの同名
];

const NAME_POOL = [
  'Kick', 'kick', 'KICK 2', 'Bass Drum', 'BD', 'Bass-Drum 1', '[Kick]', 'Snare', 'SD', 'Snare Rim', 'snare ghost', 'Rimshot',
  'Side Stick', 'Hi-Hat Closed', 'HH Open', 'HiHat Pedal', 'Hat', 'Hi Hat', 'Closed HH', 'Open', 'Tom 1', 'Floor Tom 2', 'High Tom',
  'Ride', 'Ride Cymbal', 'Ride Bell', 'Crash', 'Crash Cymbal 2', 'Crash Edge', 'Splash', 'China', 'Cowbell', 'Clap', 'Tambourine',
  'Closed', 'Hi-Hat (Open)', '(Snare)', 'Kick/Snare', 'Snare_Rim', 'Unknown Thing', 'Vibraslap', 'Bongo', 'Open Triangle',
  'Straße', 'STRASSE', 'スネア', 'ｽﾈｱ', 'ＨＨ', 'İ', 'ǅ', '😀 Kick', 'a\tb', '  Kick  ', 'ＫＩＣＫ', 'Kick,Snare',
  '\u0085Kick', 'Kick\u0085', '﻿Kick', 'i̇', 'ſnare', 'Snare ', 'SNARE', '\u{10400}',
];

export function generateAutoAssignInputs(count: number): AutoAssignInput[] {
  const inputs: AutoAssignInput[] = [];
  for (let c = 0; c < count; c++) {
    const rnd = mulberry32(9000 + c);
    const int = (n: number): number => Math.floor(rnd() * n);
    const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;

    // --- Part / Articulation ---
    let nextId = 1 + int(3);
    const parts: Record<string, unknown>[] = [];
    const artIds: number[] = [];
    const partTarget = BASE_PARTS.filter(() => rnd() < 0.75);
    if (partTarget.length === 0) partTarget.push(BASE_PARTS[int(BASE_PARTS.length)]!);
    partTarget.forEach((bp, i) => {
      const arts = bp.arts.filter(() => rnd() < 0.85).map((n) => {
        nextId += rnd() < 0.2 ? 2 : 1;
        artIds.push(nextId);
        return { ID: nextId, Name: rnd() < 0.08 ? n.toUpperCase() : n, DrumMapOrder: artIds.length };
      });
      if (arts.length > 0 && rnd() < 0.1) { artIds.splice(artIds.indexOf(arts[0]!.ID), 1); arts[0]!.ID = 0; } // ID=0 の Articulation
      parts.push({ ID: i + 1, Name: rnd() < 0.15 ? bp.name.toLowerCase() : bp.name, Articulations: arts });
    });
    if (rnd() < 0.1) parts.splice(int(parts.length + 1), 0, { ID: 99, Name: '', Articulations: [{ ID: 777, Name: 'x', DrumMapOrder: 99 }] });
    if (rnd() < 0.08) parts.push({ ID: 98, Name: 'Hi-Hat', Articulations: [{ ID: 778, Name: 'Closed', DrumMapOrder: 98 }] }); // 同名Part
    if (artIds.length === 0) artIds.push(1);

    // --- Plugin / Kit ---
    const pluginCount = 1 + int(3);
    const plugins: Record<string, unknown>[] = [];
    const kitRefs: [number, number][] = [];
    for (let pi = 0; pi < pluginCount; pi++) {
      const kitCount = 1 + int(3);
      const kits: Record<string, unknown>[] = [];
      for (let ki = 0; ki < kitCount; ki++) {
        const rows = 3 + int(30);
        const used = new Set<number>();
        const pitches: Record<string, unknown>[] = [];
        for (let r = 0; r < rows; r++) {
          let pitch = rnd() < 0.5 ? 35 + int(47) : int(128);
          if (rnd() > 0.05) while (used.has(pitch)) pitch = int(128);
          used.add(pitch);
          const row: Record<string, unknown> = { Pitch: pitch };
          const roll = rnd();
          if (roll < 0.9) row['Name'] = pick(NAME_POOL);
          else if (roll < 0.95) row['Name'] = '   ';
          // 既存の割当（割当済みの行は変更されない）
          if (rnd() < 0.35) row['ArticulationID'] = rnd() < 0.06 ? 8888 : rnd() < 0.05 ? 0 : pick(artIds);
          if (rnd() < 0.3) row['Separator'] = rnd() < 0.12 ? pick([99, -1, 'separate', '2']) : pick(['Separate', 'Unload', 'Duplicate']);
          pitches.push(row);
        }
        if (rnd() < 0.4) pitches.sort(() => rnd() - 0.5);
        kits.push({ ID: pi * 10 + ki + 1, Name: `kit${pi}_${ki}`, Pitches: pitches });
        kitRefs.push([pi, ki]);
      }
      const plugin: Record<string, unknown> = { ID: pi + 1, Name: `plug${pi}`, Kits: kits };
      const t = rnd();
      if (t < 0.5) plugin['PluginType'] = pick(['GM', 'GM2', 'GS', 'XG', 'None', 'gm', 2, 4, 9]);
      plugins.push(plugin);
    }

    // 辞書: 初期値が多め
    const dr = rnd();
    const dictionary = dr < 0.55 ? DEFAULT_DICT : dr < 0.65 ? [] : ODD_DICTS[int(ODD_DICTS.length)]!;
    inputs.push({
      map: { AppName: 'QBDrumMap', ModelVersion: '1.0.0', Plugins: plugins, Parts: parts },
      dictionary,
      kit: pick(kitRefs),
      tag: `c${c}`,
    });
  }
  return inputs;
}
