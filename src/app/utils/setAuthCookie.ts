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

// Sent with every request (not just /api/v1/auth) so the frontend's route guard can tell a signed-in user whose
// short-lived access cookie has expired from a signed-out one. It's httpOnly, and only the refresh route accepts it.
const refreshCookieOptions: CookieOptions = { ...baseCookieOptions, path: '/' }

// Where the refresh cookie used to live; cleared so browsers don't keep sending an old copy alongside the new one
const legacyRefreshCookieOptions: CookieOptions = { ...baseCookieOptions, path: '/api/v1/auth' }

export const setAuthCookies = (res: Response, { accessToken, refreshToken }: IAuthTokens) => {
    res.cookie('accessToken', accessToken, {
        ...baseCookieOptions,
        maxAge: jwtUtils.getRemainingLifetimeMs(accessToken),
    })
    res.cookie('refreshToken', refreshToken, {
        ...refreshCookieOptions,
        maxAge: jwtUtils.getRemainingLifetimeMs(refreshToken),
    })
    res.clearCookie('refreshToken', legacyRefreshCookieOptions)
}

export const clearAuthCookies = (res: Response) => {
    res.clearCookie('accessToken', baseCookieOptions)
    res.clearCookie('refreshToken', refreshCookieOptions)
    res.clearCookie('refreshToken', legacyRefreshCookieOptions)
}
