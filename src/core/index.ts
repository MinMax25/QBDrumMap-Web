export * from './model';
export * from './result';
export { noteName, noteNameWindows } from './noteName';
export { parseQbd } from './load';
export { serializeQbd, type SaveOutput } from './save';
export { normalizeIds } from './fixId';
export { validateNames, isValidNameLength, NAME_MAX_LENGTH, type NameIssue, type NameTarget } from './validate';
export { QbdWorkspace } from './workspace';
export {
  getArticulationMap, findKitByName, representativePitch, representativeNote, pitchesText,
  type ArticulationMap, type ArticulationMapItem,
} from './resolver';
export { getKitPitchOrder, DIVIDER_NAME, isNullOrWhiteSpace, type KitPitchOrderOptions } from './kitPitchOrder';
export * from './enums';
export { separatorValue, separatorToString, separatorDisplayName, separatorSuffix } from './separator';
export {
  defaultExportSettings, kitAt, getKitPitches, findArticulation, type ExportSettings, type KitRef,
} from './exportCommon';
export { CRLF, left, parseDotNetInt, toSafeFileName, dedupePaths, utf8Bytes, type ExportFile } from './text';
export { getTsvText, getTsvTextAt, TSV_HEADER } from './tsv';
export {
  getStudioOnePitchList, serializePitchList, escXml, type PitchList, type PitchName, type SerializePitchListOptions,
} from './pitchlist';
export {
  getCubaseDrumMap, serializeCubaseDrm, parseCubaseDrm, initializeCubaseDrumMap, type CubaseDrumMap,
} from './cubase';
export { getNoteMapperTemplate } from './noteMapperCsv';
export { getQbDrummerCsv } from './qbDrummerCsv';
export { exportKits, exportNoteMapper, type ExportFormat } from './exportKits';
export { importPitchlist, importDrm, importTsv, fileNameWithoutExtension } from './importers';
export { parseXml, XmlParseError, type XmlElement } from './xml';
export {
  convertMidi, mapPitch, type BinaryFile, type MidiConvertOptions, type MidiConvertOutput, type MidiConvertFormat,
} from './midiConvert';
export {
  parseSmf, serializeSmf, mergeTracks, eventGroup, varLen, SmfError, type WebSmf, type WebTrack, type WebEvent, type WebMessage,
} from './smfWeb';
export { autoAssignArticulations, defaultPartNameDictionary, type PartNameAlias, type AutoAssignOutput, type AutoAssignOptions } from './autoAssign';
export { equalsIgnoreCase, indexOfIgnoreCase, containsIgnoreCase, toLowerInvariant, trimDotNet } from './dotnetString';
export {
  addPlugin, deletePlugins, movePlugins, movePluginsTo, updatePlugin,
  addKit, deleteKits, moveKits, moveKitsTo, updateKit,
  updateKitPitch, clearKitPitches, moveKitPitches, moveKitPitchesTo,
  setArticulationForSameName, filterKitPitchIndices, reorderIndices, reorderTo, getNewId,
  type EditResult, type MoveDirection, type PluginPatch, type KitPatch, type KitPitchPatch, type KitPitchFilter,
} from './edit';
export { findUndefinedSeparators, type UndefinedSeparator } from './separatorCheck';
export {
  addPart, deleteParts, moveParts, movePartsTo, updatePart,
  addArticulation, deleteArticulations, moveArticulations, moveArticulationsTo, updateArticulation,
  listDrumMapOrder, moveDrumMapOrder, moveDrumMapOrderTo, countClearedReferences,
  type PartPatch, type ArticulationPatch, type ArticulationRef,
} from './editParts';
export {
  parseStudioOneColor, formatStudioOneColor, studioOneColorToCss, studioOneColorToHex, type StudioOneColor,
} from './partColor';
export {
  resetOrderByPitch, compressForward, copyArticulations, applyAutoAssign,
  type CopyArticulationResult, type AutoAssignEditResult,
} from './editAssist';
