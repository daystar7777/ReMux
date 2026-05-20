import { describe, expect, it } from "vitest";
import { REMOTE_UTF8_LOCALE_FIX, formatRemoteLocaleWarning } from "./locale";
import type { RemoteEnvProbe } from "./ipc";

const probe = (patch: Partial<RemoteEnvProbe>): RemoteEnvProbe => ({
  tmuxPresent: true,
  utf8Ok: true,
  ...patch,
});

describe("formatRemoteLocaleWarning", () => {
  it("does not warn when the remote probe reports UTF-8 support", () => {
    expect(
      formatRemoteLocaleWarning(
        probe({
          lang: "ko_KR.UTF-8",
          lcCtype: "",
          utf8Ok: true,
        }),
      ),
    ).toBeNull();
  });

  it("warns with the reported remote LANG and LC_CTYPE when UTF-8 is absent", () => {
    expect(
      formatRemoteLocaleWarning(
        probe({
          lang: "C",
          lcCtype: "POSIX",
          utf8Ok: false,
        }),
      ),
    ).toBe("locale non-UTF-8 LANG=C LC_CTYPE=POSIX");
  });

  it("makes unset locale values explicit", () => {
    expect(
      formatRemoteLocaleWarning(
        probe({
          lang: "",
          lcCtype: undefined,
          utf8Ok: false,
        }),
      ),
    ).toBe("locale non-UTF-8 LANG=unset LC_CTYPE=unset");
  });

  it("provides a pasteable UTF-8 locale fix snippet", () => {
    expect(REMOTE_UTF8_LOCALE_FIX).toBe(
      "export LANG=en_US.UTF-8\nexport LC_CTYPE=en_US.UTF-8\n",
    );
  });
});
