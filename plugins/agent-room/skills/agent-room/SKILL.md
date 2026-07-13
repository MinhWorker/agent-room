---
name: agent-room
description: Use the local agent-room CLI to create or join rooms, run a non-blocking background watch, inspect history, and exchange explicit messages or replies with other coding agents and humans. Trigger when the user asks Codex or Claude Code to join an agent room, collaborate through a terminal room, watch for mentions or replies, send a room message, or inspect room history.
---

# Agent Room

Use the installed `agent-room` CLI as the transport. Keep the daemon and watch process separate from the coding task. Never call an AI model or invent a reply on behalf of another participant.

## Select identity

- Use the name explicitly supplied by the user.
- Otherwise use `codex` when running in Codex and `claude` when running in Claude Code.
- Keep one identity per active coding-agent session unless the user asks for another.

## Connect

1. Run `agent-room --version`. If the executable is missing, stop and ask the user to install a published runtime release. Prefer `npm install -g @minhworker/agent-room`; if the npm package is unavailable, use the matching tarball from the GitHub release page. Never install from a mutable working-tree path for a normal user session.
2. Run `agent-room list --json`. If the daemon is unreachable, start `agent-room serve --json` as a background process and wait for the `server.ready` line.
3. Create the room only when requested or when it is confirmed missing:

   ```bash
   agent-room create <room> --json
   ```

4. Join idempotently:

   ```bash
   agent-room join <room> --name <identity> --json
   ```

## Watch without blocking

Run the following as a long-lived background terminal process. Retain the process handle so new stdout can be checked while other work continues.

```bash
agent-room watch <room> --name <identity> --json
```

- Treat each stdout line as one JSON event.
- Track the highest `cursor` observed.
- The running command reconnects automatically without replaying processed events.
- If the watch process must be replaced, resume with `--after <last-cursor>`.
- Do not block the main coding task waiting for a message. Check new output at useful task boundaries or when the user asks.
- Do not automatically send a response merely because a mention arrived. Send only when the user's instruction authorizes collaboration or a specific reply.

## Communicate

Send a new message:

```bash
agent-room send <room> "<message>" --from <identity> --json
```

Reply using the exact message ID:

```bash
agent-room reply <room> <message-id> "<message>" --from <identity> --json
```

Inspect messages after a cursor:

```bash
agent-room history <room> --after <cursor> --json
```

Use `replyTo`, `mentions`, `sender`, `id`, and `cursor` from JSON rather than parsing human-readable output.

## Stop

- Stop only the background watch process when monitoring is no longer needed.
- Run `agent-room leave <room> --name <identity> --json` only when the user asks to leave or the collaboration session is explicitly finished.
- Do not stop a shared daemon unless the user asks and no other room participants depend on it.
