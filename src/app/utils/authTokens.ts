import { randomUUID } from 'node:crypto'
import type { Role } from '../../generated/prisma/enums'
import config from '../config'
import { redisClient } from '../lib/redis'
import { jwtUtils } from './jwt'

export interface ITokenUser {
    id: string
    name: string
    email: string
    role: Role
}

export interface IAuthTokens {
    accessToken: string
    refreshToken: string
}

// One key per refresh token (jti), so a user can stay logged in on several devices.
// Value is ACTIVE until the token is rotated, then `used:<timestamp>` (kept until expiry to detect reuse).
const refreshTokenKey = (userId: string, jti: string) => `refresh-token:${userId}:${jti}`
const ACTIVE = 'active'
const USED_PREFIX = 'used:'

// Two tabs refreshing at the same moment is normal; a replay after this window is treated as theft
const REUSE_GRACE_PERIOD_MS = 10 * 1000

const issueAuthTokens = async (user: ITokenUser): Promise<IAuthTokens> => {
    const jwtPayload = {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
    }

    const accessToken = jwtUtils.createToken(
        jwtPayload,
        config.jwt_access_secret,
        config.jwt_access_expires_in,
    )

    const jti = randomUUID()
    const refreshToken = jwtUtils.createToken(
        { ...jwtPayload, jti },
        config.jwt_refresh_secret,
        config.jwt_refresh_expires_in,
    )

    const refreshTtlSeconds = Math.ceil(jwtUtils.getRemainingLifetimeMs(refreshToken) / 1000)

    await redisClient.set(refreshTokenKey(user.id, jti), ACTIVE, {
        expiration: { type: 'EX', value: refreshTtlSeconds },
    })

    return { accessToken, refreshToken }
}

/**
 * Atomically marks a refresh token as used (SET … XX KEEPTTL GET) and reports its previous state:
 * - 'claimed':   it was active, and this caller may issue new tokens (concurrent callers can't both win)
 * - 'concurrent': it was rotated moments ago (parallel requests from the same client): reject, no penalty
 * - 'reused':    it was rotated a while ago and is being replayed (likely stolen)
 * - 'unknown':   logged out, revoked, or expired
 */
const claimRefreshToken = async (userId: string, jti: string) => {
    const previousValue = await redisClient.set(
        refreshTokenKey(userId, jti),
        `${USED_PREFIX}${Date.now()}`,
        { condition: 'XX', expiration: 'KEEPTTL', GET: true },
    )

    if (previousValue === ACTIVE) {
        return 'claimed' as const
    }

    if (typeof previousValue === 'string' && previousValue.startsWith(USED_PREFIX)) {
        const usedAt = Number(previousValue.slice(USED_PREFIX.length))
        return Date.now() - usedAt <= REUSE_GRACE_PERIOD_MS
            ? ('concurrent' as const)
            : ('reused' as const)
    }

    return 'unknown' as const
}

const revokeRefreshToken = async (userId: string, jti: string) => {
    await redisClient.del(refreshTokenKey(userId, jti))
}

// Logs the user out everywhere: password change/reset, suspected token reuse, admin block
const revokeAllRefreshTokens = async (userId: string) => {
    for await (const keys of redisClient.scanIterator({
        MATCH: `refresh-token:${userId}:*`,
        COUNT: 100,
    })) {
        if (keys.length) {
            await redisClient.del(keys)
        }
    }
}

export const authTokenUtils = {
    issueAuthTokens,
    claimRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokens,
}
