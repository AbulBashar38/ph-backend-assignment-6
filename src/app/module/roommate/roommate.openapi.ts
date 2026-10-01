import z from 'zod'
import {
    Gender,
    LifestyleTag,
    Preference,
    RoommateRequestStatus,
    SleepSchedule,
} from '../../../generated/prisma/enums'
import {
    authSecurity,
    errorResponses,
    jsonBody,
    paginatedResponse,
    paginationQueryParams,
    registry,
    successResponse,
} from '../../docs/registry'
import {
    DECLINED_REQUEST_COOLDOWN_DAYS,
    MATCH_SORTABLE_FIELDS,
    MATCH_WEIGHTS,
    MAX_ROOMMATE_REQUESTS_PER_DAY,
    ROOMMATE_REQUEST_SORTABLE_FIELDS,
    ROOMMATE_REQUEST_TYPES,
} from './roommate.constant'
import {
    CreateRoommateProfileValidationZodSchema,
    CreateRoommateRequestValidationZodSchema,
    UpdateRoommateProfileStatusValidationZodSchema,
    UpdateRoommateProfileValidationZodSchema,
    UpdateRoommateRequestStatusValidationZodSchema,
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

// ---------- connection requests ----------

const RequestPersonSchema = z
    .object({
        id: z.string().meta({ description: 'User ID' }),
        name: z.string(),
        imageUrl: z.string().nullable(),
        gender: z.enum(Gender).nullable(),
        occupation: z.string().nullable(),
        email: z.string().optional().meta({
            description: 'Only when the request is `ACCEPTED`',
            example: 'rahim@example.com',
        }),
        phone: z
            .string()
            .nullable()
            .optional()
            .meta({ description: 'Only when the request is `ACCEPTED` (`null` if not set)' }),
        roommateProfile: z
            .object({ id: z.string() })
            .nullable()
            .meta({ description: 'Open it with `GET /roommate/profile/{id}`' }),
    })
    .meta({ id: 'RoommateRequestPerson' })

const RoommateRequestSchema = z
    .object({
        id: z.string(),
        message: z.string().nullable(),
        status: z.enum(RoommateRequestStatus),
        respondedAt: z.iso
            .datetime()
            .nullable()
            .meta({ description: 'When it was accepted, declined or cancelled' }),
        senderId: z.string(),
        receiverId: z.string(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        sender: RequestPersonSchema,
        receiver: RequestPersonSchema,
    })
    .meta({ id: 'RoommateRequest' })

const ConnectionSchema = z
    .object({
        roommateRequestId: z.string(),
        connectedAt: z.iso.datetime(),
        user: RequestPersonSchema.meta({
            description: 'The other person, always with email and phone',
        }),
    })
    .meta({ id: 'RoommateConnection' })

const requestIdParams = z.object({ id: z.string().meta({ description: 'Roommate request ID' }) })

registry.registerPath({
    method: 'post',
    path: '/roommate/requests',
    tags: [TAG],
    summary: 'Send a roommate request to a match (TENANT with search on)',
    description:
        'Asks another tenant to connect. They get a notification and an email with your name, occupation, ' +
        'compatibility score and `message`. **No contact details are shared** until they accept.\n\n' +
        '- `receiverProfileId`: a roommate profile ID from `GET /roommate/matches` or `/roommate/profile/{id}`. ' +
        'Only profiles you could see as a match (search on, gender preferences both ways); anything else → 404.\n' +
        '- Your search off → 403. No profile → 404.\n' +
        '- Already connected, a pending request either way, or declined by this person in the last ' +
        `${DECLINED_REQUEST_COOLDOWN_DAYS} days → 409. If they already sent you one, accept it instead.\n` +
        `- At most ${MAX_ROOMMATE_REQUESTS_PER_DAY} requests per 24 hours → 429.`,
    security: authSecurity,
    request: {
        body: jsonBody(
            CreateRoommateRequestValidationZodSchema.meta({
                example: {
                    receiverProfileId: '01a0f626-e0f5-7301-aa5b-8af7b39564e5',
                    message: "Hi! I'm moving to Mirpur in November and we seem like a great fit.",
                },
            }),
        ),
    },
    responses: {
        201: successResponse('Roommate Request Sent Successfully', RoommateRequestSchema),
        ...errorResponses(400, 401, 403, 404, 409, 429),
    },
})

registry.registerPath({
    method: 'get',
    path: '/roommate/requests',
    tags: [TAG],
    summary: 'My roommate requests, sent and received (TENANT)',
    description:
        '`type=received` (your inbox) or `type=sent`; leave it out for both. `status` filters, e.g. ' +
        '`type=received&status=PENDING` for requests waiting on you. Email and phone appear only on `ACCEPTED` requests.',
    security: authSecurity,
    request: {
        query: z.object({
            type: z.enum(ROOMMATE_REQUEST_TYPES).optional(),
            status: z.enum(RoommateRequestStatus).optional(),
            ...paginationQueryParams(ROOMMATE_REQUEST_SORTABLE_FIELDS),
        }),
    },
    responses: {
        200: paginatedResponse('Roommate Requests Retrieved Successfully', RoommateRequestSchema),
        ...errorResponses(400, 401, 403),
    },
})

registry.registerPath({
    method: 'get',
    path: '/roommate/requests/{id}',
    tags: [TAG],
    summary: 'Get one roommate request (its sender or receiver)',
    description: "Anyone else → 404. Email and phone appear only once it's `ACCEPTED`.",
    security: authSecurity,
    request: { params: requestIdParams },
    responses: {
        200: successResponse('Roommate Request Retrieved Successfully', RoommateRequestSchema),
        ...errorResponses(401, 403, 404),
    },
})

registry.registerPath({
    method: 'patch',
    path: '/roommate/requests/{id}/status',
    tags: [TAG],
    summary: 'Accept, decline or cancel a roommate request',
    description:
        'Only from `PENDING` (otherwise 409).\n\n' +
        "- `ACCEPTED` (the receiver): both of you get each other's **email and phone**, by email and in the response " +
        '(also in `GET /roommate/connections`). The sender is notified.\n' +
        `- \`DECLINED\` (the receiver): the sender is notified (no reason shown) and can't ask you again for ${DECLINED_REQUEST_COOLDOWN_DAYS} days.\n` +
        "- `CANCELLED` (the sender): withdraws a request that hasn't been answered yet.\n" +
        '- The wrong person for the action → 403.',
    security: authSecurity,
    request: {
        params: requestIdParams,
        body: jsonBody(
            UpdateRoommateRequestStatusValidationZodSchema.meta({
                example: { status: 'ACCEPTED' },
            }),
        ),
    },
    responses: {
        200: successResponse('Roommate Request Status Updated Successfully', RoommateRequestSchema),
        ...errorResponses(400, 401, 403, 404, 409),
    },
})

registry.registerPath({
    method: 'get',
    path: '/roommate/connections',
    tags: [TAG],
    summary: "People I'm connected with, with their contact details (TENANT)",
    description:
        'Every accepted request, sent or received, newest first. Each item has the other person with their email and phone.',
    security: authSecurity,
    request: {
        query: z.object({
            page: z.string().optional().meta({ example: '1' }),
            limit: z.string().optional().meta({ example: '10' }),
        }),
    },
    responses: {
        200: paginatedResponse('Roommate Connections Retrieved Successfully', ConnectionSchema),
        ...errorResponses(401, 403),
    },
})
