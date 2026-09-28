// Raw `req.query` for list endpoints: every value arrives as a string (or is missing)
export interface IQuery {
    searchTerm?: string
    page?: string
    limit?: string
    sortBy?: string
    sortOrder?: string
    // Module-specific filters (role, status, city…)
    [key: string]: unknown
}

export interface IPaginationMeta {
    page: number
    limit: number
    total: number
    totalPages: number
}
