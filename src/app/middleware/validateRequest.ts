import type { NextFunction, Request, Response } from 'express'
import httpStatus from 'http-status'
import type { z } from 'zod'
import { AppError } from '../utils/AppError'
import { catchAsync } from '../utils/catchAsync'

// Validates req.body against the schema and replaces it with the parsed (trimmed/coerced) data
export const validateRequest = (zodSchema: z.ZodType) => {
    return catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
        const result = await zodSchema.safeParseAsync(req.body ?? {})

        if (!result.success) {
            throw new AppError(httpStatus.BAD_REQUEST, result.error.issues[0].message)
        }

        req.body = result.data
        next()
    })
}
