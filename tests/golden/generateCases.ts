// 差分検証用のケース生成（決定的な疑似乱数）。cases.json を出力する。
// 生成した cases.json を Windows版C#コード(ハーネス)に与えて expected.json を作り、Web Coreの出力と照合する。

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

const SEPS = ['Separate', 'Unload', 'Duplicate'];
const NOTE_HEADS = ['nhdX', 'nhTr', 'nhSl', 'nhCX', 'nhDi'];
const TECHNIQUES = ['circ', 'ccir', 'plus', 'trm1', 'trm2', 'trm3', 'stac'];
const VOICES = ['Up1', 'Down1', 'Up2', 'Down2'];
// 出力に影響する特殊文字（XMLエスケープ、CSV区切り、非ASCII、サロゲートペア、制御文字）
const NAMES = [
  'Kick', 'Snare & Rim', 'Hi-Hat <Open>', 'Tom "High"', "Ride's Bell", 'Crash, Left', 'スネア', 'A😀B',
  'a\tb', 'x\u0001y', 'plain',
];

export function generateCases(count: number): unknown[] {
  const cases: unknown[] = [];
  for (let c = 0; c < count; c++) {
    const rnd = mulberry32(5000 + c);
    const int = (n: number): number => Math.floor(rnd() * n);
    const pick = <T>(xs: T[]): T => xs[int(xs.length)]!;
    // たまに制御文字などの特殊名を使う（多くのケースでは安全な名前にして、出力の本流を検証できるようにする）
    const special = rnd() < 0.25;
    const nm = (base: string): string => (special && rnd() < 0.4 ? pick(NAMES) : base);

    const partCount = 1 + int(4);
    const parts: Record<string, unknown>[] = [];
    const articIds: number[] = [];
    let nextId = 1 + int(3);
    for (let i = 0; i < partCount; i++) {
      const n = 1 + int(5);
      const arts = [];
      for (let j = 0; j < n; j++) {
        nextId += rnd() < 0.2 ? 2 : 1;
        articIds.push(nextId);
        arts.push({ ID: nextId, Name: nm(`a${nextId}`), DrumMapOrder: 0 });
      }
      if (rnd() < 0.12) (arts[0] as { ID: number }).ID = 0; // ID=0のArticulation（Windows版ではArticulationID=0の行と一致する）
      const part: Record<string, unknown> = {
        ID: rnd() < 0.15 ? 1 : i + 1, // たまにPartIDを重複させる
        Name: `p${i}`,
        Articulations: arts,
      };
      if (rnd() < 0.7) part['ScorePitch'] = rnd() < 0.05 ? -3 : int(80);
      if (rnd() < 0.5) part['Color'] = pick(['#FF0000', '00000000', '', '  ', '#00ff00', 'red&"']);
      if (rnd() < 0.5) part['NoteHead'] = rnd() < 0.1 ? pick([99, 'NHDX', '2']) : pick(NOTE_HEADS);
      if (rnd() < 0.5) part['Technique'] = rnd() < 0.1 ? pick([77, 'CIRC', '1']) : pick(TECHNIQUES);
      if (rnd() < 0.4) part['NoteHeadSet'] = rnd() < 0.05 ? -1 : int(300);
      if (rnd() < 0.5) part['Voice'] = rnd() < 0.1 ? pick([7, 'down2', '3']) : pick(VOICES);
      if (rnd() < 0.4) part['InstrumentEntityID'] = nm('inst');
      if (rnd() < 0.4) part['TechniqueEntityID'] = nm('tech');
      parts.push(part);
    }
    const flat = (parts as { Articulations: { DrumMapOrder: number }[] }[]).flatMap((p) => p.Articulations);
    const order = flat.map((_, i) => i + 1).sort(() => rnd() - 0.5);
    flat.forEach((a, i) => { a.DrumMapOrder = rnd() < 0.1 ? 1 : order[i]!; });
    (parts as { Articulations: { ID: number; Complement?: number }[] }[]).forEach((p) =>
      p.Articulations.forEach((a) => {
        if (rnd() < 0.3) a.Complement = rnd() < 0.08 ? 9999 : pick(articIds);
      }));

    const kitCount = 1 + int(2);
    const kits = [];
    for (let k = 0; k < kitCount; k++) {
      const rows = 4 + int(24);
      const pitches = [];
      const used = new Set<number>();
      for (let r = 0; r < rows; r++) {
        let pitch = int(128);
        if (rnd() > 0.1) while (used.has(pitch)) pitch = int(128);
        used.add(pitch);
        if (rnd() < 0.02) pitch = pick([-1, 128, 200, 300]); // 範囲外のPitch
        const row: Record<string, unknown> = { Pitch: pitch };
        if (rnd() < 0.85) row['Name'] = rnd() < 0.05 ? '   ' : nm(`n${r}`);
        const roll = rnd();
        if (roll < 0.55) row['ArticulationID'] = pick(articIds);
        else if (roll < 0.6) row['ArticulationID'] = 8888;
        if (rnd() < 0.3) {
          // 名前（大文字小文字違い含む）、数値文字列、定義外の整数、OR結合
          row['Separator'] = rnd() < 0.15 ? pick(['separate', ' Unload ', '3', 2, 99, 'Separate,Unload', -4]) : pick(SEPS);
        }
        pitches.push(row);
      }
      pitches.sort(() => rnd() - 0.5);
      kits.push({ ID: k + 1, Name: nm(`kit${k}`), Pitches: pitches });
    }
    const plugin: Record<string, unknown> = { ID: 1, Name: nm('plug'), Kits: kits };
    if (rnd() < 0.2) plugin['SoundCheckChannel'] = pick([0, 5, 'channel3', '16', 99]);
    cases.push({ AppName: 'QBDrumMap', ModelVersion: '1.0.0', Plugins: [plugin], Parts: parts });
  }
  return cases;
}
