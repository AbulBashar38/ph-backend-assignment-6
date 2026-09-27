import type { NextFunction, Request, Response } from 'express'
import httpStatus from 'http-status'
import { ZodError } from 'zod'
import { Prisma } from '../../generated/prisma/client'
import config from '../config'
import { AppError } from '../utils/AppError'

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
    } else if (err?.type === 'entity.parse.failed') {
        // Malformed JSON body (thrown by express.json())
        statusCode = httpStatus.BAD_REQUEST
        errorMessage = 'Malformed JSON In Request Body'
    }

    // Client errors (4xx) keep their message in production; server errors don't leak details
    const isServerError = statusCode >= 500

    res.status(statusCode).json({
        success: false,
        statusCode,
        name: isDevelopment ? errorName : undefined,
        message: isServerError && !isDevelopment ? 'Internal Server Error' : errorMessage,
        error: isDevelopment ? err : undefined,
        stack: isDevelopment ? err?.stack : undefined,
    })
}
