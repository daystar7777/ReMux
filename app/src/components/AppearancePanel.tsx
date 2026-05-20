import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { X, Palette, RotateCcw } from "lucide-react";
import { appearanceAtom, rightPanelOpenAtom, updateAppearanceAction, DEFAULT_APPEARANCE, telemetryIntervalAtom, hierarchyIntervalAtom } from "../state/atoms";
import { THEMES } from "../lib/themes";

const FONT_FAMILIES = [
  { label: "SF Mono (macOS)", value: '"SF Mono", Menlo, "DejaVu Sans Mono", "Apple SD Gothic Neo", "Noto Sans Mono CJK KR", monospace' },
  { label: "Menlo", value: 'Menlo, Monaco, "Apple SD Gothic Neo", monospace' },
  { label: "Pretendard Mono (CJK/Ko)", value: '"Pretendard Mono", "Noto Sans Mono CJK KR", "SF Mono", monospace' },
  { label: "Fira Code", value: '"Fira Code", "Fira Mono", monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", monospace' },
  { label: "System Default", value: 'monospace' },
];

export function AppearancePanel() {
  const [isOpen, setIsOpen] = useAtom(rightPanelOpenAtom);
  const appearance = useAtomValue(appearanceAtom);
  const updateAppearance = useSetAtom(updateAppearanceAction);
  const [telemetryInterval, setTelemetryInterval] = useAtom(telemetryIntervalAtom);
  const [hierarchyInterval, setHierarchyInterval] = useAtom(hierarchyIntervalAtom);

  if (!isOpen) return null;

  const handleReset = () => {
    updateAppearance(DEFAULT_APPEARANCE);
  };

  return (
    <div
      className="appearance-panel"
      style={{
        width: "280px",
        height: "100%",
        background: "var(--bg-1)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        boxSizing: "border-box",
        overflowY: "auto",
        transition: "all 0.2s ease-in-out",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.25)",
        zIndex: 10,
      }}
    >
      {/* Header bar */}
      <div
        className="appearance-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--glass-bg)",
          backdropFilter: "blur(var(--glass-blur))",
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--fg-0)" }}>
          <Palette size={14} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Appearance
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            className="icon-btn"
            title="Reset to default settings"
            onClick={handleReset}
            style={{
              width: "22px",
              height: "22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
            }}
          >
            <RotateCcw size={11} />
          </button>
          <button
            className="icon-btn"
            title="Close Settings Panel"
            onClick={() => setIsOpen(false)}
            style={{
              width: "22px",
              height: "22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
            }}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Settings List */}
      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: "18px" }}>
        
        {/* Preset Themes Section */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Terminal Themes
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "8px",
              marginTop: "4px",
            }}
          >
            {Object.keys(THEMES).map((themeName) => {
              const theme = THEMES[themeName];
              const isActive = appearance.themeName === themeName;
              return (
                <button
                  key={themeName}
                  onClick={() => updateAppearance({ themeName })}
                  style={{
                    background: theme.background,
                    border: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "8px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "4px",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    boxShadow: isActive ? "0 4px 12px rgba(106, 169, 255, 0.15)" : "none",
                  }}
                  title={themeName}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: theme.foreground,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      width: "100%",
                    }}
                  >
                    {themeName}
                  </span>
                  
                  {/* Theme Accent Preview Dots */}
                  <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: theme.red }} />
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: theme.green }} />
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: theme.yellow }} />
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: theme.blue }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Family Section */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Font Family
          </span>
          <select
            value={appearance.fontFamily}
            onChange={(e) => updateAppearance({ fontFamily: e.target.value })}
            className="form-select"
            style={{
              fontSize: "12px",
              padding: "6px 8px",
              fontFamily: "var(--font-family)",
            }}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size Slider */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Font Size
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
              {appearance.fontSize}px
            </span>
          </div>
          <input
            type="range"
            min="9"
            max="24"
            step="1"
            value={appearance.fontSize}
            onChange={(e) => updateAppearance({ fontSize: parseInt(e.target.value, 10) })}
            style={{
              width: "100%",
              accentColor: "var(--accent)",
              cursor: "pointer",
            }}
          />
        </div>

        {/* Letter Spacing Slider */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Letter Spacing
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
              {appearance.letterSpacing >= 0 ? `+${appearance.letterSpacing}` : appearance.letterSpacing}px
            </span>
          </div>
          <input
            type="range"
            min="-2"
            max="6"
            step="1"
            value={appearance.letterSpacing}
            onChange={(e) => updateAppearance({ letterSpacing: parseInt(e.target.value, 10) })}
            style={{
              width: "100%",
              accentColor: "var(--accent)",
              cursor: "pointer",
            }}
          />
        </div>

        {/* Line Height Slider */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Line Height
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
              {appearance.lineHeight.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="1.0"
            max="2.0"
            step="0.05"
            value={appearance.lineHeight}
            onChange={(e) => updateAppearance({ lineHeight: parseFloat(e.target.value) })}
            style={{
              width: "100%",
              accentColor: "var(--accent)",
              cursor: "pointer",
            }}
          />
        </div>

        {/* Global Text Scale (Zoom) Slider */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Text Scale Zoom
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
              {Math.round(appearance.zoom * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.8"
            max="1.5"
            step="0.05"
            value={appearance.zoom}
            onChange={(e) => updateAppearance({ zoom: parseFloat(e.target.value) })}
            style={{
              width: "100%",
              accentColor: "var(--accent)",
              cursor: "pointer",
            }}
          />
        </div>

        {/* Performance & Diagnostics Section */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "4px", paddingTop: "14px", borderTop: "1px solid var(--border)" }}>
          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Performance & Diagnostics
          </span>

          {/* Telemetry diagnostics Interval */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--fg-1)" }}>Telemetry Polling</span>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
                {telemetryInterval === 0 ? "Off" : `${telemetryInterval / 1000}s`}
              </span>
            </div>
            <select
              value={telemetryInterval}
              onChange={(e) => setTelemetryInterval(parseInt(e.target.value, 10))}
              className="form-select"
              style={{
                fontSize: "12px",
                padding: "6px 8px",
                fontFamily: "var(--font-family)",
              }}
            >
              <option value={2000}>2s (High performance)</option>
              <option value={5000}>5s (Balanced - Default)</option>
              <option value={10000}>10s (Eco mode)</option>
              <option value={30000}>30s (Battery saver)</option>
              <option value={0}>Off (No diagnostics)</option>
            </select>
          </div>

          {/* Tmux inventory polling Interval */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--fg-1)" }}>Inventory Polling</span>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
                {hierarchyInterval === 0 ? "Off" : `${hierarchyInterval / 1000}s`}
              </span>
            </div>
            <select
              value={hierarchyInterval}
              onChange={(e) => setHierarchyInterval(parseInt(e.target.value, 10))}
              className="form-select"
              style={{
                fontSize: "12px",
                padding: "6px 8px",
                fontFamily: "var(--font-family)",
              }}
            >
              <option value={3000}>3s (Instant update)</option>
              <option value={8000}>8s (Balanced - Default)</option>
              <option value={15000}>15s (Eco mode)</option>
              <option value={30000}>30s (Battery saver)</option>
              <option value={0}>Off (Manual only)</option>
            </select>
          </div>
        </div>

      </div>
    </div>
  );
}
