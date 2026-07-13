export type EventType =
  | 'room.created'
  | 'participant.joined'
  | 'participant.left'
  | 'message.created';

export interface Room {
  id: string;
  name: string;
  createdAt: string;
}

export interface RoomSummary extends Room {
  participantCount: number;
  messageCount: number;
}

export interface Participant {
  id: string;
  roomId: string;
  name: string;
  active: boolean;
  joinedAt: string;
  leftAt: string | null;
}

export interface Message {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  replyTo: string | null;
  mentions: string[];
  cursor: number;
  createdAt: string;
}

interface BaseRoomEvent {
  cursor: number;
  roomId: string;
  createdAt: string;
}

export type RoomEvent =
  | (BaseRoomEvent & { type: 'room.created'; payload: { room: Room } })
  | (BaseRoomEvent & {
      type: 'participant.joined';
      payload: { participant: Participant };
    })
  | (BaseRoomEvent & {
      type: 'participant.left';
      payload: { participant: Participant };
    })
  | (BaseRoomEvent & { type: 'message.created'; payload: { message: Message } });

export interface JoinResult {
  participant: Participant;
  changed: boolean;
}

export interface CursorResult {
  cursor: number;
}

const ROOM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PARTICIPANT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const MENTION = /@([A-Za-z0-9][A-Za-z0-9._-]{0,31})/g;

export function isValidRoomName(value: string): boolean {
  return ROOM_NAME.test(value);
}

export function isValidParticipantName(value: string): boolean {
  return PARTICIPANT_NAME.test(value);
}

export function extractMentions(body: string): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];

  for (const match of body.matchAll(MENTION)) {
    const name = match[1];
    if (name === undefined) {
      continue;
    }

    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      mentions.push(name);
    }
  }

  return mentions;
}
