import { AuthProvider, Role } from '../../generated/prisma/enums'
import config from '../config'
import { prisma } from '../lib/prisma'
import { hashPassword } from './password'

// Idempotent: creates the super admin from env on first boot, does nothing afterwards
export const seedSuperAdmin = async () => {
    const { super_admin_name: name, super_admin_password: password } = config
    const email = config.super_admin_email?.trim().toLowerCase()

    if (!name || !email || !password) {
        console.warn('SUPER_ADMIN_NAME/EMAIL/PASSWORD not set in .env. Skipping super admin seed.')
        return
    }

    const existingSuperAdmin = await prisma.user.findFirst({
        where: { OR: [{ role: Role.SUPER_ADMIN }, { email }] },
        select: { id: true },
    })

    if (existingSuperAdmin) {
        return
    }

    await prisma.user.create({
        data: {
            name,
            email,
            password: await hashPassword(password),
            role: Role.SUPER_ADMIN,
            authProvider: AuthProvider.CREDENTIAL,
            emailVerified: true,
        },
    })

    console.log(`Super admin created: ${email}`)
}
