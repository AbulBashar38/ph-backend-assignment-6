import type { NextFunction, Request, Response } from 'express'
import httpStatus from 'http-status'
import { type Role, UserStatus } from '../../generated/prisma/enums'
import config from '../config'
import { prisma } from '../lib/prisma'
import { AppError } from '../utils/AppError'
import { catchAsync } from '../utils/catchAsync'
import { jwtUtils } from '../utils/jwt'

export interface RequestUser {
    userId: string
    name: string
    email: string
    role: Role
}

declare global {
    namespace Express {
        interface Request {
            user?: RequestUser
        }
    }
}

// auth() => any logged-in user, auth(Role.OWNER) => owners only
export const auth = (...requiredRoles: Role[]) => {
    return catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
        const authorization = req.headers.authorization
        const token =
            req.cookies?.accessToken ??
            (authorization?.startsWith('Bearer ') ? authorization.split(' ')[1] : authorization)

        if (!token) {
            throw new AppError(
                httpStatus.UNAUTHORIZED,
                'You Are Not Logged In. Please Log In To Access This Resource',
            )
        }

        const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret)

        if (!verifiedToken.success) {
            throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Or Expired Access Token')
        }

        // Look the user up by id only, so a name/email change doesn't invalidate the token
        const user = await prisma.user.findUnique({
            where: { id: verifiedToken.data.userId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                isDeleted: true,
            },
        })

        if (!user || user.isDeleted || user.status === UserStatus.DELETED) {
            throw new AppError(httpStatus.UNAUTHORIZED, 'User Not Found. Please Log In Again')
        }

        if (user.status === UserStatus.BLOCKED) {
            throw new AppError(
                httpStatus.FORBIDDEN,
                'Your Account Has Been Blocked. Please Contact Support',
            )
        }

        // Check the current role from the DB, not the (possibly stale) one in the token
        if (requiredRoles.length && !requiredRoles.includes(user.role)) {
            throw new AppError(
                httpStatus.FORBIDDEN,
                "Forbidden. You Don't Have Permission To Access This Resource",
            )
        }

        req.user = {
            userId: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
        }

        next()
    })
}
