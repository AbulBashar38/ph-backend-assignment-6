import httpStatus from 'http-status'
import config from '../../config'
import { redisClient } from '../../lib/redis'
import { AppError } from '../../utils/AppError'
import { formatEmailDate, sendEmail } from '../../utils/sendEmail'
import {
    CONTACT_WINDOW_SECONDS,
    contactEmailKey,
    contactIpKey,
    MAX_MESSAGES_PER_EMAIL,
    MAX_MESSAGES_PER_IP,
} from './contact.constant'
import type { IContactPayload } from './contact.interface'

// Counts one message against a limit; returns false once the limit for this hour is used up
const consumeQuota = async (key: string, limit: number) => {
    const count = await redisClient.incr(key)
    if (count === 1) {
        await redisClient.expire(key, CONTACT_WINDOW_SECONDS)
    }
    return count <= limit
}

const sendContactMessage = async (payload: IContactPayload, ip: string | undefined) => {
    const withinEmailLimit = await consumeQuota(
        contactEmailKey(payload.email),
        MAX_MESSAGES_PER_EMAIL,
    )
    const withinIpLimit = ip ? await consumeQuota(contactIpKey(ip), MAX_MESSAGES_PER_IP) : true

    if (!withinEmailLimit || !withinIpLimit) {
        throw new AppError(
            httpStatus.TOO_MANY_REQUESTS,
            'You Have Sent Several Messages Recently. Please Try Again In An Hour',
        )
    }

    // The team's inbox; replying goes straight to the person who wrote in
    await sendEmail({
        to: config.contact_email ?? config.smtp_user,
        replyTo: `${payload.name} <${payload.email}>`,
        subject: `Contact form: ${payload.subject}`,
        templateName: 'contact-message',
        templateData: { ...payload, sentAt: formatEmailDate() },
        text: `${payload.name} <${payload.email}> wrote:\n\n${payload.message}`,
    })
}

export const ContactServices = {
    sendContactMessage,
}
