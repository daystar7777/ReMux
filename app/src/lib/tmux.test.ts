import { describe, expect, it } from "vitest";
import {
  attachOrCreateCommand,
  listPanesFormat,
  parsePaneRow,
  parseTmuxVersion,
  supportsModernMouse,
  supportsUserOptions,
} from "./tmux";

describe("tmux helpers", () => {
  it("parses version", () => {
    const v = parseTmuxVersion("tmux 3.5a");
    expect(v).toBeTruthy();
    expect(v!.major).toBe(3);
    expect(v!.minor).toBe(5);
    expect(supportsModernMouse(v!)).toBe(true);
    expect(supportsUserOptions(v!)).toBe(true);
  });

  it("flags legacy", () => {
    const v = parseTmuxVersion("tmux 2.0");
    expect(supportsModernMouse(v!)).toBe(false);
    expect(supportsUserOptions(v!)).toBe(false);
  });

  it("builds attach with chained mouse-off and no detach-others", () => {
    const cmd = attachOrCreateCommand({ session: "dev" });
    expect(cmd).toEqual([
      "tmux",
      "new-session",
      "-A",
      "-s",
      "dev",
      ";",
      "set-option",
      "-t",
      "dev",
      "mouse",
      "off",
    ]);
  });

  it("emits -D for detach-others before -s", () => {
    const cmd = attachOrCreateCommand({ session: "dev", detachOthers: true });
    expect(cmd).toEqual([
      "tmux",
      "new-session",
      "-A",
      "-D",
      "-s",
      "dev",
      ";",
      "set-option",
      "-t",
      "dev",
      "mouse",
      "off",
    ]);
  });

  it("supports socket and window targets and still chains mouse off", () => {
    const cmd = attachOrCreateCommand({
      session: "logs",
      window: "api",
      socketPath: "/tmp/tmux-501/default",
      tmuxBinary: "/opt/homebrew/bin/tmux",
    });
    expect(cmd[0]).toBe("/opt/homebrew/bin/tmux");
    expect(cmd).toContain("-S");
    expect(cmd).toContain("/tmp/tmux-501/default");
    expect(cmd).toContain("-n");
    expect(cmd).toContain("api");
    expect(cmd.slice(-6)).toEqual([
      ";",
      "set-option",
      "-t",
      "logs",
      "mouse",
      "off",
    ]);
  });

  it("parses a pane row", () => {
    const row = ["%14", "@5", "$2", "dev", "0", "main", "e117,112x36,0,0,85", "1", "vim", "12345", "vim", "/Users/me"].join("\t");
    const pane = parsePaneRow(row);
    expect(pane).toBeTruthy();
    expect(pane!.pane_id).toBe("%14");
    expect(pane!.session_name).toBe("dev");
    expect(pane!.window_layout).toBe("e117,112x36,0,0,85");
    expect(pane!.pane_index).toBe(1);
    expect(pane!.pane_pid).toBe(12345);
    expect(pane!.pane_current_path).toBe("/Users/me");
  });

  it("parses a legacy pane row without window layout", () => {
    const row = ["%14", "@5", "$2", "dev", "0", "main", "1", "vim", "12345", "vim", "/Users/me"].join("\t");
    const pane = parsePaneRow(row);
    expect(pane).toBeTruthy();
    expect(pane!.window_layout).toBeUndefined();
    expect(pane!.pane_index).toBe(1);
  });

  it("emits a stable list-panes format", () => {
    expect(listPanesFormat()).toContain("#{pane_id}");
    expect(listPanesFormat()).toContain("#{session_name}");
    expect(listPanesFormat()).toContain("#{window_layout}");
  });
});
