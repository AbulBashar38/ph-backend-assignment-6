import { Role } from '../../generated/prisma/enums'

// "Admin" always means ADMIN **and** SUPER_ADMIN: the super admin can do everything an admin can (and more).
// Use `auth(...ADMIN_ROLES)` for admin routes instead of listing the roles by hand.
export const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const

export const isAdminRole = (role: Role) => (ADMIN_ROLES as readonly Role[]).includes(role)
