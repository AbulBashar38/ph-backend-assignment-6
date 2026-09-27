import type { CookieOptions, Response } from 'express'
import config from '../config'
import type { IAuthTokens } from './authTokens'
import { jwtUtils } from './jwt'

const isProduction = config.node_env === 'production'

// Browsers drop `sameSite: 'none'` cookies that aren't `secure`, so only use it in production (HTTPS)
const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
}

// The refresh token is only ever needed by the auth routes
const refreshCookieOptions: CookieOptions = { ...baseCookieOptions, path: '/api/v1/auth' }

export const setAuthCookies = (res: Response, { accessToken, refreshToken }: IAuthTokens) => {
    res.cookie('accessToken', accessToken, {
        ...baseCookieOptions,
        maxAge: jwtUtils.getRemainingLifetimeMs(accessToken),
    })
    res.cookie('refreshToken', refreshToken, {
        ...refreshCookieOptions,
        maxAge: jwtUtils.getRemainingLifetimeMs(refreshToken),
    })
}

export const clearAuthCookies = (res: Response) => {
    res.clearCookie('accessToken', baseCookieOptions)
    res.clearCookie('refreshToken', refreshCookieOptions)
}
