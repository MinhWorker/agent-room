import type {
  CursorResult,
  JoinResult,
  Message,
  Participant,
  Room,
  RoomEvent,
  RoomSummary,
} from './domain.js';

interface ErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface WatchOptions {
  room: string;
  name: string;
  after: number;
  signal: AbortSignal;
  onEvent(event: RoomEvent): void;
  onReconnect?(error: Error): void;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export class AgentRoomClient {
  readonly #baseUrl: string;

  public constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  public async health(): Promise<{ ok: boolean }> {
    return this.#request('/health');
  }

  public async createRoom(name: string): Promise<Room> {
    const response = await this.#request<{ room: Room }>('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return response.room;
  }

  public async listRooms(): Promise<RoomSummary[]> {
    const response = await this.#request<{ rooms: RoomSummary[] }>('/rooms');
    return response.rooms;
  }

  public async join(room: string, name: string): Promise<JoinResult> {
    return this.#request(`/rooms/${encodeURIComponent(room)}/join`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  public async leave(room: string, name: string): Promise<Participant> {
    const response = await this.#request<{ participant: Participant }>(
      `/rooms/${encodeURIComponent(room)}/leave`,
      { method: 'POST', body: JSON.stringify({ name }) },
    );
    return response.participant;
  }

  public async send(
    room: string,
    from: string,
    body: string,
    replyTo: string | null = null,
  ): Promise<Message> {
    const response = await this.#request<{ message: Message }>(
      `/rooms/${encodeURIComponent(room)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ from, body, replyTo }),
      },
    );
    return response.message;
  }

  public async history(room: string, limit = 50, after?: number): Promise<Message[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (after !== undefined) {
      query.set('after', String(after));
    }
    const response = await this.#request<{ messages: Message[] }>(
      `/rooms/${encodeURIComponent(room)}/messages?${query.toString()}`,
    );
    return response.messages;
  }

  public async cursor(room: string): Promise<number> {
    const response = await this.#request<CursorResult>(
      `/rooms/${encodeURIComponent(room)}/cursor`,
    );
    return response.cursor;
  }

  public async watch(options: WatchOptions): Promise<number> {
    let cursor = options.after;

    while (!options.signal.aborted) {
      try {
        const query = new URLSearchParams({
          name: options.name,
          after: String(cursor),
        });
        const response = await fetch(
          `${this.#baseUrl}/rooms/${encodeURIComponent(options.room)}/events?${query.toString()}`,
          { signal: options.signal, headers: { accept: 'application/x-ndjson' } },
        );
        if (!response.ok) {
          throw await this.#responseError(response);
        }
        if (response.body === null) {
          throw new Error('Watch response did not include a stream.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!options.signal.aborted) {
          const result = await reader.read();
          if (result.done) {
            break;
          }
          buffer += decoder.decode(result.value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim().length === 0) {
              continue;
            }
            const event = JSON.parse(line) as RoomEvent;
            if (event.cursor > cursor) {
              cursor = event.cursor;
              options.onEvent(event);
            }
          }
        }
      } catch (error: unknown) {
        if (options.signal.aborted) {
          break;
        }
        if (error instanceof ApiError && error.status < 500) {
          throw error;
        }
        const reconnectError = error instanceof Error ? error : new Error(String(error));
        options.onReconnect?.(reconnectError);
      }

      if (!options.signal.aborted) {
        await delay(300, options.signal);
      }
    }

    return cursor;
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? `: ${error.message}` : '';
      throw new ApiError(
        `Cannot reach agent-room daemon at ${this.#baseUrl}${detail}`,
        503,
        'daemon_unreachable',
      );
    }

    if (!response.ok) {
      throw await this.#responseError(response);
    }
    return (await response.json()) as T;
  }

  async #responseError(response: Response): Promise<ApiError> {
    let payload: ErrorResponse = {};
    try {
      payload = (await response.json()) as ErrorResponse;
    } catch {
      // A non-JSON response still becomes a useful status-based error.
    }
    return new ApiError(
      payload.error?.message ?? `Request failed with HTTP ${response.status}.`,
      response.status,
      payload.error?.code ?? 'request_failed',
    );
  }
}
