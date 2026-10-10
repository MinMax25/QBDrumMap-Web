// テスト用Fixture（QBD JSON文字列）。

const j = (o: unknown): string => JSON.stringify(o, null, 2);

/** GM相当の小規模Fixture: Plugin1 / Kit1 / Part3 / Articulation各1。Windows版Saveの出力形式（既定値省略）。 */
export const gmSmall = j({
  AppName: 'QBDrumMap',
  ModelVersion: '1.0.0',
  Plugins: [
    {
      ID: 1,
      Name: 'GM',
      PluginType: 'GM',
      MidiOutDevice: '',
      SoundCheckChannel: 'Channel10',
      Kits: [
        {
          ID: 1,
          Name: 'GM Kit',
          Pitches: [
            { Name: '' },
            { Pitch: 36, Name: 'Kick', ArticulationID: 1 },
            { Pitch: 38, Name: 'Snare', ArticulationID: 2 },
            { Pitch: 42, Name: 'Closed HH', ArticulationID: 3, Separator: 'Separate' },
          ],
        },
      ],
    },
  ],
  Parts: [
    { ID: 1, Name: 'Kick', ScorePitch: 36, InstrumentEntityID: '', TechniqueEntityID: '',
      Articulations: [{ ID: 1, Name: 'Kick', DrumMapOrder: 1 }] },
    { ID: 2, Name: 'Snare', ScorePitch: 38, Color: '#FF0000', NoteHead: 'nhdX', Technique: 'circ',
      InstrumentEntityID: 'inst', NoteHeadSet: 2, Voice: 'Down1', TechniqueEntityID: 'tech',
      Articulations: [{ ID: 2, Name: 'Snare', DrumMapOrder: 2 }] },
    { ID: 3, Name: 'HiHat', ScorePitch: 42, InstrumentEntityID: '', TechniqueEntityID: '',
      Articulations: [{ ID: 3, Name: 'Closed', DrumMapOrder: 3 }] },
  ],
});

/**
 * 複雑Fixture: 非連番ID、複数Plugin/Kit/Part/Articulation、Complement、欠損参照、
 * Unload/Duplicate、DrumMapOrder入れ替え、Plugin/Part順が配列順と一致しないID、追加フィールドを含む。
 */
export const complex = j({
  AppName: 'QBDrumMap',
  ModelVersion: '1.0.0',
  FutureRootField: { a: 1 },
  Plugins: [
    {
      ID: 40,
      Name: 'Plugin B',
      PluginType: 'XG',
      MidiOutDevice: 'Device <1>',
      SoundCheckChannel: 'Channel3',
      Kits: [
        { ID: 90, Name: 'Kit B1', BankSelectMSB: 1, BankSelectLSB: 2, ProgramNumber: 3,
          Pitches: [
            { Pitch: 10, Name: 'x', ArticulationID: 700 },
            { Pitch: 11, Name: 'dangling', ArticulationID: 999, Separator: 'Duplicate' },
          ] },
      ],
    },
    {
      ID: 7,
      Name: 'Plugin A',
      Kits: [
        { ID: 5, Name: 'Kit A1',
          Pitches: [
            { Pitch: 60, Name: 'Ride', ArticulationID: 300, Separator: 'Separate', Memo: 'keep me' },
            { Pitch: 61, Name: 'Bell', ArticulationID: 301, Separator: 'Unload' },
            { Pitch: 62, Name: 'Crash', ArticulationID: 700 },
          ] },
        { ID: 2, Name: 'Kit A2', Pitches: [] },
      ],
    },
  ],
  Parts: [
    { ID: 20, Name: 'Cymbals', ScorePitch: 51, Color: '#00FF00', Voice: 'Up2',
      InstrumentEntityID: '', TechniqueEntityID: '',
      Articulations: [
        { ID: 300, Name: 'Ride', Complement: 301, DrumMapOrder: 9 },
        { ID: 301, Name: 'Bell', Complement: 12345, DrumMapOrder: 4 },
      ] },
    { ID: 3, Name: 'Toms', ScorePitch: 45, InstrumentEntityID: '', TechniqueEntityID: '',
      Articulations: [{ ID: 700, Name: 'Floor', Complement: 300, DrumMapOrder: 1 }] },
  ],
});

export const empty = j({ AppName: 'QBDrumMap', ModelVersion: '1.0.0', Plugins: [], Parts: [] });

export const brokenJson = '{ "AppName": "QBDrumMap", "Plugins": [ ';
