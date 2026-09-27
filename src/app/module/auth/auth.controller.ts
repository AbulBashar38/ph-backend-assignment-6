import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import type { RequestUser } from '../../middleware/checkAuth'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { clearAuthCookies, setAuthCookies } from '../../utils/setAuthCookie'
import { AuthService } from './auth.service'

// Browsers send the refresh token as a cookie; Postman/mobile clients may send it in the body
const getRefreshTokenFromRequest = (req: Request): string | undefined =>
    req.cookies?.refreshToken ?? req.body?.refreshToken

const registerUser = catchAsync(async (req: Request, res: Response) => {
    await AuthService.registerUser(req.body)

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Verification OTP Sent To Your Email',
        data: null,
    })
})

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.verifyEmail(req.body)
    const { accessToken, refreshToken, user } = result

    setAuthCookies(res, { accessToken, refreshToken })

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Email Verified And Account Created Successfully',
        data: { accessToken, refreshToken, user },
    })
})

const resendVerificationOtp = catchAsync(async (req: Request, res: Response) => {
    await AuthService.resendVerificationOtp(req.body)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'A New Verification OTP Has Been Sent',
        data: null,
    })
})

const loginUser = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.loginUser(req.body)
    const { accessToken, refreshToken, user } = result

    setAuthCookies(res, { accessToken, refreshToken })

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'User Logged In Successfully',
        data: { accessToken, refreshToken, user },
    })
})

const refreshToken = catchAsync(async (req: Request, res: Response) => {
    const tokens = await AuthService.refreshToken(getRefreshTokenFromRequest(req))

    setAuthCookies(res, tokens)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'New Tokens Generated Successfully',
        data: tokens,
    })
})

const logoutUser = catchAsync(async (req: Request, res: Response) => {
    await AuthService.logoutUser(getRefreshTokenFromRequest(req))

    clearAuthCookies(res)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'User Logged Out Successfully',
        data: null,
    })
})

const getMe = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.getMe(req.user as RequestUser)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'User Profile Retrieved Successfully',
        data: result,
    })
})

const changePassword = catchAsync(async (req: Request, res: Response) => {
    const tokens = await AuthService.changePassword(req.user as RequestUser, req.body)

    setAuthCookies(res, tokens)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Password Changed Successfully',
        data: tokens,
    })
})

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
    await AuthService.forgotPassword(req.body)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Password Reset OTP Sent To Your Email',
        data: null,
    })
})

const resetPassword = catchAsync(async (req: Request, res: Response) => {
    await AuthService.resetPassword(req.body)

    clearAuthCookies(res)

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Password Reset Successfully. Please Log In With Your New Password',
        data: null,
    })
})

export const AuthController = {
    registerUser,
    verifyEmail,
    resendVerificationOtp,
    loginUser,
    refreshToken,
    logoutUser,
    getMe,
    changePassword,
    forgotPassword,
    resetPassword,
}
