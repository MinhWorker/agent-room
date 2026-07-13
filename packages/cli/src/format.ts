import type { Message, RoomEvent } from './domain.js';

export function formatMessage(message: Message): string {
  const reply = message.replyTo === null ? '' : ` reply-to=${message.replyTo}`;
  return `[${message.cursor}] ${message.createdAt} ${message.sender}: ${message.body}${reply} id=${message.id}`;
}

export function formatEvent(event: RoomEvent): string {
  switch (event.type) {
    case 'room.created':
      return `[${event.cursor}] room created: ${event.payload.room.name}`;
    case 'participant.joined':
      return `[${event.cursor}] ${event.payload.participant.name} joined`;
    case 'participant.left':
      return `[${event.cursor}] ${event.payload.participant.name} left`;
    case 'message.created':
      return formatMessage(event.payload.message);
  }
}
