import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:7337';

export function defaultDatabasePath(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agent-room', 'agent-room.db');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'agent-room', 'agent-room.db');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'agent-room', 'agent-room.db');
}
