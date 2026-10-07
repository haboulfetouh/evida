import nodemailer from 'nodemailer';
import { env } from '../config';

let transport: nodemailer.Transporter | null = null;
export function mailer() {
  if (!transport) {
    const e = env();
    transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}
