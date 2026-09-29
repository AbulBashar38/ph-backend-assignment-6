import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { RoommateController } from './roommate.controller'
import {
    CreateRoommateProfileValidationZodSchema,
    UpdateRoommateProfileStatusValidationZodSchema,
    UpdateRoommateProfileValidationZodSchema,
} from './roommate.validation'

const router = Router()

// Roommate profiles belong to tenants; each tenant manages only their own
router.post(
    '/profile',
    auth(Role.TENANT),
    validateRequest(CreateRoommateProfileValidationZodSchema),
    RoommateController.createMyProfile,
)
router.get('/profile/me', auth(Role.TENANT), RoommateController.getMyProfile)
router.patch(
    '/profile/me',
    auth(Role.TENANT),
    validateRequest(UpdateRoommateProfileValidationZodSchema),
    RoommateController.updateMyProfile,
)
router.patch(
    '/profile/me/status',
    auth(Role.TENANT),
    validateRequest(UpdateRoommateProfileStatusValidationZodSchema),
    RoommateController.updateMyProfileStatus,
)

// Matching: only tenants whose own roommate search is on (checked in the service)
router.get('/matches', auth(Role.TENANT), RoommateController.getMatches)
// After /profile/me, so "me" is never treated as an id
router.get('/profile/:id', auth(Role.TENANT), RoommateController.getProfileById)

export const RoommateRoutes = router
