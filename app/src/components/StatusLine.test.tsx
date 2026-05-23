import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusLine } from "./StatusLine";
import {
  activeTabIdAtom,
  clipboardAtom,
  configAtom,
  imeComposingAtom,
  localeWarningAtom,
  mousePolicyAtom,
  openTabsAtom,
  type OpenTab,
} from "../state/atoms";
import { summarize } from "../lib/clipboard";
import { REMOTE_UTF8_LOCALE_FIX } from "../lib/locale";
import { clipboardWrite } from "../lib/ipc";
import type { AppConfig, Host, Profile } from "../types/config";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/ipc", () => ({
  clipboardWrite: vi.fn(async () => {}),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const passwordHost: Host = {
  id: "host-password",
  label: "Password Host",
  address: "example.internal",
  port: 22,
  username: "storysq",
  auth_method: "password",
  detach_other_clients: false,
  clipboard_policy: "allow",
};

const keyHost: Host = {
  id: "host-key",
  label: "Key Host",
  address: "key.example.internal",
  port: 2222,
  username: "storysq",
  auth_method: "keyfile",
  key_path: "/Users/storysq/.ssh/id_ed25519",
  detach_other_clients: false,
  clipboard_policy: "allow",
};

function makeProfile(host: Host): Profile {
  return {
    id: `profile-${host.id}`,
    host_id: host.id,
    display_alias: `${host.label} remux`,
    tmux_session_name: "remux-dev",
  };
}

function renderStatusLine(host: Host): ReturnType<typeof createStore> {
  const profile = makeProfile(host);
  const tab: OpenTab = {
    id: "tab-1",
    profileId: profile.id,
    state: "connected",
    mousePolicy: "remux",
    activePaneId: "pane-1",
    layout: { type: "leaf", id: "pane-1", ptyId: "pty-1" },
  };
  const config: AppConfig = {
    version: 1,
    hosts: [host],
    profiles: [profile],
  };
  const store = createStore();
  store.set(configAtom, config);
  store.set(openTabsAtom, [tab]);
  store.set(activeTabIdAtom, tab.id);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <Provider store={store}>
        <StatusLine />
      </Provider>,
    );
  });
  return store;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("StatusLine remote auth policy", () => {
  it("does not show password-auth remote as interactive-only anymore and still allows toggling mouse policy to tmux", () => {
    const store = renderStatusLine(passwordHost);

    expect(document.body.textContent).not.toContain("remote interactive-only");
    expect(document.body.textContent).toContain("mouse\u00a0REMUX");

    const mouseButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("mouse"),
    ) as HTMLButtonElement | undefined;
    expect(mouseButton).toBeTruthy();
    expect(mouseButton?.disabled).toBe(false);

    act(() => {
      mouseButton?.click();
    });
    expect(store.get(mousePolicyAtom)).toBe("tmux");
  });

  it("allows tmux mouse handoff for key-auth remote hosts", () => {
    const store = renderStatusLine(keyHost);

    expect(document.body.textContent).not.toContain("remote interactive-only");

    const mouseButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("mouse"),
    ) as HTMLButtonElement | undefined;
    expect(mouseButton).toBeTruthy();
    expect(mouseButton?.disabled).toBe(false);

    act(() => {
      mouseButton?.click();
    });
    expect(store.get(mousePolicyAtom)).toBe("tmux");
  });
});

describe("StatusLine clipboard and IME indicators", () => {
  it("renders the current clipboard summary and IME composition state", () => {
    const store = renderStatusLine(keyHost);

    act(() => {
      store.set(clipboardAtom, summarize("remux clipboard smoke\nline 2"));
      store.set(imeComposingAtom, true);
    });

    expect(document.body.textContent).toContain("remux clipboard smoke");
    expect(document.body.textContent).toContain("+1 lines");
    expect(document.body.textContent).toContain("ime composing");
  });

  it("renders locale warnings for remote Unicode safety", () => {
    const store = renderStatusLine(keyHost);

    act(() => {
      store.set(localeWarningAtom, "locale non-UTF-8 LANG=C LC_CTYPE=POSIX");
    });

    expect(document.body.textContent).toContain("locale non-UTF-8 LANG=C LC_CTYPE=POSIX");
  });

  it("copies a UTF-8 locale fix from the locale warning action", async () => {
    const store = renderStatusLine(keyHost);

    act(() => {
      store.set(localeWarningAtom, "locale non-UTF-8 LANG=C LC_CTYPE=POSIX");
    });

    const copyButton = document.querySelector(
      'button[aria-label="Copy UTF-8 locale fix"]',
    ) as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton?.click();
    });

    expect(clipboardWrite).toHaveBeenCalledWith(REMOTE_UTF8_LOCALE_FIX);
    expect(store.get(clipboardAtom).preview).toContain("export LANG=en_US.UTF-8");
  });

  it("redacts secret-shaped clipboard previews in the status line", () => {
    const store = renderStatusLine(keyHost);

    act(() => {
      store.set(clipboardAtom, summarize("ghp_1234567890abcdefghij1234567890ABCD"));
    });

    expect(document.body.textContent).toContain("[CLIPBOARD: Redacted Secret]");
    expect(document.body.textContent).not.toContain("ghp_1234567890");
  });
});
