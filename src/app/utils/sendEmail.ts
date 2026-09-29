import path from 'node:path'
import ejs from 'ejs'
import type { SendMailOptions } from 'nodemailer'
import type { Role } from '../../generated/prisma/enums'
import config from '../config'
import { transporter } from '../lib/nodemailer'

export const APP_NAME = 'Housing & Roommate Platform'

// The data each template needs. Adding a template = add it here and create src/app/templates/<name>.ejs
interface IEmailTemplateData {
    'registration-user-otp': { name: string; email: string; otp: string; expirationMinutes: number }
    'forgot-password': { name: string; email: string; otp: string; expirationMinutes: number }
    'reset-password-success': { name: string; email: string; changedAt: string }
    'welcome-email': { name: string; email: string; role: Role }
    'payment-success': {
        name: string
        amount: string
        propertyTitle: string
        roomName: string
        period: string
        paidAt: string
        reference: string
        isFirstPayment: boolean
        moveInDate: string
    }
    'rent-reminder': {
        name: string
        amount: string
        dueDate: string
        daysLeft: number
        propertyTitle: string
        roomName: string
        period: string
    }
}

export type TEmailTemplate = keyof IEmailTemplateData

interface ISendEmailPayload<T extends TEmailTemplate> {
    to: string
    subject: string
    templateName: T
    templateData: IEmailTemplateData[T]
    // Plain-text alternative: helps deliverability and shows in lock-screen previews
    text?: string
    attachments?: SendMailOptions['attachments']
}

// Available in every template (used by the shared layout partials)
const getSharedTemplateData = () => ({
    appName: APP_NAME,
    frontendUrl: config.frontend_url ?? 'http://localhost:3000',
    currentYear: new Date().getFullYear(),
})

// e.g. "28 Sept 2026, 14:05 (Bangladesh time)"
export const formatEmailDate = (date: Date = new Date()) =>
    `${date.toLocaleString('en-GB', {
        timeZone: 'Asia/Dhaka',
        dateStyle: 'medium',
        timeStyle: 'short',
    })} (Bangladesh time)`

export const sendEmail = async <T extends TEmailTemplate>({
    to,
    subject,
    templateName,
    templateData,
    text,
    attachments,
}: ISendEmailPayload<T>) => {
    const templatePath = path.join(process.cwd(), `src/app/templates/${templateName}.ejs`)
    const html = await ejs.renderFile(templatePath, { ...getSharedTemplateData(), ...templateData })

    await transporter.sendMail({
        from: config.email_sender,
        to,
        subject,
        html,
        text,
        attachments,
    })
}

// For emails that must not fail an action that already succeeded (welcome, confirmations)
export const sendEmailSafely = async <T extends TEmailTemplate>(payload: ISendEmailPayload<T>) => {
    try {
        await sendEmail(payload)
    } catch (error) {
        console.error(`Failed to send "${payload.templateName}" email to ${payload.to}:`, error)
    }
}
