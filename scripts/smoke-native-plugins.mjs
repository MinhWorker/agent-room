import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const requireTools = process.argv.includes('--require-tools');
const directory = await mkdtemp(join(tmpdir(), 'agent-room-plugin-smoke-'));
const codexName = process.platform === 'win32' ? 'codex.cmd' : 'codex';
const claudeName = process.platform === 'win32' ? 'claude.exe' : 'claude';

function locate(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [command], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/u).find((line) => line.length > 0);
}

function run(tool, args, env) {
  const fullArgs = [...tool.args, ...args];
  const result = spawnSync(tool.command, fullArgs, {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `${tool.command} ${fullArgs.join(' ')} failed:\n${result.error?.message || result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

try {
  const codexPath = locate(codexName);
  const claudePath = locate(claudeName);
  const missing = [
    !codexPath ? 'codex' : undefined,
    !claudePath ? 'claude' : undefined,
  ].filter(Boolean);
  if (missing.length > 0) {
    if (requireTools) {
      throw new Error(`Missing native CLIs: ${missing.join(', ')}`);
    }
    console.log(`Skipped native plugin smoke; missing: ${missing.join(', ')}.`);
    process.exitCode = 0;
  } else {
    const codex = process.platform === 'win32'
      ? {
          command: process.execPath,
          args: [join(dirname(codexPath), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')],
        }
      : { command: codexPath, args: [] };
    const claude = { command: claudePath, args: [] };
    const codexHome = join(directory, 'codex-home');
    const claudeConfig = join(directory, 'claude-config');
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      mkdir(claudeConfig, { recursive: true }),
    ]);

    const codexEnv = { ...process.env, CODEX_HOME: codexHome };
    run(codex, ['plugin', 'marketplace', 'add', root, '--json'], codexEnv);
    run(codex, ['plugin', 'add', 'agent-room@agent-room', '--json'], codexEnv);
    const codexList = JSON.parse(
      run(codex, ['plugin', 'list', '--marketplace', 'agent-room', '--json'], codexEnv),
    );
    if (codexList.installed?.[0]?.pluginId !== 'agent-room@agent-room') {
      throw new Error('Codex sandbox did not install agent-room@agent-room');
    }

    const claudeEnv = { ...process.env, CLAUDE_CONFIG_DIR: claudeConfig };
    run(claude, ['plugin', 'validate', join(root, 'plugins', 'agent-room'), '--strict'], claudeEnv);
    run(claude, ['plugin', 'validate', root, '--strict'], claudeEnv);
    run(claude, ['plugin', 'marketplace', 'add', root, '--scope', 'user'], claudeEnv);
    run(claude, ['plugin', 'install', 'agent-room@agent-room', '--scope', 'user'], claudeEnv);
    const claudeList = JSON.parse(run(claude, ['plugin', 'list', '--json'], claudeEnv));
    if (!claudeList.some((plugin) => plugin.id === 'agent-room@agent-room')) {
      throw new Error('Claude sandbox did not install agent-room@agent-room');
    }

    console.log('Native plugin smoke passed in disposable Codex and Claude profiles.');
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
