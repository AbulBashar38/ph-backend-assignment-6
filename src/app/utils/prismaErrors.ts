import { Prisma } from '../../generated/prisma/client'

// A unique constraint refused the write (e.g. a concurrent request created the same row first)
export const isUniqueViolation = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
