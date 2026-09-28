import z from 'zod'

// Field schemas shared by several modules, so the rules and messages stay identical everywhere

// Normalize first (trim + lowercase), then check the format, so " Rahim@Example.com " is accepted
export const emailSchema = z
    .string('Email Is Required')
    .trim()
    .toLowerCase()
    .pipe(z.email('Invalid Email Address'))
    .meta({ format: 'email', example: 'rahim@example.com' })

export const passwordSchema = z
    .string('Password Is Required')
    .min(8, 'Password Must Be At Least 8 Characters Long')
    .max(64, 'Password Must Be At Most 64 Characters Long')
    .regex(/[a-z]/, 'Password Must Contain At Least 1 Lowercase Letter')
    .regex(/[A-Z]/, 'Password Must Contain At Least 1 Uppercase Letter')
    .regex(/[0-9]/, 'Password Must Contain At Least 1 Number')
    .regex(/[^A-Za-z0-9]/, 'Password Must Contain At Least 1 Special Character')

export const nameSchema = z
    .string('Name Is Required')
    .trim()
    .min(2, 'Name Must Be At Least 2 Characters Long')
    .max(50, 'Name Must Be At Most 50 Characters Long')

export const phoneSchema = z
    .string('Phone Number Is Required')
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, 'Phone Number Must Be 10-15 Digits')
    .meta({ example: '01712345678' })
