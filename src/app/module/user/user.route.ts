import { Router } from 'express'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { UserController } from './user.controller'
import { DeleteUserValidationZodSchema, UpdateUserValidationZodSchema } from './user.validation'

const router = Router()

// Self or admin: the ownership/role rules live in UserServices (assertCanManageUser)
router.patch(
    '/:id',
    auth(),
    validateRequest(UpdateUserValidationZodSchema),
    UserController.updateUser,
)
router.delete(
    '/:id',
    auth(),
    validateRequest(DeleteUserValidationZodSchema),
    UserController.deleteUser,
)

export const UserRoutes = router
