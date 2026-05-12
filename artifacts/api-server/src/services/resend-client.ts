// Resend email client — uses Replit Connectors credential proxy.
// WARNING: Never cache this client. Tokens expire; call getResendClient() fresh each time.
import { Resend } from "resend";

async function getCredentials(): Promise<{ apiKey: string; fromEmail: string | null }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Resend not connected: missing Replit connector environment variables");
  }

  const data = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  ).then((r) => r.json());

  const settings = data?.items?.[0]?.settings;
  if (!settings?.api_key) throw new Error("Resend not connected");

  return { apiKey: settings.api_key, fromEmail: settings.from_email ?? null };
}

export async function getResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return { client: new Resend(apiKey), fromEmail };
}
