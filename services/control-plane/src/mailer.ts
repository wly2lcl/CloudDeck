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

export function createMailer(config: AppConfig): Mailer {
  if (config.mailProvider === 'http' && config.mailHttpUrl) {
    return new HttpMailer({
      url: config.mailHttpUrl,
      token: config.mailHttpToken,
      from: config.mailFrom,
    })
  }
  return new MockMailer()
}
