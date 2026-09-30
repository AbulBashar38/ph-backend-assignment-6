import type { Request, Response } from 'express'
import httpStatus from 'http-status'
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

export const AnalyticsController = {
    getPlatformStats,
}
