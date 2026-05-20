import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  useState,
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import {
  clipboardAtom,
  imeComposingAtom,
  mousePolicyAtom,
  appearanceAtom,
} from "../state/atoms";
import { getThemeColors } from "../lib/themes";
import {
  containsControlPayload,
  isMultiline,
  summarize,
  wrapBracketedPaste,
} from "../lib/clipboard";
import { clipboardRead, clipboardWrite } from "../lib/ipc";


export interface TerminalHandle {
  fit: () => void;
  focus: () => void;
  write: (data: string) => void;
  cols: () => number;
  rows: () => number;
}

export interface PasteRequest {
  text: string;
  resolve: (accept: boolean) => void;
}

interface Props {
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onDoubleClick?: () => void;
  onPasteRequested?: (req: PasteRequest) => void;
  localEcho?: boolean;
}

export const Terminal = forwardRef<TerminalHandle, Props>(function Terminal(
  props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const composingRef = useRef(false);
  const setComposing = useSetAtom(imeComposingAtom);
  const setClipboard = useSetAtom(clipboardAtom);
  const [composeDebug, setComposeDebug] = useState("");
  const mousePolicy = useAtomValue(mousePolicyAtom);
  const mousePolicyRef = useRef(mousePolicy);

  useEffect(() => {
    mousePolicyRef.current = mousePolicy;
  }, [mousePolicy]);

  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const appearance = useAtomValue(appearanceAtom);

  useEffect(() => {
    if (!containerRef.current) return;

    const effectiveFontSize = Math.round(appearance.fontSize * appearance.zoom);
    const term = new XTerm({
      fontFamily: appearance.fontFamily,
      fontSize: effectiveFontSize,
      lineHeight: appearance.lineHeight,
      letterSpacing: appearance.letterSpacing,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      windowsMode: false,
      convertEol: false,
      theme: getThemeColors(appearance.themeName),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.ctrlKey || event.metaKey) {
          invoke("plugin:opener|open", { path: uri }).catch((err) => {
            console.error("[REMUX] Failed to open link:", err);
            window.open(uri, "_blank");
          });
        }
      })
    );
    term.open(containerRef.current);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        webglRef.current = null;
      });
      term.loadAddon(webgl);
      webglRef.current = webgl;
    } catch (err) {
      console.warn("[REMUX] WebGL addon unavailable, using canvas fallback", err);
    }

    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    if (propsRef.current.localEcho) {
      term.write(
        [
          "\x1b[1;38;5;111mREMUX IME spike\x1b[0m",
          "\x1b[38;5;240m한글 / 日本語 / 中文 / emoji 🦄 입력 테스트 — 키 입력은 로컬 에코됩니다.\x1b[0m",
          "\x1b[38;5;240mCompose status overlay (top right) should toggle blue while you compose.\x1b[0m",
          "\x1b[38;5;240mEnter, backspace, arrow keys are echoed raw.\x1b[0m",
          "",
        ].join("\r\n"),
      );
    }

    const ingest = (data: string) => {
      if (propsRef.current.localEcho) {
        termRef.current?.write(data.replace(/\r?\n/g, "\r\n"));
      }
      propsRef.current.onInput?.(data);
    };

    const performPaste = async () => {
      let text = "";
      try {
        text = await clipboardRead();
      } catch {
        try {
          text = await navigator.clipboard.readText();
        } catch {
          text = "";
        }
      }
      if (!text) return;
      const dangerous = isMultiline(text) || containsControlPayload(text);
      const onPasteRequested = propsRef.current.onPasteRequested;
      if (dangerous && onPasteRequested) {
        await new Promise<void>((resolve) => {
          onPasteRequested({
            text,
            resolve: (accept) => {
              if (accept) ingest(wrapBracketedPaste(text));
              resolve();
            },
          });
        });
      } else {
        ingest(isMultiline(text) ? wrapBracketedPaste(text) : text);
      }
    };

    term.attachCustomKeyEventHandler((e) => {
      const isCopy = e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c");
      const isPaste = e.ctrlKey && e.shiftKey && (e.key === "V" || e.key === "v");

      if (isCopy || isPaste) {
        if (e.type === "keydown") {
          if (isCopy) {
            const sel = term.getSelection();
            if (sel) {
              void (async () => {
                try {
                  await clipboardWrite(sel);
                } catch {
                  try {
                    await navigator.clipboard.writeText(sel);
                  } catch {
                    /* ignore */
                  }
                }
                setClipboard(summarize(sel));
                term.clearSelection();
              })();
            }
          } else {
            void performPaste();
          }
        }
        return false;
      }
      return true;
    });

    const MOUSE_SGR = /^\x1b\[<\d+;\d+;\d+[Mm]/;
    const MOUSE_X10 = /^\x1b\[M/;
    const onDataDisposer = term.onData((data) => {
      if (composingRef.current) {
        return;
      }
      if (
        mousePolicyRef.current === "remux" &&
        (MOUSE_SGR.test(data) || MOUSE_X10.test(data))
      ) {
        return;
      }
      ingest(data);
    });

    const onResizeDisposer = term.onResize(({ cols, rows }) => {
      propsRef.current.onResize?.(cols, rows);
    });

    const helper = term.textarea;
    const detachHelperListeners: (() => void)[] = [];
    if (helper) {
      const onStart = (e: CompositionEvent) => {
        composingRef.current = true;
        setComposing(true);
        setComposeDebug(`compose start: "${e.data ?? ""}"`);
      };
      const onUpdate = (e: CompositionEvent) => {
        setComposeDebug(`compose update: "${e.data ?? ""}"`);
      };
      const onEnd = (e: CompositionEvent) => {
        composingRef.current = false;
        setComposing(false);
        setComposeDebug(`compose end: "${e.data ?? ""}"`);
      };
      helper.addEventListener("compositionstart", onStart);
      helper.addEventListener("compositionupdate", onUpdate);
      helper.addEventListener("compositionend", onEnd);
      detachHelperListeners.push(() =>
        helper.removeEventListener("compositionstart", onStart),
      );
      detachHelperListeners.push(() =>
        helper.removeEventListener("compositionupdate", onUpdate),
      );
      detachHelperListeners.push(() =>
        helper.removeEventListener("compositionend", onEnd),
      );
    }

    const root = containerRef.current;
    const onDblClick = (e: MouseEvent) => {
      if (mousePolicyRef.current !== "remux") return;
      e.preventDefault();
      propsRef.current.onDoubleClick?.();
    };

    const onContextMenu = async (e: MouseEvent) => {
      if (mousePolicyRef.current !== "remux") return;
      e.preventDefault();
      await performPaste();
    };

    const onMouseUp = async () => {
      if (mousePolicyRef.current !== "remux") return;
      const sel = term.getSelection();
      if (!sel) return;
      try {
        await clipboardWrite(sel);
      } catch {
        try {
          await navigator.clipboard.writeText(sel);
        } catch {
          /* ignore */
        }
      }
      setClipboard(summarize(sel));
    };

    root.addEventListener("dblclick", onDblClick);
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("mouseup", onMouseUp);

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(root);

    return () => {
      observer.disconnect();
      onDataDisposer.dispose();
      onResizeDisposer.dispose();
      detachHelperListeners.forEach((fn) => fn());
      root.removeEventListener("dblclick", onDblClick);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("mouseup", onMouseUp);
      webglRef.current?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      webglRef.current = null;
    };
  }, [setClipboard, setComposing]); // eslint-disable-next-line react-hooks/exhaustive-deps

  // Reactive updates on appearance configurations
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const effectiveFontSize = Math.round(appearance.fontSize * appearance.zoom);
    
    // Mutate xterm options reactively!
    term.options.fontFamily = appearance.fontFamily;
    term.options.fontSize = effectiveFontSize;
    term.options.lineHeight = appearance.lineHeight;
    term.options.letterSpacing = appearance.letterSpacing;
    term.options.theme = getThemeColors(appearance.themeName);

    // Give xterm and DOM a tiny tick to settle before measuring dimensions
    const timer = setTimeout(() => {
      fitRef.current?.fit();
    }, 25);

    return () => clearTimeout(timer);
  }, [appearance]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => fitRef.current?.fit(),
      focus: () => termRef.current?.focus(),
      write: (data: string) => termRef.current?.write(data),
      cols: () => termRef.current?.cols ?? 80,
      rows: () => termRef.current?.rows ?? 24,
    }),
    [],
  );

  return (
    <div className="terminal-host" ref={containerRef}>
      {composeDebug && (
        <div
          className={`ime-debug${composingRef.current ? " composing" : ""}`}
          aria-live="polite"
        >
          {composeDebug}
        </div>
      )}
    </div>
  );
});
