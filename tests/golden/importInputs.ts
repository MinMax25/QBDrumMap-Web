// 取り込みテスト用の入力生成。各ケースの先頭Kitの出力（Web Core = C#と一致を確認済み）を土台に、決定的に変形する。
// 同じ入力を Windows版C#の取り込みメソッド（ハーネス）と Web Core の取り込みへ与え、Kitの状態を比較する。
// ※ LF改行のTSVは意図的な差異（Web版は受け付け、Windows版は受け付けない）のためここには含めない。
import {
  getCubaseDrumMap, getStudioOnePitchList, getTsvText, parseQbd, serializeCubaseDrm, serializePitchList,
} from '../../src/core';

export interface ImportInput {
  case: number;
  kind: 'pitchlist' | 'drm' | 'tsv';
  variant: string;
  fileName: string;
  text: string;
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

const NL = '\r\n';
const LONG = 'x'.repeat(100);

export function generateImportInputs(cases: unknown[]): ImportInput[] {
  const out: ImportInput[] = [];
  cases.forEach((c, ci) => {
    const r = parseQbd(JSON.stringify(c));
    if (!r.ok) return;
    const map = r.value;
    const kitName = map.Plugins[0]!.Kits[0]!.Name;
    const st = { useArticulation: true, useArticulationPitchName: true };
    const rnd = mulberry32(90000 + ci);
    const int = (n: number): number => Math.floor(rnd() * n);
    const shuffle = <T>(xs: T[]): T[] => [...xs].sort(() => rnd() - 0.5);
    const drop = <T>(xs: T[], p: number): T[] => xs.filter(() => rnd() >= p);
    const add = (kind: ImportInput['kind'], variant: string, text: string): void => {
      out.push({ case: ci, kind, variant, fileName: kind === 'tsv' ? 'imp.tsv' : `imp.${kind}`, text });
    };

    // ---- Studio One ----
    const pl = getStudioOnePitchList(map, kitName, st);
    if (pl.ok) {
      const t = serializePitchList(pl.value, { escapeAttributes: false }); // Windows版互換（未エスケープ）の出力を土台にする
      const lines = t.split(NL);
      const head = lines.slice(0, 2);
      const tail = lines.slice(-2);
      const items = lines.slice(2, -2);
      const join = (xs: string[]): string => [...head, ...xs, ...tail].join(NL);
      add('pitchlist', 'base', t);
      add('pitchlist', 'drop', join(drop(items, 0.4)));
      add('pitchlist', 'shuffle', join(shuffle(items)));
      if (items.length > 0) {
        const k = int(items.length);
        const dup = items[k]!.replace(/name="[^"]*"/, 'name="dup"');
        add('pitchlist', 'duplicate', join([...items.slice(0, k), dup, ...items.slice(k)]));
        add('pitchlist', 'longName', join(items.map((x, i) => (i === 0 ? x.replace(/name="[^"]*"/, `name="${LONG}"`) : x))));
        add('pitchlist', 'badPitch', join(items.map((x, i) => (i === 0 ? x.replace(/pitch="\d+"/, 'pitch="abc"') : x))));
        add('pitchlist', 'bigPitch', join(items.map((x, i) => (i === 0 ? x.replace(/pitch="\d+"/, 'pitch="300"') : x))));
        add('pitchlist', 'negPitch', join(items.map((x, i) => (i === 0 ? x.replace(/pitch="\d+"/, 'pitch="-1"') : x))));
        add('pitchlist', 'noPitchAttr', join(items.map((x, i) => (i === 0 ? x.replace(/ pitch="\d+"/, '') : x))));
        add('pitchlist', 'unknownBits', join(items.map((x, i) => (i === 0 ? x.replace('/>', ' foo="1"/>') : x))).replace(`${NL}</`, `${NL}<!-- c --><Other a="1"/>${NL}</`));
      }
      add('pitchlist', 'blankTitle', t.replace(/title="[^"]*"/, 'title="   "'));
      add('pitchlist', 'noTitle', t.replace(/ title="[^"]*"/, ''));
      add('pitchlist', 'longTitle', t.replace(/title="[^"]*"/, `title="${LONG}"`));
      add('pitchlist', 'wrongRoot', t.replace(/Music\.PitchNameList/g, 'Other'));
      add('pitchlist', 'truncated', t.slice(0, Math.max(10, Math.floor(t.length * 0.6))));
      add('pitchlist', 'ctrlChar', t.replace('<Music.PitchName', '<Music.PitchName x="\u0001"'));
    }

    // ---- Cubase ----
    const dm = getCubaseDrumMap(map, kitName, null, st);
    const drm = dm.ok ? serializeCubaseDrm(dm.value) : undefined;
    if (drm?.ok) {
      const t = drm.value;
      const oStart = t.indexOf('<list name="Order"');
      const oEnd = t.indexOf('</list>', oStart);
      const orderBlock = t.slice(oStart, oEnd);
      const orderItems = orderBlock.match(/ {4}<item value="\d+" \/>\r\n/g) ?? [];
      const withOrder = (items: string[]): string =>
        t.slice(0, oStart) + orderBlock.slice(0, orderBlock.indexOf('>') + 1) + NL + items.join('') + '  ' + t.slice(oEnd);
      add('drm', 'base', t);
      add('drm', 'dropOrder', withOrder(drop(orderItems, 0.4)));
      add('drm', 'reverseOrder', withOrder([...orderItems].reverse()));
      add('drm', 'shuffleOrder', withOrder(shuffle(orderItems)));
      add('drm', 'emptyOrder', withOrder([]));
      add('drm', 'shiftINote', t.replace(/name="INote" value="(\d+)"/g, (m, n: string) => (rnd() < 0.3 ? `name="INote" value="${Number(n) + 200}"` : m)));
      add('drm', 'longName', t.replace(/(name="Name" value=")[^"]*"/, `$1${LONG}"`));
      add('drm', 'emptyName', t.replace(/(name="Name" value=")[^"]*"/, '$1"'));
      const mStart = t.indexOf('<list name="Map"');
      const mEnd = t.indexOf('</list>', mStart);
      const blocks = t.slice(mStart, mEnd).match(/ {4}<item>\r\n[\s\S]*?\r\n {4}<\/item>\r\n/g) ?? [];
      const mHead = t.slice(mStart, t.indexOf('>', mStart) + 1);
      add('drm', 'dropMapItems', t.slice(0, mStart) + mHead + NL + drop(blocks, 0.5).join('') + '  ' + t.slice(mEnd));
      add('drm', 'badInt', t.replace(/name="ONote" value="\d+"/, 'name="ONote" value="x"'));
      add('drm', 'wrongRoot', t.replace(/DrumMap>/g, 'Other>').replace('<DrumMap', '<Other'));
      add('drm', 'escapes', t.replace(/(name="Name" value=")[^"]*"/, '$1a&amp;b&lt;&#65;&quot;&#x3042;"'));
      add('drm', 'ctrlEntity', t.replace(/(name="Name" value=")[^"]*"/, '$1a&#1;b"'));
    }

    // ---- TSV ----
    const tsv = getTsvText(map, kitName);
    const tl = tsv.split(NL).filter((x) => x !== '');
    const th = tl[0]!;
    const rows = tl.slice(1);
    const tj = (xs: string[]): string => [th, ...xs].join(NL) + NL;
    const cell = (row: string, i: number, v: string): string => row.split('\t').map((x, k) => (k === i ? v : x)).join('\t');
    add('tsv', 'base', tsv);
    add('tsv', 'shuffle', tj(shuffle(rows)));
    add('tsv', 'drop', tj(drop(rows, 0.5)));
    add('tsv', 'blankLines', tj(rows.flatMap((x) => (rnd() < 0.2 ? [x, ''] : [x]))));
    add('tsv', 'noTrailingNewline', tj(rows).slice(0, -2));
    add('tsv', 'bom', '﻿' + tsv);
    const artNames = ['unknownArt', '', ...map.Parts.flatMap((p) => p.Articulations.map((a) => a.Name))];
    add('tsv', 'articulations', tj(rows.map((x) => cell(x, 3, artNames[int(artNames.length)]!))));
    const seps = ['', 'Separate', 'separate', ' Unload ', '2', '99', '-4', 'Separate,Unload', 'Bogus', 'Duplicate'];
    add('tsv', 'separators', tj(rows.map((x) => cell(x, 4, seps[int(seps.length)]!))));
    add('tsv', 'blankNames', tj(rows.map((x) => (rnd() < 0.3 ? cell(x, 2, ' ') : x))));
    add('tsv', 'longNames', tj(rows.map((x) => (rnd() < 0.3 ? cell(x, 2, LONG) : x))));
    add('tsv', 'pitchSpaces', tj(rows.map((x) => cell(x, 0, ` ${x.split('\t')[0]} `))));
    add('tsv', 'pitchPlus', tj(rows.map((x) => cell(x, 0, `+${x.split('\t')[0]}`))));
    add('tsv', 'badPitch', tj(rows.map((x, i) => (i === 0 ? cell(x, 0, 'abc') : x))));
    add('tsv', 'missingPitch', tj(rows.map((x, i) => (i === 0 ? cell(x, 0, '4000') : x))));
    add('tsv', 'fewColumns', tj(rows.map((x, i) => (i === 0 ? x.split('\t').slice(0, 4).join('\t') : x))));
    add('tsv', 'badHeader', [th.replace('Note', 'Notes'), ...rows].join(NL) + NL);
    add('tsv', 'empty', '');
    add('tsv', 'headerOnly', th + NL);
  });
  return out;
}
