import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { AnalyticsServices } from './analytics.service'

const getPlatformStats = catchAsync(async (_req: Request, res: Response) => {
    const result = await AnalyticsServices.getPlatformStats()

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Platform Statistics Retrieved Successfully',
        data: result,
    })
})

const getOwnerStats = catchAsync(async (req: Request, res: Response) => {
    const result = await AnalyticsServices.getOwnerStats((req.user as RequestUser).userId)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Owner Statistics Retrieved Successfully',
        data: result,
    })
})

export const AnalyticsController = {
    getPlatformStats,
    getOwnerStats,
}
