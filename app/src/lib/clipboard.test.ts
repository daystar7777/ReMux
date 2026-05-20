import { describe, expect, it } from "vitest";
import {
  containsControlPayload,
  detectSecret,
  isMultiline,
  summarize,
  wrapBracketedPaste,
} from "./clipboard";

describe("clipboard scrubber", () => {
  it("redacts private keys", () => {
    expect(detectSecret("-----BEGIN OPENSSH PRIVATE KEY-----\nabcd\n-----END")).toBe(true);
    expect(detectSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(detectSecret("-----BEGIN CERTIFICATE-----")).toBe(true);
  });

  it("redacts well-known token shapes", () => {
    expect(detectSecret("ghp_1234567890abcdefghij1234567890ABCD")).toBe(true);
    expect(detectSecret("sk-abcdefghijklmnopqrstuvwxyz1234")).toBe(true);
    expect(detectSecret("export AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP")).toBe(true);
  });

  it("redacts password-like assignments", () => {
    expect(detectSecret("password=hunter2hunter2")).toBe(true);
    expect(detectSecret("api_key: thisisapikey123456")).toBe(true);
  });

  it("redacts high-entropy single tokens", () => {
    const random = "aB3xQ9pLkR7nM2vC5hT8wYzU4eJ1iO6dF0sN";
    expect(detectSecret(random)).toBe(true);
  });

  it("passes regular shell text", () => {
    expect(detectSecret("ls -la /tmp")).toBe(false);
    expect(detectSecret("git status")).toBe(false);
  });

  it("summarizes single-line text", () => {
    const snap = summarize("hello world");
    expect(snap.kind).toBe("text");
    expect(snap.lineCount).toBe(1);
    expect(snap.redacted).toBe(false);
    expect(snap.preview).toBe("hello world");
  });

  it("summarizes multiline with trailer", () => {
    const snap = summarize("line1\nline2\nline3");
    expect(snap.lineCount).toBe(3);
    expect(snap.preview).toContain("line1");
    expect(snap.preview).toContain("+2 lines");
  });

  it("redacts in summary preview", () => {
    const snap = summarize("ghp_1234567890abcdefghij1234567890ABCD");
    expect(snap.redacted).toBe(true);
    expect(snap.preview).toBe("[CLIPBOARD: Redacted Secret]");
  });

  it("wraps bracketed paste", () => {
    expect(wrapBracketedPaste("echo hi")).toBe("\x1b[200~echo hi\x1b[201~");
  });

  it("detects multiline", () => {
    expect(isMultiline("a\nb")).toBe(true);
    expect(isMultiline("ab")).toBe(false);
  });

  it("flags control payloads", () => {
    expect(containsControlPayload("\x07hello")).toBe(true);
    expect(containsControlPayload("hello")).toBe(false);
  });
});
