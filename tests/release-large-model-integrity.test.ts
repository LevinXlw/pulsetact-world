import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Node-only release script has no TypeScript declaration
import { createRuntimeIntegrityCapture, installLargeModelIntegrityCapture, MOBILE_RUNTIME_BASE_PATH } from '../scripts/check-release-bu.mjs';
const origin = 'https://world.pulsetact.ai';
class Session extends EventEmitter {
  send = vi.fn(async (_method: string, _params: unknown): Promise<any> => ({}));
}
const receive = (session: Session, requestId: string, status = 200, url = origin + MOBILE_RUNTIME_BASE_PATH) => session.emit('Network.responseReceived', { requestId, response: { status, url } });
async function fixture(body = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0, 255, 17])) {
  const session = new Session(), capture = createRuntimeIntegrityCapture(true);
  session.send.mockImplementation(async method => method === 'Network.getResponseBody' ? { body: body.toString('base64'), base64Encoded: true } : {});
  const installed = await installLargeModelIntegrityCapture(session, origin, capture);
  return { session, capture, installed, body };
}

describe('large actual model response retention', () => {
  it('sets explicit inspector buffers before navigation and fetches body only after loadingFinished on the same session', async () => {
    const { session, capture, installed, body } = await fixture();
    expect(session.send.mock.calls).toEqual([['Network.enable', { maxTotalBufferSize: 268435456, maxResourceBufferSize: 67108864 }]]);
    receive(session, 'first');
    expect(capture.has(MOBILE_RUNTIME_BASE_PATH)).toBe(true); expect(session.send).toHaveBeenCalledTimes(1);
    session.emit('Network.loadingFinished', { requestId: 'first' });
    expect(session.send.mock.calls[1]).toEqual(['Network.getResponseBody', { requestId: 'first' }]);
    const result = await capture.read(MOBILE_RUNTIME_BASE_PATH);
    expect(result.status).toBe(200); expect(result.bytes.equals(body)).toBe(true);
    expect(capture.diagnostics[0]).toMatchObject({ source: 'cdp', requestId: 'first', captured: true, bytes: body.length });
    installed.dispose();
  });
  it('never overwrites the first runtime 200 with cached, redirected or later successful responses', async () => {
    const { session, capture, installed, body } = await fixture();
    receive(session, 'redirect', 302); receive(session, 'first'); receive(session, 'cache', 304); receive(session, 'later');
    for (const requestId of ['redirect', 'cache', 'later', 'first', 'first']) session.emit('Network.loadingFinished', { requestId });
    expect((await capture.read(MOBILE_RUNTIME_BASE_PATH)).bytes.equals(body)).toBe(true);
    expect(session.send.mock.calls.filter(([method]) => method === 'Network.getResponseBody')).toEqual([['Network.getResponseBody', { requestId: 'first' }]]);
    installed.dispose();
  });
  it('rejects loadingFailed without a getResponseBody request or substitute download', async () => {
    const { session, capture, installed } = await fixture();
    receive(session, 'failed'); session.emit('Network.loadingFailed', { requestId: 'failed', errorText: 'net::ERR_CONNECTION_RESET' });
    receive(session, 'later'); session.emit('Network.loadingFinished', { requestId: 'later' });
    await expect(capture.read(MOBILE_RUNTIME_BASE_PATH)).rejects.toThrow('net::ERR_CONNECTION_RESET');
    expect(session.send).toHaveBeenCalledTimes(1); installed.dispose();
  });
  it('surfaces inspector retrieval failure without changing the first-download identity', async () => {
    const { session, capture, installed } = await fixture();
    session.send.mockRejectedValueOnce(Error('inspector cache failure'));
    receive(session, 'first'); session.emit('Network.loadingFinished', { requestId: 'first' });
    await expect(capture.read(MOBILE_RUNTIME_BASE_PATH)).rejects.toThrow('inspector cache failure');
    expect(capture.diagnostics[0].requestId).toBe('first'); installed.dispose();
  });
  it('rejects unfinished body promises on page/context cleanup and detaches all event listeners', async () => {
    const { session, capture, installed } = await fixture();
    receive(session, 'pending'); installed.dispose('Page closed before runtime download completed'); installed.dispose();
    await expect(capture.read(MOBILE_RUNTIME_BASE_PATH)).rejects.toThrow('Page closed');
    for (const event of ['Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed']) expect(session.listenerCount(event)).toBe(0);
    session.emit('Network.loadingFinished', { requestId: 'pending' }); expect(session.send).toHaveBeenCalledTimes(1);
  });
  it('rejects in-flight retrieval on cleanup even if the inspector later resolves', async () => {
    const { session, capture, installed } = await fixture(); let finish!: (value: any) => void;
    session.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    receive(session, 'inflight'); session.emit('Network.loadingFinished', { requestId: 'inflight' }); installed.dispose('Context closed');
    finish({ body: 'late response', base64Encoded: false });
    await expect(capture.read(MOBILE_RUNTIME_BASE_PATH)).rejects.toThrow('Context closed');
  });
  it('ignores other origins/models and handles protocol text bodies without a base64 assumption', async () => {
    const { session, capture, installed } = await fixture();
    receive(session, 'cross-origin', 200, 'https://other.example' + MOBILE_RUNTIME_BASE_PATH);
    receive(session, 'unrelated', 200, origin + '/assets/mit-stata/stata-full.glb');
    expect(capture.paths()).toEqual([]);
    session.send.mockResolvedValueOnce({ body: 'glTF text response', base64Encoded: false });
    receive(session, 'plain'); session.emit('Network.loadingFinished', { requestId: 'plain' });
    expect((await capture.read(MOBILE_RUNTIME_BASE_PATH)).bytes.toString()).toBe('glTF text response'); installed.dispose();
  });
  it('cleans listeners if enabling the inspector buffer fails', async () => {
    const session = new Session(); session.send.mockRejectedValueOnce(Error('unsupported setting'));
    await expect(installLargeModelIntegrityCapture(session, origin, createRuntimeIntegrityCapture(true))).rejects.toThrow('unsupported setting');
    expect(session.eventNames()).toEqual([]);
  });
});
