import type { NextFunction, Request, Response } from 'express'
import httpStatus from 'http-status'
import { MulterError } from 'multer'
import { ZodError } from 'zod'
import { Prisma } from '../../generated/prisma/client'
import config from '../config'
import { AppError } from '../utils/AppError'

const multerErrorMessages: Partial<Record<MulterError['code'], string>> = {
    LIMIT_FILE_SIZE: 'File Is Too Large',
    LIMIT_FILE_COUNT: 'Too Many Files',
    LIMIT_UNEXPECTED_FILE: 'Unexpected File Field',
    LIMIT_PART_COUNT: 'Too Many Form Fields',
    LIMIT_FIELD_KEY: 'Form Field Name Is Too Long',
    LIMIT_FIELD_VALUE: 'Form Field Value Is Too Long',
    LIMIT_FIELD_COUNT: 'Too Many Form Fields',
}

export const globalErrorHandler = (
    // biome-ignore lint/suspicious/noExplicitAny: Express error middleware receives an unknown thrown value
    err: any,
    _req: Request,
    res: Response,
    _next: NextFunction,
) => {
    const isDevelopment = config.node_env === 'development'

    if (isDevelopment) {
        console.log('Error from Global Error Handler', err)
    }

    let statusCode: number = httpStatus.INTERNAL_SERVER_ERROR
    let errorMessage: string = err?.message || 'Internal Server Error'
    const errorName: string = err?.name || 'Error'

    if (err instanceof AppError) {
        statusCode = err.statusCode
    } else if (err instanceof ZodError) {
        statusCode = httpStatus.BAD_REQUEST
        errorMessage = err.issues[0]?.message ?? 'Invalid Request Data'
    } else if (err instanceof Prisma.PrismaClientValidationError) {
        statusCode = httpStatus.BAD_REQUEST
        errorMessage = 'You Have Provided Incorrect Field Type Or Missing Fields'
    } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
            statusCode = httpStatus.CONFLICT
            errorMessage = 'A Record With This Unique Value Already Exists'
        } else if (err.code === 'P2003') {
            statusCode = httpStatus.BAD_REQUEST
            errorMessage = 'Foreign Key Constraint Failed'
        } else if (err.code === 'P2025') {
            statusCode = httpStatus.NOT_FOUND
            errorMessage = 'Requested Record Was Not Found'
        }
    } else if (err instanceof Prisma.PrismaClientInitializationError) {
        errorMessage = "Can't Connect To The Database"
    } else if (err instanceof MulterError) {
        // Upload problems are the client's fault: wrong field name, too many or too large files
        statusCode =
            err.code === 'LIMIT_FILE_SIZE'
                ? httpStatus.REQUEST_ENTITY_TOO_LARGE
                : httpStatus.BAD_REQUEST
        errorMessage = multerErrorMessages[err.code] ?? err.message
        if (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field) {
            errorMessage = `Unexpected File Field "${err.field}". Check The Field Name And The Number Of Files`
        }
    } else if (err?.type === 'entity.parse.failed') {
        // Malformed JSON body (thrown by express.json())
        statusCode = httpStatus.BAD_REQUEST
        errorMessage = 'Malformed JSON In Request Body'
    }

    // AppError messages are written by us (safe to show, e.g. 502 "Failed To Upload File"), and 4xx messages
    // describe the client's mistake. Only unexpected server errors hide their details outside development.
    const canShowMessage = isDevelopment || err instanceof AppError || statusCode < 500

    res.status(statusCode).json({
        success: false,
        statusCode,
        name: isDevelopment ? errorName : undefined,
        message: canShowMessage ? errorMessage : 'Internal Server Error',
        error: isDevelopment ? err : undefined,
        stack: isDevelopment ? err?.stack : undefined,
    })
}
