import type { IPaginationMeta, IQuery } from '../interfaces'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

export type TSortOrder = 'asc' | 'desc'

const toPositiveInt = (value: unknown) => {
    const number = Math.floor(Number(value))
    return Number.isFinite(number) && number > 0 ? number : undefined
}

/**
 * Normalizes page/limit/sort from the query string. Lenient on purpose: bad values fall back to defaults.
 * `sortBy` is only accepted from `sortableFields`, because an unknown field would make Prisma throw.
 */
export const paginationHelper = <TField extends string>(
    query: IQuery,
    sortableFields: readonly TField[],
    defaultSortBy: TField,
) => {
    const page = toPositiveInt(query.page) ?? DEFAULT_PAGE
    const limit = Math.min(toPositiveInt(query.limit) ?? DEFAULT_LIMIT, MAX_LIMIT)
    const sortBy = sortableFields.includes(query.sortBy as TField)
        ? (query.sortBy as TField)
        : defaultSortBy
    const sortOrder: TSortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc'

    return { page, limit, skip: (page - 1) * limit, sortBy, sortOrder }
}

export const buildPaginationMeta = (
    page: number,
    limit: number,
    total: number,
): IPaginationMeta => ({
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
})
