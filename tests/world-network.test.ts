import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldService } from '../server/world-server.mjs';
import type { WorldEvent, WorldSnapshot } from '../src/features/world/world-network-types';
import { readWorldVisitorProfile } from '../src/features/world/world-network';
import type { PlayableCharacterId } from '../src/features/world/character-catalog';

type Session = WorldSnapshot & { token: string };
let service: ReturnType<typeof createWorldService>;
let server: Server;
let base: string;
let storageDirectory: string;
const aborts: AbortController[] = [];

async function start() {
  service = createWorldService({ storagePath: join(storageDirectory, 'world.json') });
  server = createServer(service.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local HTTP server');
  base = `http://127.0.0.1:${address.port}`;
}

async function stop() {
  for (const abort of aborts.splice(0)) abort.abort();
  await service.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function post(path: string, body: unknown, session?: Session, origin?: string) {
  const response = await fetch(`${base}/api/world/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function guest(nickname: string, token?: string, characterId?: PlayableCharacterId): Promise<Session> {
  const result = await post('session', { nickname, color: '#68a998', characterId, token });
  expect(result.status).toBe(200);
  return result.data;
}

async function events(session: Session) {
  const abort = new AbortController();
  aborts.push(abort);
  const response = await fetch(`${base}/api/world/events`, { headers: { Authorization: `Bearer ${session.token}` }, signal: abort.signal });
  expect(response.status).toBe(200);
  const received: WorldEvent[] = [];
  void (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of frame.split('\n')) if (line.startsWith('data: ')) received.push(JSON.parse(line.slice(6)));
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
    finally { reader.releaseLock(); }
  })();
  return {
    received,
    async wait(predicate: (event: WorldEvent) => boolean) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const event = received.find(predicate);
        if (event) return event;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for event. Received: ${JSON.stringify(received)}`);
    },
  };
}

beforeEach(async () => {
  storageDirectory = await mkdtemp(join(tmpdir(), 'pulsetact-world-test-'));
  await start();
});

afterEach(async () => {
  await stop();
  if (!storageDirectory.startsWith(join(tmpdir(), 'pulsetact-world-test-'))) throw new Error('Unexpected test storage path');
  await rm(storageDirectory, { recursive: true, force: true });
});

describe('real shared MIT room', () => {
  it('connects two independent visitors, shares movement and text, and removes departures without exposing credentials', async () => {
    const alice = await guest('Alice', undefined, 'pixiv');
    const aliceEvents = await events(alice);
    const bob = await guest('Bob', undefined, 'sakurada');
    const bobEvents = await events(bob);
    expect(alice.selfId).not.toBe(bob.selfId);
    await aliceEvents.wait((event) => event.type === 'players' && event.data.length === 2 && event.data.some((player) => player.id === bob.selfId && player.characterId === 'sakurada'));
    await bobEvents.wait((event) => event.type === 'snapshot' && event.data.players.length === 2 && event.data.players.some((player) => player.id === alice.selfId && player.characterId === 'pixiv'));
    expect((await post('move', { position: [12.5, -2], yaw: 1.2 }, alice)).status).toBe(200);
    await bobEvents.wait((event) => event.type === 'players' && event.data.some((player) => player.id === alice.selfId && player.position[0] === 12.5));
    expect((await post('chat', { text: 'Meet near the dome <script>literal text</script>' }, bob)).status).toBe(200);
    await aliceEvents.wait((event) => event.type === 'chat' && event.data.playerId === bob.selfId && event.data.text.includes('<script>'));
    const payloads = JSON.stringify([...aliceEvents.received, ...bobEvents.received]);
    expect(payloads).not.toContain(alice.token);
    expect(payloads).not.toContain('tokenHash');
    await post('leave', {}, bob);
    await aliceEvents.wait((event) => event.type === 'players' && event.data.length === 1);
    expect((await guest('Bob', bob.token)).selfId).toBe(bob.selfId);
  });

  it('shares authoritative optics progress and persists both participants’ completion and accepted friendship across restart', async () => {
    const alice = await guest('Alice');
    const bob = await guest('Bob', undefined, 'sakurada');
    const aliceEvents = await events(alice);
    const bobEvents = await events(bob);
    expect((await post('lesson', { patch: { mirrorA: -45 } }, alice)).status).toBe(409);
    await post('lesson-join', {}, alice);
    await post('lesson-join', {}, bob);
    await aliceEvents.wait((event) => event.type === 'lesson-participants' && event.data.length === 2);
    await post('lesson', { patch: { stage: 3 } }, alice);
    expect((await guest('Alice', alice.token)).lesson.stage).toBe(0);
    await post('lesson', { patch: { mirrorA: -45 } }, alice);
    await bobEvents.wait((event) => event.type === 'lesson' && event.data.mirrorA === -45);
    await post('lesson', { patch: { stage: 1 } }, bob);
    await post('lesson', { patch: { prediction: 'equal', stage: 2 } }, bob);
    await post('lesson', { patch: { mirrorA: -45 } }, alice);
    await post('lesson', { patch: { mirrorB: -45, stage: 3 } }, bob);
    await aliceEvents.wait((event) => event.type === 'friends' && event.data.completedLessons.includes('mit-optics-01'));
    await bobEvents.wait((event) => event.type === 'lesson' && event.data.stage === 3);
    await post('friend-request', { targetId: bob.selfId }, alice);
    await bobEvents.wait((event) => event.type === 'friends' && event.data.friendRequests.some((request) => request.id === alice.selfId && request.direction === 'incoming'));
    await post('friend-response', { targetId: alice.selfId, accept: true }, bob);
    await aliceEvents.wait((event) => event.type === 'friends' && event.data.friends.some((friend) => friend.id === bob.selfId));
    await post('report', { targetId: bob.selfId, reason: 'Integration test moderation report' }, alice);
    await stop();
    await start();
    const restoredAlice = await guest('Alice', alice.token);
    const restoredBob = await guest('Bob', bob.token);
    expect(restoredAlice.selfId).toBe(alice.selfId);
    expect(restoredAlice.friends.map((friend) => friend.id)).toContain(bob.selfId);
    expect(restoredBob.completedLessons).toContain('mit-optics-01');
    expect(restoredBob.players.find((player) => player.id === bob.selfId)?.characterId).toBe('sakurada');
    expect(restoredAlice.completedLessons).toContain('mit-optics-01');
    expect(JSON.stringify(restoredAlice)).not.toContain('Integration test moderation report');
    const disk = JSON.parse(await readFile(join(storageDirectory, 'world.json'), 'utf8'));
    expect(disk.reports).toHaveLength(1);
    expect(disk.profiles.find((profile: { id: string }) => profile.id === bob.selfId).characterId).toBe('sakurada');
    expect(JSON.stringify(disk)).not.toContain(alice.token);
  });

  it('validates character choices and shares changes without losing the visitor’s pose or workshop presence', async () => {
    const alice = await guest('Alice');
    const bob = await guest('Bob', undefined, 'sakurada');
    const bobEvents = await events(bob);
    expect(alice.players.find((player) => player.id === alice.selfId)?.characterId).toBe('pixiv');
    await post('move', { position: [12.5, -2], yaw: 1.2 }, alice);
    await post('lesson-join', {}, alice);
    for (const characterId of ['hiyori', 'unknown', '', null, 123, { id: 'sakurada' }]) {
      expect((await post('session', { nickname: 'Alice', color: '#68a998', token: alice.token, characterId })).status).toBe(400);
    }
    const unchanged = await guest('Alice', alice.token);
    expect(unchanged.players.find((player) => player.id === alice.selfId)?.characterId).toBe('pixiv');
    const changed = await guest('Alice', alice.token, 'sakurada');
    expect(changed.selfId).toBe(alice.selfId);
    const changedPlayer = changed.players.find((player) => player.id === alice.selfId);
    expect(changedPlayer).toMatchObject({ characterId: 'sakurada', position: [12.5, -2] });
    expect(changedPlayer?.yaw).toBeCloseTo(1.2);
    await bobEvents.wait((event) => event.type === 'players' && event.data.some((player) => player.id === alice.selfId && player.characterId === 'sakurada'));
    await bobEvents.wait((event) => event.type === 'lesson-participants' && event.data.some((player) => player.id === alice.selfId && player.characterId === 'sakurada'));
    // Older callers omit the new field; omission must retain the accepted selection.
    const reconnected = await guest('Alice', alice.token);
    expect(reconnected.players.find((player) => player.id === alice.selfId)?.characterId).toBe('sakurada');
  });

  it('restores legacy profiles without a character field as the default character', async () => {
    const legacyVisitor = await guest('Legacy');
    await stop();
    const storagePath = join(storageDirectory, 'world.json');
    const saved = JSON.parse(await readFile(storagePath, 'utf8'));
    delete saved.profiles[0].characterId;
    await writeFile(storagePath, JSON.stringify(saved));
    await start();
    const restored = await guest('Legacy', legacyVisitor.token);
    expect(restored.selfId).toBe(legacyVisitor.selfId);
    expect(restored.players.find((player) => player.id === legacyVisitor.selfId)?.characterId).toBe('pixiv');
  });

  it('enforces origin, credentials, message size, finite positions, and rate limits', async () => {
    expect((await post('session', { nickname: 'X', color: '#68a998' }, undefined, 'https://unrelated.example')).status).toBe(403);
    expect((await post('session', { nickname: 'x'.repeat(25), color: '#68a998' })).status).toBe(400);
    const alice = await guest('Alice');
    expect((await post('chat', { text: 'hello' })).status).toBe(401);
    expect((await post('chat', { text: 'x'.repeat(241) }, alice)).status).toBe(400);
    expect((await post('move', { position: [null, 0], yaw: 0 }, alice)).status).toBe(400);
    expect((await post('move', { position: [501, 0], yaw: 0 }, alice)).status).toBe(400);
    expect((await post('lesson-join', {}, alice)).status).toBe(200);
    expect((await post('lesson', { patch: { mirrorA: 1000 } }, alice)).status).toBe(400);
    expect((await post('chat', { text: 'x'.repeat(9000) }, alice)).status).toBe(413);
    for (let index = 0; index < 5; index += 1) expect((await post('chat', { text: `hello ${index}` }, alice)).status).toBe(200);
    expect((await post('chat', { text: 'too fast' }, alice)).status).toBe(429);
  });

  it('caps the shared room at 16 visitors and the cooperative lesson at four participants', async () => {
    const people: Session[] = [];
    for (let index = 0; index < 16; index += 1) people.push(await guest(`Guest ${index}`));
    expect((await post('session', { nickname: 'Overflow', color: '#68a998' })).status).toBe(409);
    for (const person of people.slice(0, 4)) expect((await post('lesson-join', {}, person)).status).toBe(200);
    expect((await post('lesson-join', {}, people[4])).status).toBe(409);
    expect((await post('lesson-leave', {}, people[0])).status).toBe(200);
    expect((await post('lesson-join', {}, people[4])).status).toBe(200);
    await post('leave', {}, people[1]);
    expect((await post('session', { nickname: 'Replacement', color: '#68a998' })).status).toBe(200);
  });

  it('does not award a late joiner an already finished lesson and allows a fresh attempt', async () => {
    const alice = await guest('Alice');
    const bob = await guest('Bob');
    await post('lesson-join', {}, alice);
    await post('lesson', { patch: { mirrorA: -45, stage: 1 } }, alice);
    await post('lesson', { patch: { prediction: 'equal', stage: 2 } }, alice);
    await post('lesson', { patch: { mirrorA: -45, mirrorB: -45, stage: 3 } }, alice);
    await post('lesson-join', {}, bob);
    let returningBob = await guest('Bob', bob.token);
    expect(returningBob.lesson.stage).toBe(3);
    expect(returningBob.completedLessons).toEqual([]);
    await post('lesson', { patch: { mirrorA: -45 } }, bob);
    expect((await guest('Bob', bob.token)).completedLessons).toEqual([]);
    await post('lesson', { patch: { stage: 0 } }, bob);
    await post('lesson', { patch: { mirrorA: -45, stage: 1 } }, bob);
    await post('lesson', { patch: { prediction: 'equal', stage: 2 } }, bob);
    await post('lesson', { patch: { mirrorA: -45, mirrorB: -45, stage: 3 } }, bob);
    returningBob = await guest('Bob', bob.token);
    expect(returningBob.completedLessons).toContain('mit-optics-01');
  });

  it('uses distinct atomic save files when middleware shutdowns overlap', async () => {
    const failures = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const overlappingServices = Array.from({ length: 8 }, () => createWorldService({ storagePath: join(storageDirectory, 'overlap.json') }));
      await Promise.all(overlappingServices.map((instance) => instance.close()));
      expect(failures).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(join(storageDirectory, 'overlap.json'), 'utf8')).version).toBe(1);
      expect((await readdir(storageDirectory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally { failures.mockRestore(); }
  });

  it('restores display profiles for the tab’s token instead of another tab’s most recent visitor', () => {
    const tabStorage = new Map<string, string>();
    const sharedStorage = new Map<string, string>();
    const alice = { token: 'a'.repeat(43), nickname: 'Alice', color: '#778a64', characterId: 'pixiv' };
    const bob = { token: 'b'.repeat(43), nickname: 'Bob', color: '#698b9e', characterId: 'sakurada' };
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => tabStorage.get(key) ?? null });
    vi.stubGlobal('localStorage', { getItem: (key: string) => sharedStorage.get(key) ?? null });
    try {
      tabStorage.set('pulsetact.world.visitor.v1', alice.token);
      tabStorage.set('pulsetact.world.visitor-profile.v1', JSON.stringify(alice));
      sharedStorage.set('pulsetact.world.returning-profile.v1', JSON.stringify(bob));
      expect(readWorldVisitorProfile()).toEqual({ nickname: 'Alice', color: '#778a64', characterId: 'pixiv' });
      tabStorage.delete('pulsetact.world.visitor-profile.v1');
      expect(readWorldVisitorProfile()).toBeNull();
      tabStorage.clear();
      expect(readWorldVisitorProfile()).toEqual({ nickname: 'Bob', color: '#698b9e', characterId: 'sakurada' });
    } finally { vi.unstubAllGlobals(); }
  });

  it('normalizes old or unavailable cached character choices while restoring the paired visitor', () => {
    let stored: string | null = null;
    vi.stubGlobal('sessionStorage', { getItem: () => null });
    vi.stubGlobal('localStorage', { getItem: () => stored });
    try {
      for (const characterId of [undefined, 'hiyori', 'unknown', null]) {
        stored = JSON.stringify({ token: 'a'.repeat(43), nickname: 'Returning', color: '#778a64', characterId });
        expect(readWorldVisitorProfile()).toEqual({ nickname: 'Returning', color: '#778a64', characterId: 'pixiv' });
      }
    } finally { vi.unstubAllGlobals(); }
  });
});
