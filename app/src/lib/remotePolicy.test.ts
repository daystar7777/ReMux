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
  it("allows password-auth remotes to leverage native command channel via auto key provisioning", () => {
    expect(supportsNativeTmuxCommands(host("password"))).toBe(true);
    expect(nativeTmuxDisabledReason(host("password"), "Rename")).toBeUndefined();
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
