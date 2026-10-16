import { Router } from 'express'
import { validateRequest } from '../../middleware/validateRequest'
import { ContactController } from './contact.controller'
import { ContactValidationZodSchema } from './contact.validation'

const router = Router()

// Public: anyone can write to the team (rate-limited in the service)
router.post('/', validateRequest(ContactValidationZodSchema), ContactController.sendContactMessage)

export const ContactRoutes = router
