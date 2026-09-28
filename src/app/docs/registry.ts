import { OpenAPIRegistry, type ResponseConfig } from '@asteasolutions/zod-to-openapi'
import z from 'zod'

export const registry = new OpenAPIRegistry()

registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
})

registry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'accessToken',
})

// Either an `Authorization: Bearer` header or the `accessToken` cookie works
export const authSecurity: Record<string, string[]>[] = [{ bearerAuth: [] }, { cookieAuth: [] }]

// `.meta({ id })` registers a named component without needing extendZodWithOpenApi
const ErrorResponseSchema = z
    .object({
        success: z.literal(false),
        statusCode: z.number().meta({ example: 400 }),
        message: z.string().meta({ example: 'Invalid Email Address' }),
    })
    .meta({ id: 'ErrorResponse' })

export const jsonBody = (schema: z.ZodType) => ({
    content: { 'application/json': { schema } },
})

// For endpoints where the whole body may be omitted (e.g. the value usually comes from a cookie)
export const optionalJsonBody = (schema: z.ZodType, description: string) => ({
    required: false,
    description,
    content: { 'application/json': { schema } },
})

export const successResponse = (description: string, dataSchema: z.ZodType = z.null()) => ({
    description,
    content: {
        'application/json': {
            schema: z.object({
                success: z.literal(true),
                statusCode: z.number(),
                message: z.string().meta({ example: description }),
                data: dataSchema,
            }),
        },
    },
})

export const PaginationMetaSchema = z
    .object({
        page: z.number().meta({ example: 1 }),
        limit: z.number().meta({ example: 10 }),
        total: z.number().meta({ example: 57 }),
        totalPages: z.number().meta({ example: 6 }),
    })
    .meta({ id: 'PaginationMeta' })

export const paginatedResponse = (description: string, itemSchema: z.ZodType) => ({
    description,
    content: {
        'application/json': {
            schema: z.object({
                success: z.literal(true),
                statusCode: z.number(),
                message: z.string().meta({ example: description }),
                data: z.array(itemSchema),
                meta: PaginationMetaSchema,
            }),
        },
    },
})

// Standard list query params, spread into each list endpoint's query schema for Swagger
export const paginationQueryParams = <TField extends string>(
    sortableFields: readonly [TField, ...TField[]],
) => ({
    page: z.string().optional().meta({ description: 'Page number (default 1)', example: '1' }),
    limit: z
        .string()
        .optional()
        .meta({ description: 'Items per page (default 10, max 100)', example: '10' }),
    sortBy: z.enum(sortableFields).optional().meta({ description: 'Default `createdAt`' }),
    sortOrder: z.enum(['asc', 'desc']).optional().meta({ description: 'Default `desc`' }),
})

const errorDescriptions: Record<number, string> = {
    400: 'Invalid input',
    401: 'Not logged in, or invalid credentials/token',
    403: 'Forbidden (wrong role or blocked account)',
    404: 'Not found',
    409: 'Conflict (duplicate or invalid state)',
    429: 'Too many requests (OTP cooldown or attempts)',
    502: 'Upstream service failed (email, payment, upload)',
}

export const errorResponses = (...statusCodes: number[]) =>
    Object.fromEntries(
        statusCodes.map((statusCode): [number, ResponseConfig] => [
            statusCode,
            {
                description: errorDescriptions[statusCode] ?? 'Error',
                content: { 'application/json': { schema: ErrorResponseSchema } },
            },
        ]),
    )
