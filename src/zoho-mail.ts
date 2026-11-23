export function zohoConfigurationError(): string | null {
  const transport = process.env.MAIL_TRANSPORT?.trim();
  if (transport && transport !== "zoho" && transport !== "file")
    return "Set MAIL_TRANSPORT=zoho. SMTP settings are not used by this application.";
  if (
    !["ZOHO_EMAIL_API_URL", "ZOHO_EMAIL_API_KEY", "ZOHO_EMAIL_FROM"].every(
      (key) => Boolean(process.env[key]?.trim()),
    )
  )
    return "Complete the three Zoho API settings.";
  if (/[\r\n]/.test(process.env.ZOHO_EMAIL_API_KEY!.trim()))
    return "The Zoho API key must be a single line.";
  try {
    const url = new URL(process.env.ZOHO_EMAIL_API_URL!);
    if (url.protocol !== "https:" || url.username || url.password)
      return "Use an HTTPS Zoho email API endpoint.";
  } catch {
    return "Use a valid HTTPS Zoho email API endpoint.";
  }
  return null;
}
export function zohoConfigured() {
  return zohoConfigurationError() === null;
}
export async function sendZohoMail(
  message: { id: string; to: string; subject: string; body: string },
  request: typeof fetch = fetch,
) {
  if (!zohoConfigured()) throw new Error("MAIL_NOT_CONFIGURED");
  const url = new URL(process.env.ZOHO_EMAIL_API_URL!);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("ZOHO_CONFIGURATION_ERROR");
  const key = process.env
    .ZOHO_EMAIL_API_KEY!.trim()
    .replace(/^Zoho-enczapikey\s+/i, "");
  const response = await request(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Zoho-enczapikey ${key}`,
    },
    body: JSON.stringify({
      from: {
        address: process.env.ZOHO_EMAIL_FROM!.trim(),
        name: "FlurryPay HR",
      },
      to: [{ email_address: { address: message.to } }],
      subject: message.subject,
      textbody: message.body,
      client_reference: message.id,
      track_clicks: false,
      track_opens: false,
    }),
  });
  const result = (await response.json().catch(() => null)) as {
    data?: { code?: string }[];
    request_id?: string;
  } | null;
  if (!response.ok || !result?.data?.some((item) => item.code === "EM_104"))
    throw new Error("ZOHO_DELIVERY_REJECTED");
  return typeof result.request_id === "string"
    ? result.request_id.slice(0, 300)
    : null;
}
