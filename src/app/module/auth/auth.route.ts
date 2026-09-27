import { Router } from 'express'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { AuthController } from './auth.controller'
import {
    ChangePasswordValidationZodSchema,
    ForgotPasswordValidationZodSchema,
    LoginValidationZodSchema,
    RefreshTokenValidationZodSchema,
    RegisterValidationZodSchema,
    ResendOtpValidationZodSchema,
    ResetPasswordValidationZodSchema,
    VerifyEmailValidationZodSchema,
} from './auth.validation'

const router = Router()

router.post('/register', validateRequest(RegisterValidationZodSchema), AuthController.registerUser)
router.post(
    '/verify-email',
    validateRequest(VerifyEmailValidationZodSchema),
    AuthController.verifyEmail,
)
router.post(
    '/resend-otp',
    validateRequest(ResendOtpValidationZodSchema),
    AuthController.resendVerificationOtp,
)
router.post('/login', validateRequest(LoginValidationZodSchema), AuthController.loginUser)
router.post(
    '/refresh-token',
    validateRequest(RefreshTokenValidationZodSchema),
    AuthController.refreshToken,
)
router.post('/logout', AuthController.logoutUser)
router.get('/me', auth(), AuthController.getMe)
router.patch(
    '/change-password',
    auth(),
    validateRequest(ChangePasswordValidationZodSchema),
    AuthController.changePassword,
)
router.post(
    '/forgot-password',
    validateRequest(ForgotPasswordValidationZodSchema),
    AuthController.forgotPassword,
)
router.post(
    '/reset-password',
    validateRequest(ResetPasswordValidationZodSchema),
    AuthController.resetPassword,
)

export const AuthRoutes = router
