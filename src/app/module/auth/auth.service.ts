import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import { AuthProvider, UserStatus } from '../../../generated/prisma/enums'
import config from '../../config'
import { googleClient } from '../../lib/googleAuth'
import { prisma } from '../../lib/prisma'
import { redisClient } from '../../lib/redis'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { authTokenUtils } from '../../utils/authTokens'
import { jwtUtils } from '../../utils/jwt'
import { OTP_EXPIRATION_SECONDS, otpUtils, type TOtpPurpose } from '../../utils/otp'
import { hashPassword } from '../../utils/password'
import { APP_NAME, formatEmailDate, sendEmail, sendEmailSafely } from '../../utils/sendEmail'
import type {
    IChangePasswordPayload,
    IForgotPasswordPayload,
    IGoogleLoginPayload,
    ILoginPayload,
    IPendingRegistration,
    IRegisterPayload,
    IResendOtpPayload,
    IResetPasswordPayload,
    IVerifyEmailPayload,
} from './auth.interface'

// Pending registration outlives the OTP so the user can request a new code without re-registering
const REGISTRATION_DATA_EXPIRATION_SECONDS = 30 * 60

const registrationDataKey = (email: string) => `user-registration-data:${email}`

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const sendOtpEmail = async (
    purpose: TOtpPurpose,
    { name, email, otp }: { name: string; email: string; otp: string },
) => {
    const isRegistration = purpose === 'user-registration'
    const expirationMinutes = OTP_EXPIRATION_SECONDS / 60

    try {
        await sendEmail({
            to: email,
            // Code in the subject so it's readable straight from the notification
            subject: isRegistration
                ? `${otp} is your ${APP_NAME} verification code`
                : `${otp} is your ${APP_NAME} password reset code`,
            templateName: isRegistration ? 'registration-user-otp' : 'forgot-password',
            templateData: { name, email, otp, expirationMinutes },
            text: `Hi ${name},\n\nYour ${isRegistration ? 'verification' : 'password reset'} code is ${otp}. It expires in ${expirationMinutes} minutes.\n\nNever share this code. If you didn't request it, you can ignore this email.\n\n${APP_NAME}`,
        })
    } catch (error) {
        console.error(`Failed to send ${purpose} OTP email to ${email}:`, error)
        await otpUtils.clearOtp(purpose, email)
        throw new AppError(httpStatus.BAD_GATEWAY, 'Failed To Send OTP Email. Please Try Again')
    }
}

const registerUser = async (payload: IRegisterPayload) => {
    const email = normalizeEmail(payload.email)

    const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email }, { phone: payload.phone }] },
        select: { email: true, isDeleted: true },
    })

    if (existingUser?.isDeleted) {
        // Soft-deleted accounts keep their email/phone, so they can't be reused by a new signup
        throw new AppError(
            httpStatus.CONFLICT,
            'This Email Or Phone Belongs To A Deleted Account. Please Contact Support To Restore It',
        )
    }

    if (existingUser) {
        throw new AppError(
            httpStatus.CONFLICT,
            existingUser.email === email
                ? 'User With This Email Already Exists'
                : 'User With This Phone Number Already Exists',
        )
    }

    const otp = await otpUtils.createOtp('user-registration', email)

    const pendingRegistration: IPendingRegistration = {
        name: payload.name,
        email,
        phone: payload.phone,
        password: await hashPassword(payload.password),
        role: payload.role,
    }

    await redisClient.set(registrationDataKey(email), JSON.stringify(pendingRegistration), {
        expiration: { type: 'EX', value: REGISTRATION_DATA_EXPIRATION_SECONDS },
    })

    await sendOtpEmail('user-registration', { name: payload.name, email, otp })
}

const verifyEmail = async (payload: IVerifyEmailPayload) => {
    const email = normalizeEmail(payload.email)

    const pendingRegistrationData = await redisClient.get(registrationDataKey(email))

    if (!pendingRegistrationData) {
        throw new AppError(
            httpStatus.NOT_FOUND,
            'Registration Not Found Or Expired. Please Register Again',
        )
    }

    await otpUtils.verifyOtp('user-registration', email, payload.otp)

    const pendingRegistration: IPendingRegistration = JSON.parse(pendingRegistrationData)

    // A duplicate created in the meantime fails with P2002 → 409 from the global error handler
    const createdUser = await prisma.user.create({
        data: {
            name: pendingRegistration.name,
            email,
            phone: pendingRegistration.phone,
            password: pendingRegistration.password,
            role: pendingRegistration.role,
            authProvider: AuthProvider.CREDENTIAL,
            emailVerified: true,
        },
        omit: { password: true },
    })

    await redisClient.del(registrationDataKey(email))

    await sendEmailSafely({
        to: email,
        subject: `Welcome to ${APP_NAME}, ${createdUser.name}!`,
        templateName: 'welcome-email',
        templateData: { name: createdUser.name, email, role: createdUser.role },
    })

    const tokens = await authTokenUtils.issueAuthTokens(createdUser)

    return { user: createdUser, ...tokens }
}

const resendVerificationOtp = async (payload: IResendOtpPayload) => {
    const email = normalizeEmail(payload.email)

    const pendingRegistrationData = await redisClient.get(registrationDataKey(email))

    if (!pendingRegistrationData) {
        throw new AppError(
            httpStatus.NOT_FOUND,
            'Registration Not Found Or Expired. Please Register Again',
        )
    }

    const pendingRegistration: IPendingRegistration = JSON.parse(pendingRegistrationData)

    const otp = await otpUtils.createOtp('user-registration', email)

    await redisClient.expire(registrationDataKey(email), REGISTRATION_DATA_EXPIRATION_SECONDS)

    await sendOtpEmail('user-registration', { name: pendingRegistration.name, email, otp })
}

const loginUser = async (payload: ILoginPayload) => {
    const email = normalizeEmail(payload.email)

    const user = await prisma.user.findUnique({
        where: { email },
    })

    // Same message for unknown email and wrong password, so emails can't be probed
    if (!user || user.isDeleted || user.status === UserStatus.DELETED) {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Email Or Password')
    }

    if (!user.password) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'This Account Uses Google Login. Please Continue With Google',
        )
    }

    const isPasswordMatched = await bcrypt.compare(payload.password, user.password)

    if (!isPasswordMatched) {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Email Or Password')
    }

    if (user.status === UserStatus.BLOCKED) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'Your Account Has Been Blocked. Please Contact Support',
        )
    }

    const { password: _password, ...userWithoutPassword } = user
    const tokens = await authTokenUtils.issueAuthTokens(user)

    return { user: userWithoutPassword, ...tokens }
}

const verifyGoogleIdToken = async (idToken: string) => {
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: config.google_client_id,
        })
        return ticket.getPayload()
    } catch {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Or Expired Google ID Token')
    }
}

const googleLogin = async (payload: IGoogleLoginPayload) => {
    const googlePayload = await verifyGoogleIdToken(payload.idToken)

    if (!googlePayload?.sub || !googlePayload.email) {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Google Account Email Not Available')
    }

    // Linking/creating by email is only safe if Google has verified that the user owns it
    if (!googlePayload.email_verified) {
        throw new AppError(httpStatus.FORBIDDEN, 'Your Google Email Is Not Verified')
    }

    const googleId = googlePayload.sub
    const email = normalizeEmail(googlePayload.email)
    const name = googlePayload.name?.trim() || email.split('@')[0]

    // A Google ID always maps to the account it was first linked to, even if the Google email changes later
    const existingUser =
        (await prisma.user.findUnique({ where: { googleId } })) ??
        (await prisma.user.findUnique({ where: { email } }))

    if (existingUser?.isDeleted || existingUser?.status === UserStatus.DELETED) {
        throw new AppError(httpStatus.FORBIDDEN, 'This Account Has Been Deleted')
    }

    if (existingUser?.status === UserStatus.BLOCKED) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'Your Account Has Been Blocked. Please Contact Support',
        )
    }

    if (existingUser?.googleId && existingUser.googleId !== googleId) {
        throw new AppError(
            httpStatus.CONFLICT,
            'This Email Is Already Linked To A Different Google Account',
        )
    }

    let isNewUser = false

    const user = existingUser
        ? await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                  googleId,
                  emailVerified: true,
                  // Use the Google photo only if the user has no profile image yet
                  ...(!existingUser.imageUrl && googlePayload.picture
                      ? { imageUrl: googlePayload.picture }
                      : {}),
              },
              omit: { password: true },
          })
        : await (async () => {
              isNewUser = true

              // A concurrent first login for the same account fails with P2002 → 409
              return prisma.user.create({
                  data: {
                      name,
                      email,
                      googleId,
                      authProvider: AuthProvider.GOOGLE,
                      emailVerified: true,
                      role: payload.role,
                      imageUrl: googlePayload.picture ?? null,
                  },
                  omit: { password: true },
              })
          })()

    // An unfinished email/password signup for this address is no longer needed
    await redisClient.del(registrationDataKey(email))

    if (isNewUser) {
        await sendEmailSafely({
            to: email,
            subject: `Welcome to ${APP_NAME}, ${user.name}!`,
            templateName: 'welcome-email',
            templateData: { name: user.name, email, role: user.role },
        })
    }

    const tokens = await authTokenUtils.issueAuthTokens(user)

    return { user, isNewUser, ...tokens }
}

const refreshToken = async (token: string | undefined) => {
    if (!token) {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Refresh Token Is Missing')
    }

    const verifiedToken = jwtUtils.verifyToken(token, config.jwt_refresh_secret)

    if (!verifiedToken.success || !verifiedToken.data.jti) {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Or Expired Refresh Token')
    }

    const { userId, jti } = verifiedToken.data

    // Rotation: claiming marks this refresh token as used, so it can't be used again
    const claim = await authTokenUtils.claimRefreshToken(userId, jti)

    if (claim === 'reused') {
        // A token rotated a while ago is being replayed: it may be stolen, so log the user out everywhere
        await authTokenUtils.revokeAllRefreshTokens(userId)
    }

    if (claim !== 'claimed') {
        throw new AppError(
            httpStatus.UNAUTHORIZED,
            'Refresh Token Has Been Revoked. Please Log In Again',
        )
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, status: true, isDeleted: true },
    })

    if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
        await authTokenUtils.revokeAllRefreshTokens(userId)
        throw new AppError(httpStatus.UNAUTHORIZED, 'User Is Inactive Or Not Found')
    }

    return authTokenUtils.issueAuthTokens(user)
}

const logoutUser = async (token: string | undefined) => {
    if (!token) {
        return
    }

    const verifiedToken = jwtUtils.verifyToken(token, config.jwt_refresh_secret)

    if (verifiedToken.success && verifiedToken.data.jti) {
        await authTokenUtils.revokeRefreshToken(verifiedToken.data.userId, verifiedToken.data.jti)
    }
}

const getMe = async (user: RequestUser) => {
    const existingUser = await prisma.user.findUnique({
        where: { id: user.userId },
        omit: { password: true },
    })

    if (!existingUser) {
        throw new AppError(httpStatus.NOT_FOUND, 'User Not Found')
    }

    return existingUser
}

const changePassword = async (user: RequestUser, payload: IChangePasswordPayload) => {
    const existingUser = await prisma.user.findUnique({ where: { id: user.userId } })

    if (!existingUser) {
        throw new AppError(httpStatus.NOT_FOUND, 'User Not Found')
    }

    if (!existingUser.password) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'This Account Uses Google Login And Has No Password',
        )
    }

    const isPasswordMatched = await bcrypt.compare(payload.oldPassword, existingUser.password)

    if (!isPasswordMatched) {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Old Password Is Incorrect')
    }

    await prisma.user.update({
        where: { id: existingUser.id },
        data: { password: await hashPassword(payload.newPassword), needPasswordChange: false },
    })

    // Log out every other session, then give this one fresh tokens
    await authTokenUtils.revokeAllRefreshTokens(existingUser.id)

    return authTokenUtils.issueAuthTokens(existingUser)
}

const forgotPassword = async (payload: IForgotPasswordPayload) => {
    const email = normalizeEmail(payload.email)

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || user.isDeleted || user.status === UserStatus.DELETED) {
        throw new AppError(httpStatus.NOT_FOUND, 'User Does Not Exist')
    }

    if (user.status === UserStatus.BLOCKED) {
        throw new AppError(httpStatus.FORBIDDEN, 'Your Account Has Been Blocked')
    }

    if (!user.password) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'This Account Uses Google Login. Please Continue With Google',
        )
    }

    const otp = await otpUtils.createOtp('forgot-password', email)

    await sendOtpEmail('forgot-password', { name: user.name, email, otp })
}

const resetPassword = async (payload: IResetPasswordPayload) => {
    const email = normalizeEmail(payload.email)

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || user.isDeleted || user.status === UserStatus.DELETED) {
        throw new AppError(httpStatus.NOT_FOUND, 'User Does Not Exist')
    }

    if (user.status === UserStatus.BLOCKED) {
        throw new AppError(httpStatus.FORBIDDEN, 'Your Account Has Been Blocked')
    }

    await otpUtils.verifyOtp('forgot-password', email, payload.otp)

    await prisma.user.update({
        where: { id: user.id },
        data: { password: await hashPassword(payload.newPassword), needPasswordChange: false },
    })

    await authTokenUtils.revokeAllRefreshTokens(user.id)

    await sendEmailSafely({
        to: email,
        subject: `Your ${APP_NAME} password was changed`,
        templateName: 'reset-password-success',
        templateData: { name: user.name, email, changedAt: formatEmailDate() },
    })
}

export const AuthService = {
    registerUser,
    verifyEmail,
    resendVerificationOtp,
    loginUser,
    googleLogin,
    refreshToken,
    logoutUser,
    getMe,
    changePassword,
    forgotPassword,
    resetPassword,
}
