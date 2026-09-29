import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { imageUpload } from '../../lib/multer'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { ADMIN_ROLES } from '../../utils/roles'
import { UserController } from './user.controller'
import {
    CreateAdminValidationZodSchema,
    DeleteUserValidationZodSchema,
    UpdateUserStatusValidationZodSchema,
    UpdateUserValidationZodSchema,
} from './user.validation'

const router = Router()

router.get('/', auth(...ADMIN_ROLES), UserController.getAllUsers)
router.post(
    '/admin',
    auth(Role.SUPER_ADMIN),
    validateRequest(CreateAdminValidationZodSchema),
    UserController.createAdmin,
)

// Self or admin: the ownership/role rules live in UserServices
router.get('/:id', auth(), UserController.getUserById)
router.patch(
    '/:id',
    auth(),
    validateRequest(UpdateUserValidationZodSchema),
    UserController.updateUser,
)
// auth() runs before multer, so anonymous requests are rejected before any file is read
router.patch(
    '/:id/profile-image',
    auth(),
    imageUpload.single('profileImage'),
    UserController.uploadProfileImage,
)
router.delete('/:id/profile-image', auth(), UserController.removeProfileImage)
router.delete(
    '/:id',
    auth(),
    validateRequest(DeleteUserValidationZodSchema),
    UserController.deleteUser,
)

// Admins: suspend / reactivate (who may change whom is checked in the service)
router.patch(
    '/:id/status',
    auth(...ADMIN_ROLES),
    validateRequest(UpdateUserStatusValidationZodSchema),
    UserController.updateUserStatus,
)

export const UserRoutes = router
