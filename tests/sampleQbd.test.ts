import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { cloneMap } from '../src/core';
import { EditorStore } from '../src/ui/state/editorStore';
import { fetchSample, sampleUrl } from '../src/ui/services/sampleQbd';
import { parseSnapshot, SESSION_SCHEMA_VERSION } from '../src/ui/state/sessionPersistence';
import { gmSmall } from './fixtures';

const PUBLIC_SAMPLE = fileURLToPath(new URL('../public/samples/DrumMap.qbd', import.meta.url));
// Windows版の正本 DrumMap.qbd（1,965,623 B）の SHA-256。別の手段（certutil）で正本から独立に確認した値
const SOURCE_SHA256 = 'cd41b13c82c0ff242ac5315626845e83aa1641b3c02410d1f3124fbb3f8fcec5';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const res = (body: string, init?: ResponseInit) => new Response(body, init);

describe('sampleUrl: base の結合（リポジトリ名に依存しない）', () => {
  it.each([
    ['./', './samples/DrumMap.qbd'],
    ['', './samples/DrumMap.qbd'],
    ['/', '/samples/DrumMap.qbd'],
    ['/QBDrumMap-Web/', '/QBDrumMap-Web/samples/DrumMap.qbd'],
    ['/repo', '/repo/samples/DrumMap.qbd'],
    ['https://x.github.io/repo/', 'https://x.github.io/repo/samples/DrumMap.qbd'],
  ])('base=%j → %s', (base, expected) => {
    expect(sampleUrl(base)).toBe(expected);
    expect(sampleUrl(base).replace(/^[a-z]+:\/\//, '')).not.toContain('//');
  });
});

describe('fetchSample', () => {
  it('成功: 本文を変換せずそのまま返す（GET・no-cache。書き戻さない）', async () => {
    const f = vi.fn(async () => res(gmSmall));
    const r = await fetchSample(f as never, '/repo/');
    expect(r).toEqual({ ok: true, value: { name: 'DrumMap.qbd', text: gmSmall } });
    expect(f).toHaveBeenCalledWith('/repo/samples/DrumMap.qbd', { cache: 'no-cache' });
  });
  it('HTTP エラー・通信エラー・空は QbdError', async () => {
    const http = await fetchSample((async () => res('x', { status: 404, statusText: 'Not Found' })) as never, '/');
    expect(http).toMatchObject({ ok: false, error: { code: 'sample-http-error' } });
    const net = await fetchSample((async () => { throw new TypeError('Failed to fetch'); }) as never, '/');
    expect(net).toMatchObject({ ok: false, error: { code: 'sample-network-error', message: 'Failed to fetch' } });
    const empty = await fetchSample((async () => res('  \n')) as never, '/');
    expect(empty).toMatchObject({ ok: false, error: { code: 'sample-empty' } });
  });
});

describe('公開サンプル（public/samples/DrumMap.qbd）', () => {
  it('正本 DrumMap.qbd とバイト単位で一致し、139 Kit を読み込める', () => {
    const copy = readFileSync(PUBLIC_SAMPLE);
    expect(sha(copy)).toBe(SOURCE_SHA256);
    const s = new EditorStore();
    expect(s.load(copy.toString('utf8'), 'DrumMap.qbd', { sample: true }).ok).toBe(true);
    const st = s.getSnapshot();
    expect(st.map.Plugins.reduce((n, p) => n + p.Kits.length, 0)).toBe(139);
    expect(st.dirty).toBe(false);
    expect(st.sample).toBe(true);
  });
});

describe('EditorStore: サンプル表示フラグ', () => {
  it('開いた直後は Dirty でなく、新規・通常の読込でフラグは外れる', () => {
    const s = new EditorStore();
    s.load(gmSmall, 'DrumMap.qbd', { sample: true });
    expect(s.getSnapshot()).toMatchObject({ sample: true, dirty: false, fileName: 'DrumMap.qbd' });
    s.load(gmSmall, 'a.qbd');
    expect(s.getSnapshot().sample).toBe(false);
    s.load(gmSmall, 'DrumMap.qbd', { sample: true });
    s.createNew();
    expect(s.getSnapshot().sample).toBe(false);
  });
  it('編集で Dirty になり、解析に失敗した読込はフラグも内容も変えない', () => {
    const s = new EditorStore();
    s.load(gmSmall, 'DrumMap.qbd', { sample: true });
    s.apply('改名', (m) => { const c = cloneMap(m); c.Plugins[0]!.Name = 'X'; return { ok: true as const, value: c }; });
    expect(s.getSnapshot().dirty).toBe(true);
    expect(s.load('{ broken', 'DrumMap.qbd', { sample: false }).ok).toBe(false);
    expect(s.getSnapshot()).toMatchObject({ sample: true, dirty: true });
  });
});

describe('永続スキーマの後方互換', () => {
  it('sample を持たない旧レコードは sample=false として読める。不正な型は拒否', () => {
    const s = new EditorStore();
    s.load(gmSmall, 'a.qbd');
    const st = s.getSnapshot();
    const base = {
      schemaVersion: SESSION_SCHEMA_VERSION, savedAt: '', seq: 1, fileName: 'a.qbd', map: st.map, baselineMap: null,
      ui: { pageId: 'mapEditor', tabId: 'parts' }, selection: st.selection,
    };
    const old = parseSnapshot(base);
    expect(old.ok && old.snapshot.sample).toBe(false);
    const withSample = parseSnapshot({ ...base, sample: true });
    expect(withSample.ok && withSample.snapshot.sample).toBe(true);
    expect(parseSnapshot({ ...base, sample: 'yes' }).ok).toBe(false);
  });
});
