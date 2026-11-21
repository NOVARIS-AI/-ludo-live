import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTransactionalEmail } from "../worker/email.ts";

describe("transactional email provider failover", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses Resend first and falls back to Brevo when Resend fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ messageId: "brevo-message" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendTransactionalEmail({
      RESEND_API_KEY: "resend-test",
      BREVO_API_KEY: "brevo-test",
      LUDO_EMAIL_FROM: "LUDO LIVE <mail@example.test>",
    }, "player@example.test", "Verify account", "<p>Verify</p>");
    expect(result).toEqual({ provider: "brevo", ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("does not call Brevo when Resend succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "resend-message" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendTransactionalEmail({
      RESEND_API_KEY: "resend-test",
      BREVO_API_KEY: "brevo-test",
      LUDO_EMAIL_FROM: "LUDO LIVE <mail@example.test>",
    }, "player@example.test", "Reset password", "<p>Reset</p>");
    expect(result).toEqual({ provider: "resend", ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
