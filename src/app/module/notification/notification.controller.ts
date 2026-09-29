import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { NotificationServices } from './notification.service'

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await NotificationServices.getMyNotifications(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Notifications Retrieved Successfully',
        data,
        meta,
    })
})

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
    const result = await NotificationServices.getUnreadCount(req.user as RequestUser)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Unread Count Retrieved Successfully',
        data: result,
    })
})

const markAsRead = catchAsync(async (req: Request, res: Response) => {
    const result = await NotificationServices.markAsRead(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Notification Marked As Read',
        data: result,
    })
})

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
    const result = await NotificationServices.markAllAsRead(req.user as RequestUser)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'All Notifications Marked As Read',
        data: result,
    })
})

export const NotificationController = {
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
}
