import { test } from "node:test";
import assert from "node:assert/strict";
import { sendZohoMail, zohoConfigured } from "./zoho-mail";
const message = {
  id: "job-1",
  to: "employee@example.test",
  subject: "Invitation",
  body: "Secure invitation link",
};
async function configured(run: () => Promise<void>) {
  const original = { ...process.env };
  Object.assign(process.env, {
    MAIL_TRANSPORT: "zoho",
    ZOHO_EMAIL_API_URL: "https://api.zeptomail.com/v1.1/email",
    ZOHO_EMAIL_API_KEY: "Zoho-enczapikey test-key",
    ZOHO_EMAIL_FROM: "hr@example.test",
  });
  try {
    await run();
  } finally {
    process.env = original;
  }
}
test("Zoho sends authenticated payload and recognizes provider acceptance", async () => {
  await configured(async () => {
    assert.equal(zohoConfigured(), true);
    const reference = await sendZohoMail(message, async (url, options) => {
      assert.equal(String(url), process.env.ZOHO_EMAIL_API_URL);
      assert.equal(
        (options!.headers as Record<string, string>).Authorization,
        "Zoho-enczapikey test-key",
      );
      const body = JSON.parse(options!.body as string);
      assert.equal(body.from.address, "hr@example.test");
      assert.equal(body.from.name, "FlurryPay HR");
      assert.equal(body.to[0].email_address.address, message.to);
      assert.equal(body.textbody, message.body);
      assert.equal(body.client_reference, message.id);
      assert.equal(body.track_clicks, false);
      return Response.json({
        data: [{ code: "EM_104" }],
        request_id: "provider-reference",
      });
    });
    assert.equal(reference, "provider-reference");
  });
});
test("Zoho rejection never becomes accepted delivery", async () => {
  await configured(async () => {
    for (const response of [
      Response.json({ error: "rejected" }, { status: 401 }),
      Response.json({ data: [{ code: "ERROR" }] }),
    ])
      await assert.rejects(
        sendZohoMail(message, async () => response),
        /ZOHO_DELIVERY_REJECTED/,
      );
  });
});
test("Missing API key fails before any network request", async () => {
  await configured(async () => {
    delete process.env.ZOHO_EMAIL_API_KEY;
    assert.equal(zohoConfigured(), false);
    await assert.rejects(
      sendZohoMail(message, async () => {
        throw new Error("Unexpected request");
      }),
      /MAIL_NOT_CONFIGURED/,
    );
  });
});
test("Zoho credentials are never sent to a non-HTTPS endpoint", async () => {
  await configured(async () => {
    process.env.ZOHO_EMAIL_API_URL = "http://api.zeptomail.com/v1.1/email";
    await assert.rejects(
      sendZohoMail(message, async () => {
        throw new Error("Unexpected request");
      }),
      /MAIL_NOT_CONFIGURED|ZOHO_CONFIGURATION_ERROR/,
    );
  });
});

test("unsupported SMTP transport and multiline API keys cannot report configured", async () => {
  await configured(async () => {
    process.env.MAIL_TRANSPORT = "smtp";
    assert.equal(zohoConfigured(), false);
    process.env.MAIL_TRANSPORT = "zoho";
    process.env.ZOHO_EMAIL_API_KEY = "first-line\nsecond-line";
    assert.equal(zohoConfigured(), false);
  });
});
