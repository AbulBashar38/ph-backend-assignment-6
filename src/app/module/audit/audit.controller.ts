import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { IQuery } from '../../interfaces'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { AuditServices } from './audit.service'

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await AuditServices.getAuditLogs(req.query as IQuery)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Audit Logs Retrieved Successfully',
        data,
        meta,
    })
})

const getAuditLogById = catchAsync(async (req: Request, res: Response) => {
    const result = await AuditServices.getAuditLogById(req.params.id as string)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Audit Log Retrieved Successfully',
        data: result,
    })
})

export const AuditController = {
    getAuditLogs,
    getAuditLogById,
}
