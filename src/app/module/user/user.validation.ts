import z from 'zod'
import { Gender } from '../../../generated/prisma/enums'
import { nameSchema, phoneSchema } from '../../utils/commonZodSchemas'

// `.strict()` rejects fields that can't be changed here (email, role, status, password…)
export const UpdateUserValidationZodSchema = z
    .object({
        name: nameSchema.optional(),
        phone: phoneSchema.optional(),
        // Tenant-only fields; `null` clears the value
        occupation: z
            .string('Occupation Must Be A String')
            .trim()
            .min(2, 'Occupation Must Be At Least 2 Characters Long')
            .max(60, 'Occupation Must Be At Most 60 Characters Long')
            .nullable()
            .optional(),
        gender: z.enum(Gender, 'Gender Must Be MALE, FEMALE Or OTHER').nullable().optional(),
        // Owner-only field; `null` clears the value
        address: z
            .string('Address Must Be A String')
            .trim()
            .min(5, 'Address Must Be At Least 5 Characters Long')
            .max(200, 'Address Must Be At Most 200 Characters Long')
            .nullable()
            .optional(),
    })
    .strict()
    .refine((data) => Object.values(data).some((value) => value !== undefined), {
        message: 'Provide At Least One Field To Update',
    })

export const DeleteUserValidationZodSchema = z.object({
    // The CALLER's own password (re-confirms identity). Callers without a password (Google-only) can omit it
    password: z.string('Password Must Be A String').min(1, 'Password Is Required').optional(),
})
