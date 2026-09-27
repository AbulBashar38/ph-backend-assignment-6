import path from 'node:path'
import ejs from 'ejs'
import type { SendMailOptions } from 'nodemailer'
import config from '../config'
import { transporter } from '../lib/nodemailer'

export type TEmailTemplate =
    | 'registration-user-otp'
    | 'welcome-email'
    | 'forgot-password'
    | 'reset-password-success'

interface ISendEmailPayload {
    to: string
    subject: string
    templateName: TEmailTemplate
    templateData: Record<string, unknown>
    attachments?: SendMailOptions['attachments']
}

export const sendEmail = async ({
    to,
    subject,
    templateName,
    templateData,
    attachments,
}: ISendEmailPayload) => {
    const templatePath = path.join(process.cwd(), `src/app/templates/${templateName}.ejs`)
    const html = await ejs.renderFile(templatePath, templateData)

    await transporter.sendMail({
        from: config.email_sender,
        to,
        subject,
        html,
        attachments,
    })
}

// For emails that must not fail an action that already succeeded (welcome, confirmations)
export const sendEmailSafely = async (payload: ISendEmailPayload) => {
    try {
        await sendEmail(payload)
    } catch (error) {
        console.error(`Failed to send "${payload.templateName}" email to ${payload.to}:`, error)
    }
}
