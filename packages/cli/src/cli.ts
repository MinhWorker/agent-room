#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { readFileSync } from 'node:fs';
import { AgentRoomClient } from './client.js';
import { DEFAULT_SERVER_URL, defaultDatabasePath } from './config.js';
import { errorMessage } from './errors.js';
import { formatEvent, formatMessage } from './format.js';
import { createAgentRoomServer } from './server.js';

interface GlobalOptions {
  server: string;
}

function packageVersion(): string {
  const value: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error('package.json does not contain a valid version');
  }
  return value.version;
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Expected a non-negative integer.');
  }
  return parsed;
}

function port(value: string): number {
  const parsed = integer(value);
  if (parsed < 1 || parsed > 65_535) {
    throw new InvalidArgumentError('Expected a port between 1 and 65535.');
  }
  return parsed;
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('agent-room')
    .description('Local terminal rooms for coding agents and humans')
    .version(packageVersion())
    .option(
      '--server <url>',
      'daemon URL',
      process.env.AGENT_ROOM_URL ?? DEFAULT_SERVER_URL,
    );

  const client = (): AgentRoomClient =>
    new AgentRoomClient(program.opts<GlobalOptions>().server);

  program
    .command('serve')
    .description('start the local daemon')
    .option('--host <host>', 'listen host', '127.0.0.1')
    .option('--port <port>', 'listen port', port, 7337)
    .option('--db <path>', 'SQLite database path', defaultDatabasePath())
    .option('--json', 'print startup details as JSONL')
    .action(async (options: { host: string; port: number; db: string; json?: boolean }) => {
      const daemon = createAgentRoomServer({
        dbPath: options.db,
        host: options.host,
        port: options.port,
      });
      const address = await daemon.start();
      if (options.json === true) {
        console.log(JSON.stringify({ type: 'server.ready', url: address.url, database: options.db }));
      } else {
        console.log(`agent-room listening on ${address.url}`);
        console.log(`database: ${options.db}`);
      }

      await new Promise<void>((resolve) => {
        const stop = (): void => resolve();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      await daemon.stop();
    });

  program
    .command('create')
    .description('create a room')
    .argument('<room>')
    .option('--json', 'print JSON')
    .action(async (room: string, options: { json?: boolean }) => {
      const created = await client().createRoom(room);
      console.log(options.json === true ? JSON.stringify(created) : `created room ${created.name}`);
    });

  program
    .command('list')
    .description('list rooms')
    .option('--json', 'print JSON')
    .action(async (options: { json?: boolean }) => {
      const rooms = await client().listRooms();
      if (options.json === true) {
        console.log(JSON.stringify(rooms));
        return;
      }
      if (rooms.length === 0) {
        console.log('no rooms');
        return;
      }
      for (const room of rooms) {
        console.log(`${room.name}\tparticipants=${room.participantCount}\tmessages=${room.messageCount}`);
      }
    });

  program
    .command('join')
    .description('join a room')
    .argument('<room>')
    .requiredOption('--name <name>', 'participant name')
    .option('--json', 'print JSON')
    .action(async (room: string, options: { name: string; json?: boolean }) => {
      const result = await client().join(room, options.name);
      console.log(
        options.json === true
          ? JSON.stringify(result)
          : `${result.participant.name} ${result.changed ? 'joined' : 'is already in'} ${room}`,
      );
    });

  program
    .command('leave')
    .description('leave a room')
    .argument('<room>')
    .requiredOption('--name <name>', 'participant name')
    .option('--json', 'print JSON')
    .action(async (room: string, options: { name: string; json?: boolean }) => {
      const participant = await client().leave(room, options.name);
      console.log(
        options.json === true ? JSON.stringify(participant) : `${participant.name} left ${room}`,
      );
    });

  program
    .command('send')
    .description('send a message')
    .argument('<room>')
    .argument('<message>')
    .requiredOption('--from <name>', 'sender name')
    .option('--json', 'print JSON')
    .action(async (room: string, body: string, options: { from: string; json?: boolean }) => {
      const message = await client().send(room, options.from, body);
      console.log(options.json === true ? JSON.stringify(message) : formatMessage(message));
    });

  program
    .command('reply')
    .description('reply to a message')
    .argument('<room>')
    .argument('<message-id>')
    .argument('<message>')
    .requiredOption('--from <name>', 'sender name')
    .option('--json', 'print JSON')
    .action(
      async (
        room: string,
        messageId: string,
        body: string,
        options: { from: string; json?: boolean },
      ) => {
        const message = await client().send(room, options.from, body, messageId);
        console.log(options.json === true ? JSON.stringify(message) : formatMessage(message));
      },
    );

  program
    .command('history')
    .description('show recent messages')
    .argument('<room>')
    .option('--limit <count>', 'maximum messages (1-500)', integer, 50)
    .option('--after <cursor>', 'only messages after this event cursor', integer)
    .option('--json', 'print JSONL')
    .action(async (room: string, options: { limit: number; after?: number; json?: boolean }) => {
      const messages = await client().history(room, options.limit, options.after);
      for (const message of messages) {
        console.log(options.json === true ? JSON.stringify(message) : formatMessage(message));
      }
    });

  program
    .command('watch')
    .description('stream new room events until interrupted')
    .argument('<room>')
    .requiredOption('--name <name>', 'participant name')
    .option('--after <cursor>', 'resume after this event cursor', integer)
    .option('--json', 'print events as JSONL')
    .action(async (room: string, options: { name: string; after?: number; json?: boolean }) => {
      const api = client();
      const after = options.after ?? (await api.cursor(room));
      const controller = new AbortController();
      const stop = (): void => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      console.error(`watching ${room} as ${options.name} after cursor ${after}`);
      try {
        const finalCursor = await api.watch({
          room,
          name: options.name,
          after,
          signal: controller.signal,
          onEvent: (event) => {
            console.log(options.json === true ? JSON.stringify(event) : formatEvent(event));
          },
          onReconnect: (error) => console.error(`watch reconnecting: ${error.message}`),
        });
        console.error(`watch stopped at cursor ${finalCursor}`);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    });

  return program;
}

createProgram().parseAsync(process.argv).catch((error: unknown) => {
  console.error(`error: ${errorMessage(error)}`);
  process.exitCode = 1;
});
