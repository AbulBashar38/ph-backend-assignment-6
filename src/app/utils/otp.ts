import { randomInt, timingSafeEqual } from 'node:crypto'
import httpStatus from 'http-status'
import { redisClient } from '../lib/redis'
import { AppError } from './AppError'

export type TOtpPurpose = 'user-registration' | 'forgot-password'

export const OTP_EXPIRATION_SECONDS = 5 * 60
const OTP_RESEND_COOLDOWN_SECONDS = 60
const OTP_MAX_ATTEMPTS = 5

const otpKey = (purpose: TOtpPurpose, email: string) => `${purpose}-otp:${email}`
const attemptsKey = (purpose: TOtpPurpose, email: string) => `otp-attempts:${purpose}:${email}`
const cooldownKey = (purpose: TOtpPurpose, email: string) => `otp-cooldown:${purpose}:${email}`

// Creates a fresh OTP. Throws 429 if one was sent for this email less than a minute ago.
const createOtp = async (purpose: TOtpPurpose, email: string) => {
    const cooldownSet = await redisClient.set(cooldownKey(purpose, email), '1', {
        expiration: { type: 'EX', value: OTP_RESEND_COOLDOWN_SECONDS },
        condition: 'NX',
    })

    if (!cooldownSet) {
        throw new AppError(
            httpStatus.TOO_MANY_REQUESTS,
            'Please Wait A Minute Before Requesting Another OTP',
        )
    }

    const otp = randomInt(100000, 1000000).toString()

    await redisClient.set(otpKey(purpose, email), otp, {
        expiration: { type: 'EX', value: OTP_EXPIRATION_SECONDS },
    })
    await redisClient.del(attemptsKey(purpose, email))

    return otp
}

// Deletes the OTP on success. After too many wrong attempts the OTP is deleted too.
const verifyOtp = async (purpose: TOtpPurpose, email: string, otp: string) => {
    const storedOtp = await redisClient.get(otpKey(purpose, email))

    if (!storedOtp) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'OTP Expired Or Not Found. Please Request A New One',
        )
    }

    const isMatch =
        storedOtp.length === otp.length && timingSafeEqual(Buffer.from(storedOtp), Buffer.from(otp))

    if (!isMatch) {
        const attempts = await redisClient.incr(attemptsKey(purpose, email))
        if (attempts === 1) {
            await redisClient.expire(attemptsKey(purpose, email), OTP_EXPIRATION_SECONDS)
        }

        if (attempts >= OTP_MAX_ATTEMPTS) {
            await redisClient.del([otpKey(purpose, email), attemptsKey(purpose, email)])
            throw new AppError(
                httpStatus.TOO_MANY_REQUESTS,
                'Too Many Wrong Attempts. Please Request A New OTP',
            )
        }

        throw new AppError(httpStatus.BAD_REQUEST, 'Invalid OTP')
    }

    await redisClient.del([otpKey(purpose, email), attemptsKey(purpose, email)])
}

// Used when the OTP email could not be sent, so the user can retry immediately
const clearOtp = async (purpose: TOtpPurpose, email: string) => {
    await redisClient.del([
        otpKey(purpose, email),
        attemptsKey(purpose, email),
        cooldownKey(purpose, email),
    ])
}

export const otpUtils = {
    createOtp,
    verifyOtp,
    clearOtp,
}
