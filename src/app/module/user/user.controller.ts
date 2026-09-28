import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { clearAuthCookies } from '../../utils/setAuthCookie'
import { UserServices } from './user.service'

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await UserServices.getAllUsers(req.query as IQuery)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Users Retrieved Successfully',
        data,
        meta,
    })
})

const getUserById = catchAsync(async (req: Request, res: Response) => {
    const result = await UserServices.getUserById(req.user as RequestUser, req.params.id as string)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'User Retrieved Successfully',
        data: result,
    })
})

const updateUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserServices.updateUser(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'User Updated Successfully',
        data: result,
    })
})

const deleteUser = catchAsync(async (req: Request, res: Response) => {
    const { isSelf } = await UserServices.deleteUser(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    // Only log the caller out when they deleted their own account (not when an admin deletes someone)
    if (isSelf) {
        clearAuthCookies(res)
    }

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: isSelf ? 'Your Account Was Deleted Successfully' : 'User Deleted Successfully',
        data: null,
    })
})

export const UserController = {
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
}
