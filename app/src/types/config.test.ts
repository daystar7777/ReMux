import { describe, it, expect } from "vitest";
import { validateHost, validateProfile } from "./config";

describe("validateHost", () => {
  it("passes validation for valid local host configuration", () => {
    const validLocal = {
      label: "My Localhost",
      auth_method: "local" as const,
    };
    expect(validateHost(validLocal)).toBeNull();
  });

  it("fails if host label/name is missing or empty whitespace", () => {
    expect(validateHost({ label: "" })).toBe("Host name/label is required");
    expect(validateHost({ label: "   " })).toBe("Host name/label is required");
  });

  it("fails if remote host is missing address", () => {
    const invalidRemote = {
      label: "Remote Box",
      auth_method: "password" as const,
      address: "",
    };
    expect(validateHost(invalidRemote)).toBe("Address is required for remote hosts");
  });

  it("fails if remote host has an invalid port range", () => {
    const invalidPortLow = {
      label: "Remote Box",
      auth_method: "password" as const,
      address: "1.2.3.4",
      port: 0,
    };
    const invalidPortHigh = {
      label: "Remote Box",
      auth_method: "password" as const,
      address: "1.2.3.4",
      port: 65536,
    };
    expect(validateHost(invalidPortLow)).toBe("Port must be between 1 and 65535");
    expect(validateHost(invalidPortHigh)).toBe("Port must be between 1 and 65535");
  });

  it("fails if remote keyfile host is missing key path", () => {
    const missingKey = {
      label: "Secure Node",
      auth_method: "keyfile" as const,
      address: "192.168.1.100",
      port: 22,
      key_path: "",
    };
    expect(validateHost(missingKey)).toBe("Private key path or SSH config alias is required when auth method is keyfile");
  });

  it("passes keyfile validation when an SSH config alias supplies identity details", () => {
    const aliasOnly = {
      label: "Config Alias",
      auth_method: "keyfile" as const,
      address: "ignored-by-alias.example",
      port: 22,
      key_path: "",
      ssh_config_alias: "prod-api",
    };
    expect(validateHost(aliasOnly)).toBeNull();
  });

  it("passes validation for a valid remote host config", () => {
    const validRemote = {
      label: "Main Server",
      auth_method: "keyfile" as const,
      address: "ssh.example.com",
      port: 2222,
      key_path: "~/.ssh/id_ed25519",
    };
    expect(validateHost(validRemote)).toBeNull();
  });
});

describe("validateProfile", () => {
  it("fails if display alias is missing", () => {
    const invalid = {
      display_alias: "",
      host_id: "host_1",
      tmux_session_name: "dev",
    };
    expect(validateProfile(invalid)).toBe("Profile display alias is required");
  });

  it("fails if target host is not selected", () => {
    const invalid = {
      display_alias: "Production Logs",
      host_id: "",
      tmux_session_name: "dev",
    };
    expect(validateProfile(invalid)).toBe("Please select a target host");
  });

  it("fails if tmux session name is missing", () => {
    const invalid = {
      display_alias: "Production Logs",
      host_id: "host_123",
      tmux_session_name: "  ",
    };
    expect(validateProfile(invalid)).toBe("Tmux session name is required");
  });

  it("passes validation for a fully valid profile configuration", () => {
    const valid = {
      display_alias: "Work Session",
      host_id: "host_999",
      tmux_session_name: "remux-main",
    };
    expect(validateProfile(valid)).toBeNull();
  });
});
