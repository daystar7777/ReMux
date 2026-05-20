export type TmuxLayoutNode =
  | {
      type: "pane";
      width: number;
      height: number;
      x: number;
      y: number;
      paneId: string;
    }
  | {
      type: "row" | "column";
      width: number;
      height: number;
      x: number;
      y: number;
      children: TmuxLayoutNode[];
    };

interface Cursor {
  value: string;
  index: number;
}

export function parseTmuxLayout(layout: string | undefined | null): TmuxLayoutNode | null {
  if (!layout) return null;
  const normalized = stripChecksum(layout.trim());
  if (!normalized) return null;
  const cursor: Cursor = { value: normalized, index: 0 };
  const node = parseCell(cursor);
  return node && cursor.index === cursor.value.length ? node : null;
}

function stripChecksum(layout: string): string {
  const firstComma = layout.indexOf(",");
  if (firstComma <= 0) return layout;
  const possibleChecksum = layout.slice(0, firstComma);
  const rest = layout.slice(firstComma + 1);
  if (/^[0-9a-f]+$/i.test(possibleChecksum) && /^\d+x\d+,\d+,\d+/.test(rest)) {
    return rest;
  }
  return layout;
}

function parseCell(cursor: Cursor): TmuxLayoutNode | null {
  const geometry = parseGeometry(cursor);
  if (!geometry) return null;
  const next = cursor.value[cursor.index];
  if (next === "{" || next === "[") {
    cursor.index += 1;
    const type = next === "{" ? "column" : "row";
    const close = next === "{" ? "}" : "]";
    const children: TmuxLayoutNode[] = [];
    while (cursor.index < cursor.value.length && cursor.value[cursor.index] !== close) {
      const child = parseCell(cursor);
      if (!child) return null;
      children.push(child);
      if (cursor.value[cursor.index] === ",") {
        cursor.index += 1;
      }
    }
    if (cursor.value[cursor.index] !== close || children.length === 0) return null;
    cursor.index += 1;
    return { type, ...geometry, children };
  }
  if (next !== ",") return null;
  cursor.index += 1;
  const start = cursor.index;
  while (
    cursor.index < cursor.value.length &&
    cursor.value[cursor.index] !== "," &&
    cursor.value[cursor.index] !== "}" &&
    cursor.value[cursor.index] !== "]"
  ) {
    cursor.index += 1;
  }
  const paneId = cursor.value.slice(start, cursor.index);
  if (!paneId) return null;
  return { type: "pane", ...geometry, paneId };
}

function parseGeometry(cursor: Cursor): Pick<TmuxLayoutNode, "width" | "height" | "x" | "y"> | null {
  const source = cursor.value.slice(cursor.index);
  const match = source.match(/^(\d+)x(\d+),(\d+),(\d+)/);
  if (!match) return null;
  cursor.index += match[0].length;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
  };
}

export function flattenTmuxLayoutPanes(node: TmuxLayoutNode | null): string[] {
  if (!node) return [];
  if (node.type === "pane") return [node.paneId];
  return node.children.flatMap(flattenTmuxLayoutPanes);
}

export function tmuxPaneIdToLayoutPaneId(tmuxPaneId: string | undefined | null): string | undefined {
  if (!tmuxPaneId) return undefined;
  return tmuxPaneId.startsWith("%") ? tmuxPaneId.slice(1) : tmuxPaneId;
}
