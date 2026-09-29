import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { RoomServices } from './room.service'

const createRoom = catchAsync(async (req: Request, res: Response) => {
    const result = await RoomServices.createRoom(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Room Created Successfully',
        data: result,
    })
})

const getRooms = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RoomServices.getRooms(req.user as RequestUser, req.query as IQuery)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Rooms Retrieved Successfully',
        data,
        meta,
    })
})

const getRoomById = catchAsync(async (req: Request, res: Response) => {
    const result = await RoomServices.getRoomById(req.user as RequestUser, req.params.id as string)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Room Retrieved Successfully',
        data: result,
    })
})

const getPublicRooms = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RoomServices.getPublicRooms(req.query as IQuery)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Rooms Retrieved Successfully',
        data,
        meta,
    })
})

const getPublicRoomById = catchAsync(async (req: Request, res: Response) => {
    const result = await RoomServices.getPublicRoomById(req.params.id as string)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Room Retrieved Successfully',
        data: result,
    })
})

const updateRoom = catchAsync(async (req: Request, res: Response) => {
    const result = await RoomServices.updateRoom(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Room Updated Successfully',
        data: result,
    })
})

const updateRoomStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await RoomServices.updateRoomStatus(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Room Status Updated Successfully',
        data: result,
    })
})

const archiveRoom = catchAsync(async (req: Request, res: Response) => {
    await RoomServices.archiveRoom(req.user as RequestUser, req.params.id as string)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Room Removed Successfully',
        data: null,
    })
})

const addImages = catchAsync(async (req: Request, res: Response) => {
    const result = await RoomServices.addImages(
        req.user as RequestUser,
        req.params.id as string,
        req.files as Express.Multer.File[] | undefined,
    )

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Images Added Successfully',
        data: result,
    })
})

const removeImage = catchAsync(async (req: Request, res: Response) => {
    const result = await RoomServices.removeImage(
        req.user as RequestUser,
        req.params.id as string,
        req.params.imageId as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Image Removed Successfully',
        data: result,
    })
})

export const RoomController = {
    createRoom,
    getRooms,
    getRoomById,
    getPublicRooms,
    getPublicRoomById,
    updateRoom,
    updateRoomStatus,
    archiveRoom,
    addImages,
    removeImage,
}
