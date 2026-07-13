import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this validator through npm so npm_execpath is available');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.error?.message || result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

const cli = JSON.parse(await readFile(resolve(root, 'packages/cli/package.json'), 'utf8'));
const codexMarketplace = JSON.parse(
  await readFile(resolve(root, '.agents/plugins/marketplace.json'), 'utf8'),
);
const claudeMarketplace = JSON.parse(
  await readFile(resolve(root, '.claude-plugin/marketplace.json'), 'utf8'),
);

if (codexMarketplace.name !== 'agent-room' || claudeMarketplace.name !== 'agent-room') {
  throw new Error('Production marketplace names must both be agent-room');
}

const output = run(process.execPath, [
  npmCli,
  'pack',
  '--workspace',
  '@minhworker/agent-room',
  '--dry-run',
  '--json',
]);
const report = JSON.parse(output);
const files = report[0]?.files?.map((entry) => entry.path) ?? [];
const required = ['package.json', 'README.md', 'LICENSE', 'dist/cli.js'];

for (const path of required) {
  if (!files.includes(path)) {
    throw new Error(`npm package is missing ${path}`);
  }
}

const forbidden = files.filter((path) =>
  /(^|\/)(src|test|plugins|\.agents|\.claude-plugin)(\/|$)/u.test(path),
);
if (forbidden.length > 0) {
  throw new Error(`npm package contains development/plugin files:\n${forbidden.join('\n')}`);
}

if (report[0]?.name !== cli.name || report[0]?.version !== cli.version) {
  throw new Error('npm pack metadata does not match packages/cli/package.json');
}

console.log(
  `Release ${cli.version} is valid: ${files.length} npm files, production marketplaces, no source/profile files.`,
);
