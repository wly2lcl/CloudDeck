import nodemailer from 'nodemailer'
import { describe, expect, it } from 'vitest'
import { SmtpMailer } from '../src/mailer'

describe('SmtpMailer', () => {
  it('通过 transport 发送纯文本邮件', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true })
    const mailer = new SmtpMailer({
      host: 'localhost',
      port: 587,
      secure: false,
      from: 'CloudDeck <noreply@test.local>',
      transport,
    })
    await expect(
      mailer.send({ to: 'user@example.com', subject: '测试', text: 'hello' }),
    ).resolves.toBeUndefined()
  })
})
