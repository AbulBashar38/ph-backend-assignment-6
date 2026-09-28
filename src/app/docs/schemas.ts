import z from 'zod'
import { AuthProvider, Gender, Role, UserStatus } from '../../generated/prisma/enums'

// Response schemas shared by several modules' *.openapi.ts files

export const UserSchema = z
    .object({
        id: z.string().meta({ example: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }),
        name: z.string().meta({ example: 'Rahim Uddin' }),
        email: z.email().meta({ example: 'rahim@example.com' }),
        phone: z.string().nullable().meta({ example: '01712345678' }),
        role: z.enum(Role),
        status: z.enum(UserStatus),
        authProvider: z.enum(AuthProvider),
        emailVerified: z.boolean(),
        needPasswordChange: z.boolean(),
        imageUrl: z.string().nullable(),
        imagePublicId: z.string().nullable(),
        googleId: z.string().nullable(),
        isDeleted: z.boolean(),
        deletedAt: z.iso.datetime().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        // Profile details: gender/occupation are used for tenants, address for owners
        gender: z.enum(Gender).nullable(),
        occupation: z.string().nullable().meta({ example: 'Software Engineer' }),
        address: z.string().nullable(),
    })
    // `id` makes it a named, reusable component (#/components/schemas/User)
    .meta({ id: 'User' })
