import { config } from "./config.js";

export type Mail = { to: string; subject: string; text: string };

// Placeholder until an email provider is wired up. In development the message is printed so links can be opened from the
// terminal; in production it is dropped, because printing reset links to logs would let anyone with log access use them.
export async function sendMail(mail: Mail) {
  if (config.isProd) {
    console.warn(`[mail] No email provider configured; dropped "${mail.subject}" to ${mail.to}`);
    return;
  }
  console.info(`\n[mail] To: ${mail.to}\n[mail] Subject: ${mail.subject}\n${mail.text}\n`);
}
