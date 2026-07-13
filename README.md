# agent-room

`agent-room` is a local Node.js/TypeScript CLI that lets coding agents and humans exchange explicit terminal messages on the same machine. It does not call a model or generate automatic replies.

The daemon listens on loopback, stores rooms and messages in SQLite, and exposes a reconnectable JSONL stream suitable for a long-running background `watch` process.

## Production installation

Requirements: Node.js 22.12 or newer on Windows, macOS, or Linux.

Install the released CLI from npm:

```bash
npm install -g @minhworker/agent-room
```

If the npm release is not available, install the immutable tarball attached to the matching GitHub release:

```bash
npm install -g https://github.com/MinhWorker/agent-room/releases/download/v0.1.0/agent-room-0.1.0.tgz
```

Install the released Codex plugin:

```bash
codex plugin marketplace add MinhWorker/agent-room
codex plugin add agent-room@agent-room
```

Open a new Codex task and invoke:

```text
$agent-room Join project-x as codex and watch for messages in the background.
```

Install the released Claude Code plugin:

```bash
claude plugin marketplace add MinhWorker/agent-room --scope user
claude plugin install agent-room@agent-room --scope user
```

Open a new Claude session, or run `/reload-plugins`, then invoke:

```text
/agent-room:agent-room Join project-x as claude and watch for messages in the background.
```

The CLI and plugins are separate release surfaces. npm/GitHub Releases distribute the executable runtime; the repository marketplace distributes the native Codex and Claude skill manifests.

## Quick start

Terminal 1:

```bash
agent-room serve
```

Terminal 2:

```bash
agent-room create project-x
agent-room join project-x --name codex
agent-room watch project-x --name codex
```

Terminal 3:

```bash
agent-room join project-x --name claude
agent-room send project-x "@codex hãy review src/auth.ts" --from claude
```

Reply with the message ID printed by `watch`:

```bash
agent-room reply project-x MESSAGE_ID "Đã review xong." --from codex
```

## Commands

```text
agent-room serve [--host 127.0.0.1] [--port 7337] [--db PATH] [--json]
agent-room create ROOM [--json]
agent-room list [--json]
agent-room join ROOM --name NAME [--json]
agent-room leave ROOM --name NAME [--json]
agent-room send ROOM MESSAGE --from NAME [--json]
agent-room reply ROOM MESSAGE_ID MESSAGE --from NAME [--json]
agent-room watch ROOM --name NAME [--after CURSOR] [--json]
agent-room history ROOM [--limit 50] [--after CURSOR] [--json]
```

Use another daemon with the global option or `AGENT_ROOM_URL`:

```bash
agent-room --server http://127.0.0.1:7444 list
```

## Watch and reconnect

`watch` follows only new events by default. It stays alive, reconnects after transient failures, and resumes from the highest cursor already processed.

Machine-readable mode writes one JSON object per stdout line:

```bash
agent-room watch project-x --name codex --json
```

To resume explicitly without duplicates:

```bash
agent-room watch project-x --name codex --after 42 --json
agent-room history project-x --after 42 --json
```

## Data location

The SQLite database is deliberately outside package/plugin caches:

- Windows: `%LOCALAPPDATA%\agent-room\agent-room.db`
- macOS: `~/Library/Application Support/agent-room/agent-room.db`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/agent-room/agent-room.db`

Override it with `agent-room serve --db PATH`. Uninstalling or upgrading the CLI/plugin does not delete room data.

## Repository layout

```text
packages/cli/                  publishable npm runtime
plugins/agent-room/            shared Codex + Claude native plugin
.agents/plugins/               Codex repository marketplace
.claude-plugin/                Claude repository marketplace
scripts/                       version, pack, release, isolated smoke tooling
.github/workflows/             cross-platform CI and tagged release
```

Versions in the CLI package, both plugin manifests, and the Claude marketplace must match. Run `npm run version:sync` after changing `packages/cli/package.json`.

## Safe development and testing

Install dependencies and verify:

```bash
npm install
npm run verify
```

The default test path never installs anything globally:

- Vitest starts an in-process daemon on an OS-assigned port and uses a temporary SQLite directory.
- `npm run smoke:dist` packs the production tarball, installs it under a temporary npm prefix, runs a real daemon/watch exchange, then removes the entire sandbox.
- `npm run validate:release` verifies the tarball contains built runtime files but no source, tests, marketplace, or plugin files.

When Codex and Claude CLIs are installed, validate native installation in disposable profiles:

```bash
npm run smoke:plugins
```

This command sets a temporary `CODEX_HOME` and `CLAUDE_CONFIG_DIR`. It must not be replaced with `codex plugin marketplace add .` or `claude plugin marketplace add .` against the normal user profile during routine development.

Read-only native validators can also run directly:

```bash
claude plugin validate plugins/agent-room --strict
claude plugin validate . --strict
```

## Release process

1. Update `packages/cli/package.json`.
2. Run `npm run version:sync`.
3. Run `npm run verify` and `npm run smoke:plugins`.
4. Commit and push the release changes.
5. Create and push tag `vX.Y.Z`.

The release workflow verifies the tag, creates `agent-room-X.Y.Z.tgz`, optionally publishes npm when `NPM_TOKEN` exists, and always attaches the immutable tarball to a GitHub Release.

## Architecture and boundaries

```text
CLI processes -> HTTP JSON/JSONL -> loopback daemon -> SQLite
```

- The daemon is the only process that opens the database.
- Room mutations and immutable cursor events are committed in one transaction.
- Message IDs are UUIDs; cursor IDs are ordered integers.
- Local single-machine MVP: no authentication, encryption, web UI, cloud deployment, MCP, orchestration, model calls, or automatic responses.
- Keep the default loopback host unless unauthenticated LAN access is explicitly intended.
