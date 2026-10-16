/**
 * Demo data for evaluators: `npm run seed:demo`
 *
 * Creates (or refreshes) the demo admin, owner and tenant from DEMO_* env vars, a set of published listings
 * for the demo owner with photos on Cloudinary, a few other tenants' roommate profiles, and, through the real
 * services, the demo tenant's roommate profile, a viewing request, a pending application and an approved one
 * (which creates a rental and its first rent bill, ready to pay with Stripe test cards), plus a few months of past
 * rent for the demo owner's earnings charts. The demo tenant always keeps one bill to pay, and has a roommate
 * request to answer plus one accepted connection.
 *
 * Idempotent: listings are only created if the demo owner has none, bookings only if the demo tenant has none.
 */
import { addDays, addMonths, startOfDay, subDays, subMonths } from 'date-fns'
import config from './app/config'
import { cloudinary } from './app/lib/cloudinary'
import { prisma } from './app/lib/prisma'
import type { RequestUser } from './app/middleware/checkAuth'
import { ApplicationServices } from './app/module/application/application.service'
import { CreateApplicationValidationZodSchema } from './app/module/application/application.validation'
import { createRentPayment } from './app/module/payment/payment.utils'
import { RoommateServices } from './app/module/roommate/roommate.service'
import { CreateRoommateProfileValidationZodSchema } from './app/module/roommate/roommate.validation'
import { ViewingServices } from './app/module/viewing/viewing.service'
import { CreateViewingValidationZodSchema } from './app/module/viewing/viewing.validation'
import { hashPassword } from './app/utils/password'
import {
    type Amenity,
    ApplicationStatus,
    AuthProvider,
    Gender,
    type LifestyleTag,
    PaymentStatus,
    type Preference,
    PropertyStatus,
    type PropertyType,
    RentalStatus,
    Role,
    RoomStatus,
    type RoomType,
    type SleepSchedule,
    UserStatus,
} from './generated/prisma/enums'

// Free Unsplash photos, copied into Cloudinary once (deterministic public ids, so re-runs reuse them)
const PHOTOS = {
    apartmentBlock: '1545324418-cc1a3fa10c00',
    modernHouse: '1600585154340-be6161a56a0c',
    gardenHouse: '1568605114967-8130f3a36994',
    brightLiving: '1502672260266-1c1ef2d93688',
    sunnyRoom: '1522708323590-d24dbb6b0267',
    familyLiving: '1560448204-e02f11c3d0e2',
    blueSofa: '1493809842364-78817add7ffb',
    calmLiving: '1505691938895-1758d7feb511',
    kitchen: '1484154218962-a197022b5858',
    loft: '1536376072261-38c75010e6c9',
    plantLiving: '1554995207-c18c203602cb',
    readingCorner: '1586023492125-27b2c045efd7',
    bunkBeds: '1555854877-bab0e564b8d5',
    tvLounge: '1529408632839-a54952c491e5',
} as const

type PhotoKey = keyof typeof PHOTOS

const uploadedPhotos = new Map<PhotoKey, { url: string; publicId: string }>()

const photo = async (key: PhotoKey) => {
    const cached = uploadedPhotos.get(key)
    if (cached) return cached

    const result = await cloudinary.uploader.upload(
        `https://images.unsplash.com/photo-${PHOTOS[key]}?w=1600&q=75&auto=format&fit=crop&fm=jpg`,
        { public_id: `housing/seed/${key}`, overwrite: false, resource_type: 'image' },
    )
    const uploaded = { url: result.secure_url, publicId: result.public_id }
    uploadedPhotos.set(key, uploaded)
    return uploaded
}

interface SeedRoom {
    name: string
    roomType: RoomType
    monthlyRent: number
    maxOccupants: number
    description: string
    amenities: Amenity[]
    availableInDays: number
    photos: PhotoKey[]
}

interface SeedProperty {
    title: string
    description: string
    propertyType: PropertyType
    address: string
    area: string
    amenities: Amenity[]
    photos: PhotoKey[]
    rooms: SeedRoom[]
}

const LISTINGS: SeedProperty[] = [
    {
        title: 'Bright 2-bed flat near Dhanmondi Lake',
        description:
            'Corner flat on the 5th floor with cross ventilation and a balcony facing the lake road. Walking distance to Rabindra Sarobar, schools and Road 27 shops. Gas line, lift and generator backup for lifts and lights.',
        propertyType: 'APARTMENT',
        address: 'House 14, Road 7A',
        area: 'Dhanmondi',
        amenities: ['LIFT', 'GENERATOR', 'GAS', 'SECURITY_GUARD', 'BALCONY', 'WATER_SUPPLY'],
        photos: ['apartmentBlock', 'brightLiving', 'kitchen'],
        rooms: [
            {
                name: 'Master bedroom',
                roomType: 'MASTER',
                monthlyRent: 22000,
                maxOccupants: 2,
                description: 'Large bedroom with an attached bathroom and the balcony.',
                amenities: ['ATTACHED_BATHROOM', 'AC', 'FURNISHED'],
                availableInDays: 0,
                photos: ['calmLiving'],
            },
            {
                name: 'Second bedroom',
                roomType: 'SINGLE',
                monthlyRent: 15000,
                maxOccupants: 1,
                description: 'Quiet room facing the inner courtyard, good for working from home.',
                amenities: ['WIFI', 'FURNISHED'],
                availableInDays: 14,
                photos: ['readingCorner'],
            },
        ],
    },
    {
        title: 'Family house with a garden in Uttara Sector 7',
        description:
            'Two-storey house on a quiet lane with a small front garden and parking for one car. Five minutes to the Uttara North metro station. Rooms can be rented separately; the kitchen and living room are shared.',
        propertyType: 'HOUSE',
        address: 'House 22, Road 13, Sector 7',
        area: 'Uttara',
        amenities: ['PARKING', 'GAS', 'CCTV', 'KITCHEN', 'LAUNDRY', 'WATER_SUPPLY'],
        photos: ['gardenHouse', 'familyLiving', 'kitchen'],
        rooms: [
            {
                name: 'Ground floor master',
                roomType: 'MASTER',
                monthlyRent: 25000,
                maxOccupants: 3,
                description: 'Opens onto the garden, with its own bathroom.',
                amenities: ['ATTACHED_BATHROOM', 'AC'],
                availableInDays: 7,
                photos: ['familyLiving'],
            },
            {
                name: 'Upstairs single',
                roomType: 'SINGLE',
                monthlyRent: 12000,
                maxOccupants: 1,
                description: 'Bright single room with a desk and wardrobe.',
                amenities: ['FURNISHED', 'WIFI'],
                availableInDays: 0,
                photos: ['sunnyRoom'],
            },
            {
                name: 'Shared room (3 beds)',
                roomType: 'SHARED',
                monthlyRent: 7000,
                maxOccupants: 3,
                description: 'Three beds with lockers; rent is per bed.',
                amenities: ['FURNISHED'],
                availableInDays: 0,
                photos: ['tvLounge'],
            },
        ],
    },
    {
        title: 'Furnished studio near Gulshan 2 circle',
        description:
            'Self-contained studio in a serviced building with 24/7 security, a rooftop terrace and high-speed Wi-Fi included in the rent. Ideal for one professional or a couple.',
        propertyType: 'STUDIO',
        address: 'Road 41, Block CEN',
        area: 'Gulshan',
        amenities: ['WIFI', 'AC', 'LIFT', 'GENERATOR', 'SECURITY_GUARD', 'ROOFTOP', 'FURNISHED'],
        photos: ['modernHouse', 'loft', 'plantLiving'],
        rooms: [
            {
                name: 'Studio 4B',
                roomType: 'STUDIO',
                monthlyRent: 32000,
                maxOccupants: 2,
                description: 'Open-plan studio with a kitchenette and a large window.',
                amenities: ['KITCHEN', 'ATTACHED_BATHROOM', 'AC', 'FURNISHED'],
                availableInDays: 3,
                photos: ['loft'],
            },
        ],
    },
    {
        title: 'Bachelor sublet in Bashundhara R/A',
        description:
            'Two rooms available in a shared 3-bedroom flat with working professionals. Close to the private universities and Jamuna Future Park. Cook and cleaner shared by the flat.',
        propertyType: 'SUBLET',
        address: 'Road 8, Block D',
        area: 'Bashundhara',
        amenities: ['WIFI', 'LIFT', 'GENERATOR', 'GAS', 'KITCHEN'],
        photos: ['blueSofa', 'kitchen'],
        rooms: [
            {
                name: 'Room A',
                roomType: 'SINGLE',
                monthlyRent: 9500,
                maxOccupants: 1,
                description: 'Furnished room with a window onto the street.',
                amenities: ['FURNISHED'],
                availableInDays: 0,
                photos: ['sunnyRoom'],
            },
            {
                name: 'Room B',
                roomType: 'SINGLE',
                monthlyRent: 8500,
                maxOccupants: 1,
                description: 'Smaller room next to the shared bathroom.',
                amenities: ['FURNISHED'],
                availableInDays: 10,
                photos: ['readingCorner'],
            },
        ],
    },
    {
        title: 'Student hostel near Banani Road 11',
        description:
            'Clean, supervised hostel for students and young professionals, with meals available, a study room and laundry. Beds are rented individually.',
        propertyType: 'HOSTEL',
        address: 'House 54, Road 11',
        area: 'Banani',
        amenities: ['WIFI', 'GENERATOR', 'CCTV', 'SECURITY_GUARD', 'LAUNDRY', 'WATER_SUPPLY'],
        photos: ['bunkBeds', 'tvLounge'],
        rooms: [
            {
                name: '4-bed dorm',
                roomType: 'SHARED',
                monthlyRent: 5500,
                maxOccupants: 4,
                description: 'Bunk beds with personal lockers and reading lights.',
                amenities: ['FURNISHED'],
                availableInDays: 0,
                photos: ['bunkBeds'],
            },
            {
                name: '2-bed room',
                roomType: 'SHARED',
                monthlyRent: 7500,
                maxOccupants: 2,
                description: 'Twin room with a desk for each person.',
                amenities: ['FURNISHED', 'AC'],
                availableInDays: 5,
                photos: ['sunnyRoom'],
            },
        ],
    },
    {
        title: 'Quiet 3-bed apartment in Mohammadpur',
        description:
            'Spacious apartment in a calm residential block near Asad Avenue. Good light all day, gas stove kitchen and a separate dining space.',
        propertyType: 'APARTMENT',
        address: 'House 9, Road 2, Block C',
        area: 'Mohammadpur',
        amenities: ['GAS', 'WATER_SUPPLY', 'BALCONY', 'KITCHEN'],
        photos: ['calmLiving', 'brightLiving'],
        rooms: [
            {
                name: 'Corner bedroom',
                roomType: 'MASTER',
                monthlyRent: 14000,
                maxOccupants: 2,
                description: 'Corner room with two windows and an attached bathroom.',
                amenities: ['ATTACHED_BATHROOM'],
                availableInDays: 0,
                photos: ['plantLiving'],
            },
            {
                name: 'Small bedroom',
                roomType: 'SINGLE',
                monthlyRent: 9000,
                maxOccupants: 1,
                description: 'Compact room, good value for one person.',
                amenities: [],
                availableInDays: 20,
                photos: ['readingCorner'],
            },
        ],
    },
]

// Other tenants looking for roommates, so the demo tenant has matches to browse (they can't log in)
const OTHER_SEEKERS: {
    name: string
    email: string
    gender: Gender
    occupation: string
    age: number
    budgetMin: number
    budgetMax: number
    preferredArea?: string
    moveInDays: number
    sleepSchedule: SleepSchedule
    smokingPreference: Preference
    petPreference: Preference
    lifestyle: LifestyleTag[]
    bio: string
}[] = [
    {
        name: 'Tanvir Hasan',
        email: 'tanvir.seeker@example.com',
        gender: Gender.MALE,
        occupation: 'Software engineer',
        age: 26,
        budgetMin: 8000,
        budgetMax: 14000,
        preferredArea: 'Bashundhara',
        moveInDays: 10,
        sleepSchedule: 'NIGHT_OWL',
        smokingPreference: 'NO',
        petPreference: 'NO_PREFERENCE',
        lifestyle: ['WORK_FROM_HOME', 'GAMING', 'CLEAN'],
        bio: 'Remote developer, quiet during the day, happy to split groceries.',
    },
    {
        name: 'Arif Chowdhury',
        email: 'arif.seeker@example.com',
        gender: Gender.MALE,
        occupation: 'Master’s student',
        age: 24,
        budgetMin: 6000,
        budgetMax: 10000,
        preferredArea: 'Bashundhara',
        moveInDays: 20,
        sleepSchedule: 'EARLY_BIRD',
        smokingPreference: 'NO',
        petPreference: 'NO',
        lifestyle: ['STUDIOUS', 'QUIET', 'FITNESS'],
        bio: 'Studying at a university nearby; early riser, gym in the mornings.',
    },
    {
        name: 'Rafiq Ahmed',
        email: 'rafiq.seeker@example.com',
        gender: Gender.MALE,
        occupation: 'Bank officer',
        age: 29,
        budgetMin: 10000,
        budgetMax: 18000,
        moveInDays: 30,
        sleepSchedule: 'FLEXIBLE',
        smokingPreference: 'NO_PREFERENCE',
        petPreference: 'YES',
        lifestyle: ['COOKING', 'SOCIAL', 'MUSIC'],
        bio: 'Loves cooking on weekends; looking for a friendly flat in Dhaka.',
    },
]

const actorOf = (user: { id: string; name: string; email: string; role: Role }): RequestUser => ({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
})

// Creates the account, or brings an existing one back to a usable demo state (verified, active, known password)
const upsertDemoUser = async (input: {
    email: string
    password: string
    name: string
    role: Role
    phone: string
    gender?: Gender
    occupation?: string
}) => {
    const email = input.email.trim().toLowerCase()
    const data = {
        name: input.name,
        role: input.role,
        password: await hashPassword(input.password),
        emailVerified: true,
        status: UserStatus.ACTIVE,
        isDeleted: false,
        deletedAt: null,
        gender: input.gender,
        occupation: input.occupation,
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    const user = existing
        ? await prisma.user.update({ where: { id: existing.id }, data })
        : await prisma.user.create({
              data: { ...data, email, phone: input.phone, authProvider: AuthProvider.CREDENTIAL },
          })

    console.log(`  ${existing ? 'updated' : 'created'} ${input.role.toLowerCase()} ${email}`)
    return user
}

const requireEnv = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`${name} is not set in .env (see .env.example)`)
    return value
}

const seedListings = async (ownerId: string) => {
    const existing = await prisma.property.count({ where: { ownerId, isDeleted: false } })
    if (existing > 0) {
        console.log(`  demo owner already has ${existing} listing(s); skipping listings`)
        return
    }

    const today = startOfDay(new Date())

    for (const listing of LISTINGS) {
        const propertyImages = await Promise.all(listing.photos.map(photo))
        const property = await prisma.property.create({
            data: {
                title: listing.title,
                description: listing.description,
                propertyType: listing.propertyType,
                address: listing.address,
                city: 'Dhaka',
                area: listing.area,
                amenities: listing.amenities,
                status: PropertyStatus.PUBLISHED,
                publishedAt: new Date(),
                ownerId,
                images: { create: propertyImages },
            },
        })

        for (const room of listing.rooms) {
            const roomImages = await Promise.all(room.photos.map(photo))
            await prisma.room.create({
                data: {
                    name: room.name,
                    roomType: room.roomType,
                    monthlyRent: room.monthlyRent,
                    maxOccupants: room.maxOccupants,
                    description: room.description,
                    amenities: room.amenities,
                    availableFrom: addDays(today, room.availableInDays),
                    propertyId: property.id,
                    images: { create: roomImages },
                },
            })
        }
        console.log(`  listed "${listing.title}" with ${listing.rooms.length} room(s)`)
    }
}

const seedOtherSeekers = async () => {
    for (const [index, seeker] of OTHER_SEEKERS.entries()) {
        const user = await upsertDemoUser({
            email: seeker.email,
            // Random: these accounts only exist so the demo tenant has roommate matches
            password: `Seeker-${crypto.randomUUID()}!aA1`,
            name: seeker.name,
            role: Role.TENANT,
            phone: `+88017000001${index}0`,
            gender: seeker.gender,
            occupation: seeker.occupation,
        })
        const hasProfile = await prisma.roommateProfile.findUnique({ where: { tenantId: user.id } })
        if (hasProfile) continue

        const payload = await CreateRoommateProfileValidationZodSchema.parseAsync({
            age: seeker.age,
            budgetMin: seeker.budgetMin,
            budgetMax: seeker.budgetMax,
            preferredCity: 'Dhaka',
            preferredArea: seeker.preferredArea,
            moveInDate: addDays(new Date(), seeker.moveInDays).toISOString(),
            sleepSchedule: seeker.sleepSchedule,
            smokingPreference: seeker.smokingPreference,
            petPreference: seeker.petPreference,
            lifestyle: seeker.lifestyle,
            bio: seeker.bio,
        })
        await RoommateServices.createMyProfile(actorOf(user), payload)
    }
}

const seedTenantActivity = async (
    tenant: { id: string; name: string; email: string; role: Role },
    owner: { id: string; name: string; email: string; role: Role },
) => {
    const tenantActor = actorOf(tenant)

    if (!(await prisma.roommateProfile.findUnique({ where: { tenantId: tenant.id } }))) {
        const payload = await CreateRoommateProfileValidationZodSchema.parseAsync({
            age: 25,
            budgetMin: 8000,
            budgetMax: 13000,
            preferredCity: 'Dhaka',
            preferredArea: 'Bashundhara',
            moveInDate: addDays(new Date(), 14).toISOString(),
            sleepSchedule: 'FLEXIBLE',
            smokingPreference: 'NO',
            petPreference: 'NO_PREFERENCE',
            lifestyle: ['CLEAN', 'WORK_FROM_HOME', 'COOKING'],
            bio: 'Product designer who works from home a few days a week. Tidy, friendly and up for sharing meals.',
        })
        await RoommateServices.createMyProfile(tenantActor, payload)
        console.log('  created the demo tenant’s roommate profile')
    }

    if ((await prisma.application.count({ where: { tenantId: tenant.id } })) > 0) {
        console.log('  demo tenant already has applications; skipping bookings')
        return
    }

    const room = (propertyTitle: string, roomName: string) =>
        prisma.room.findFirstOrThrow({
            where: {
                name: roomName,
                isDeleted: false,
                property: { title: propertyTitle, ownerId: owner.id, isDeleted: false },
            },
            select: { id: true, propertyId: true },
        })

    // Approved: becomes a rental with its first rent bill, ready to pay
    const sublet = await room('Bachelor sublet in Bashundhara R/A', 'Room A')
    const approved = await ApplicationServices.createApplication(
        tenantActor,
        await CreateApplicationValidationZodSchema.parseAsync({
            roomId: sublet.id,
            moveInDate: addDays(new Date(), 3).toISOString(),
            occupants: 1,
            message: 'Hi! I work as a product designer nearby and can move in this week.',
        }),
    )
    await ApplicationServices.updateApplicationStatus(actorOf(owner), approved.id, {
        status: 'APPROVED',
    })
    console.log('  approved an application → rental + first rent bill')

    // Pending: waiting for the owner's decision
    const dhanmondi = await room('Bright 2-bed flat near Dhanmondi Lake', 'Second bedroom')
    await ApplicationServices.createApplication(
        tenantActor,
        await CreateApplicationValidationZodSchema.parseAsync({
            roomId: dhanmondi.id,
            moveInDate: addDays(new Date(), 21).toISOString(),
            occupants: 1,
            message: 'Interested in the second bedroom from next month.',
        }),
    )
    console.log('  sent a pending application')

    // Viewing request the demo owner can approve or reschedule
    const studio = await room('Furnished studio near Gulshan 2 circle', 'Studio 4B')
    const viewingAt = addDays(startOfDay(new Date()), 3)
    viewingAt.setHours(17, 0, 0, 0)
    await ViewingServices.createViewing(
        tenantActor,
        await CreateViewingValidationZodSchema.parseAsync({
            propertyId: studio.propertyId,
            roomId: studio.id,
            preferredAt: viewingAt.toISOString(),
            message: 'Could I see the studio after work?',
        }),
    )
    console.log('  requested a viewing')
}

/**
 * Past rent for the earnings charts. Bills of past months can't be created through the real services (they only
 * bill from today on), so this writes demo HISTORY directly: one finished rental and one active one, each with
 * months of rent marked paid on its due day. The app itself never does this: only Stripe settles live bills.
 * Skipped when the demo owner already has paid bills.
 */
const seedRentHistory = async (owner: { id: string }) => {
    const paidBills = await prisma.payment.count({
        where: { status: PaymentStatus.PAID, rental: { ownerId: owner.id } },
    })
    if (paidBills > 0) {
        console.log('  demo owner already has paid rent; skipping rent history')
        return
    }

    const history = [
        {
            seekerEmail: 'tanvir.seeker@example.com',
            propertyTitle: 'Family house with a garden in Uttara Sector 7',
            roomName: 'Upstairs single',
            startedMonthsAgo: 5,
            paidMonths: 4,
            // Moved out a month ago: the room is free again
            finished: true,
        },
        {
            seekerEmail: 'arif.seeker@example.com',
            propertyTitle: 'Student hostel near Banani Road 11',
            roomName: '2-bed room',
            startedMonthsAgo: 3,
            paidMonths: 3,
            // Still living there; this month's bill is due
            finished: false,
        },
    ]

    for (const entry of history) {
        const tenant = await prisma.user.findUniqueOrThrow({
            where: { email: entry.seekerEmail },
            select: { id: true },
        })
        const room = await prisma.room.findFirstOrThrow({
            where: {
                name: entry.roomName,
                isDeleted: false,
                property: { title: entry.propertyTitle, ownerId: owner.id, isDeleted: false },
            },
            select: { id: true, propertyId: true, monthlyRent: true },
        })
        const startDate = startOfDay(subMonths(new Date(), entry.startedMonthsAgo))
        const endDate = entry.finished ? addMonths(startDate, entry.paidMonths) : null

        await prisma.$transaction(async (tx) => {
            const application = await tx.application.create({
                data: {
                    tenantId: tenant.id,
                    propertyId: room.propertyId,
                    roomId: room.id,
                    moveInDate: startDate,
                    occupants: 1,
                    status: ApplicationStatus.APPROVED,
                    expiresAt: startDate,
                    reviewedAt: subDays(startDate, 3),
                    createdAt: subDays(startDate, 7),
                },
            })
            const rental = await tx.rental.create({
                data: {
                    applicationId: application.id,
                    tenantId: tenant.id,
                    ownerId: owner.id,
                    propertyId: room.propertyId,
                    roomId: room.id,
                    monthlyRent: room.monthlyRent,
                    startDate,
                    endDate,
                    status: entry.finished ? RentalStatus.COMPLETED : RentalStatus.ACTIVE,
                    activatedAt: startDate,
                    completedAt: endDate,
                    liveRoomKey: entry.finished ? null : room.id,
                    createdAt: subDays(startDate, 3),
                },
            })

            const months = entry.finished ? entry.paidMonths : entry.paidMonths + 1
            for (let period = 1; period <= months; period += 1) {
                const bill = await createRentPayment(tx, { ...rental, tenantId: tenant.id }, period)
                if (period <= entry.paidMonths) {
                    await tx.payment.update({
                        where: { id: bill.id },
                        data: { status: PaymentStatus.PAID, paidAt: addDays(bill.dueDate, 1) },
                    })
                }
            }

            if (!entry.finished) {
                await tx.room.update({
                    where: { id: room.id },
                    data: { status: RoomStatus.OCCUPIED, currentOccupants: 1 },
                })
            }
        })
        console.log(
            `  added rent history for "${entry.roomName}" (${entry.paidMonths} paid month(s)${entry.finished ? ', finished' : ', active'})`,
        )
    }
}

/**
 * Keeps one bill the evaluator can pay with a Stripe test card: if the demo tenant has nothing payable, apply for a
 * room and approve it through the real services (which create the rental and its first rent bill).
 */
const ensureTenantHasDueBill = async (
    tenant: { id: string; name: string; email: string; role: Role },
    owner: { id: string; name: string; email: string; role: Role },
) => {
    const payable = await prisma.payment.count({
        where: {
            tenantId: tenant.id,
            status: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED, PaymentStatus.CANCELLED] },
            rental: { status: { in: [RentalStatus.PENDING, RentalStatus.ACTIVE] } },
        },
    })
    if (payable > 0) return

    const room = await prisma.room.findFirst({
        where: {
            name: 'Small bedroom',
            status: RoomStatus.AVAILABLE,
            isDeleted: false,
            property: {
                title: 'Quiet 3-bed apartment in Mohammadpur',
                ownerId: owner.id,
                isDeleted: false,
            },
        },
        select: { id: true },
    })
    if (!room) {
        console.log('  no free room for a new demo bill; skipping')
        return
    }

    const application = await ApplicationServices.createApplication(
        actorOf(tenant),
        await CreateApplicationValidationZodSchema.parseAsync({
            roomId: room.id,
            moveInDate: addDays(new Date(), 5).toISOString(),
            occupants: 1,
            message: 'Looking for a quiet room close to work. Happy to move in next week.',
        }),
    )
    await ApplicationServices.updateApplicationStatus(actorOf(owner), application.id, {
        status: 'APPROVED',
    })
    console.log('  approved a new application → a rent bill the demo tenant can pay')
}

/**
 * Roommate requests through the real services: one waiting for the demo tenant to answer, and one accepted
 * connection (so the connections page shows contact details). Skipped once the demo tenant has any requests.
 */
const seedRoommateRequests = async (tenant: {
    id: string
    name: string
    email: string
    role: Role
}) => {
    const existing = await prisma.roommateRequest.count({
        where: { OR: [{ senderId: tenant.id }, { receiverId: tenant.id }] },
    })
    if (existing > 0) {
        console.log('  demo tenant already has roommate requests; skipping')
        return
    }

    const seeker = (email: string) =>
        prisma.user.findUniqueOrThrow({
            where: { email },
            select: { id: true, name: true, email: true, role: true },
        })
    const profileOf = (userId: string) =>
        prisma.roommateProfile.findUniqueOrThrow({
            where: { tenantId: userId },
            select: { id: true },
        })
    const demoProfile = await profileOf(tenant.id)

    // Waiting for the demo tenant: accept or decline it on /dashboard/roommate/requests
    const rafiq = await seeker('rafiq.seeker@example.com')
    await RoommateServices.sendRoommateRequest(actorOf(rafiq), {
        receiverProfileId: demoProfile.id,
        message:
            'Hi! We seem to want the same area and budget. Want to look for a 2-bed flat together?',
    })

    // Already connected: the demo tenant asked, Tanvir accepted
    const tanvir = await seeker('tanvir.seeker@example.com')
    const request = await RoommateServices.sendRoommateRequest(actorOf(tenant), {
        receiverProfileId: (await profileOf(tanvir.id)).id,
        message: 'Your schedule sounds a lot like mine. Shall we team up?',
    })
    await RoommateServices.updateRoommateRequestStatus(actorOf(tanvir), request.id, {
        status: 'ACCEPTED',
    })
    console.log('  added a pending roommate request and an accepted connection')
}

const main = async () => {
    console.log('Seeding demo data…')

    await upsertDemoUser({
        email: requireEnv(config.demo_admin_email, 'DEMO_ADMIN_EMAIL'),
        password: requireEnv(config.demo_admin_password, 'DEMO_ADMIN_PASSWORD'),
        name: 'Demo Admin',
        role: Role.ADMIN,
        phone: '+8801700000001',
    })
    const owner = await upsertDemoUser({
        email: requireEnv(config.demo_owner_email, 'DEMO_OWNER_EMAIL'),
        password: requireEnv(config.demo_owner_password, 'DEMO_OWNER_PASSWORD'),
        name: 'Demo Owner',
        role: Role.OWNER,
        phone: '+8801700000002',
    })
    const tenant = await upsertDemoUser({
        email: requireEnv(config.demo_tenant_email, 'DEMO_TENANT_EMAIL'),
        password: requireEnv(config.demo_tenant_password, 'DEMO_TENANT_PASSWORD'),
        name: 'Demo Tenant',
        role: Role.TENANT,
        phone: '+8801700000003',
        gender: Gender.MALE,
        occupation: 'Product designer',
    })

    await seedListings(owner.id)
    await seedOtherSeekers()
    await seedTenantActivity(tenant, owner)
    await seedRentHistory(owner)
    await ensureTenantHasDueBill(tenant, owner)
    await seedRoommateRequests(tenant)

    console.log('Done.')
}

main()
    .catch((error) => {
        console.error('Demo seed failed:', error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
