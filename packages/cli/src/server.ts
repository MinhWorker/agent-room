import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AgentRoomDatabase } from './database.js';
import { AppError, errorMessage } from './errors.js';
import { EventHub } from './event-hub.js';
import type { RoomEvent } from './domain.js';

export interface ServerOptions {
  dbPath: string;
  host?: string;
  port?: number;
}

export interface ServerAddress {
  host: string;
  port: number;
  url: string;
}

export interface AgentRoomServer {
  start(): Promise<ServerAddress>;
  stop(): Promise<void>;
}

type JsonObject = Record<string, unknown>;

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new AppError('Request body exceeds 1 MB.', 413, 'body_too_large');
    }
    chunks.push(buffer);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object.');
    }
    return parsed as JsonObject;
  } catch {
    throw new AppError('Request body must be a valid JSON object.', 400, 'invalid_json');
  }
}

function requireString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new AppError(`Field "${key}" must be a string.`, 400, 'invalid_request');
  }
  return value;
}

function optionalString(body: JsonObject, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(`Field "${key}" must be a string or null.`, 400, 'invalid_request');
  }
  return value;
}

function parseInteger(value: string | null, fallback: number, key: string): number {
  if (value === null) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AppError(`Query parameter "${key}" must be a non-negative integer.`, 400, 'invalid_query');
  }
  return number;
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

export function createAgentRoomServer(options: ServerOptions): AgentRoomServer {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 7337;
  const database = new AgentRoomDatabase(options.dbPath);
  const events = new EventHub();
  const streams = new Set<ServerResponse>();
  let started = false;
  let stopped = false;

  const server: Server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status = error instanceof AppError ? error.status : 500;
      const code = error instanceof AppError ? error.code : 'internal_error';
      sendJson(response, status, { error: { code, message: errorMessage(error) } });
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const segments = pathSegments(url);

    if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === 'GET' && segments.length === 1 && segments[0] === 'rooms') {
      sendJson(response, 200, { rooms: database.listRooms() });
      return;
    }

    if (method === 'POST' && segments.length === 1 && segments[0] === 'rooms') {
      const body = await readJson(request);
      const result = database.createRoom(requireString(body, 'name'));
      if (result.event !== null) {
        events.publish(result.event);
      }
      sendJson(response, 201, { room: result.value });
      return;
    }

    if (segments.length >= 2 && segments[0] === 'rooms') {
      const room = segments[1];
      if (room === undefined) {
        throw new AppError('Room name is required.', 400, 'invalid_room_name');
      }

      if (method === 'GET' && segments.length === 3 && segments[2] === 'cursor') {
        sendJson(response, 200, { cursor: database.latestCursor(room) });
        return;
      }

      if (method === 'POST' && segments.length === 3 && segments[2] === 'join') {
        const body = await readJson(request);
        const result = database.join(room, requireString(body, 'name'));
        if (result.event !== null) {
          events.publish(result.event);
        }
        sendJson(response, result.value.changed ? 201 : 200, result.value);
        return;
      }

      if (method === 'POST' && segments.length === 3 && segments[2] === 'leave') {
        const body = await readJson(request);
        const result = database.leave(room, requireString(body, 'name'));
        if (result.event !== null) {
          events.publish(result.event);
        }
        sendJson(response, 200, { participant: result.value });
        return;
      }

      if (method === 'POST' && segments.length === 3 && segments[2] === 'messages') {
        const body = await readJson(request);
        const result = database.send(
          room,
          requireString(body, 'from'),
          requireString(body, 'body'),
          optionalString(body, 'replyTo'),
        );
        if (result.event !== null) {
          events.publish(result.event);
        }
        sendJson(response, 201, { message: result.value });
        return;
      }

      if (method === 'GET' && segments.length === 3 && segments[2] === 'messages') {
        const limit = parseInteger(url.searchParams.get('limit'), 50, 'limit');
        const rawAfter = url.searchParams.get('after');
        const after = rawAfter === null ? undefined : parseInteger(rawAfter, 0, 'after');
        sendJson(response, 200, { messages: database.history(room, limit, after) });
        return;
      }

      if (method === 'GET' && segments.length === 3 && segments[2] === 'events') {
        const participant = url.searchParams.get('name');
        if (participant === null) {
          throw new AppError('Query parameter "name" is required.', 400, 'invalid_query');
        }
        const after = parseInteger(url.searchParams.get('after'), 0, 'after');
        const foundRoom = database.assertCanWatch(room, participant);
        const replay = database.listEvents(foundRoom.id, after);
        streamEvents(request, response, foundRoom.id, after, replay);
        return;
      }
    }

    throw new AppError('Route not found.', 404, 'not_found');
  }

  function streamEvents(
    request: IncomingMessage,
    response: ServerResponse,
    roomId: string,
    after: number,
    replay: RoomEvent[],
  ): void {
    let cursor = after;
    let closed = false;
    streams.add(response);
    response.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.flushHeaders();

    const write = (event: RoomEvent): void => {
      if (!closed && event.cursor > cursor) {
        cursor = event.cursor;
        response.write(`${JSON.stringify(event)}\n`);
      }
    };
    const unsubscribe = events.subscribe(roomId, write);
    for (const event of replay) {
      write(event);
    }

    const heartbeat = setInterval(() => {
      if (!closed) {
        response.write('\n');
      }
    }, 15_000);

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(response);
    };

    request.once('close', cleanup);
    response.once('close', cleanup);
  }

  return {
    async start(): Promise<ServerAddress> {
      if (started) {
        throw new AppError('Server has already been started.', 500, 'server_state');
      }
      started = true;
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          resolve();
        });
      });
      const address = server.address() as AddressInfo;
      return { host, port: address.port, url: `http://${host}:${address.port}` };
    },

    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      for (const stream of streams) {
        stream.end();
      }
      streams.clear();
      if (started) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeAllConnections();
        });
      }
      database.close();
    },
  };
}
