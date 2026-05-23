import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTabsAtom } from "../state/atoms";
import { TerminalGrid } from "./TerminalGrid";
import type { PaneLayout } from "../state/atoms";

const xtermMock = vi.hoisted(() => {
  class MockTerminal {
    static instances: MockTerminal[] = [];
    textarea: HTMLTextAreaElement | null = null;
    options: Record<string, unknown> = {};
    parser = { registerCsiHandler: () => ({ dispose: () => {} }) };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      MockTerminal.instances.push(this);
    }

    loadAddon() {}
    open(container: HTMLElement) {
      this.textarea = document.createElement("textarea");
      this.textarea.setAttribute("aria-label", "mock xterm textarea");
      container.appendChild(this.textarea);
    }
    write() {}
    focus() {}
    dispose() {}
    attachCustomKeyEventHandler() {}
    onData() { return { dispose: () => {} }; }
    onResize() { return { dispose: () => {} }; }
  }
  return { MockTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xtermMock.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/ipc", () => ({
  clipboardRead: vi.fn(async () => ""),
  clipboardWrite: vi.fn(async () => {}),
  logDebug: vi.fn(async () => {}),
}));

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  xtermMock.MockTerminal.instances.length = 0;
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: MockResizeObserver,
  });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("TerminalGrid Phantom Focus Guard verification", () => {
  it("scientifically proves that phantom focus drops are blocked while genuine user clicks transition active state correctly", async () => {
    const store = createStore();
    const tabId = "test_tab";
    const pane0Id = "pane_0";
    const pane1Id = "pane_1";

    const layout: PaneLayout = {
      type: "column",
      id: "split_root",
      children: [
        { type: "leaf", id: pane0Id, ptyId: null },
        { type: "leaf", id: pane1Id, ptyId: null },
      ],
    };

    store.set(openTabsAtom, [
      {
        id: tabId,
        profileId: "prof_1",
        state: "connected",
        layout,
        activePaneId: pane1Id, // Initially focus is on Pane 1
      },
    ]);

    const termHandlesRef = { current: new Map() };
    const onInput = vi.fn();
    const onResize = vi.fn();
    const onDoubleClick = vi.fn();
    const onPasteRequested = vi.fn();
    const onPaneCreated = vi.fn();
    const onPaneSelect = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Provider store={store}>
          <TerminalGrid
            tabId={tabId}
            layout={layout}
            activePaneId={pane1Id}
            termHandlesRef={termHandlesRef}
            onInput={onInput}
            onResize={onResize}
            onDoubleClick={onDoubleClick}
            onPasteRequested={onPasteRequested}
            onPaneCreated={onPaneCreated}
            localEcho={false}
            onPaneSelect={onPaneSelect}
          />
        </Provider>
      );
    });

    // Verify both terminals are mounted
    expect(xtermMock.MockTerminal.instances.length).toBe(2);
    const term0 = xtermMock.MockTerminal.instances[0]; // Pane 0
    const term1 = xtermMock.MockTerminal.instances[1]; // Pane 1

    const term1FocusSpy = vi.spyOn(term1, "focus");

    // SCENARIO A: Phantom Focus Event (Telemetry Sync Focus Hijack Simulation)
    // The browser automatically slips focus to Pane 0's textarea.
    // There was NO user interaction (mousedown/keydown) on Pane 0.
    act(() => {
      term0.textarea?.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    });

    // Proves that the active state remains on Pane 1 and did NOT get hijacked to Pane 0.
    const tabStateAfterPhantom = store.get(openTabsAtom)[0];
    expect(tabStateAfterPhantom.activePaneId).toBe(pane1Id); // Stays at Pane 1
    expect(onPaneSelect).not.toHaveBeenCalled();
    // Proves that focus was forcefully recalled back to the active Pane 1!
    expect(term1FocusSpy).toHaveBeenCalled();

    // SCENARIO B: Genuine User Interaction
    // The user physically clicks (mousedown) on Pane 0 wrapper.
    const pane0Wrapper = container?.querySelector(`[data-pane-id="${pane0Id}"]`);
    expect(pane0Wrapper).toBeDefined();

    act(() => {
      pane0Wrapper?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      // Immediately after clicking, xterm.js focus event triggers
      term0.textarea?.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    });

    // Proves that active focus successfully switches to Pane 0 under real user interaction.
    const tabStateAfterRealClick = store.get(openTabsAtom)[0];
    expect(tabStateAfterRealClick.activePaneId).toBe(pane0Id); // Transferred to Pane 0
    expect(onPaneSelect).toHaveBeenCalledWith(pane0Id);
  });
});
