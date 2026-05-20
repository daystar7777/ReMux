import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameWindowModal } from "./RenameWindowModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function fillInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderModal(props: ComponentProps<typeof RenameWindowModal>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<RenameWindowModal {...props} />);
  });
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

describe("RenameWindowModal", () => {
  it("disables submit until the name changes", () => {
    renderModal({
      currentName: "main",
      identityLabel: "remux:0.0",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    const button = document.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const input = document.querySelector("#rename-window-input") as HTMLInputElement;
    act(() => {
      fillInput(input, "logs");
    });

    expect(button.disabled).toBe(false);
  });

  it("submits the trimmed new name", () => {
    const onConfirm = vi.fn();
    renderModal({
      currentName: "main",
      identityLabel: "remux:0.0",
      onConfirm,
      onCancel: vi.fn(),
    });

    const input = document.querySelector("#rename-window-input") as HTMLInputElement;
    const form = document.querySelector("form") as HTMLFormElement;

    act(() => {
      fillInput(input, "  logs  ");
    });
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith("logs");
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    renderModal({
      currentName: "main",
      identityLabel: "remux:0.0",
      onConfirm: vi.fn(),
      onCancel,
    });

    const input = document.querySelector("#rename-window-input") as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("can submit an empty name when empty values are allowed", () => {
    const onConfirm = vi.fn();
    renderModal({
      currentName: "worker",
      identityLabel: "remux:0.0",
      allowEmpty: true,
      onConfirm,
      onCancel: vi.fn(),
    });

    const input = document.querySelector("#rename-window-input") as HTMLInputElement;
    const form = document.querySelector("form") as HTMLFormElement;

    act(() => {
      fillInput(input, "");
    });
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith("");
  });
});
