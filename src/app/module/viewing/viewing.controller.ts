import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { ViewingServices } from './viewing.service'

const createViewing = catchAsync(async (req: Request, res: Response) => {
    const result = await ViewingServices.createViewing(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Viewing Requested Successfully',
        data: result,
    })
})

const getViewings = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ViewingServices.getViewings(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Viewing Requests Retrieved Successfully',
        data,
        meta,
    })
})

const getViewingById = catchAsync(async (req: Request, res: Response) => {
    const result = await ViewingServices.getViewingById(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Viewing Request Retrieved Successfully',
        data: result,
    })
})

const statusMessages: Record<string, string> = {
    APPROVED: 'Viewing Approved Successfully',
    REJECTED: 'Viewing Rejected Successfully',
    RESCHEDULED: 'Viewing Rescheduled Successfully',
    COMPLETED: 'Viewing Marked As Completed',
    CANCELLED: 'Viewing Cancelled Successfully',
}

const updateViewingStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await ViewingServices.updateViewingStatus(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: statusMessages[req.body.status],
        data: result,
    })
})

export const ViewingController = {
    createViewing,
    getViewings,
    getViewingById,
    updateViewingStatus,
}
