import z from 'zod'
import { AuthProvider, Gender, Role, UserStatus } from '../../../generated/prisma/enums'
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

// Query-string filters for GET /user (page/limit/sort are handled by paginationHelper).
// Query values are strings, so booleans arrive as 'true' / 'false'.
const booleanQuerySchema = (field: string) =>
    z
        .enum(['true', 'false'], `${field} Must Be true Or false`)
        .transform((value) => value === 'true')

export const GetAllUsersQueryZodSchema = z.object({
    searchTerm: z.string().trim().max(100, 'Search Term Is Too Long').optional(),
    role: z.enum(Role, 'Role Must Be SUPER_ADMIN, ADMIN, OWNER Or TENANT').optional(),
    status: z.enum(UserStatus, 'Status Must Be ACTIVE, BLOCKED Or DELETED').optional(),
    authProvider: z.enum(AuthProvider, 'Auth Provider Must Be GOOGLE Or CREDENTIAL').optional(),
    emailVerified: booleanQuerySchema('emailVerified').optional(),
    // Default false: soft-deleted accounts are only listed when explicitly asked for
    isDeleted: booleanQuerySchema('isDeleted').optional(),
})
