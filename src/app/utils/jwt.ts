import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken'

const createToken = (payload: JwtPayload, secret: string, expiresIn: string) => {
    return jwt.sign(payload, secret, { expiresIn } as SignOptions)
}

const verifyToken = (token: string, secret: string) => {
    try {
        const verifiedToken = jwt.verify(token, secret) as JwtPayload
        return {
            success: true as const,
            data: verifiedToken,
        }
    } catch (error) {
        return {
            success: false as const,
            error: (error as Error).message,
        }
    }
}

// Milliseconds until the token's `exp`, used for cookie maxAge and Redis TTLs
const getRemainingLifetimeMs = (token: string) => {
    const decoded = jwt.decode(token) as JwtPayload | null
    return decoded?.exp ? decoded.exp * 1000 - Date.now() : 0
}

export const jwtUtils = {
    createToken,
    verifyToken,
    getRemainingLifetimeMs,
}
