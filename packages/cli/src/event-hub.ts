import { EventEmitter } from 'node:events';
import type { RoomEvent } from './domain.js';

export class EventHub {
  readonly #emitter = new EventEmitter();

  public constructor() {
    this.#emitter.setMaxListeners(0);
  }

  public publish(event: RoomEvent): void {
    this.#emitter.emit(event.roomId, event);
  }

  public subscribe(roomId: string, listener: (event: RoomEvent) => void): () => void {
    this.#emitter.on(roomId, listener);
    return () => this.#emitter.off(roomId, listener);
  }
}
