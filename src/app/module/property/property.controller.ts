import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { PropertyServices } from './property.service'

const createProperty = catchAsync(async (req: Request, res: Response) => {
    const result = await PropertyServices.createProperty(req.user as RequestUser, req.body)

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Property Created Successfully',
        data: result,
    })
})

const getProperties = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await PropertyServices.getProperties(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Properties Retrieved Successfully',
        data,
        meta,
    })
})

const getPublicProperties = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await PropertyServices.getPublicProperties(req.query as IQuery)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Properties Retrieved Successfully',
        data,
        meta,
    })
})

const getPublicPropertyById = catchAsync(async (req: Request, res: Response) => {
    const result = await PropertyServices.getPublicPropertyById(req.params.id as string)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Property Retrieved Successfully',
        data: result,
    })
})

const getPropertyById = catchAsync(async (req: Request, res: Response) => {
    const result = await PropertyServices.getPropertyById(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Property Retrieved Successfully',
        data: result,
    })
})

const updateProperty = catchAsync(async (req: Request, res: Response) => {
    const result = await PropertyServices.updateProperty(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Property Updated Successfully',
        data: result,
    })
})

const updatePropertyStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await PropertyServices.updatePropertyStatus(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Property Status Updated Successfully',
        data: result,
    })
})

const archiveProperty = catchAsync(async (req: Request, res: Response) => {
    await PropertyServices.archiveProperty(req.user as RequestUser, req.params.id as string)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Property Removed From Listings Successfully',
        data: null,
    })
})

const addImages = catchAsync(async (req: Request, res: Response) => {
    const result = await PropertyServices.addImages(
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
    const result = await PropertyServices.removeImage(
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

export const PropertyController = {
    createProperty,
    getProperties,
    getPublicProperties,
    getPublicPropertyById,
    getPropertyById,
    updateProperty,
    updatePropertyStatus,
    archiveProperty,
    addImages,
    removeImage,
}
