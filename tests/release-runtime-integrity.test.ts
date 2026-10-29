import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Node-only release script has no TypeScript declaration
import { createRuntimeIntegrityCapture, verifyReleaseAssetBytes } from '../scripts/check-release-bu.mjs';
const path = '/assets/index-current.js';
const response = (status: number, text = 'actual runtime bytes') => ({ status: () => status, body: vi.fn(async () => Buffer.from(text)) });

describe('actual runtime response integrity capture', () => {
  it('starts body capture immediately on the first 200 and retains its bytes across 304 and redirects', async () => {
    const capture = createRuntimeIntegrityCapture(), first = response(200), cached = response(304), redirect = response(302), duplicate = response(200, 'must not replace');
    capture.observe(path, first); expect(first.body).toHaveBeenCalledTimes(1);
    capture.observe(path, cached); capture.observe(path, redirect); capture.observe(path, duplicate);
    const saved = await capture.read(path);
    expect(saved.status).toBe(200); expect(saved.bytes.toString()).toBe('actual runtime bytes');
    expect(cached.body).not.toHaveBeenCalled(); expect(redirect.body).not.toHaveBeenCalled(); expect(duplicate.body).not.toHaveBeenCalled();
    expect(capture.diagnostics.map((item: { status: number }) => item.status)).toEqual([200, 304, 302, 200]);
    expect(capture.diagnostics.filter((item: { captured: boolean }) => item.captured)).toHaveLength(1);
  });
  it('waits for actual 200 bytes if 304 or redirects arrive first', async () => {
    const capture = createRuntimeIntegrityCapture(), redirect = response(301), cached = response(304), loaded = response(200);
    capture.observe(path, redirect); capture.observe(path, cached);
    expect(capture.paths()).toEqual([path]); expect(capture.has(path)).toBe(false);
    await expect(capture.read(path)).rejects.toThrow('No actual runtime 200 response');
    capture.observe(path, loaded); expect((await capture.read(path)).bytes.toString()).toBe('actual runtime bytes');
    expect(redirect.body).not.toHaveBeenCalled(); expect(cached.body).not.toHaveBeenCalled();
  });
  it('does not drop a pending body promise when reload responses arrive', async () => {
    let finish!: (value: Buffer) => void;
    const capture = createRuntimeIntegrityCapture(), body = vi.fn(() => new Promise<Buffer>(resolve => { finish = resolve; }));
    capture.observe(path, { status: () => 200, body }); capture.observe(path, response(304));
    finish(Buffer.from('completed original download'));
    expect((await capture.read(path)).bytes.toString()).toBe('completed original download');
  });
  it('reports failed first-200 bodies and never substitutes a later download', async () => {
    const capture = createRuntimeIntegrityCapture(), later = response(200, 'different download');
    capture.observe(path, { status: () => 200, body: () => Promise.reject(new Error('response body unavailable')) });
    capture.observe(path, later);
    await expect(capture.read(path)).rejects.toThrow('Runtime response body unavailable');
    expect(later.body).not.toHaveBeenCalled(); expect(capture.diagnostics[0].bodyError).toBe('response body unavailable');
  });
  it('records synchronous body failures and rejects non-200-only resources', async () => {
    const capture = createRuntimeIntegrityCapture();
    capture.observe(path, { status: () => 200, body: () => { throw Error('synchronous failure'); } });
    await expect(capture.read(path)).rejects.toThrow('synchronous failure');
    capture.observe('/assets/failed.css', response(404));
    await expect(capture.read('/assets/failed.css')).rejects.toThrow('No actual runtime 200 response');
  });
  it('captures mobile base/JSON only for phones and ignores unrelated large models', async () => {
    const mobile = createRuntimeIntegrityCapture(true), desktop = createRuntimeIntegrityCapture();
    for (const name of ['/assets/mit-residences/boston-without-residences.glb', '/data/mobile/boston.json']) {
      const loaded = response(200); mobile.observe(name, loaded); desktop.observe(name, loaded);
      expect(mobile.has(name)).toBe(true); expect(desktop.has(name)).toBe(false); expect(loaded.body).toHaveBeenCalledTimes(1);
    }
    for (const name of ['/data/mobile/boston.glb', '/assets/bu-cds/cds-full.glb', '/assets/mit-stata/stata-full.glb', '/data/killian/detail.glb.gz', '/assets/environment/sky.png']) {
      const loaded = response(200); mobile.observe(name, loaded); desktop.observe(name, loaded); expect(loaded.body).not.toHaveBeenCalled();
    }
    const css = response(200); desktop.observe('/assets/style.css', css); expect(css.body).toHaveBeenCalledTimes(1);
  });
  it('checks retained actual bytes strictly and cannot conceal a mismatched first download', async () => {
    const capture = createRuntimeIntegrityCapture();
    capture.observe(path, response(200, 'old runtime')); capture.observe(path, response(304)); capture.observe(path, response(200, 'expected runtime'));
    const actual = await capture.read(path);
    expect(() => verifyReleaseAssetBytes(path, actual.bytes, Buffer.from('expected runtime'))).toThrow('Exact release bytes mismatch');
    expect(verifyReleaseAssetBytes(path, actual.bytes, Buffer.from('old runtime')).removedBytes).toBe(0);
  });
});
