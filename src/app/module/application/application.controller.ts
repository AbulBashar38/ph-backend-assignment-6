import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { ApplicationServices } from './application.service'

const createApplication = catchAsync(async (req: Request, res: Response) => {
    const result = await ApplicationServices.createApplication(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Application Submitted Successfully',
        data: result,
    })
})

const statusMessages: Record<string, string> = {
    APPROVED: 'Application Approved: Rental Created And Room Reserved',
    REJECTED: 'Application Rejected Successfully',
    CANCELLED: 'Application Cancelled Successfully',
}

const updateApplicationStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await ApplicationServices.updateApplicationStatus(
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

const getApplications = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ApplicationServices.getApplications(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Applications Retrieved Successfully',
        data,
        meta,
    })
})

const getApplicationById = catchAsync(async (req: Request, res: Response) => {
    const result = await ApplicationServices.getApplicationById(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Application Retrieved Successfully',
        data: result,
    })
})

export const ApplicationController = {
    createApplication,
    updateApplicationStatus,
    getApplications,
    getApplicationById,
}
