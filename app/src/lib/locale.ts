import type { RemoteEnvProbe } from "./ipc";

export const REMOTE_UTF8_LOCALE_FIX = "export LANG=en_US.UTF-8\nexport LC_CTYPE=en_US.UTF-8\n";

export function formatRemoteLocaleWarning(probe: RemoteEnvProbe): string | null {
  if (probe.utf8Ok) return null;

  const lang = probe.lang?.trim() || "unset";
  const lcCtype = probe.lcCtype?.trim() || "unset";
  return `locale non-UTF-8 LANG=${lang} LC_CTYPE=${lcCtype}`;
}
