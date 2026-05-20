import { describe, expect, it } from "vitest";
import type { AuthMethod, Host } from "../types/config";
import {
  PASSWORD_REMOTE_COMMAND_CHANNEL_REASON,
  PASSWORD_REMOTE_INTERACTIVE_ONLY_LABEL,
  nativeTmuxDisabledReason,
  supportsNativeTmuxCommands,
} from "./remotePolicy";

function host(authMethod: AuthMethod): Host {
  return {
    id: `host-${authMethod}`,
    label: authMethod,
    address: "example.internal",
    port: 22,
    username: "storysq",
    auth_method: authMethod,
    detach_other_clients: false,
    clipboard_policy: "allow",
  };
}

describe("remote tmux command policy", () => {
  it("keeps password-auth remotes interactive-only for beta", () => {
    expect(supportsNativeTmuxCommands(host("password"))).toBe(false);
    expect(nativeTmuxDisabledReason(host("password"), "Rename")).toBe(
      "Rename require key/agent/alias auth until password sessions have a command channel.",
    );
    expect(PASSWORD_REMOTE_INTERACTIVE_ONLY_LABEL).toBe("remote interactive-only");
    expect(PASSWORD_REMOTE_COMMAND_CHANNEL_REASON).toContain("command channel");
  });

  it("allows native tmux commands for local, keyfile, and agent auth", () => {
    for (const method of ["local", "keyfile", "agent"] as const) {
      expect(supportsNativeTmuxCommands(host(method))).toBe(true);
      expect(nativeTmuxDisabledReason(host(method))).toBeUndefined();
    }
  });
});
