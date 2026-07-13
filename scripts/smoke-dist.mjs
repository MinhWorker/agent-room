import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this smoke test through npm so npm_execpath is available');
}
const directory = await mkdtemp(join(tmpdir(), 'agent-room-dist-smoke-'));
const packDirectory = join(directory, 'pack');
const prefix = join(directory, 'prefix');
let daemon;
let watch;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.error?.message || result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function waitForJsonLine(child, predicate, label) {
  return new Promise((resolveLine, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, 10_000);

    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length === 0) continue;
        try {
          const value = JSON.parse(line);
          if (predicate(value)) {
            cleanup();
            resolveLine(value);
            return;
          }
        } catch {
          // Ignore non-JSON diagnostics; JSONL events are asserted below.
        }
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`${label} process exited early with code ${String(code)}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      child.off('exit', onExit);
    };

    child.stdout?.on('data', onData);
    child.once('exit', onExit);
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not allocate a smoke-test port');
  }
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

try {
  await mkdir(packDirectory, { recursive: true });
  const packed = JSON.parse(
    run(process.execPath, [
      npmCli,
      'pack',
      '--workspace',
      '@minhworker/agent-room',
      '--pack-destination',
      packDirectory,
      '--json',
    ]),
  );
  const tarball = join(packDirectory, packed[0].filename);

  run(process.execPath, [
    npmCli,
    'install',
    '--prefix',
    prefix,
    '--no-audit',
    '--no-fund',
    tarball,
  ]);
  const cli = join(prefix, 'node_modules', '@minhworker', 'agent-room', 'dist', 'cli.js');
  const version = run(process.execPath, [cli, '--version']);
  const port = await freePort();
  const database = join(directory, 'data', 'agent-room.db');

  daemon = spawn(
    process.execPath,
    [cli, 'serve', '--port', String(port), '--db', database, '--json'],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const ready = await waitForJsonLine(daemon, (value) => value.type === 'server.ready', 'daemon');
  const base = ['--server', ready.url];

  run(process.execPath, [cli, ...base, 'create', 'release-smoke', '--json']);
  run(process.execPath, [cli, ...base, 'join', 'release-smoke', '--name', 'codex', '--json']);
  run(process.execPath, [cli, ...base, 'join', 'release-smoke', '--name', 'claude', '--json']);

  watch = spawn(
    process.execPath,
    [cli, ...base, 'watch', 'release-smoke', '--name', 'codex', '--after', '0', '--json'],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await waitForJsonLine(
    watch,
    (value) => value.type === 'participant.joined' && value.payload?.participant?.name === 'codex',
    'watch replay',
  );

  const sent = JSON.parse(
    run(process.execPath, [
      cli,
      ...base,
      'send',
      'release-smoke',
      '@codex release artifact works',
      '--from',
      'claude',
      '--json',
    ]),
  );
  const observed = await waitForJsonLine(
    watch,
    (value) => value.type === 'message.created' && value.payload?.message?.id === sent.id,
    'watched release message',
  );

  if (observed.payload.message.cursor !== sent.cursor) {
    throw new Error('Watch cursor does not match the sent release message');
  }

  console.log(`Isolated release smoke passed for agent-room ${version} at cursor ${sent.cursor}.`);
} finally {
  watch?.kill('SIGTERM');
  daemon?.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
