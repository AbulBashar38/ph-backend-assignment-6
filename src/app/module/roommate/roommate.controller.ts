import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
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

const getMatches = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RoommateServices.getMatches(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Matches Retrieved Successfully',
        data,
        meta,
    })
})

const getProfileById = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.getProfileById(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Profile Retrieved Successfully',
        data: result,
    })
})

// ---------- connection requests ----------

const sendRoommateRequest = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.sendRoommateRequest(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Roommate Request Sent Successfully',
        data: result,
    })
})

const updateRoommateRequestStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.updateRoommateRequestStatus(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Request Status Updated Successfully',
        data: result,
    })
})

const getRoommateRequests = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RoommateServices.getRoommateRequests(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Requests Retrieved Successfully',
        data,
        meta,
    })
})

const getRoommateRequestById = catchAsync(async (req: Request, res: Response) => {
    const result = await RoommateServices.getRoommateRequestById(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Request Retrieved Successfully',
        data: result,
    })
})

const getConnections = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RoommateServices.getConnections(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Roommate Connections Retrieved Successfully',
        data,
        meta,
    })
})

export const RoommateController = {
    getMatches,
    getProfileById,
    sendRoommateRequest,
    updateRoommateRequestStatus,
    getRoommateRequests,
    getRoommateRequestById,
    getConnections,
    createMyProfile,
    getMyProfile,
    updateMyProfile,
    updateMyProfileStatus,
}
