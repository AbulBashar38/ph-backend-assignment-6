import z from 'zod'
import { Amenity, PropertyStatus, PropertyType } from '../../../generated/prisma/enums'

const trimmedString = (field: string, min: number, max: number) =>
    z
        .string(`${field} Is Required`)
        .trim()
        .min(min, `${field} Must Be At Least ${min} Characters Long`)
        .max(max, `${field} Must Be At Most ${max} Characters Long`)

const futureDateSchema = z.iso
    .datetime({ offset: true, error: 'Expiry Date Must Be An ISO Date, e.g. 2026-12-31T23:59:59Z' })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() > Date.now(), 'Expiry Date Must Be In The Future')

const propertyFields = {
    title: trimmedString('Title', 5, 120),
    description: trimmedString('Description', 20, 5000),
    propertyType: z.enum(
        PropertyType,
        'Property Type Must Be APARTMENT, HOUSE, HOSTEL, SUBLET Or STUDIO',
    ),
    address: trimmedString('Address', 5, 200),
    city: trimmedString('City', 2, 50),
    area: trimmedString('Area', 2, 80),
    latitude: z.number('Latitude Must Be A Number').min(-90).max(90).nullable(),
    longitude: z.number('Longitude Must Be A Number').min(-180).max(180).nullable(),
    amenities: z
        .array(z.enum(Amenity, 'Invalid Amenity'), 'Amenities Must Be A List')
        .max(Object.keys(Amenity).length)
        .transform((list) => [...new Set(list)]),
    expiresAt: futureDateSchema.nullable(),
}

// Status is never set directly: use publish / disable / delete / moderate
export const CreatePropertyValidationZodSchema = z
    .object({
        ...propertyFields,
        latitude: propertyFields.latitude.optional(),
        longitude: propertyFields.longitude.optional(),
        amenities: propertyFields.amenities.default([]),
        expiresAt: propertyFields.expiresAt.optional(),
        // User ID of the owner. Admins create on behalf of an owner (required for them); owners may omit it or pass their own
        ownerId: z
            .string('Owner ID Must Be A String')
            .trim()
            .min(1, 'Owner ID Is Required')
            .optional(),
    })
    .strict()

export const UpdatePropertyValidationZodSchema = z
    .object(propertyFields)
    .partial()
    .strict()
    .refine((data) => Object.values(data).some((value) => value !== undefined), {
        message: 'Provide At Least One Field To Update',
    })

export const ModeratePropertyValidationZodSchema = z
    .object({
        action: z.enum(['SUSPEND', 'RESTORE'], 'Action Must Be SUSPEND Or RESTORE'),
        reason: z.string().trim().max(500, 'Reason Must Be At Most 500 Characters Long').optional(),
    })
    .refine((data) => data.action !== 'SUSPEND' || (data.reason?.length ?? 0) >= 5, {
        message: 'A Reason Of At Least 5 Characters Is Required To Suspend A Property',
        path: ['reason'],
    })

// ----- list filters (query strings) -----

const amenitiesQuerySchema = z
    .string()
    .transform((value) =>
        value
            .split(',')
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
    )
    .pipe(z.array(z.enum(Amenity, 'Invalid Amenity In Filter')))

const baseListFilters = {
    searchTerm: z.string().trim().max(100, 'Search Term Is Too Long').optional(),
    city: z.string().trim().max(50).optional(),
    area: z.string().trim().max(80).optional(),
    propertyType: z.enum(PropertyType, 'Invalid Property Type').optional(),
    // Comma-separated, a property must have ALL of them: amenities=WIFI,AC
    amenities: amenitiesQuerySchema.optional(),
}

export const PublicPropertiesQueryZodSchema = z.object(baseListFilters)

// GET /property (management list): owners get their own listings, admins get all
export const PropertiesQueryZodSchema = z.object({
    ...baseListFilters,
    status: z.enum(PropertyStatus, 'Invalid Property Status').optional(),
    ownerId: z.string().trim().optional(),
    isDeleted: z
        .enum(['true', 'false'], 'isDeleted Must Be true Or false')
        .transform((value) => value === 'true')
        .optional(),
})
