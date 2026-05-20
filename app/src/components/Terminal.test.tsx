import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imeComposingAtom } from "../state/atoms";
import { Terminal } from "./Terminal";

const xtermMock = vi.hoisted(() => {
  type DataHandler = (data: string) => void;

  class MockTerminal {
    static instances: MockTerminal[] = [];

    textarea: HTMLTextAreaElement | null = null;
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    private dataHandlers: DataHandler[] = [];

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

    onData(handler: DataHandler) {
      this.dataHandlers.push(handler);
      return {
        dispose: () => {
          this.dataHandlers = this.dataHandlers.filter((item) => item !== handler);
        },
      };
    }

    onResize() {
      return { dispose: () => {} };
    }

    getSelection() {
      return "";
    }

    clearSelection() {}

    emitData(data: string) {
      for (const handler of this.dataHandlers) handler(data);
    }
  }

  return { MockTerminal };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMock.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    constructor() {}
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  clipboardRead: vi.fn(async () => ""),
  clipboardWrite: vi.fn(async () => {}),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderTerminal(onInput = vi.fn()) {
  const store = createStore();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <Provider store={store}>
        <Terminal onInput={onInput} />
      </Provider>,
    );
  });
  const term = xtermMock.MockTerminal.instances[xtermMock.MockTerminal.instances.length - 1];
  if (!term || !term.textarea) throw new Error("mock terminal did not open");
  return { store, term, onInput };
}

beforeEach(() => {
  xtermMock.MockTerminal.instances.length = 0;
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: MockResizeObserver,
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("Terminal IME composition guard", () => {
  it("marks composition state and suppresses raw xterm data while composing", () => {
    const { store, term, onInput } = renderTerminal();

    act(() => {
      term.textarea?.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "ㅎ" }),
      );
      term.emitData("ㅎ");
    });

    expect(store.get(imeComposingAtom)).toBe(true);
    expect(document.body.textContent).toContain('compose start: "ㅎ"');
    expect(onInput).not.toHaveBeenCalled();
  });

  it("lets the committed IME text through once after compositionend", () => {
    const { store, term, onInput } = renderTerminal();

    act(() => {
      term.textarea?.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "ㅎ" }),
      );
      term.emitData("ㅎ");
      term.textarea?.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "한" }),
      );
      term.emitData("한");
    });

    expect(store.get(imeComposingAtom)).toBe(false);
    expect(document.body.textContent).toContain('compose end: "한"');
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith("한");
  });
});
