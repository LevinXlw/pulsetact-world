import { useCallback, useEffect, useRef, useState } from 'react';
import { initialOpticsState, type OpticsState } from './optics-model.mjs';
import type { WorldEvent, WorldSnapshot } from './world-network-types';
import { normalizePlayableCharacter, type PlayableCharacterId } from './character-catalog';

export type { WorldPlayer, WorldMessage, WorldFriend, WorldFriendRequest } from './world-network-types';
const SESSION_KEY = 'pulsetact.world.visitor.v1';
const RETURNING_VISITOR_KEY = 'pulsetact.world.returning-visitor.v1';
const SESSION_PROFILE_KEY = 'pulsetact.world.visitor-profile.v1';
const RETURNING_PROFILE_KEY = 'pulsetact.world.returning-profile.v1';
type VisitorProfile = { nickname: string; color: string; characterId: PlayableCharacterId };
type VisitorIdentity = VisitorProfile & { token: string };
const emptySnapshot = (): WorldSnapshot => ({ selfId: '', players: [], messages: [], friends: [], friendRequests: [], completedLessons: [], lesson: { ...initialOpticsState }, lessonParticipants: [] });
let lastRememberedAt = 0;
let lastRememberedToken: string | null = null;

function storedIdentity(storage: Storage, key: string): VisitorIdentity | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null');
    if (value && typeof value.token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value.token) && typeof value.nickname === 'string' && typeof value.color === 'string' && /^#[a-fA-F0-9]{6}$/.test(value.color)) return { token: value.token, nickname: value.nickname, color: value.color, characterId: normalizePlayableCharacter(value.characterId) };
  } catch { /* A missing or old profile is handled by the caller. */ }
  return null;
}

function restoredVisitorToken(): string | null {
  try {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (token && /^[A-Za-z0-9_-]{32,128}$/.test(token)) return token;
  } catch { /* Try the returning identity if tab storage is unavailable. */ }
  try {
    const token = storedIdentity(localStorage, RETURNING_PROFILE_KEY)?.token ?? localStorage.getItem(RETURNING_VISITOR_KEY);
    if (token && /^[A-Za-z0-9_-]{32,128}$/.test(token)) return token;
  } catch { /* A fresh in-memory identity still works. */ }
  return null;
}

/** Pair display attributes with the same identity selected for restoration, including multiple live tabs. */
export function readWorldVisitorProfile(): VisitorProfile | null {
  try {
    const tabToken = sessionStorage.getItem(SESSION_KEY);
    const tabProfile = storedIdentity(sessionStorage, SESSION_PROFILE_KEY);
    const returningProfile = storedIdentity(localStorage, RETURNING_PROFILE_KEY);
    const profile = tabToken ? (tabProfile?.token === tabToken ? tabProfile : returningProfile?.token === tabToken ? returningProfile : null) : returningProfile;
    return profile ? { nickname: profile.nickname, color: profile.color, characterId: profile.characterId } : null;
  } catch { return null; }
}

function rememberVisitor(token: string | null, profile: VisitorProfile, force = false) {
  if (!token || (document.visibilityState === 'hidden' && !force)) return;
  if (!force && token === lastRememberedToken && Date.now() - lastRememberedAt < 5000) return;
  try {
    // One atomic record keeps the returning token and display profile together across active tabs.
    localStorage.setItem(RETURNING_PROFILE_KEY, JSON.stringify({ token, ...profile }));
    localStorage.setItem(RETURNING_VISITOR_KEY, token);
    lastRememberedToken = token;
    lastRememberedAt = Date.now();
  } catch { /* The current tab remains usable without persistent storage. */ }
}

async function requestJson(path: string, body: unknown, token: string | null, signal?: AbortSignal) {
  const response = await fetch(`/api/world/${path}`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({ error: '校园连接暂时不可用，请确认服务已启动。' }));
  if (!response.ok) throw new Error(value.error ?? '校园连接暂时不可用。');
  return value;
}

/** Real room state from the same-origin server; no simulated users or claimed school identity. */
export function useWorldNetwork(nickname: string, color: string, enabled: boolean, characterId: PlayableCharacterId = 'pixiv') {
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(emptySnapshot);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('offline');
  const [error, setError] = useState<string | null>(null);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  // Bind restoration once to this mounted page. Shared storage can later belong
  // to a different live tab, and a rejected credential must remain cleared.
  const [restoredToken] = useState(restoredVisitorToken);
  const tokenRef = useRef<string | null>(restoredToken);
  const onlineRef = useRef(false);
  const effectAbort = useRef<AbortController | null>(null);
  const pendingPosition = useRef<{ position: [number, number]; yaw: number } | null>(null);
  const lastPosition = useRef<{ position: [number, number]; yaw: number } | null>(null);
  const wantsLesson = useRef(false);
  const profileRef = useRef({ nickname, color, characterId });
  profileRef.current = { nickname, color, characterId };

  useEffect(() => {
    // Save a new choice before the network can succeed, so an offline refresh retains it.
    // Never pair one tab's attributes with another tab's most recently remembered token.
    const token = tokenRef.current;
    try {
      if (token && /^[A-Za-z0-9_-]{32,128}$/.test(token)) {
        sessionStorage.setItem(SESSION_KEY, token);
        sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify({ token, nickname, color, characterId }));
        rememberVisitor(token, { nickname, color, characterId }, true);
      }
    } catch { /* The fallback page profile still supports browsers without identity storage. */ }
  }, [nickname, color, characterId]);

  useEffect(() => {
    if (!enabled) {
      onlineRef.current = false;
      wantsLesson.current = false;
      setStatus('offline');
      setSnapshot(emptySnapshot());
      return;
    }
    let stopped = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1500;
    let token: string | null = tokenRef.current;
    const tabId = crypto.randomUUID();
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pulsetact-world-tab') : null;
    let credentialClaimed = false;
    let conflictingTab = false;
    const onChannel = (event: MessageEvent) => {
      if (!token || event.data?.token !== token || event.data?.tabId === tabId) return;
      if (event.data?.type === 'probe') {
        // Simultaneously restoring tabs also elect one owner; neither must depend on having connected first.
        if (credentialClaimed || tabId < event.data.tabId) channel?.postMessage({ type: 'owned', token, tabId, recipient: event.data.tabId });
        else conflictingTab = true;
      }
      if (event.data?.type === 'owned' && event.data.recipient === tabId) conflictingTab = true;
    };
    channel?.addEventListener('message', onChannel);

    function receive(event: WorldEvent) {
      if (stopped) return;
      setSnapshot((current) => {
        if (event.type === 'snapshot') return event.data;
        if (event.type === 'players') return { ...current, players: event.data };
        if (event.type === 'chat') return { ...current, messages: [...current.messages.filter((message) => message.id !== event.data.id), event.data].slice(-80) };
        if (event.type === 'friends') return { ...current, ...event.data };
        if (event.type === 'lesson-participants') return { ...current, lessonParticipants: event.data };
        if (event.type === 'lesson') return { ...current, lesson: event.data };
        return current;
      });
    }

    async function connect() {
      if (stopped) return;
      const controller = new AbortController();
      effectAbort.current = controller;
      setStatus('connecting');
      try {
        const session = await requestJson('session', { nickname, color, characterId, token }, null, controller.signal) as WorldSnapshot & { token: string };
        if (stopped) return;
        token = session.token;
        tokenRef.current = token;
        credentialClaimed = true;
        try {
          sessionStorage.setItem(SESSION_KEY, token);
          sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify({ token, nickname, color, characterId }));
        } catch { /* Keep the live identity in memory. */ }
        rememberVisitor(token, { nickname, color, characterId }, document.visibilityState !== 'hidden');
        const { token: privateToken, ...data } = session;
        void privateToken;
        setSnapshot(data);
        let rejoinError: string | null = null;
        if (wantsLesson.current && !data.lessonParticipants.some((person) => person.id === data.selfId)) {
          try { await requestJson('lesson-join', {}, token, controller.signal); }
          catch (failure) {
            wantsLesson.current = false;
            if (failure instanceof Error && failure.name !== 'AbortError') rejoinError = failure.message;
          }
        }
        const response = await fetch('/api/world/events', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error('校园连接中断，正在尝试重新连接。');
        onlineRef.current = true;
        if (lastPosition.current) pendingPosition.current = lastPosition.current;
        retryDelay = 1500;
        setStatus('online');
        setError(rejoinError);
        heartbeat = setInterval(() => {
          requestJson('heartbeat', {}, token, controller.signal).catch(() => controller.abort());
        }, 20_000);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 1024 * 1024) throw new Error('校园数据连接异常，正在重新连接。');
            let end;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              for (const line of frame.split('\n')) if (line.startsWith('data: ')) receive(JSON.parse(line.slice(6)) as WorldEvent);
            }
          }
        } finally { reader.releaseLock(); }
        if (!stopped) throw new Error('校园连接中断，正在尝试重新连接。');
      } catch (failure) {
        if (stopped) return;
        onlineRef.current = false;
        setStatus('offline');
        setSnapshot((current) => ({ ...current, players: [], lessonParticipants: [] }));
        setError(failure instanceof Error && failure.name !== 'AbortError' ? failure.message : '校园连接中断，正在尝试重新连接。');
      } finally {
        clearInterval(heartbeat);
        if (!stopped) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(20_000, retryDelay * 1.8);
        }
      }
    }

    async function start() {
      if (token && channel) {
        channel.postMessage({ type: 'probe', token, tabId });
        await new Promise((resolve) => setTimeout(resolve, 140));
        if (stopped) return;
        if (conflictingTab) {
          token = null;
          tokenRef.current = null;
          try {
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(SESSION_PROFILE_KEY);
          } catch { /* No stored identity. */ }
        }
      }
      credentialClaimed = true;
      await connect();
    }
    void start();
    return () => {
      stopped = true;
      onlineRef.current = false;
      effectAbort.current?.abort();
      clearInterval(heartbeat);
      clearTimeout(retryTimer);
      channel?.close();
      // Server removes disconnected presence after a short grace period, allowing refresh.
    };
  }, [nickname, color, characterId, enabled, reconnectVersion]);

  const action = useCallback(async (path: string, body: unknown) => {
    if (!onlineRef.current || !tokenRef.current) {
      setError('连接校园后即可进行这个操作。');
      return false;
    }
    try {
      await requestJson(path, body, tokenRef.current, effectAbort.current?.signal);
      rememberVisitor(tokenRef.current, profileRef.current, true);
      setError(null);
      return true;
    } catch (failure) {
      if (failure instanceof Error && failure.name !== 'AbortError') setError(failure.message);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let sending = false;
    const timer = setInterval(() => {
      if (sending || !onlineRef.current || !pendingPosition.current) return;
      const position = pendingPosition.current;
      pendingPosition.current = null;
      sending = true;
      requestJson('move', position, tokenRef.current, effectAbort.current?.signal).then(() => {
        lastPosition.current = position;
        rememberVisitor(tokenRef.current, profileRef.current);
      }).catch(() => {}).finally(() => { sending = false; });
    }, 100);
    return () => { clearInterval(timer); pendingPosition.current = null; };
  }, [enabled]);

  const updatePosition = useCallback((position: [number, number], yaw: number) => {
    const previous = pendingPosition.current ?? lastPosition.current;
    if (previous && Math.abs(position[0] - previous.position[0]) < .001 && Math.abs(position[1] - previous.position[1]) < .001 && Math.abs(yaw - previous.yaw) < .001) return;
    pendingPosition.current = { position: [...position], yaw };
  }, []);
  const sendChat = useCallback((text: string) => action('chat', { text }), [action]);
  const requestFriend = useCallback((targetId: string) => action('friend-request', { targetId }), [action]);
  const respondFriend = useCallback((targetId: string, accept: boolean) => action('friend-response', { targetId, accept }), [action]);
  const reportPlayer = useCallback((targetId: string, reason: string) => action('report', { targetId, reason }), [action]);
  const joinLesson = useCallback(async () => {
    const joined = await action('lesson-join', {});
    if (joined) wantsLesson.current = true;
    return joined;
  }, [action]);
  const leaveLesson = useCallback(async () => {
    wantsLesson.current = false;
    return action('lesson-leave', {});
  }, [action]);
  const submitLesson = useCallback((patch: Partial<OpticsState>) => action('lesson', { patch }), [action]);
  const reconnect = useCallback(() => setReconnectVersion((version) => version + 1), []);

  return { ...snapshot, selfId: snapshot.selfId || null, status, error, sendChat, updatePosition, requestFriend, respondFriend, reportPlayer, joinLesson, leaveLesson, submitLesson, reconnect };
}
