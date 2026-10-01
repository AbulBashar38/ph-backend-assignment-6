import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { RoommateController } from './roommate.controller'
import {
    CreateRoommateProfileValidationZodSchema,
    CreateRoommateRequestValidationZodSchema,
    UpdateRoommateProfileStatusValidationZodSchema,
    UpdateRoommateProfileValidationZodSchema,
    UpdateRoommateRequestStatusValidationZodSchema,
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

// Connection requests between matched tenants (who may act is checked in the service)
router.post(
    '/requests',
    auth(Role.TENANT),
    validateRequest(CreateRoommateRequestValidationZodSchema),
    RoommateController.sendRoommateRequest,
)
router.get('/requests', auth(Role.TENANT), RoommateController.getRoommateRequests)
router.get('/requests/:id', auth(Role.TENANT), RoommateController.getRoommateRequestById)
router.patch(
    '/requests/:id/status',
    auth(Role.TENANT),
    validateRequest(UpdateRoommateRequestStatusValidationZodSchema),
    RoommateController.updateRoommateRequestStatus,
)
router.get('/connections', auth(Role.TENANT), RoommateController.getConnections)

export const RoommateRoutes = router
