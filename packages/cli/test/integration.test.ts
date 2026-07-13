import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRoomClient } from '../src/client.js';
import type { RoomEvent } from '../src/domain.js';
import { createAgentRoomServer, type AgentRoomServer } from '../src/server.js';

describe('agent-room integration', () => {
  let directory: string;
  let daemon: AgentRoomServer;
  let client: AgentRoomClient;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-room-test-'));
    daemon = createAgentRoomServer({ dbPath: join(directory, 'room.db'), port: 0 });
    const address = await daemon.start();
    client = new AgentRoomClient(address.url);
  });

  afterEach(async () => {
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  });

  it('should support a watched mention, reply, cursor resume, and history', async () => {
    // Arrange
    await client.createRoom('project-x');
    await client.join('project-x', 'claude');
    await client.join('project-x', 'codex');
    const initialCursor = await client.cursor('project-x');
    const firstWatch = new AbortController();
    const firstEvents: RoomEvent[] = [];
    const firstWatchDone = client.watch({
      room: 'project-x',
      name: 'codex',
      after: initialCursor,
      signal: firstWatch.signal,
      onEvent: (event) => {
        firstEvents.push(event);
        if (event.type === 'message.created') {
          firstWatch.abort();
        }
      },
    });

    // Act
    const request = await client.send(
      'project-x',
      'claude',
      '@codex hãy review src/auth.ts; @Codex xem cả tests',
    );
    const firstFinalCursor = await firstWatchDone;
    const reply = await client.send('project-x', 'codex', 'Đã review xong.', request.id);

    const resumedWatch = new AbortController();
    const resumedEvents: RoomEvent[] = [];
    const resumedFinalCursor = await client.watch({
      room: 'project-x',
      name: 'codex',
      after: request.cursor,
      signal: resumedWatch.signal,
      onEvent: (event) => {
        resumedEvents.push(event);
        if (event.type === 'message.created') {
          resumedWatch.abort();
        }
      },
    });
    const history = await client.history('project-x');

    // Assert
    expect(request.mentions).toStrictEqual(['codex']);
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0]).toMatchObject({
      cursor: request.cursor,
      type: 'message.created',
      payload: { message: { id: request.id, sender: 'claude' } },
    });
    expect(firstFinalCursor).toBe(request.cursor);
    expect(reply.replyTo).toBe(request.id);
    expect(resumedEvents).toHaveLength(1);
    expect(resumedEvents[0]).toMatchObject({
      cursor: reply.cursor,
      type: 'message.created',
      payload: { message: { id: reply.id, replyTo: request.id } },
    });
    expect(resumedFinalCursor).toBe(reply.cursor);
    expect(history.map((message) => message.id)).toStrictEqual([request.id, reply.id]);

    const rooms = await client.listRooms();
    expect(rooms).toStrictEqual([
      expect.objectContaining({ name: 'project-x', participantCount: 2, messageCount: 2 }),
    ]);
  });

  it('should reject invalid state instead of sending as an inactive participant', async () => {
    // Arrange
    await client.createRoom('project-x');
    await client.join('project-x', 'claude');
    await client.leave('project-x', 'claude');

    // Act
    const attempt = client.send('project-x', 'claude', 'message after leaving');

    // Assert
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      code: 'participant_not_active',
    });
  });

  it('should make join idempotent and reject a cross-room reply', async () => {
    // Arrange
    await client.createRoom('one');
    await client.createRoom('two');
    await client.join('one', 'claude');
    await client.join('two', 'claude');
    const original = await client.send('one', 'claude', 'hello');

    // Act
    const secondJoin = await client.join('one', 'claude');
    const crossRoomReply = client.send('two', 'claude', 'wrong room', original.id);

    // Assert
    expect(secondJoin.changed).toBe(false);
    await expect(crossRoomReply).rejects.toMatchObject({
      status: 404,
      code: 'reply_not_found',
    });
  });
});
