import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
    AuditAction,
    NotificationType,
    Role,
    RoommateRequestStatus,
    UserStatus,
} from '../../../generated/prisma/enums'
import type {
    RoommateProfileWhereInput,
    RoommateRequestWhereInput,
} from '../../../generated/prisma/models'
import type { IQuery } from '../../interfaces'
import { prisma } from '../../lib/prisma'
import type { RequestUser } from '../../middleware/checkAuth'
import { AppError } from '../../utils/AppError'
import { createAuditLog } from '../../utils/auditLog'
import { createNotifications } from '../../utils/notification'
import { buildPaginationMeta, paginationHelper } from '../../utils/paginationHelper'
import { APP_NAME, formatEmailDate, sendEmailSafely } from '../../utils/sendEmail'
import {
    DECLINED_REQUEST_COOLDOWN_DAYS,
    MATCH_SORTABLE_FIELDS,
    MAX_MATCH_CANDIDATES,
    MAX_ROOMMATE_REQUESTS_PER_DAY,
    ROOMMATE_REQUEST_SORTABLE_FIELDS,
} from './roommate.constant'
import type {
    ICreateRoommateProfilePayload,
    ICreateRoommateRequestPayload,
    IUpdateRoommateProfilePayload,
    IUpdateRoommateProfileStatusPayload,
    IUpdateRoommateRequestStatusPayload,
} from './roommate.interface'
import { calculateCompatibility } from './roommate.matching'
import {
    RoommateMatchesQueryZodSchema,
    RoommateRequestsQueryZodSchema,
} from './roommate.validation'

// The profile plus the person details that live on the user account
const profileInclude = {
    tenant: {
        select: { id: true, name: true, imageUrl: true, gender: true, occupation: true },
    },
} satisfies Prisma.RoommateProfileInclude

const findMyProfile = async (tenantId: string) => {
    const profile = await prisma.roommateProfile.findUnique({
        where: { tenantId },
        include: profileInclude,
    })

    if (!profile) {
        throw new AppError(
            httpStatus.NOT_FOUND,
            'You Have No Roommate Profile Yet. Create One First',
        )
    }

    return profile
}

const createMyProfile = async (actor: RequestUser, payload: ICreateRoommateProfilePayload) => {
    const { gender, occupation, ...profileData } = payload

    const [existingProfile, user] = await Promise.all([
        prisma.roommateProfile.findUnique({
            where: { tenantId: actor.userId },
            select: { id: true },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { gender: true } }),
    ])

    if (existingProfile) {
        throw new AppError(
            httpStatus.CONFLICT,
            'You Already Have A Roommate Profile. Update It Instead',
        )
    }

    // Matching filters by gender, so the account must have one
    if (!gender && !user.gender) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Gender Is Required To Create A Roommate Profile',
        )
    }

    await prisma.$transaction(async (tx) => {
        if (gender !== undefined || occupation !== undefined) {
            await tx.user.update({ where: { id: actor.userId }, data: { gender, occupation } })
        }

        await tx.roommateProfile.create({ data: { ...profileData, tenantId: actor.userId } })
    })

    return findMyProfile(actor.userId)
}

const getMyProfile = (actor: RequestUser) => findMyProfile(actor.userId)

const updateMyProfile = async (actor: RequestUser, payload: IUpdateRoommateProfilePayload) => {
    const profile = await findMyProfile(actor.userId)
    const { gender, occupation, ...profileData } = payload

    // Only one side of the budget may be sent, so check the pair against the saved values
    const budgetMin = profileData.budgetMin ?? profile.budgetMin
    const budgetMax = profileData.budgetMax ?? profile.budgetMax

    if (budgetMin > budgetMax) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            'Minimum Budget Must Not Be More Than Maximum Budget',
        )
    }

    await prisma.$transaction(async (tx) => {
        if (gender !== undefined || occupation !== undefined) {
            await tx.user.update({ where: { id: actor.userId }, data: { gender, occupation } })
        }

        if (Object.keys(profileData).length > 0) {
            await tx.roommateProfile.update({ where: { id: profile.id }, data: profileData })
        }
    })

    return findMyProfile(actor.userId)
}

// Switch roommate search on/off (requirement §8). Idempotent.
const updateMyProfileStatus = async (
    actor: RequestUser,
    payload: IUpdateRoommateProfileStatusPayload,
) => {
    const profile = await findMyProfile(actor.userId)

    if (profile.isActive !== payload.isActive) {
        await prisma.roommateProfile.update({
            where: { id: profile.id },
            data: { isActive: payload.isActive },
        })
    }

    return findMyProfile(actor.userId)
}

// ---------- matching ----------

// What another tenant may see of a profile: no email, phone, or account details
const matchProfileSelect = {
    id: true,
    age: true,
    budgetMin: true,
    budgetMax: true,
    preferredCity: true,
    preferredArea: true,
    moveInDate: true,
    smokingPreference: true,
    petPreference: true,
    sleepSchedule: true,
    lifestyle: true,
    genderPreference: true,
    bio: true,
    updatedAt: true,
    tenant: {
        select: { id: true, name: true, imageUrl: true, gender: true, occupation: true },
    },
} satisfies Prisma.RoommateProfileSelect

// The viewer must have a profile with search switched on: you can't browse others without being visible
const findMyActiveProfile = async (tenantId: string) => {
    const profile = await findMyProfile(tenantId)

    if (!profile.isActive) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'Turn On Roommate Search To See Other Roommate Profiles',
        )
    }

    return profile
}

/**
 * Profiles `me` may see: search on, a live active tenant account, and gender preferences
 * respected in BOTH directions (theirs must accept my gender, mine must accept theirs).
 */
const visibleTo = (me: Awaited<ReturnType<typeof findMyProfile>>): RoommateProfileWhereInput => ({
    isActive: true,
    tenantId: { not: me.tenantId },
    tenant: {
        isDeleted: false,
        status: UserStatus.ACTIVE,
        role: Role.TENANT,
        ...(me.genderPreference && { gender: me.genderPreference }),
    },
    OR: [
        { genderPreference: null },
        ...(me.tenant.gender ? [{ genderPreference: me.tenant.gender }] : []),
    ],
})

/**
 * Compatible roommates, best first (requirement §9). Candidates share my preferred city and have an
 * overlapping budget; each one is then scored 0–100 with a per-factor breakdown.
 */
const getMatches = async (actor: RequestUser, query: IQuery) => {
    const me = await findMyActiveProfile(actor.userId)
    const { minScore } = RoommateMatchesQueryZodSchema.parse(query)
    const { page, limit, skip } = paginationHelper(query, MATCH_SORTABLE_FIELDS, 'score')

    const candidates = await prisma.roommateProfile.findMany({
        where: {
            AND: [
                visibleTo(me),
                { preferredCity: { equals: me.preferredCity, mode: 'insensitive' } },
                { budgetMin: { lte: me.budgetMax } },
                { budgetMax: { gte: me.budgetMin } },
            ],
        },
        select: matchProfileSelect,
        orderBy: { updatedAt: 'desc' },
        take: MAX_MATCH_CANDIDATES,
    })

    const scored = candidates
        .map((candidate) => ({
            ...candidate,
            compatibility: calculateCompatibility(me, candidate),
        }))
        .filter((match) => match.compatibility.score >= (minScore ?? 0))
        // Best score first; the most recently updated profile wins a tie
        .sort(
            (a, b) =>
                b.compatibility.score - a.compatibility.score ||
                b.updatedAt.getTime() - a.updatedAt.getTime(),
        )

    return {
        data: scored.slice(skip, skip + limit),
        meta: buildPaginationMeta(page, limit, scored.length),
    }
}

// One other tenant's roommate profile, with my compatibility score against it
const getProfileById = async (actor: RequestUser, profileId: string) => {
    const me = await findMyActiveProfile(actor.userId)

    const profile = await prisma.roommateProfile.findFirst({
        where: { id: profileId, ...visibleTo(me) },
        select: matchProfileSelect,
    })

    if (!profile) {
        throw new AppError(httpStatus.NOT_FOUND, 'Roommate Profile Not Found')
    }

    return { ...profile, compatibility: calculateCompatibility(me, profile) }
}

// ---------- connection requests ----------

const DAY_MS = 24 * 60 * 60 * 1000
const AUDIT_RESOURCE = 'RoommateRequest'

// Contact details are loaded with the person but only shown once the request is ACCEPTED (toRequestView)
const requestPersonSelect = {
    id: true,
    name: true,
    imageUrl: true,
    gender: true,
    occupation: true,
    email: true,
    phone: true,
    // So the receiver can open the sender's profile (GET /roommate/profile/:id) and the other way round
    roommateProfile: { select: { id: true } },
} satisfies Prisma.UserSelect

const roommateRequestInclude = {
    sender: { select: requestPersonSelect },
    receiver: { select: requestPersonSelect },
} satisfies Prisma.RoommateRequestInclude

type TRoommateRequest = Prisma.RoommateRequestGetPayload<{ include: typeof roommateRequestInclude }>
type TRequestPerson = TRoommateRequest['sender']

const withoutContact = ({ email: _email, phone: _phone, ...person }: TRequestPerson) => person

const toRequestView = (request: TRoommateRequest) =>
    request.status === RoommateRequestStatus.ACCEPTED
        ? request
        : {
              ...request,
              sender: withoutContact(request.sender),
              receiver: withoutContact(request.receiver),
          }

const findRequest = (requestId: string) =>
    prisma.roommateRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: roommateRequestInclude,
    })

// Only the two people involved may see a request; to anyone else it doesn't exist
const findRequestFor = async (actor: RequestUser, requestId: string) => {
    const request = await prisma.roommateRequest.findUnique({
        where: { id: requestId },
        include: roommateRequestInclude,
    })

    if (!request || (request.senderId !== actor.userId && request.receiverId !== actor.userId)) {
        throw new AppError(httpStatus.NOT_FOUND, 'Roommate Request Not Found')
    }

    return request
}

// Requests in either direction between two people
const betweenPair = (a: string, b: string): RoommateRequestWhereInput => ({
    OR: [
        { senderId: a, receiverId: b },
        { senderId: b, receiverId: a },
    ],
})

/**
 * Ask a matched tenant to connect. Allowed only for profiles I could see as a match (search on, gender
 * preferences both ways), at most one open request per pair, MAX_ROOMMATE_REQUESTS_PER_DAY per sender, and
 * not again within DECLINED_REQUEST_COOLDOWN_DAYS of being declined by the same person.
 */
const sendRoommateRequest = async (actor: RequestUser, payload: ICreateRoommateRequestPayload) => {
    const me = await findMyActiveProfile(actor.userId)

    const profile = await prisma.roommateProfile.findFirst({
        where: { id: payload.receiverProfileId, ...visibleTo(me) },
        select: matchProfileSelect,
    })

    if (!profile) {
        throw new AppError(httpStatus.NOT_FOUND, 'Roommate Profile Not Found')
    }

    const receiverId = profile.tenant.id
    const compatibility = calculateCompatibility(me, profile)
    const now = Date.now()

    const created = await prisma.$transaction(async (tx) => {
        // One request at a time per pair: two clicks, or both people sending at once, can't open two
        const pairKey = [actor.userId, receiverId].sort().join(':')
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`roommate-request:${pairKey}`}))`

        const sentToday = await tx.roommateRequest.count({
            where: { senderId: actor.userId, createdAt: { gte: new Date(now - DAY_MS) } },
        })

        if (sentToday >= MAX_ROOMMATE_REQUESTS_PER_DAY) {
            throw new AppError(
                httpStatus.TOO_MANY_REQUESTS,
                `You Can Send At Most ${MAX_ROOMMATE_REQUESTS_PER_DAY} Roommate Requests A Day. Try Again Later`,
            )
        }

        const open = await tx.roommateRequest.findFirst({
            where: {
                ...betweenPair(actor.userId, receiverId),
                status: { in: [RoommateRequestStatus.PENDING, RoommateRequestStatus.ACCEPTED] },
            },
            select: { status: true, senderId: true },
        })

        if (open?.status === RoommateRequestStatus.ACCEPTED) {
            throw new AppError(httpStatus.CONFLICT, 'You Are Already Connected With This Person')
        }

        if (open) {
            throw new AppError(
                httpStatus.CONFLICT,
                open.senderId === actor.userId
                    ? 'You Already Sent A Request To This Person'
                    : 'This Person Already Sent You A Request. Accept It Instead',
            )
        }

        const recentDecline = await tx.roommateRequest.findFirst({
            where: {
                senderId: actor.userId,
                receiverId,
                status: RoommateRequestStatus.DECLINED,
                respondedAt: { gte: new Date(now - DECLINED_REQUEST_COOLDOWN_DAYS * DAY_MS) },
            },
            orderBy: { respondedAt: 'desc' },
            select: { respondedAt: true },
        })

        if (recentDecline?.respondedAt) {
            const askAgainAt = new Date(
                recentDecline.respondedAt.getTime() + DECLINED_REQUEST_COOLDOWN_DAYS * DAY_MS,
            )

            throw new AppError(
                httpStatus.CONFLICT,
                `This Person Declined Your Last Request. You Can Ask Again After ${formatEmailDate(askAgainAt)}`,
            )
        }

        const request = await tx.roommateRequest.create({
            data: { senderId: actor.userId, receiverId, message: payload.message },
        })

        await createNotifications(tx, [
            {
                userId: receiverId,
                type: NotificationType.ROOMMATE_REQUEST_RECEIVED,
                title: 'New Roommate Request',
                message: `${actor.name} (${compatibility.score}% match) wants to connect with you as a roommate.`,
                data: { roommateRequestId: request.id, roommateProfileId: me.id },
            },
        ])

        await createAuditLog(tx, {
            actor,
            action: AuditAction.ROOMMATE_REQUEST_SENT,
            resource: AUDIT_RESOURCE,
            resourceId: request.id,
            newData: { status: RoommateRequestStatus.PENDING, receiverId },
        })

        return request
    })

    const request = await findRequest(created.id)

    await sendEmailSafely({
        to: request.receiver.email,
        subject: `${request.sender.name} wants to connect with you on ${APP_NAME}`,
        templateName: 'roommate-request',
        templateData: {
            name: request.receiver.name,
            senderName: request.sender.name,
            senderOccupation: request.sender.occupation,
            compatibility: compatibility.score,
            message: request.message,
        },
    })

    return toRequestView(request)
}

const REQUEST_AUDIT_ACTIONS = {
    ACCEPTED: AuditAction.ROOMMATE_REQUEST_ACCEPTED,
    DECLINED: AuditAction.ROOMMATE_REQUEST_DECLINED,
    CANCELLED: AuditAction.ROOMMATE_REQUEST_CANCELLED,
} as const

/**
 * PATCH /roommate/requests/:id/status. ACCEPTED / DECLINED: the receiver. CANCELLED: the sender.
 * Only from PENDING. Accepting shares both people's email and phone with each other (in the app and by email).
 */
const updateRoommateRequestStatus = async (
    actor: RequestUser,
    requestId: string,
    payload: IUpdateRoommateRequestStatusPayload,
) => {
    const request = await findRequestFor(actor, requestId)
    const isSender = request.senderId === actor.userId

    if (payload.status === RoommateRequestStatus.CANCELLED && !isSender) {
        throw new AppError(httpStatus.FORBIDDEN, 'Only The Sender Can Cancel A Roommate Request')
    }

    if (payload.status !== RoommateRequestStatus.CANCELLED && isSender) {
        throw new AppError(
            httpStatus.FORBIDDEN,
            'Only The Person Who Received This Request Can Accept Or Decline It',
        )
    }

    if (request.status !== RoommateRequestStatus.PENDING) {
        throw new AppError(httpStatus.CONFLICT, `This Request Is Already ${request.status}`)
    }

    // Don't hand out contact details of an account that was blocked or deleted since it sent the request
    if (payload.status === RoommateRequestStatus.ACCEPTED) {
        const senderIsActive = await prisma.user.count({
            where: { id: request.senderId, isDeleted: false, status: UserStatus.ACTIVE },
        })

        if (!senderIsActive) {
            throw new AppError(httpStatus.CONFLICT, 'This User Is No Longer Available')
        }
    }

    await prisma.$transaction(async (tx) => {
        const { count } = await tx.roommateRequest.updateMany({
            where: { id: request.id, status: RoommateRequestStatus.PENDING },
            data: { status: payload.status, respondedAt: new Date() },
        })

        if (count === 0) {
            throw new AppError(
                httpStatus.CONFLICT,
                'Roommate Request Status Changed. Please Refresh And Try Again',
            )
        }

        // The sender hears the answer; a cancelled request just disappears from the receiver's pending list
        if (payload.status !== RoommateRequestStatus.CANCELLED) {
            const accepted = payload.status === RoommateRequestStatus.ACCEPTED

            await createNotifications(tx, [
                {
                    userId: request.senderId,
                    type: accepted
                        ? NotificationType.ROOMMATE_REQUEST_ACCEPTED
                        : NotificationType.ROOMMATE_REQUEST_DECLINED,
                    title: accepted ? 'Roommate Request Accepted' : 'Roommate Request Declined',
                    message: accepted
                        ? `${request.receiver.name} accepted your roommate request. You can now see each other's contact details.`
                        : `${request.receiver.name} declined your roommate request.`,
                    data: { roommateRequestId: request.id },
                },
            ])
        }

        await createAuditLog(tx, {
            actor,
            action: REQUEST_AUDIT_ACTIONS[payload.status],
            resource: AUDIT_RESOURCE,
            resourceId: request.id,
            previousData: { status: request.status },
            newData: { status: payload.status },
        })
    })

    if (payload.status === RoommateRequestStatus.ACCEPTED) {
        const { sender, receiver } = request

        await Promise.all(
            [
                [sender, receiver],
                [receiver, sender],
            ].map(([to, other]) =>
                sendEmailSafely({
                    to: to.email,
                    subject: `You're connected with ${other.name} on ${APP_NAME}`,
                    templateName: 'roommate-connected',
                    templateData: {
                        name: to.name,
                        otherName: other.name,
                        otherEmail: other.email,
                        otherPhone: other.phone,
                    },
                }),
            ),
        )
    }

    return toRequestView(await findRequest(request.id))
}

// My requests, sent and/or received (?type=sent|received&status=…)
const getRoommateRequests = async (actor: RequestUser, query: IQuery) => {
    const filters = RoommateRequestsQueryZodSchema.parse(query)
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper(
        query,
        ROOMMATE_REQUEST_SORTABLE_FIELDS,
        'createdAt',
    )

    const side: RoommateRequestWhereInput =
        filters.type === 'sent'
            ? { senderId: actor.userId }
            : filters.type === 'received'
              ? { receiverId: actor.userId }
              : { OR: [{ senderId: actor.userId }, { receiverId: actor.userId }] }

    const where: RoommateRequestWhereInput = {
        AND: [side, ...(filters.status ? [{ status: filters.status }] : [])],
    }

    const [requests, total] = await prisma.$transaction([
        prisma.roommateRequest.findMany({
            where,
            include: roommateRequestInclude,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
        }),
        prisma.roommateRequest.count({ where }),
    ])

    return { data: requests.map(toRequestView), meta: buildPaginationMeta(page, limit, total) }
}

const getRoommateRequestById = async (actor: RequestUser, requestId: string) =>
    toRequestView(await findRequestFor(actor, requestId))

// People I'm connected with (accepted requests in either direction), with their contact details
const getConnections = async (actor: RequestUser, query: IQuery) => {
    const { page, limit, skip } = paginationHelper(query, ['respondedAt'] as const, 'respondedAt')

    const where: RoommateRequestWhereInput = {
        status: RoommateRequestStatus.ACCEPTED,
        OR: [
            { senderId: actor.userId, receiver: { isDeleted: false } },
            { receiverId: actor.userId, sender: { isDeleted: false } },
        ],
    }

    const [requests, total] = await prisma.$transaction([
        prisma.roommateRequest.findMany({
            where,
            include: roommateRequestInclude,
            skip,
            take: limit,
            orderBy: { respondedAt: 'desc' },
        }),
        prisma.roommateRequest.count({ where }),
    ])

    const data = requests.map((request) => ({
        roommateRequestId: request.id,
        connectedAt: request.respondedAt,
        user: request.senderId === actor.userId ? request.receiver : request.sender,
    }))

    return { data, meta: buildPaginationMeta(page, limit, total) }
}

export const RoommateServices = {
    getMatches,
    getProfileById,
    sendRoommateRequest,
    updateRoommateRequestStatus,
    getRoommateRequests,
    getRoommateRequestById,
    getConnections,
    createMyProfile,
    getMyProfile,
    updateMyProfile,
    updateMyProfileStatus,
}
