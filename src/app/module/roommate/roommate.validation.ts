import z from 'zod'
import {
    Gender,
    LifestyleTag,
    Preference,
    RoommateRequestStatus,
    SleepSchedule,
} from '../../../generated/prisma/enums'
import { ROOMMATE_REQUEST_RESPONSES, ROOMMATE_REQUEST_TYPES } from './roommate.constant'

const startOfToday = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
}

const budgetSchema = (field: string) =>
    z
        .number(`${field} Must Be A Number`)
        .int(`${field} Must Be A Whole Number (Taka)`)
        .min(500, `${field} Must Be At Least 500`)
        .max(10_000_000, `${field} Is Too High`)

const profileFields = {
    age: z
        .number('Age Must Be A Number')
        .int('Age Must Be A Whole Number')
        .min(18, 'You Must Be At Least 18')
        .max(100, 'Age Must Be At Most 100'),
    budgetMin: budgetSchema('Minimum Budget'),
    budgetMax: budgetSchema('Maximum Budget'),
    preferredCity: z
        .string('Preferred City Is Required')
        .trim()
        .min(2, 'Preferred City Must Be At Least 2 Characters Long')
        .max(50, 'Preferred City Must Be At Most 50 Characters Long'),
    preferredArea: z
        .string()
        .trim()
        .min(2, 'Preferred Area Must Be At Least 2 Characters Long')
        .max(80, 'Preferred Area Must Be At Most 80 Characters Long')
        .nullable(),
    moveInDate: z.iso
        .datetime({
            offset: true,
            error: 'Move-In Date Must Be An ISO Date, e.g. 2026-11-01T00:00:00Z',
        })
        .transform((value) => new Date(value))
        .refine((date) => date >= startOfToday(), "Move-In Date Can't Be In The Past"),
    smokingPreference: z.enum(Preference, 'Smoking Preference Must Be YES, NO Or NO_PREFERENCE'),
    petPreference: z.enum(Preference, 'Pet Preference Must Be YES, NO Or NO_PREFERENCE'),
    sleepSchedule: z.enum(
        SleepSchedule,
        'Sleep Schedule Must Be EARLY_BIRD, NIGHT_OWL Or FLEXIBLE',
    ),
    lifestyle: z
        .array(z.enum(LifestyleTag, 'Invalid Lifestyle Tag'), 'Lifestyle Must Be A List')
        .transform((list) => [...new Set(list)]),
    // Gender of the roommate they want; null = any
    genderPreference: z.enum(Gender, 'Gender Preference Must Be MALE, FEMALE Or OTHER').nullable(),
    bio: z.string().trim().max(1000, 'Bio Must Be At Most 1000 Characters Long').nullable(),
    // Saved on the user account (not duplicated on the roommate profile)
    gender: z.enum(Gender, 'Gender Must Be MALE, FEMALE Or OTHER'),
    occupation: z
        .string()
        .trim()
        .min(2, 'Occupation Must Be At Least 2 Characters Long')
        .max(60, 'Occupation Must Be At Most 60 Characters Long')
        .nullable(),
}

export const CreateRoommateProfileValidationZodSchema = z
    .object({
        age: profileFields.age,
        budgetMin: profileFields.budgetMin,
        budgetMax: profileFields.budgetMax,
        preferredCity: profileFields.preferredCity,
        moveInDate: profileFields.moveInDate,
        preferredArea: profileFields.preferredArea.optional(),
        smokingPreference: profileFields.smokingPreference.optional(),
        petPreference: profileFields.petPreference.optional(),
        sleepSchedule: profileFields.sleepSchedule.optional(),
        lifestyle: profileFields.lifestyle.default([]),
        genderPreference: profileFields.genderPreference.optional(),
        bio: profileFields.bio.optional(),
        // Required unless the account already has a gender (checked in the service)
        gender: profileFields.gender.optional(),
        occupation: profileFields.occupation.optional(),
    })
    .strict()
    .refine((data) => data.budgetMin <= data.budgetMax, {
        message: 'Minimum Budget Must Not Be More Than Maximum Budget',
        path: ['budgetMin'],
    })

// The budget pair is re-checked in the service against the saved values
export const UpdateRoommateProfileValidationZodSchema = z
    .object(profileFields)
    .partial()
    .strict()
    .refine((data) => Object.values(data).some((value) => value !== undefined), {
        message: 'Provide At Least One Field To Update',
    })

export const UpdateRoommateProfileStatusValidationZodSchema = z.object({
    isActive: z.boolean('isActive Must Be true Or false'),
})

// GET /roommate/matches filters (page/limit come from paginationHelper)
export const RoommateMatchesQueryZodSchema = z.object({
    minScore: z
        .string()
        .regex(/^\d+$/, 'minScore Must Be A Whole Number From 0 To 100')
        .transform(Number)
        .refine((value) => value <= 100, 'minScore Must Be A Whole Number From 0 To 100')
        .optional(),
})

// ---------- connection requests ----------

export const CreateRoommateRequestValidationZodSchema = z
    .object({
        // The roommate profile ID from GET /roommate/matches or /roommate/profile/:id
        receiverProfileId: z
            .string('Roommate Profile ID Is Required')
            .trim()
            .min(1, 'Roommate Profile ID Is Required'),
        message: z
            .string()
            .trim()
            .min(1, 'Message Must Not Be Empty')
            .max(500, 'Message Must Be At Most 500 Characters Long')
            .optional(),
    })
    .strict()

// ACCEPTED / DECLINED: the receiver. CANCELLED: the sender.
export const UpdateRoommateRequestStatusValidationZodSchema = z
    .object({
        status: z.enum(
            ROOMMATE_REQUEST_RESPONSES,
            'Status Must Be ACCEPTED, DECLINED Or CANCELLED',
        ),
    })
    .strict()

// GET /roommate/requests filters (no type = both sent and received)
export const RoommateRequestsQueryZodSchema = z.object({
    type: z.enum(ROOMMATE_REQUEST_TYPES, 'type Must Be received Or sent').optional(),
    status: z.enum(RoommateRequestStatus, 'Invalid Roommate Request Status').optional(),
})
