import { describe, expect, it } from "vitest";
import {
  flattenTmuxLayoutPanes,
  parseTmuxLayout,
  tmuxPaneIdToLayoutPaneId,
} from "./tmuxLayout";

describe("tmux layout parser", () => {
  it("parses a single-pane layout", () => {
    const layout = parseTmuxLayout("e117,112x36,0,0,85");

    expect(layout).toEqual({
      type: "pane",
      width: 112,
      height: 36,
      x: 0,
      y: 0,
      paneId: "85",
    });
    expect(flattenTmuxLayoutPanes(layout)).toEqual(["85"]);
  });

  it("parses a left-right split container", () => {
    const layout = parseTmuxLayout(
      "bb62,120x40,0,0{60x40,0,0,1,59x40,61,0,3}",
    );

    expect(layout?.type).toBe("column");
    expect(flattenTmuxLayoutPanes(layout)).toEqual(["1", "3"]);
  });

  it("parses nested top-bottom and left-right split containers", () => {
    const layout = parseTmuxLayout(
      "a496,266x63,0,0{127x63,0,0,9,138x63,128,0[138x8,128,0,12,138x15,128,9,10]}",
    );

    expect(layout?.type).toBe("column");
    expect(flattenTmuxLayoutPanes(layout)).toEqual(["9", "12", "10"]);
    if (layout?.type !== "column") throw new Error("expected column root");
    expect(layout.children[1].type).toBe("row");
  });

  it("rejects malformed layouts", () => {
    expect(parseTmuxLayout("not-layout")).toBeNull();
    expect(parseTmuxLayout("112x36,0,0{}")).toBeNull();
  });

  it("normalizes tmux pane ids for layout leaf matching", () => {
    expect(tmuxPaneIdToLayoutPaneId("%85")).toBe("85");
    expect(tmuxPaneIdToLayoutPaneId("85")).toBe("85");
    expect(tmuxPaneIdToLayoutPaneId(undefined)).toBeUndefined();
  });
});
