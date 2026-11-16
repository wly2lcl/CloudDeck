import nodemailer, { type Transporter } from 'nodemailer'
import type { AppConfig } from './config'

export interface MailInput {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(input: MailInput): Promise<void>
}

export interface SentMail extends MailInput {
  sentAt: string
}

export class MockMailer implements Mailer {
  readonly sent: SentMail[] = []

  async send(input: MailInput): Promise<void> {
    this.sent.push({ ...input, sentAt: new Date().toISOString() })
    console.log(`[mail:mock] to=${input.to} subject=${input.subject}`)
  }
}

export class HttpMailer implements Mailer {
  constructor(
    private readonly options: { url: string; token?: string; from: string },
  ) {}

  async send(input: MailInput): Promise<void> {
    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
      },
      body: JSON.stringify({ ...input, from: this.options.from }),
    })
    if (!response.ok) throw new Error(`邮件服务返回 ${response.status}`)
  }
}

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter

  constructor(
    private readonly options: {
      host: string
      port: number
      secure: boolean
      user?: string
      pass?: string
      from: string
      transport?: Transporter
    },
  ) {
    this.transporter =
      options.transport ??
      nodemailer.createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure,
        auth: options.user ? { user: options.user, pass: options.pass } : undefined,
      })
  }

  async send(input: MailInput): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    })
  }
}

export function createMailer(config: AppConfig): Mailer {
  if (config.mailProvider === 'smtp' && config.smtpHost) {
    return new SmtpMailer({
      host: config.smtpHost,
      port: config.smtpPort ?? 587,
      secure: config.smtpSecure ?? false,
      user: config.smtpUser,
      pass: config.smtpPass,
      from: config.mailFrom,
    })
  }
  if (config.mailProvider === 'http' && config.mailHttpUrl) {
    return new HttpMailer({
      url: config.mailHttpUrl,
      token: config.mailHttpToken,
      from: config.mailFrom,
    })
  }
  return new MockMailer()
}
