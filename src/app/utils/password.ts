import bcrypt from 'bcryptjs'
import config from '../config'

export const hashPassword = (password: string) =>
    bcrypt.hash(password, Number(config.bcrypt_salt_rounds) || 10)
