import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { initialOpticsState, opticsReducer } from '../src/features/world/optics-model.mjs';

const CAPACITY = 16;
const PREFIX = '/api/world/';
const CHARACTER_IDS = new Set(['pixiv', 'sakurada']);
const characterOrDefault = (value) => CHARACTER_IDS.has(value) ? value : 'pixiv';
// Survives Vite's configuration-module reloads within one process.
const fileWrites = globalThis[Symbol.for('pulsetact.world.file-writes')] ??= new Map();
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const cleanText = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const fail = (status, message) => Object.assign(new Error(message), { status });

/** Single-process MIT room. Anonymous credentials are private and never included in room events. */
export function createWorldService({ storagePath = '.world-data/world.json' } = {}) {
  const file = storagePath === null ? null : resolve(storagePath);
  const profiles = new Map();
  const credentials = new Map();
  const players = new Map();
  const clients = new Map();
  const messages = [];
  const limits = new Map();
  const lessonParticipants = new Set();
  let reports = [];
  let lesson = { ...initialOpticsState };
  let saveTimer;
  let saveQueue = Promise.resolve();
  let closed = false;
  let closePromise = null;
  let movementChanged = false;

  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.profiles)) throw new Error('Unsupported world storage format');
      reports = Array.isArray(saved.reports) ? saved.reports.slice(-1000) : [];
      for (const profile of saved.profiles) {
        if (!profile.id || !/^[a-f0-9]{64}$/.test(profile.tokenHash)) continue;
        profile.friends = Array.isArray(profile.friends) ? profile.friends : [];
        profile.requests = Array.isArray(profile.requests) ? profile.requests : [];
        profile.completedLessons = Array.isArray(profile.completedLessons) ? profile.completedLessons : [];
        profile.characterId = characterOrDefault(profile.characterId);
        profiles.set(profile.id, profile);
        credentials.set(profile.tokenHash, profile.id);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  function persist() {
    if (!file) return Promise.resolve();
    const payload = JSON.stringify({ version: 1, profiles: [...profiles.values()], reports });
    saveQueue = (fileWrites.get(file) ?? saveQueue).catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true });
      // Vite can overlap old and new middleware instances during restart. Never share a temp path.
      const temporaryFile = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporaryFile, payload, { mode: 0o600 });
      for (let attempt = 0; ; attempt += 1) {
        try { await rename(temporaryFile, file); break; }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
        }
      }
    });
    fileWrites.set(file, saveQueue);
    const currentSave = saveQueue;
    const settled = () => { if (fileWrites.get(file) === currentSave) fileWrites.delete(file); };
    saveQueue.then(settled, settled);
    return saveQueue;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist().catch((error) => console.error('World profile save failed:', error.message)), 100);
    saveTimer.unref?.();
  }

  function limited(key, count, windowMs) {
    const now = Date.now();
    let entry = limits.get(key);
    if (!entry || entry.until <= now) {
      entry = { count: 0, until: now + windowMs };
      limits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > count) throw fail(429, '操作太快了，请稍等几秒再试。');
  }

  function publicPlayers() {
    return [...players.values()].map(({ lastSeen, ...player }) => player);
  }

  function friendData(profile) {
    const describe = (id) => {
      const person = profiles.get(id);
      return person && { id, nickname: person.nickname, color: person.color };
    };
    return {
      friends: profile.friends.map(describe).filter(Boolean).map((person) => ({ ...person, online: players.has(person.id) })),
      friendRequests: [
        ...profile.requests.map(describe).filter(Boolean).map((person) => ({ ...person, direction: 'incoming' })),
        ...[...profiles.values()].filter((person) => person.requests.includes(profile.id)).map((person) => ({ ...describe(person.id), direction: 'outgoing' })),
      ],
      completedLessons: profile.completedLessons,
    };
  }

  function snapshot(id) {
    return { selfId: id, players: publicPlayers(), messages, lesson, lessonParticipants: activeLessonPlayers(), ...friendData(profiles.get(id)) };
  }

  function activeLessonPlayers() {
    return publicPlayers().filter((player) => lessonParticipants.has(player.id));
  }

  function send(response, type, data) {
    if (response.destroyed || response.writableEnded) return;
    if (response.writableLength > 256 * 1024) return response.destroy();
    response.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }

  function broadcast(type, data) {
    for (const responses of clients.values()) for (const response of responses) send(response, type, data);
  }

  function sendFriends(id) {
    const profile = profiles.get(id);
    if (!profile) return;
    for (const response of clients.get(id) ?? []) send(response, 'friends', friendData(profile));
  }

  function changedPresence() {
    broadcast('players', publicPlayers());
    for (const id of clients.keys()) sendFriends(id);
  }

  function leave(id) {
    if (!players.delete(id)) return;
    if (lessonParticipants.delete(id)) broadcast('lesson-participants', activeLessonPlayers());
    for (const response of clients.get(id) ?? []) response.end();
    clients.delete(id);
    changedPresence();
  }

  function profileFor(request) {
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
    const id = token && credentials.get(tokenHash(token));
    const profile = profiles.get(id);
    if (!profile) throw fail(401, '访客身份已失效，请重新进入校园。');
    return profile;
  }

  async function bodyFor(request) {
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw fail(415, '请使用 JSON 请求。');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 8192) throw fail(413, '请求内容过长。');
      chunks.push(chunk);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch {
      throw fail(400, '请求格式不正确。');
    }
  }

  function json(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  }

  async function handle(request, response, next) {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith(PREFIX)) {
      if (next) return next();
      return json(response, 404, { error: 'Not found' });
    }
    if (closed) throw fail(503, '校园服务正在重启，请稍后重连。');
    const origin = request.headers.origin;
    if (origin) {
      let originUrl;
      try { originUrl = new URL(origin); } catch { throw fail(403, '请求来源无效。'); }
      if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.host !== request.headers.host) throw fail(403, '请从当前校园页面连接。');
    }
    const action = path.slice(PREFIX.length);
    if (action === 'health' && request.method === 'GET') return json(response, 200, { ok: true, capacity: CAPACITY, online: players.size });
    if (action === 'events' && request.method === 'GET') {
      const profile = profileFor(request);
      if (!players.has(profile.id)) throw fail(409, '请先进入校园。');
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      response.flushHeaders?.();
      let responses = clients.get(profile.id);
      if (!responses) clients.set(profile.id, responses = new Set());
      // One active stream per anonymous tab credential prevents stale reconnects accumulating.
      for (const previous of responses) previous.end();
      responses.add(response);
      players.get(profile.id).lastSeen = Date.now();
      send(response, 'snapshot', snapshot(profile.id));
      response.on('close', () => {
        responses.delete(response);
        if (!responses.size) {
          clients.delete(profile.id);
          const player = players.get(profile.id);
          if (player) player.lastSeen = Date.now();
        }
      });
      return;
    }
    if (request.method !== 'POST') throw fail(405, '不支持的请求方式。');
    const body = await bodyFor(request);
    if (closed) throw fail(503, '校园服务正在重启，请稍后重连。');
    if (action === 'session') {
      limited(`session:${request.socket.remoteAddress}`, 40, 60_000);
      const nickname = cleanText(body.nickname);
      const color = body.color;
      if (!nickname || nickname.length > 24) throw fail(400, '名字请填写 1–24 个字符。');
      if (typeof color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(color)) throw fail(400, '请选择有效的角色颜色。');
      if ('characterId' in body && !CHARACTER_IDS.has(body.characterId)) throw fail(400, '请选择已开放的角色。');
      let token = typeof body.token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(body.token) ? body.token : null;
      let profile = token && profiles.get(credentials.get(tokenHash(token)));
      const characterId = body.characterId ?? characterOrDefault(profile?.characterId);
      if ((!profile || !players.has(profile.id)) && players.size >= CAPACITY) throw fail(409, '校园现在已有 16 位访客，请稍后再来。');
      if (!profile) {
        if (profiles.size >= 10_000) throw fail(503, '访客空间已满，请联系房间管理员。');
        token = randomBytes(32).toString('base64url');
        profile = { id: randomUUID(), tokenHash: tokenHash(token), nickname, color, characterId, friends: [], requests: [], completedLessons: [] };
        profiles.set(profile.id, profile);
        credentials.set(profile.tokenHash, profile.id);
      }
      profile.nickname = nickname;
      profile.color = color;
      profile.characterId = characterId;
      const previous = players.get(profile.id);
      // Keep the initial pose aligned with world-locations.ts; the scene immediately publishes its surveyed pose.
      players.set(profile.id, { id: profile.id, nickname, color, characterId, position: previous?.position ?? [53.5, 52.5], yaw: previous?.yaw ?? 3.5778343653752236, lastSeen: Date.now() });
      scheduleSave();
      changedPresence();
      if (lessonParticipants.has(profile.id)) broadcast('lesson-participants', activeLessonPlayers());
      return json(response, 200, { token, ...snapshot(profile.id) });
    }
    const profile = profileFor(request);
    const player = players.get(profile.id);
    if (action === 'leave') {
      leave(profile.id);
      return json(response, 200, { ok: true });
    }
    if (!player) throw fail(409, '你已离开校园，请重新连接。');
    player.lastSeen = Date.now();
    if (action === 'heartbeat') return json(response, 200, { ok: true });
    if (action === 'move') {
      limited(`move:${profile.id}`, 30, 1000);
      const { position, yaw } = body;
      if (!Array.isArray(position) || position.length !== 2 || position.some((value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 500) || typeof yaw !== 'number' || !Number.isFinite(yaw)) throw fail(400, '位置无效。');
      player.position = position;
      player.yaw = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      movementChanged = true;
      return json(response, 200, { ok: true });
    }
    if (action === 'chat') {
      limited(`chat:${profile.id}`, 6, 10_000);
      const text = cleanText(body.text);
      if (!text || text.length > 240) throw fail(400, '消息请填写 1–240 个字符。');
      const message = { id: randomUUID(), playerId: profile.id, nickname: profile.nickname, text, sentAt: Date.now() };
      messages.push(message);
      if (messages.length > 80) messages.shift();
      broadcast('chat', message);
      return json(response, 200, { ok: true });
    }
    if (action === 'lesson') limited(`lesson:${profile.id}`, 30, 1000);
    else limited(`action:${profile.id}`, 40, 10_000);
    if (action === 'report') {
      limited(`report:${profile.id}`, 2, 60_000);
      const target = profiles.get(body.targetId);
      const reason = cleanText(body.reason);
      if (!target || target.id === profile.id || !reason || reason.length > 500) throw fail(400, '请选择另一位访客，并填写 1–500 字的举报说明。');
      reports.push({ id: randomUUID(), reporterId: profile.id, targetId: target.id, reason, createdAt: Date.now() });
      if (reports.length > 1000) reports.shift();
      scheduleSave();
      return json(response, 200, { ok: true });
    }
    if (action === 'lesson-join') {
      if (!lessonParticipants.has(profile.id) && lessonParticipants.size >= 4) throw fail(409, '这间工坊已有 4 位同学，稍后再来参加吧。');
      lessonParticipants.add(profile.id);
      broadcast('lesson-participants', activeLessonPlayers());
      return json(response, 200, { ok: true });
    }
    if (action === 'lesson-leave') {
      lessonParticipants.delete(profile.id);
      broadcast('lesson-participants', activeLessonPlayers());
      return json(response, 200, { ok: true });
    }
    if (action === 'friend-request' || action === 'friend-response') {
      const target = profiles.get(body.targetId);
      if (!target || target.id === profile.id) throw fail(400, '请选择另一位访客。');
      if (action === 'friend-request') {
        if (!profile.friends.includes(target.id) && !target.requests.includes(profile.id)) {
          if (target.requests.length >= 80) throw fail(409, '对方的好友邀请已满。');
          target.requests.push(profile.id);
        }
      } else {
        if (typeof body.accept !== 'boolean' || !profile.requests.includes(target.id)) throw fail(400, '好友邀请不存在。');
        profile.requests = profile.requests.filter((id) => id !== target.id);
        target.requests = target.requests.filter((id) => id !== profile.id);
        if (body.accept) {
          if (!profile.friends.includes(target.id)) profile.friends.push(target.id);
          if (!target.friends.includes(profile.id)) target.friends.push(profile.id);
        }
      }
      scheduleSave();
      sendFriends(profile.id);
      sendFriends(target.id);
      return json(response, 200, { ok: true });
    }
    if (action === 'lesson') {
      if (!lessonParticipants.has(profile.id)) throw fail(409, '请先进入光学工坊。');
      const patch = body.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !['stage', 'mirrorA', 'mirrorB', 'prediction'].includes(key))) throw fail(400, '课堂操作无效。');
      if (Object.keys(patch).length === 0) throw fail(400, '课堂操作不能为空。');
      if (['mirrorA', 'mirrorB'].some((key) => key in patch && (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]) || patch[key] < -80 || patch[key] > 80))) throw fail(400, '镜面角度无效。');
      if ('stage' in patch && ![0, 1, 2, 3].includes(patch.stage)) throw fail(400, '课堂阶段无效。');
      if ('prediction' in patch && ![null, 'equal', 'double', 'half'].includes(patch.prediction)) throw fail(400, '请选择一个预测。');
      const nextLesson = opticsReducer(lesson, patch);
      if (JSON.stringify(nextLesson) === JSON.stringify(lesson)) return json(response, 200, { ok: true });
      lesson = nextLesson;
      if (lesson.stage === 3) {
        for (const id of lessonParticipants) {
          const participant = profiles.get(id);
          if (participant && !participant.completedLessons.includes('mit-optics-01')) participant.completedLessons.push('mit-optics-01');
          sendFriends(id);
        }
        scheduleSave();
      }
      broadcast('lesson', lesson);
      return json(response, 200, { ok: true });
    }
    throw fail(404, '请求不存在。');
  }

  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const [id, player] of players) if (!clients.has(id) && now - player.lastSeen > 8000) leave(id);
    for (const responses of clients.values()) for (const response of responses) if (!response.destroyed) response.write(': keepalive\n\n');
    for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
  }, 4000);
  maintenance.unref?.();
  // Coalesce all guests' updates into ten shared snapshots per second, rather than N broadcasts per guest.
  const movementBroadcast = setInterval(() => {
    if (!movementChanged) return;
    movementChanged = false;
    broadcast('players', publicPlayers());
  }, 100);
  movementBroadcast.unref?.();

  return {
    handler(request, response, next) {
      handle(request, response, next).catch((error) => {
        if (response.headersSent) return response.end();
        json(response, error.status ?? 500, { error: error.status ? error.message : '校园服务暂时不可用，请稍后重试。' });
      });
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      clearTimeout(saveTimer);
      clearInterval(maintenance);
      clearInterval(movementBroadcast);
      for (const responses of clients.values()) for (const response of responses) response.end();
      clients.clear();
      players.clear();
      closePromise = persist().catch((error) => console.error('World profile shutdown save failed:', error.message));
      return closePromise;
    },
  };
}
