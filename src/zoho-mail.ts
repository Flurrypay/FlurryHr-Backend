export function zohoConfigured() {
  return ["ZOHO_EMAIL_API_URL", "ZOHO_EMAIL_API_KEY", "ZOHO_EMAIL_FROM"].every(
    (key) => Boolean(process.env[key]?.trim()),
  );
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
  } | null;
  if (!response.ok || !result?.data?.some((item) => item.code === "EM_104"))
    throw new Error("ZOHO_DELIVERY_REJECTED");
}
