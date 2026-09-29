import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { RoommateServices } from './roommate.service'

const createMyProfile = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.createMyProfile(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Roommate Profile Created Successfully',
        data: result,
    })
})

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.getMyProfile(req.user as RequestUser)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Profile Retrieved Successfully',
        data: result,
    })
})

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.updateMyProfile(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Profile Updated Successfully',
        data: result,
    })
})

const updateMyProfileStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.updateMyProfileStatus(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: result.isActive ? 'Roommate Search Turned On' : 'Roommate Search Turned Off',
        data: result,
    })
})

export const RoommateController = {
    createMyProfile,
    getMyProfile,
    updateMyProfile,
    updateMyProfileStatus,
}
