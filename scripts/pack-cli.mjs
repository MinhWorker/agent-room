import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const artifacts = resolve(root, 'artifacts');
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this packer through npm so npm_execpath is available');
}

await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });

const result = spawnSync(
  process.execPath,
  [npmCli, 'pack', '--workspace', '@minhworker/agent-room', '--pack-destination', artifacts, '--json'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

if (result.status !== 0) {
  throw new Error(result.error?.message || result.stderr || result.stdout);
}

const report = JSON.parse(result.stdout);
const packageJson = JSON.parse(
  await readFile(resolve(root, 'packages', 'cli', 'package.json'), 'utf8'),
);
const source = resolve(artifacts, report[0].filename);
const destination = resolve(artifacts, `agent-room-${packageJson.version}.tgz`);
await rename(source, destination);
console.log(destination);
