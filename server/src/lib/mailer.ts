import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

let transporter: Transporter | null = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

/** True when SMTP is configured (emails really go out). */
export const mailEnabled = () => transporter !== null;

/** Outbox for tests / development without SMTP. */
export const devOutbox: { to: string; subject: string; text: string }[] = [];

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!transporter) {
    devOutbox.push({ to, subject, text });
    if (devOutbox.length > 50) devOutbox.shift();
    if (!config.isTest) console.info(`[mail:dev] SMTP belum dikonfigurasi. Email untuk ${to}: ${subject}\n${text}`);
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text, html });
}
