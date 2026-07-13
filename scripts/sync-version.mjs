import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2] ?? '--check';

if (!['--check', '--write'].includes(mode)) {
  throw new Error('Usage: node scripts/sync-version.mjs [--check|--write]');
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

const cliPath = 'packages/cli/package.json';
const codexPath = 'plugins/agent-room/.codex-plugin/plugin.json';
const claudePath = 'plugins/agent-room/.claude-plugin/plugin.json';
const marketplacePath = '.claude-plugin/marketplace.json';

const cli = await readJson(cliPath);
const codex = await readJson(codexPath);
const claude = await readJson(claudePath);
const marketplace = await readJson(marketplacePath);
const marketplacePlugin = marketplace.plugins?.find((plugin) => plugin.name === 'agent-room');

if (!marketplacePlugin) {
  throw new Error('Claude marketplace is missing the agent-room entry');
}

const mismatches = [
  [codexPath, codex.version],
  [claudePath, claude.version],
  [marketplacePath, marketplacePlugin.version],
].filter(([, version]) => version !== cli.version);

if (mode === '--write') {
  codex.version = cli.version;
  claude.version = cli.version;
  marketplacePlugin.version = cli.version;
  await Promise.all([
    writeJson(codexPath, codex),
    writeJson(claudePath, claude),
    writeJson(marketplacePath, marketplace),
  ]);
  console.log(`Synchronized release version ${cli.version}.`);
} else if (mismatches.length > 0) {
  const details = mismatches.map(([path, version]) => `${path}: ${String(version)}`).join('\n');
  throw new Error(`Release versions must equal CLI version ${cli.version}:\n${details}`);
} else {
  console.log(`Release versions are synchronized at ${cli.version}.`);
}
