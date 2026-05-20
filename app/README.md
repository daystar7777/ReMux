# REMUX

macOS-first Tauri + React terminal for SSH-driven tmux attach/create workflows.

## Development

```sh
npm install
npm run dev
```

## Release Verification

Run the full local release gate:

```sh
npm run verify:release
```

The gate performs:

- TypeScript no-emit check
- Vitest frontend tests
- Rust tests
- Tauri `.app` build
- macOS codesign verification
- local tmux split/layout/rename/mouse/kill smoke
- optional remote SSH/tmux smoke

## Optional Remote Smoke

The remote smoke is skipped unless `REMUX_REMOTE_SMOKE_HOST` is set. It requires non-interactive SSH auth because the verifier runs with `BatchMode=yes`.

Minimal key or agent example:

```sh
REMUX_REMOTE_SMOKE_HOST=example.internal \
REMUX_REMOTE_SMOKE_USER=storysq \
npm run verify:release
```

With a non-standard port and key:

```sh
REMUX_REMOTE_SMOKE_HOST=example.internal \
REMUX_REMOTE_SMOKE_USER=storysq \
REMUX_REMOTE_SMOKE_PORT=2222 \
REMUX_REMOTE_SMOKE_KEY="$HOME/.ssh/id_ed25519" \
npm run verify:release
```

With `ProxyJump` and `IdentityAgent` coverage:

```sh
REMUX_REMOTE_SMOKE_HOST=target.internal \
REMUX_REMOTE_SMOKE_USER=storysq \
REMUX_REMOTE_SMOKE_PROXY_JUMP=bastion.example.com \
REMUX_REMOTE_SMOKE_IDENTITY_AGENT="$SSH_AUTH_SOCK" \
npm run verify:release
```

Supported variables:

- `REMUX_REMOTE_SMOKE_HOST`
- `REMUX_REMOTE_SMOKE_USER`
- `REMUX_REMOTE_SMOKE_PORT`
- `REMUX_REMOTE_SMOKE_KEY`
- `REMUX_REMOTE_SMOKE_PROXY_JUMP`
- `REMUX_REMOTE_SMOKE_IDENTITY_AGENT`
- `REMUX_REMOTE_SMOKE_SESSION`
- `REMUX_REMOTE_SMOKE_TMUX`

The remote host must have `tmux` available and must allow key, agent, or ssh-config based non-interactive auth. Password auth is intentionally excluded from this smoke until REMUX has a deliberate password-auth command channel.
