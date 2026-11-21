export interface EmailEnv {
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  LUDO_EMAIL_FROM?: string;
  LUDO_APP_ORIGIN?: string;
}

type DeliveryResult = { provider: "resend" | "brevo"; ok: true } | { provider: "none"; ok: false };

async function sendWithResend(env: EmailEnv, to: string, subject: string, html: string) {
  if (!env.RESEND_API_KEY) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from: env.LUDO_EMAIL_FROM, to: [to], subject, html }),
  });
  return response.ok;
}

async function sendWithBrevo(env: EmailEnv, to: string, subject: string, html: string) {
  if (!env.BREVO_API_KEY) return false;
  const from = env.LUDO_EMAIL_FROM || "";
  const match = from.match(/^(.*)<([^<>]+)>$/);
  const sender = match
    ? { name: match[1].trim().replace(/^["']|["']$/g, "") || "LUDO LIVE", email: match[2].trim() }
    : { name: "LUDO LIVE", email: from.trim() };
  if (!sender.email) return false;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html }),
  });
  return response.ok;
}

/** Resend is primary; Brevo is attempted only when Resend is unavailable or rejects the send. */
export async function sendTransactionalEmail(env: EmailEnv, to: string, subject: string, html: string): Promise<DeliveryResult> {
  if (!env.LUDO_EMAIL_FROM) throw new Error("Email sender is not configured.");
  try {
    if (await sendWithResend(env, to, subject, html)) return { provider: "resend", ok: true };
  } catch { /* fail over without exposing provider details or tokens */ }
  try {
    if (await sendWithBrevo(env, to, subject, html)) return { provider: "brevo", ok: true };
  } catch { /* report a generic delivery failure to the caller */ }
  return { provider: "none", ok: false };
}

export function emailActionHtml(kind: "verify" | "reset", actionUrl: string) {
  const title = kind === "verify" ? "Verify your LUDO LIVE email" : "Reset your LUDO LIVE password";
  const action = kind === "verify" ? "Verify email address" : "Choose a new password";
  const explanation = kind === "verify"
    ? "Confirm that this email address belongs to you. Your player profile will keep the same player ID."
    : "Use this secure link to choose a new password. If you did not request this, you can ignore this email.";
  return `<!doctype html><html><body style="margin:0;background:#10111b;color:#f7f5ff;font-family:Arial,sans-serif;padding:32px"><main style="max-width:520px;margin:auto;background:#1b1c2a;border:1px solid #37364d;border-radius:18px;padding:32px"><p style="letter-spacing:3px;color:#aaa5d2;font-size:12px">LUDO LIVE</p><h1 style="font-size:24px">${title}</h1><p style="color:#d4d0e4;line-height:1.6">${explanation}</p><p style="margin:28px 0"><a href="${actionUrl}" style="background:#a98bff;color:#171321;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${action}</a></p><p style="font-size:12px;color:#aaa5bd;line-height:1.6">This link expires in 30 minutes and can be used once. If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${actionUrl}</span></p></main></body></html>`;
}
