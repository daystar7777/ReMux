import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  ChevronDown,
  Eye,
  EyeOff,
  Search,
  X,
} from "lucide-react";
import type { Host, AuthMethod, ClipboardPolicy } from "../types/config";
import { newHostId, validateHost } from "../types/config";
import { hostAccount, secretsGet, testConnection, type TestConnectionResult } from "../lib/ipc";

interface HostModalProps {
  host?: Host;
  onClose: () => void;
  onSave: (payload: { host: Host; password?: string | null }) => void;
}

interface ResolvedSshHost {
  alias: string;
  address?: string;
  port?: number;
  username?: string;
  keyPath?: string;
  proxyJump?: string;
  identityAgent?: string;
}

export function HostModal({ host, onClose, onSave }: HostModalProps) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("keyfile");
  const [keyPath, setKeyPath] = useState("");
  const [sshConfigAlias, setSshConfigAlias] = useState("");
  const [customTmuxBinary, setCustomTmuxBinary] = useState("");
  const [tmuxSocketPath, setTmuxSocketPath] = useState("");
  const [detachOtherClients, setDetachOtherClients] = useState(false);
  const [clipboardPolicy, setClipboardPolicy] = useState<ClipboardPolicy>("allow");
  const [description, setDescription] = useState("");
  const [proxyJump, setProxyJump] = useState("");
  const [identityAgent, setIdentityAgent] = useState("");
  const [skipHostKeyCheck, setSkipHostKeyCheck] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [hadStoredPassword, setHadStoredPassword] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement | null>(null);

  const [sshAliases, setSshAliases] = useState<string[]>([]);
  const [sshSearch, setSshSearch] = useState("");
  const [showSshDropdown, setShowSshDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  useEffect(() => {
    if (host) {
      setLabel(host.label || "");
      setAddress(host.address || "");
      setPort(host.port ?? 22);
      setUsername(host.username || "");
      setAuthMethod(host.auth_method || "keyfile");
      setKeyPath(host.key_path || "");
      setSshConfigAlias(host.ssh_config_alias || "");
      setCustomTmuxBinary(host.custom_tmux_binary || "");
      setTmuxSocketPath(host.tmux_socket_path || "");
      setDetachOtherClients(host.detach_other_clients ?? false);
      setClipboardPolicy(host.clipboard_policy || "allow");
      setDescription(host.description || "");
      setProxyJump(host.proxy_jump || "");
      setIdentityAgent(host.identity_agent || "");
      setSkipHostKeyCheck(host.skip_host_key_check ?? false);

      void (async () => {
        try {
          const stored = await secretsGet(hostAccount(host.id));
          if (stored !== null && stored !== undefined && stored !== "") {
            setHadStoredPassword(true);
          }
        } catch (e) {
          console.warn("Keychain read failed", e);
        }
      })();
    }
  }, [host]);

  useEffect(() => {
    invoke<string[]>("ssh_config_list_hosts")
      .then((aliases) => setSshAliases(aliases || []))
      .catch((err) => console.warn("Failed to load SSH config aliases", err));
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(false);
      }
    }
    if (saveMenuOpen) {
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }
    return undefined;
  }, [saveMenuOpen]);

  const handleImportSsh = async (alias: string) => {
    try {
      setError(null);
      const resolved = await invoke<ResolvedSshHost>("ssh_config_resolve_host", { alias });
      if (resolved.address) setAddress(resolved.address);
      if (resolved.port) setPort(resolved.port);
      if (resolved.username) setUsername(resolved.username);
      if (resolved.keyPath) setKeyPath(resolved.keyPath);
      if (resolved.proxyJump) setProxyJump(resolved.proxyJump);
      if (resolved.identityAgent) setIdentityAgent(resolved.identityAgent);
      setSshConfigAlias(alias);
      if (!label) setLabel(alias);
      setShowSshDropdown(false);
      setSshSearch("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to resolve SSH alias: ${message}`);
    }
  };

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    setTesting(true);
    try {
      const result = await testConnection({
        host: address.trim(),
        user: username.trim() || undefined,
        port: port || undefined,
        sshConfigAlias: sshConfigAlias.trim() || undefined,
        keyPath: keyPath.trim() || undefined,
        proxyJump: proxyJump.trim() || undefined,
        identityAgent: identityAgent.trim() || undefined,
        skipHostKeyCheck,
      });
      setTestResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, rttMs: 0, detail: message });
    } finally {
      setTesting(false);
    }
  };

  const buildSavedHost = (): Host | null => {
    const validationError = validateHost({
      label: label.trim(),
      address: address.trim(),
      port,
      auth_method: authMethod,
      key_path: keyPath.trim(),
      ssh_config_alias: sshConfigAlias.trim(),
    });
    if (validationError) {
      setError(validationError);
      return null;
    }
    return {
      id: host?.id || newHostId(),
      label: label.trim(),
      address: authMethod === "local" ? "127.0.0.1" : address.trim(),
      port: authMethod === "local" ? 0 : port,
      username: authMethod === "local" ? "" : username.trim(),
      auth_method: authMethod,
      key_path: authMethod === "keyfile" ? keyPath.trim() : undefined,
      ssh_config_alias: sshConfigAlias.trim() || undefined,
      custom_tmux_binary: customTmuxBinary.trim() || undefined,
      tmux_socket_path: tmuxSocketPath.trim() || undefined,
      detach_other_clients: detachOtherClients,
      clipboard_policy: clipboardPolicy,
      description: description.trim() || undefined,
      proxy_jump: proxyJump.trim() || undefined,
      identity_agent: identityAgent.trim() || undefined,
      skip_host_key_check: skipHostKeyCheck,
    };
  };

  const commitSave = (savePassword: boolean) => {
    setError(null);
    const built = buildSavedHost();
    if (!built) return;
    let passwordPayload: string | null | undefined = undefined;
    if (authMethod === "password") {
      if (savePassword) {
        passwordPayload = password;
      } else if (passwordTouched && hadStoredPassword) {
        // User cleared/edited the field but chose not to persist; leave existing entry alone.
        passwordPayload = undefined;
      }
    }
    onSave({ host: built, password: passwordPayload });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    commitSave(false);
  };

  const filteredAliases = sshAliases.filter((a) =>
    a.toLowerCase().includes(sshSearch.toLowerCase()),
  );
  const isRemote = authMethod !== "local";
  const passwordSaveAvailable = authMethod === "password" && password.length > 0;

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: 520, maxWidth: "90vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{host ? "Edit Host" : "New Host"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="banner danger" style={{ marginBottom: 10 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {isRemote && sshAliases.length > 0 && (
            <div className="ssh-import-box">
              <div className="form-label" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)" }}>
                <Search size={12} /> Import from ~/.ssh/config
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="Search SSH alias..."
                  className="form-input"
                  value={sshSearch}
                  onChange={(e) => {
                    setSshSearch(e.target.value);
                    setShowSshDropdown(true);
                  }}
                  onFocus={() => setShowSshDropdown(true)}
                />
                {showSshDropdown && sshSearch && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "var(--bg-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      marginTop: 4,
                      maxHeight: 150,
                      overflowY: "auto",
                      zIndex: 10,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    }}
                  >
                    {filteredAliases.length > 0 ? (
                      filteredAliases.map((alias) => (
                        <div
                          key={alias}
                          style={{ padding: "8px 12px", cursor: "pointer" }}
                          className="profile"
                          onClick={() => handleImportSsh(alias)}
                        >
                          {alias}
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: "8px 12px", color: "var(--fg-2)" }}>No aliases found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Host Label *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Production GPU"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Auth Method</label>
              <select
                className="form-select"
                value={authMethod}
                onChange={(e) => {
                  setAuthMethod(e.target.value as AuthMethod);
                  setTestResult(null);
                }}
              >
                <option value="keyfile">SSH Keyfile</option>
                <option value="password">Password</option>
                <option value="agent">SSH Agent</option>
                <option value="local">Local Host</option>
              </select>
            </div>
          </div>

          {isRemote && (
            <>
              <div className="form-row">
                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label className="form-label">Address (IP or Hostname) *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 192.168.1.50 or my-server.com"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. ubuntu"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Port</label>
                  <input
                    type="number"
                    className="form-input"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 22)}
                  />
                </div>
              </div>
            </>
          )}

          {authMethod === "keyfile" && (
            <div className="form-group">
              <label className="form-label">SSH Private Key Path *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. /Users/me/.ssh/id_ed25519"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
              />
            </div>
          )}

          {authMethod === "password" && (
            <div className="form-group">
              <label className="form-label">
                Password
                {hadStoredPassword && !passwordTouched && (
                  <span style={{ color: "var(--fg-2)", fontWeight: 400 }}>
                    {" "}
                    · saved in Keychain
                  </span>
                )}
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={passwordVisible ? "text" : "password"}
                  className="form-input"
                  placeholder={hadStoredPassword ? "Enter to overwrite (or leave blank)" : "Leave blank to type at connect time"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordTouched(true);
                  }}
                  autoComplete="new-password"
                  style={{ paddingRight: 32 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  style={{
                    position: "absolute",
                    right: 4,
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: "transparent",
                  }}
                  onClick={() => setPasswordVisible((v) => !v)}
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                >
                  {passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-2)", marginTop: 4 }}>
                Leave empty to type interactively in the terminal. Use the dropdown next to <strong>Save</strong> to persist it to macOS Keychain.
              </div>
            </div>
          )}

          {authMethod === "agent" && (
            <div className="banner" style={{ background: "rgba(106,169,255,0.08)", borderColor: "var(--accent-dim)", color: "var(--fg-1)" }}>
              REMUX will use your active ssh-agent. Ensure <code>ssh-add</code> has loaded the right key before connecting.
            </div>
          )}

          <button
            type="button"
            className="icon-btn"
            style={{
              width: "auto",
              padding: "6px 10px",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "1px dashed var(--border)",
              alignSelf: "flex-start",
            }}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <ChevronDown
              size={12}
              style={{
                transform: advancedOpen ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 120ms ease",
              }}
            />
            Advanced {advancedOpen ? "" : "(SSH options, tmux, clipboard policy)"}
          </button>

          {advancedOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 4, borderLeft: "2px solid var(--border)", paddingTop: 4 }}>
              {isRemote && (
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">ProxyJump</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. bastion-host or user@bastion:22"
                      value={proxyJump}
                      onChange={(e) => setProxyJump(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">SSH Config Alias</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. prod-api"
                      value={sshConfigAlias}
                      onChange={(e) => setSshConfigAlias(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {isRemote && (
                <div className="form-group">
                  <label className="form-label">Identity Agent (SSH_AUTH_SOCK)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. ~/.1password/agent.sock"
                    value={identityAgent}
                    onChange={(e) => setIdentityAgent(e.target.value)}
                  />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Clipboard Policy</label>
                  <select
                    className="form-select"
                    value={clipboardPolicy}
                    onChange={(e) => setClipboardPolicy(e.target.value as ClipboardPolicy)}
                  >
                    <option value="allow">Allow Bidirectional</option>
                    <option value="ask">Ask Confirmation</option>
                    <option value="deny">Deny / Sandbox</option>
                  </select>
                </div>
                <div className="form-group" style={{ justifyContent: "flex-end" }}>
                  <label className="form-checkbox-label" style={{ marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={detachOtherClients}
                      onChange={(e) => setDetachOtherClients(e.target.checked)}
                    />
                    Detach other tmux clients on attach
                  </label>
                  {isRemote && (
                    <label className="form-checkbox-label" style={{ marginBottom: 6 }}>
                      <input
                        type="checkbox"
                        checked={skipHostKeyCheck}
                        onChange={(e) => setSkipHostKeyCheck(e.target.checked)}
                      />
                      Skip host key verification (StrictHostKeyChecking=no)
                    </label>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Custom Tmux Binary</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. /usr/local/bin/tmux"
                    value={customTmuxBinary}
                    onChange={(e) => setCustomTmuxBinary(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tmux Socket Path</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. /tmp/tmux-501/default"
                    value={tmuxSocketPath}
                    onChange={(e) => setTmuxSocketPath(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Description / Notes</label>
                <textarea
                  className="form-textarea"
                  style={{ resize: "vertical", height: 50 }}
                  placeholder="Optional notes about this host..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          )}

          {testResult && (
            <div
              className={`banner${testResult.ok ? "" : " danger"}`}
              style={{ marginTop: 4 }}
            >
              <span>
                <strong>{testResult.ok ? "OK" : "Failed"}</strong>{" "}
                {testResult.rttMs}ms — {testResult.detail}
              </span>
            </div>
          )}

          <div
            className="actions"
            style={{ marginTop: 8, justifyContent: "space-between" }}
          >
            {isRemote ? (
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !address.trim()}
                style={{ display: "flex", alignItems: "center", gap: 6, borderColor: "var(--accent-dim)", color: "var(--accent)" }}
                title="ssh -o BatchMode=yes probe (no password prompt)"
              >
                <Activity size={12} />
                {testing ? "Testing…" : "Test connection"}
              </button>
            ) : (
              <span />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <div style={{ position: "relative", display: "flex" }} ref={saveMenuRef}>
                <button
                  type="submit"
                  className="primary"
                  style={{
                    borderTopRightRadius: passwordSaveAvailable ? 0 : undefined,
                    borderBottomRightRadius: passwordSaveAvailable ? 0 : undefined,
                  }}
                >
                  Save Host
                </button>
                {passwordSaveAvailable && (
                  <>
                    <button
                      type="button"
                      className="primary"
                      style={{
                        borderLeft: "1px solid rgba(0,0,0,0.25)",
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        paddingLeft: 6,
                        paddingRight: 6,
                      }}
                      onClick={() => setSaveMenuOpen((v) => !v)}
                      aria-label="Save options"
                    >
                      <ChevronDown size={12} />
                    </button>
                    {saveMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          right: 0,
                          bottom: "calc(100% + 4px)",
                          background: "var(--bg-2)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                          padding: 4,
                          minWidth: 220,
                          zIndex: 20,
                        }}
                      >
                        <button
                          type="button"
                          className="profile"
                          style={{ width: "100%", textAlign: "left", border: "none", padding: "8px 10px" }}
                          onClick={() => {
                            setSaveMenuOpen(false);
                            commitSave(false);
                          }}
                        >
                          Save host only
                        </button>
                        <button
                          type="button"
                          className="profile"
                          style={{ width: "100%", textAlign: "left", border: "none", padding: "8px 10px", color: "var(--accent)" }}
                          onClick={() => {
                            setSaveMenuOpen(false);
                            commitSave(true);
                          }}
                        >
                          Save host &amp; password
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
