import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { imageUpload } from '../../lib/multer'
import { auth } from '../../middleware/checkAuth'
import { validateRequest } from '../../middleware/validateRequest'
import { ADMIN_ROLES } from '../../utils/roles'
import { PropertyController } from './property.controller'
import {
    CreatePropertyValidationZodSchema,
    ModeratePropertyValidationZodSchema,
    UpdatePropertyValidationZodSchema,
} from './property.validation'

const router = Router()

// Public (no login)
router.get('/public/all-properties', PropertyController.getPublicProperties)
router.get('/public/:id', PropertyController.getPublicPropertyById)

// Owner (for themselves) or admin (on behalf of an owner, with ownerId)
router.post(
    '/',
    auth(Role.OWNER, ...ADMIN_ROLES),
    validateRequest(CreatePropertyValidationZodSchema),
    PropertyController.createProperty,
)

// Owner (own listings) or admin (all listings): the scope is decided in the service
router.get('/', auth(Role.OWNER, ...ADMIN_ROLES), PropertyController.getProperties)

// Admin
router.patch(
    '/:id/moderate',
    auth(...ADMIN_ROLES),
    validateRequest(ModeratePropertyValidationZodSchema),
    PropertyController.moderateProperty,
)

// Owner of the property or any admin (ownership is checked in the service)
router.get('/:id', auth(Role.OWNER, ...ADMIN_ROLES), PropertyController.getPropertyById)
router.patch(
    '/:id',
    auth(Role.OWNER, ...ADMIN_ROLES),
    validateRequest(UpdatePropertyValidationZodSchema),
    PropertyController.updateProperty,
)
router.patch('/:id/publish', auth(Role.OWNER, ...ADMIN_ROLES), PropertyController.publishProperty)
router.patch('/:id/disable', auth(Role.OWNER, ...ADMIN_ROLES), PropertyController.disableProperty)
router.post(
    '/:id/images',
    auth(Role.OWNER, ...ADMIN_ROLES),
    imageUpload.array('images', 10),
    PropertyController.addImages,
)
router.delete(
    '/:id/images/:imageId',
    auth(Role.OWNER, ...ADMIN_ROLES),
    PropertyController.removeImage,
)
router.delete('/:id', auth(Role.OWNER, ...ADMIN_ROLES), PropertyController.archiveProperty)

export const PropertyRoutes = router
