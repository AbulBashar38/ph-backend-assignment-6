import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { ContactServices } from './contact.service'

// The browser's IP as forwarded by the proxy in front of the API (Vercel / the frontend rewrite)
const clientIp = (req: Request) => {
    const forwarded = req.headers['x-forwarded-for']
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    return first || req.ip
}

const sendContactMessage = catchAsync(async (req: Request, res: Response) => {
    await ContactServices.sendContactMessage(req.body, clientIp(req))

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Message Sent. We Will Get Back To You Soon',
        data: null,
    })
})

export const ContactController = {
    sendContactMessage,
}
