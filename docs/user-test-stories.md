# REMUX User Test Stories

These are the high-frequency paths I used as the current practical user-story gate.

## Story 1: First Local Workspace

A user creates or selects a local host profile, opens a workspace, and lands in one reusable tab backed by the configured tmux session.

Coverage: `app/src/userStories.test.ts` verifies profile-to-tab creation, duplicate-open reuse, active tab selection, and initial leaf layout.

## Story 2: Attach or Create Tmux Target

A user expects REMUX to attach to the configured tmux session/window if it exists, or create it if it does not, without detaching other clients unless explicitly configured.

Coverage: `app/src/userStories.test.ts`, `app/src/lib/tmux.test.ts`, and Rust `tmux` tests verify the command shape, socket/window support, and detach-others ordering.

## Story 3: Daily Pane Layout Work

A user splits panes, moves focus, closes individual panes, and only loses the tab after the final pane closes.

Coverage: `app/src/userStories.test.ts`, `app/src/state/atoms.test.ts`, and `app/src/lib/tmuxLayout.test.ts` verify split/close/focus behavior and layout parsing.

## Story 4: Multi-Workspace Preferences

A user switches between workspaces and expects mouse policy, layout, and active pane state to remain scoped to that workspace.

Coverage: `app/src/userStories.test.ts` and `app/src/state/atoms.test.ts` verify per-tab mouse policy and workspace cleanup.

## Story 5: Safe Profile Save

A user enters a tmux session name in the profile form and should receive frontend validation before a backend config save fails.

Coverage: `app/src/userStories.test.ts`, `app/src/types/config.test.ts`, and Rust config tests now share the same allowed session-name contract: letters, numbers, dots, underscores, and hyphens.

## Story 6: Password Host Native Tmux Support

A user can attach to a password-auth host interactively, AND native tmux actions (split, layout, rename, kill) work because REMUX auto-provisions a key on first connect to open a command channel.

Coverage: `app/src/userStories.test.ts` and `app/src/lib/remotePolicy.test.ts` verify that `supportsNativeTmuxCommands` returns true and `nativeTmuxDisabledReason` returns no blocking reason for both local and password hosts.

History: an earlier revision of REMUX gated native tmux commands behind key/agent/alias auth only; the current build relaxes that gate after the key auto-provisioning flow landed.

## Story 7: Release Gate Confidence

A maintainer runs the release gate and gets frontend tests, Rust tests, bundle verification, local tmux smoke, and optional real remote SSH/tmux smoke.

Coverage: `app/scripts/verify-release.sh` is the executable gate. Remote proof remains optional and explicitly skipped unless `REMUX_REMOTE_SMOKE_HOST` is set.
