import z from 'zod'
import { Gender, LifestyleTag, Preference, SleepSchedule } from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import { MATCH_SORTABLE_FIELDS, MATCH_WEIGHTS } from './roommate.constant'
import {
    CreateRoommateProfileValidationZodSchema,
    UpdateRoommateProfileStatusValidationZodSchema,
    UpdateRoommateProfileValidationZodSchema,
} from './roommate.validation'

const TAG = 'Roommate'

const RoommateProfileSchema = z
    .object({
        id: z.string(),
        age: z.number().int().meta({ example: 26 }),
        budgetMin: z.number().int().meta({ description: 'Whole taka per month', example: 8000 }),
        budgetMax: z.number().int().meta({ example: 12000 }),
        preferredCity: z.string().meta({ example: 'Dhaka' }),
        preferredArea: z.string().nullable().meta({ example: 'Mirpur' }),
        moveInDate: z.iso.datetime(),
        smokingPreference: z.enum(Preference),
        petPreference: z.enum(Preference),
        sleepSchedule: z.enum(SleepSchedule),
        lifestyle: z.array(z.enum(LifestyleTag)).meta({ example: ['QUIET', 'CLEAN', 'STUDIOUS'] }),
        genderPreference: z.enum(Gender).nullable().meta({ description: '`null` = any gender' }),
        bio: z.string().nullable(),
        isActive: z.boolean().meta({ description: 'Roommate search on/off' }),
        tenantId: z.string(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        tenant: z.object({
            id: z.string(),
            name: z.string(),
            imageUrl: z.string().nullable(),
            gender: z.enum(Gender).nullable(),
            occupation: z.string().nullable(),
        }),
    })
    .meta({ id: 'RoommateProfile' })

const preferenceHelp =
    '`smokingPreference` / `petPreference`: `YES` = "I smoke / have pets, or I\'m fine with it", `NO` = "please no", ' +
    '`NO_PREFERENCE` = "don\'t mind". `lifestyle`: any of ' +
    Object.values(LifestyleTag)
        .map((tag) => `\`${tag}\``)
        .join(', ') +
    '.'

registry.registerPath({
    method: 'post',
    path: '/roommate/profile',
    tags: [TAG],
    summary: 'Create my roommate profile (TENANT)',
    description:
        'One profile per tenant (a second one → 409). Roommate search starts **on** (`isActive: true`).\n\n' +
        '- Required: `age` (18+), `budgetMin` ≤ `budgetMax` (whole taka), `preferredCity`, `moveInDate` (today or later).\n' +
        '- `gender` and `occupation` are saved on your **account** (they also show on your user profile). ' +
        '`gender` is required unless your account already has one.\n' +
        `- ${preferenceHelp}`,
    security: authSecurity,
    request: {
        body: jsonBody(
            CreateRoommateProfileValidationZodSchema.meta({
                example: {
                    age: 26,
                    gender: 'MALE',
                    occupation: 'Software Engineer',
                    budgetMin: 8000,
                    budgetMax: 12000,
                    preferredCity: 'Dhaka',
                    preferredArea: 'Mirpur',
                    moveInDate: '2026-11-01T00:00:00Z',
                    smokingPreference: 'NO',
                    petPreference: 'NO_PREFERENCE',
                    sleepSchedule: 'EARLY_BIRD',
                    lifestyle: ['QUIET', 'CLEAN', 'STUDIOUS'],
                    genderPreference: 'MALE',
                    bio: 'Calm, tidy, works 9–5. Looking for a quiet flatmate near Mirpur 10.',
                },
            }),
        ),
    },
    responses: {
        201: successResponse('Roommate Profile Created Successfully', RoommateProfileSchema),
        ...errorResponses(400, 401, 403, 409),
    },
})

registry.registerPath({
    method: 'get',
    path: '/roommate/profile/me',
    tags: [TAG],
    summary: 'Get my roommate profile (TENANT)',
    description: 'No profile yet → 404.',
    security: authSecurity,
    responses: {
        200: successResponse('Roommate Profile Retrieved Successfully', RoommateProfileSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/roommate/profile/me',
    tags: [TAG],
    summary: 'Update my roommate profile / preferences (TENANT)',
    description:
        'Send only the fields to change (at least one). `null` clears `preferredArea`, `genderPreference` (= any), ' +
        '`bio` or `occupation`; `lifestyle` replaces the whole list. The budget pair must stay `budgetMin` ≤ `budgetMax`. ' +
        'Use `/profile/me/status` to switch search on/off.',
    security: authSecurity,
    request: {
        body: jsonBody(
            UpdateRoommateProfileValidationZodSchema.meta({
                example: { budgetMax: 14000, lifestyle: ['QUIET', 'FITNESS'] },
            }),
        ),
    },
    responses: {
        200: successResponse('Roommate Profile Updated Successfully', RoommateProfileSchema),
        ...errorResponses(400, 401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/roommate/profile/me/status',
    tags: [TAG],
    summary: 'Turn roommate search on or off (TENANT)',
    description:
        '`{ "isActive": false }` hides you from other tenants\' roommate matches; `true` shows you again. ' +
        'Sending the current value is fine (200).',
    security: authSecurity,
    request: {
        body: jsonBody(
            UpdateRoommateProfileStatusValidationZodSchema.meta({ example: { isActive: false } }),
        ),
    },
    responses: {
        200: successResponse('Roommate Search Turned Off', RoommateProfileSchema),
        ...errorResponses(400, 401, 403, 404),
    },
})

// ---------- matching ----------

const factorSchema = z.object({
    score: z.number().int().meta({ example: 20 }),
    max: z.number().int().meta({ example: 25 }),
    label: z.enum(['Highly Compatible', 'Compatible', 'Partially Compatible', 'Not Compatible']),
})

const CompatibilitySchema = z
    .object({
        score: z.number().int().meta({ description: '0–100', example: 87 }),
        label: z.enum([
            'Highly Compatible',
            'Compatible',
            'Partially Compatible',
            'Low Compatibility',
        ]),
        breakdown: z.object(
            Object.fromEntries(Object.keys(MATCH_WEIGHTS).map((factor) => [factor, factorSchema])),
        ),
    })
    .meta({ id: 'Compatibility' })

const RoommateMatchSchema = z
    .object({
        id: z
            .string()
            .meta({ description: 'Roommate profile ID (use it with GET /roommate/profile/{id})' }),
        age: z.number().int(),
        budgetMin: z.number().int(),
        budgetMax: z.number().int(),
        preferredCity: z.string(),
        preferredArea: z.string().nullable(),
        moveInDate: z.iso.datetime(),
        smokingPreference: z.enum(Preference),
        petPreference: z.enum(Preference),
        sleepSchedule: z.enum(SleepSchedule),
        lifestyle: z.array(z.enum(LifestyleTag)),
        genderPreference: z.enum(Gender).nullable(),
        bio: z.string().nullable(),
        updatedAt: z.iso.datetime(),
        tenant: z.object({
            id: z.string(),
            name: z.string(),
            imageUrl: z.string().nullable(),
            gender: z.enum(Gender).nullable(),
            occupation: z.string().nullable(),
        }),
        compatibility: CompatibilitySchema,
    })
    .meta({ id: 'RoommateMatch' })

const scoringHelp =
    '**Score (0–100):** ' +
    Object.entries(MATCH_WEIGHTS)
        .map(([factor, weight]) => `${factor} ${weight}`)
        .join(', ') +
    '. Budget = how much of the narrower range overlaps; location = same area (or no area preference) full, same city ' +
    'half; move-in ≤14 days apart full, ≤30 days about half; lifestyle = shared tags; smoking / pets = same answer ' +
    'full, "don\'t mind" half, yes vs no zero; sleep = same full, one FLEXIBLE half.'

registry.registerPath({
    method: 'get',
    path: '/roommate/matches',
    tags: [TAG],
    summary: 'Find compatible roommates (TENANT with roommate search on)',
    description:
        'Needs your own roommate profile with search **on** (no profile → 404, search off → 403).\n\n' +
        '**Who shows up:** other tenants with search on and an active account, in the **same preferred city**, with an ' +
        '**overlapping budget**, and whose gender fits your `genderPreference` **and** whose `genderPreference` fits ' +
        'your gender.\n\n' +
        `${scoringHelp}\n\n` +
        'Sorted best match first. `minScore` hides weaker matches. Email and phone are never included.',
    security: authSecurity,
    request: {
        query: z.object({
            minScore: z.string().optional().meta({ description: '0–100', example: '60' }),
            ...paginationQueryParams(MATCH_SORTABLE_FIELDS),
        }),
    },
    responses: {
        200: paginatedResponse('Roommate Matches Retrieved Successfully', RoommateMatchSchema),
        ...errorResponses(400, 401, 403, 404),
    },
})

registry.registerPath({
    method: 'get',
    path: '/roommate/profile/{id}',
    tags: [TAG],
    summary:
        "View another tenant's roommate profile with your compatibility (TENANT with search on)",
    description:
        'Same visibility rules as matches (search on, active account, gender preferences both ways), but the city and ' +
        "budget don't have to match: the score shows how compatible you are. Hidden, deleted or your own profile → 404 " +
        '(use `GET /roommate/profile/me` for yours).',
    security: authSecurity,
    request: { params: z.object({ id: z.string().meta({ description: 'Roommate profile ID' }) }) },
    responses: {
        200: successResponse('Roommate Profile Retrieved Successfully', RoommateMatchSchema),
        ...errorResponses(401, 403, 404),
    },
})
