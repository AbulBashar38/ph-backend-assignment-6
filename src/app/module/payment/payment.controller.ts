import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { PaymentServices } from './payment.service'

const createCheckoutSession = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentServices.createCheckoutSession(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Checkout Session Created Successfully',
        data: result,
    })
})

// req.body is the raw Buffer here (see app.ts): the signature is computed over the exact bytes Stripe sent
const handleStripeWebhook = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentServices.handleStripeWebhook(
        req.body,
        req.headers['stripe-signature'] as string | undefined,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Webhook Received',
        data: result,
    })
})

const getPayments = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await PaymentServices.getPayments(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Payments Retrieved Successfully',
        data,
        meta,
    })
})

const getPaymentById = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentServices.getPaymentById(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Payment Retrieved Successfully',
        data: result,
    })
})

const getPaymentBySessionId = catchAsync(async (req: Request, res: Response) => {
    const result = await PaymentServices.getPaymentBySessionId(
        req.user as RequestUser,
        req.params.sessionId as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Payment Retrieved Successfully',
        data: result,
    })
})

const getPaymentReceipt = catchAsync(async (req: Request, res: Response) => {
    const { pdf, filename } = await PaymentServices.getPaymentReceipt(
        req.user as RequestUser,
        req.params.id as string,
    )

    res.status(httpStatus.OK)
        .set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': pdf.length,
        })
        .send(pdf)
})

export const PaymentController = {
    createCheckoutSession,
    handleStripeWebhook,
    getPayments,
    getPaymentById,
    getPaymentBySessionId,
    getPaymentReceipt,
}
