import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  extractMentions,
  isValidParticipantName,
  isValidRoomName,
  type EventType,
  type JoinResult,
  type Message,
  type Participant,
  type Room,
  type RoomEvent,
  type RoomSummary,
} from './domain.js';
import { AppError } from './errors.js';

interface RoomRow {
  id: string;
  name: string;
  created_at: string;
}

interface RoomSummaryRow extends RoomRow {
  participant_count: number;
  message_count: number;
}

interface ParticipantRow {
  id: string;
  room_id: string;
  name: string;
  active: number;
  joined_at: string;
  left_at: string | null;
}

interface MessageRow {
  id: string;
  room_id: string;
  sender: string;
  body: string;
  reply_to: string | null;
  mentions_json: string;
  event_id: number;
  created_at: string;
}

interface EventRow {
  id: number;
  room_id: string;
  type: EventType;
  payload_json: string;
  created_at: string;
}

export interface MutationResult<T> {
  value: T;
  event: RoomEvent | null;
}

function now(): string {
  return new Date().toISOString();
}

function roomFromRow(row: RoomRow): Room {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function participantFromRow(row: ParticipantRow): Participant {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    active: row.active === 1,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

function messageFromRow(row: MessageRow): Message {
  return {
    id: row.id,
    roomId: row.room_id,
    sender: row.sender,
    body: row.body,
    replyTo: row.reply_to,
    mentions: JSON.parse(row.mentions_json) as string[],
    cursor: row.event_id,
    createdAt: row.created_at,
  };
}

export class AgentRoomDatabase {
  readonly #db: Database.Database;

  public constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.#db = new Database(path);
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('foreign_keys = ON');
    this.#migrate();
  }

  public close(): void {
    this.#db.close();
  }

  public createRoom(name: string): MutationResult<Room> {
    if (!isValidRoomName(name)) {
      throw new AppError(
        'Room name must be 1-64 characters using letters, numbers, dot, underscore, or hyphen.',
        400,
        'invalid_room_name',
      );
    }
    if (this.#findRoom(name) !== undefined) {
      throw new AppError(`Room "${name}" already exists.`, 409, 'room_exists');
    }

    const result = this.#db.transaction(() => {
      const room: Room = { id: randomUUID(), name, createdAt: now() };
      this.#db
        .prepare('INSERT INTO rooms (id, name, created_at) VALUES (?, ?, ?)')
        .run(room.id, room.name, room.createdAt);
      const cursor = this.#insertEvent(room.id, 'room.created', { room });
      return { room, cursor };
    })();

    return { value: result.room, event: this.getEvent(result.cursor) };
  }

  public listRooms(): RoomSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT r.id, r.name, r.created_at,
          (SELECT COUNT(*) FROM participants p WHERE p.room_id = r.id AND p.active = 1) AS participant_count,
          (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) AS message_count
         FROM rooms r
         ORDER BY r.name COLLATE NOCASE`,
      )
      .all() as RoomSummaryRow[];

    return rows.map((row) => ({
      ...roomFromRow(row),
      participantCount: row.participant_count,
      messageCount: row.message_count,
    }));
  }

  public join(roomName: string, name: string): MutationResult<JoinResult> {
    this.#assertParticipantName(name);
    const room = this.#requireRoom(roomName);
    const existing = this.#findParticipant(room.id, name);
    if (existing?.active === true) {
      return { value: { participant: existing, changed: false }, event: null };
    }

    const result = this.#db.transaction(() => {
      const timestamp = now();
      let participant: Participant;
      if (existing === undefined) {
        participant = {
          id: randomUUID(),
          roomId: room.id,
          name,
          active: true,
          joinedAt: timestamp,
          leftAt: null,
        };
        this.#db
          .prepare(
            `INSERT INTO participants (id, room_id, name, active, joined_at, left_at)
             VALUES (?, ?, ?, 1, ?, NULL)`,
          )
          .run(participant.id, room.id, name, timestamp);
      } else {
        this.#db
          .prepare('UPDATE participants SET active = 1, joined_at = ?, left_at = NULL WHERE id = ?')
          .run(timestamp, existing.id);
        participant = { ...existing, active: true, joinedAt: timestamp, leftAt: null };
      }

      const cursor = this.#insertEvent(room.id, 'participant.joined', { participant });
      return { participant, cursor };
    })();

    return {
      value: { participant: result.participant, changed: true },
      event: this.getEvent(result.cursor),
    };
  }

  public leave(roomName: string, name: string): MutationResult<Participant> {
    const room = this.#requireRoom(roomName);
    const participant = this.#requireActiveParticipant(room.id, name);

    const result = this.#db.transaction(() => {
      const leftAt = now();
      this.#db
        .prepare('UPDATE participants SET active = 0, left_at = ? WHERE id = ?')
        .run(leftAt, participant.id);
      const updated = { ...participant, active: false, leftAt };
      const cursor = this.#insertEvent(room.id, 'participant.left', { participant: updated });
      return { participant: updated, cursor };
    })();

    return { value: result.participant, event: this.getEvent(result.cursor) };
  }

  public send(
    roomName: string,
    senderName: string,
    body: string,
    replyTo: string | null = null,
  ): MutationResult<Message> {
    const room = this.#requireRoom(roomName);
    const sender = this.#requireActiveParticipant(room.id, senderName);
    const text = body.trim();
    if (text.length === 0 || text.length > 20_000) {
      throw new AppError('Message must contain 1-20,000 characters.', 400, 'invalid_message');
    }
    if (replyTo !== null) {
      const parent = this.#findMessage(replyTo);
      if (parent === undefined || parent.roomId !== room.id) {
        throw new AppError(`Reply target "${replyTo}" was not found in this room.`, 404, 'reply_not_found');
      }
    }

    const result = this.#db.transaction(() => {
      const id = randomUUID();
      const createdAt = now();
      const mentions = extractMentions(text);
      this.#db
        .prepare(
          `INSERT INTO messages
           (id, room_id, participant_id, sender, body, reply_to, mentions_json, event_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          id,
          room.id,
          sender.id,
          sender.name,
          text,
          replyTo,
          JSON.stringify(mentions),
          createdAt,
        );
      const pendingMessage: Message = {
        id,
        roomId: room.id,
        sender: sender.name,
        body: text,
        replyTo,
        mentions,
        cursor: 0,
        createdAt,
      };
      const cursor = this.#insertEvent(room.id, 'message.created', {
        message: pendingMessage,
      });
      this.#db.prepare('UPDATE messages SET event_id = ? WHERE id = ?').run(cursor, id);
      const message = { ...pendingMessage, cursor };
      this.#db
        .prepare('UPDATE events SET payload_json = ? WHERE id = ?')
        .run(JSON.stringify({ message }), cursor);
      return { message, cursor };
    })();

    return { value: result.message, event: this.getEvent(result.cursor) };
  }

  public history(roomName: string, limit: number, after?: number): Message[] {
    const room = this.#requireRoom(roomName);
    const safeLimit = Math.max(1, Math.min(limit, 500));
    let rows: MessageRow[];

    if (after === undefined) {
      rows = this.#db
        .prepare(
          `SELECT * FROM (
             SELECT id, room_id, sender, body, reply_to, mentions_json, event_id, created_at
             FROM messages WHERE room_id = ? ORDER BY event_id DESC LIMIT ?
           ) ORDER BY event_id ASC`,
        )
        .all(room.id, safeLimit) as MessageRow[];
    } else {
      rows = this.#db
        .prepare(
          `SELECT id, room_id, sender, body, reply_to, mentions_json, event_id, created_at
           FROM messages WHERE room_id = ? AND event_id > ? ORDER BY event_id ASC LIMIT ?`,
        )
        .all(room.id, after, safeLimit) as MessageRow[];
    }

    return rows.map(messageFromRow);
  }

  public latestCursor(roomName: string): number {
    const room = this.#requireRoom(roomName);
    const row = this.#db
      .prepare('SELECT COALESCE(MAX(id), 0) AS cursor FROM events WHERE room_id = ?')
      .get(room.id) as { cursor: number };
    return row.cursor;
  }

  public assertCanWatch(roomName: string, participantName: string): Room {
    const room = this.#requireRoom(roomName);
    this.#requireActiveParticipant(room.id, participantName);
    return room;
  }

  public listEvents(roomId: string, after: number): RoomEvent[] {
    const rows = this.#db
      .prepare(
        `SELECT id, room_id, type, payload_json, created_at
         FROM events WHERE room_id = ? AND id > ? ORDER BY id ASC`,
      )
      .all(roomId, after) as EventRow[];
    return rows.map((row) => this.#eventFromRow(row));
  }

  public getEvent(cursor: number): RoomEvent {
    const row = this.#db
      .prepare('SELECT id, room_id, type, payload_json, created_at FROM events WHERE id = ?')
      .get(cursor) as EventRow | undefined;
    if (row === undefined) {
      throw new AppError(`Event cursor ${cursor} was not found.`, 500, 'event_not_found');
    }
    return this.#eventFromRow(row);
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        joined_at TEXT NOT NULL,
        left_at TEXT,
        UNIQUE (room_id, name)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id),
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        reply_to TEXT REFERENCES messages(id),
        mentions_json TEXT NOT NULL,
        event_id INTEGER UNIQUE REFERENCES events(id),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS events_room_cursor_idx ON events(room_id, id);
      CREATE INDEX IF NOT EXISTS messages_room_event_idx ON messages(room_id, event_id);
    `);
  }

  #insertEvent(roomId: string, type: EventType, payload: unknown): number {
    const result = this.#db
      .prepare(
        'INSERT INTO events (room_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(roomId, type, JSON.stringify(payload), now());
    return Number(result.lastInsertRowid);
  }

  #eventFromRow(row: EventRow): RoomEvent {
    const base = { cursor: row.id, roomId: row.room_id, createdAt: row.created_at };

    switch (row.type) {
      case 'room.created': {
        const payload = JSON.parse(row.payload_json) as { room: Room };
        return { ...base, type: row.type, payload };
      }
      case 'participant.joined':
      case 'participant.left': {
        const payload = JSON.parse(row.payload_json) as { participant: Participant };
        return { ...base, type: row.type, payload };
      }
      case 'message.created': {
        const payload = JSON.parse(row.payload_json) as { message: Message };
        return { ...base, type: row.type, payload };
      }
    }
  }

  #findRoom(name: string): Room | undefined {
    const row = this.#db.prepare('SELECT * FROM rooms WHERE name = ?').get(name) as RoomRow | undefined;
    return row === undefined ? undefined : roomFromRow(row);
  }

  #requireRoom(name: string): Room {
    const room = this.#findRoom(name);
    if (room === undefined) {
      throw new AppError(`Room "${name}" was not found.`, 404, 'room_not_found');
    }
    return room;
  }

  #findParticipant(roomId: string, name: string): Participant | undefined {
    const row = this.#db
      .prepare('SELECT * FROM participants WHERE room_id = ? AND name = ?')
      .get(roomId, name) as ParticipantRow | undefined;
    return row === undefined ? undefined : participantFromRow(row);
  }

  #requireActiveParticipant(roomId: string, name: string): Participant {
    this.#assertParticipantName(name);
    const participant = this.#findParticipant(roomId, name);
    if (participant?.active !== true) {
      throw new AppError(
        `Participant "${name}" has not joined this room or has left it.`,
        409,
        'participant_not_active',
      );
    }
    return participant;
  }

  #assertParticipantName(name: string): void {
    if (!isValidParticipantName(name)) {
      throw new AppError(
        'Participant name must be 1-32 characters using letters, numbers, dot, underscore, or hyphen.',
        400,
        'invalid_participant_name',
      );
    }
  }

  #findMessage(id: string): Message | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, room_id, sender, body, reply_to, mentions_json, event_id, created_at
         FROM messages WHERE id = ?`,
      )
      .get(id) as MessageRow | undefined;
    return row === undefined ? undefined : messageFromRow(row);
  }
}
