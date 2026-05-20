export interface ClipboardSnapshot {
  kind: "empty" | "text" | "image" | "binary";
  byteLength: number;
  lineCount: number;
  preview: string;
  redacted: boolean;
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
  /-----BEGIN OPENSSH PRIVATE KEY-----/i,
  /-----BEGIN CERTIFICATE-----/i,
  /-----BEGIN ENCRYPTED PRIVATE KEY-----/i,
  /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|bearer|token|auth[_-]?token)\s*[:=]\s*\S{6,}/i,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bghp_[A-Za-z0-9]{30,}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\baws_secret_access_key\b/i,
];

const HIGH_ENTROPY_LEN = 32;

const isHighEntropyToken = (line: string): boolean => {
  const candidate = line.trim().split(/\s+/).find((tok) => tok.length >= HIGH_ENTROPY_LEN);
  if (!candidate) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(candidate)) return false;
  const counts = new Map<string, number>();
  for (const ch of candidate) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / candidate.length;
    entropy -= p * Math.log2(p);
  }
  return entropy >= 3.5;
};

export const detectSecret = (text: string): boolean => {
  if (SECRET_PATTERNS.some((re) => re.test(text))) return true;
  for (const line of text.split(/\r?\n/)) {
    if (isHighEntropyToken(line)) return true;
  }
  return false;
};

export const summarize = (text: string): ClipboardSnapshot => {
  if (!text) {
    return { kind: "empty", byteLength: 0, lineCount: 0, preview: "", redacted: false };
  }
  const lines = text.split(/\r?\n/);
  const redacted = detectSecret(text);
  const firstLine = lines[0] ?? "";
  let preview = firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
  if (lines.length > 1) {
    preview = `${preview} · +${lines.length - 1} lines`;
  }
  return {
    kind: "text",
    byteLength: new Blob([text]).size,
    lineCount: lines.length,
    preview: redacted ? "[CLIPBOARD: Redacted Secret]" : preview,
    redacted,
  };
};

const BRACKET_BEGIN = "\x1b[200~";
const BRACKET_END = "\x1b[201~";

export const wrapBracketedPaste = (text: string): string =>
  `${BRACKET_BEGIN}${text}${BRACKET_END}`;

export const containsControlPayload = (text: string): boolean =>
  /[\x00-\x08\x0b-\x1f\x7f]/.test(text);

export const isMultiline = (text: string): boolean => /\r?\n/.test(text);
