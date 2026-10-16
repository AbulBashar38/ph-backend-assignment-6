import z from 'zod'
import { emailSchema, nameSchema } from '../../utils/commonZodSchemas'

export const ContactValidationZodSchema = z
    .object({
        name: nameSchema,
        email: emailSchema,
        subject: z
            .string('Subject Is Required')
            .trim()
            .min(3, 'Subject Must Be At Least 3 Characters Long')
            .max(120, 'Subject Must Be At Most 120 Characters Long'),
        message: z
            .string('Message Is Required')
            .trim()
            .min(20, 'Message Must Be At Least 20 Characters Long')
            .max(2000, 'Message Must Be At Most 2000 Characters Long'),
    })
    .strict()
