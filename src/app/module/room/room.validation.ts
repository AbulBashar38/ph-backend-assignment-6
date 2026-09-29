import z from 'zod'
import { Amenity, PropertyType, RoomStatus, RoomType } from '../../../generated/prisma/enums'
import { MANUAL_ROOM_STATUSES } from './room.constant'

const isoDateSchema = z.iso
    .datetime({ offset: true, error: 'Must Be An ISO Date, e.g. 2026-11-01T00:00:00Z' })
    .transform((value) => new Date(value))

const roomFields = {
    name: z
        .string('Room Name Is Required')
        .trim()
        .min(1, 'Room Name Is Required')
        .max(50, 'Room Name Must Be At Most 50 Characters Long'),
    roomType: z.enum(RoomType, 'Room Type Must Be SINGLE, SHARED, MASTER Or STUDIO'),
    monthlyRent: z
        .number('Monthly Rent Must Be A Number')
        .int('Monthly Rent Must Be A Whole Number (Taka)')
        .min(500, 'Monthly Rent Must Be At Least 500')
        .max(10_000_000, 'Monthly Rent Is Too High'),
    maxOccupants: z
        .number('Max Occupants Must Be A Number')
        .int('Max Occupants Must Be A Whole Number')
        .min(1, 'Max Occupants Must Be At Least 1')
        .max(20, 'Max Occupants Must Be At Most 20'),
    description: z
        .string()
        .trim()
        .max(2000, 'Description Must Be At Most 2000 Characters Long')
        .nullable(),
    amenities: z
        .array(z.enum(Amenity, 'Invalid Amenity'), 'Amenities Must Be A List')
        .transform((list) => [...new Set(list)]),
    availableFrom: isoDateSchema.nullable(),
}

export const CreateRoomValidationZodSchema = z
    .object({
        propertyId: z.string('Property ID Is Required').trim().min(1, 'Property ID Is Required'),
        ...roomFields,
        description: roomFields.description.optional(),
        amenities: roomFields.amenities.default([]),
        availableFrom: roomFields.availableFrom.optional(),
    })
    .strict()

// Status and property can't be changed here
export const UpdateRoomValidationZodSchema = z
    .object(roomFields)
    .partial()
    .strict()
    .refine((data) => Object.values(data).some((value) => value !== undefined), {
        message: 'Provide At Least One Field To Update',
    })

export const UpdateRoomStatusValidationZodSchema = z.object({
    status: z.enum(
        MANUAL_ROOM_STATUSES,
        'Status Must Be AVAILABLE, UNAVAILABLE Or MAINTENANCE (RESERVED/OCCUPIED Are Set By Rentals)',
    ),
})

// ----- list filters (query strings) -----

const intQuerySchema = (field: string) =>
    z.string().regex(/^\d+$/, `${field} Must Be A Whole Number`).transform(Number)

const amenitiesQuerySchema = z
    .string()
    .transform((value) =>
        value
            .split(',')
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
    )
    .pipe(z.array(z.enum(Amenity, 'Invalid Amenity In Filter')))

const sharedFilters = {
    searchTerm: z.string().trim().max(100, 'Search Term Is Too Long').optional(),
    roomType: z.enum(RoomType, 'Invalid Room Type').optional(),
    minRent: intQuerySchema('minRent').optional(),
    maxRent: intQuerySchema('maxRent').optional(),
    // Rooms that fit at least this many people
    occupants: intQuerySchema('occupants').optional(),
    // Comma-separated; each amenity must be on the room OR its property: amenities=WIFI,AC
    amenities: amenitiesQuerySchema.optional(),
}

export const PublicRoomsQueryZodSchema = z.object({
    ...sharedFilters,
    city: z.string().trim().max(50).optional(),
    area: z.string().trim().max(80).optional(),
    propertyType: z.enum(PropertyType, 'Invalid Property Type').optional(),
    propertyId: z.string().trim().optional(),
    // Rooms free to move into on or before this date
    availableBy: isoDateSchema.optional(),
})

// GET /room (management): owners get rooms of their own properties, admins get all
export const RoomsQueryZodSchema = z.object({
    ...sharedFilters,
    propertyId: z.string().trim().optional(),
    status: z.enum(RoomStatus, 'Invalid Room Status').optional(),
    isDeleted: z
        .enum(['true', 'false'], 'isDeleted Must Be true Or false')
        .transform((value) => value === 'true')
        .optional(),
})
