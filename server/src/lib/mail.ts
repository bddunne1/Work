import nodemailer from "nodemailer";

// Outbound mail for scheduled reports. SMTP_URL (smtp://user:pass@host:587
// or smtps://...) names the server; MAIL_FROM the sender. With no SMTP_URL
// the message is logged instead of sent, so a development box never mails
// anyone and the schedule still records its run.

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  attachments: MailAttachment[];
}

export interface MailOutcome {
  sent: boolean;
  detail: string;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

export async function sendMail(mail: Mail): Promise<MailOutcome> {
  if (!process.env.SMTP_URL) {
    console.log(`mail (not sent - SMTP_URL is unset): to ${mail.to.join(", ")} · ${mail.subject} · ${mail.attachments.map((a) => `${a.filename} ${a.content.length} bytes`).join(", ")}`);
    return { sent: false, detail: "SMTP_URL is unset - logged instead of sent" };
  }
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  const info = await transport.sendMail({
    from: process.env.MAIL_FROM ?? "reports@localhost",
    to: mail.to.join(", "),
    subject: mail.subject,
    text: mail.text,
    attachments: mail.attachments,
  });
  return { sent: true, detail: String(info.messageId ?? "sent") };
}
