import type { Request } from 'express'
import httpStatus from 'http-status'
import multer, { type FileFilterCallback } from 'multer'
import { AppError } from '../utils/AppError'

const MB = 1024 * 1024

interface IUploadOptions {
    allowedMimeTypes: readonly string[]
    // Shown in the error message, e.g. "JPG, PNG Or WEBP"
    allowedLabel: string
    maxFileSizeMb: number
    maxFiles: number
}

// Files stay in memory (no temp files on disk) and are streamed straight to Cloudinary
const createUpload = ({
    allowedMimeTypes,
    allowedLabel,
    maxFileSizeMb,
    maxFiles,
}: IUploadOptions) =>
    multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxFileSizeMb * MB, files: maxFiles },
        fileFilter: (_req: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
            if (allowedMimeTypes.includes(file.mimetype)) {
                callback(null, true)
                return
            }

            callback(
                new AppError(
                    httpStatus.BAD_REQUEST,
                    `Invalid File Type For "${file.fieldname}". Only ${allowedLabel} Files Are Allowed`,
                ),
            )
        },
    })

export const IMAGE_UPLOAD_OPTIONS = {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedLabel: 'JPG, PNG Or WEBP',
    maxFileSizeMb: 5,
    maxFiles: 10,
} as const satisfies IUploadOptions

export const DOCUMENT_UPLOAD_OPTIONS = {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    allowedLabel: 'JPG, PNG, WEBP Or PDF',
    maxFileSizeMb: 10,
    maxFiles: 5,
} as const satisfies IUploadOptions

// Profile pictures, property and room photos
export const imageUpload = createUpload(IMAGE_UPLOAD_OPTIONS)

// Application documents (ID, payslips…): images or PDF
export const documentUpload = createUpload(DOCUMENT_UPLOAD_OPTIONS)
