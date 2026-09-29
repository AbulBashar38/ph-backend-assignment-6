import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { RentalServices } from './rental.service'

const getRentals = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await RentalServices.getRentals(
        req.user as RequestUser,
        req.query as IQuery,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Rentals Retrieved Successfully',
        data,
        meta,
    })
})

const getRentalById = catchAsync(async (req: Request, res: Response) => {
    const result = await RentalServices.getRentalById(
        req.user as RequestUser,
        req.params.id as string,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Rental Retrieved Successfully',
        data: result,
    })
})

const updateRentalStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await RentalServices.updateRentalStatus(
        req.user as RequestUser,
        req.params.id as string,
        req.body,
    )

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message:
            req.body.status === 'COMPLETED'
                ? 'Rental Completed Successfully'
                : 'Rental Terminated Successfully',
        data: result,
    })
})

export const RentalController = {
    getRentals,
    getRentalById,
    updateRentalStatus,
}
