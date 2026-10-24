import type { OpticsState } from './optics-model.mjs';
import type { PlayableCharacterId } from './character-catalog';

export interface WorldPlayer {
  id: string;
  nickname: string;
  color: string;
  characterId: PlayableCharacterId;
  position: [number, number];
  yaw: number;
}

export interface WorldMessage {
  id: string;
  playerId: string;
  nickname: string;
  text: string;
  sentAt: number;
}

export interface WorldFriend {
  id: string;
  nickname: string;
  color: string;
  online: boolean;
}

export interface WorldFriendRequest extends Omit<WorldFriend, 'online'> {
  direction: 'incoming' | 'outgoing';
}

export interface WorldSnapshot {
  selfId: string;
  players: WorldPlayer[];
  messages: WorldMessage[];
  friends: WorldFriend[];
  friendRequests: WorldFriendRequest[];
  completedLessons: string[];
  lesson: OpticsState;
  lessonParticipants: WorldPlayer[];
}

export type WorldEvent =
  | { type: 'snapshot'; data: WorldSnapshot }
  | { type: 'players'; data: WorldPlayer[] }
  | { type: 'chat'; data: WorldMessage }
  | { type: 'friends'; data: Pick<WorldSnapshot, 'friends' | 'friendRequests' | 'completedLessons'> }
  | { type: 'lesson-participants'; data: WorldPlayer[] }
  | { type: 'lesson'; data: OpticsState };
