import type { UploadApiOptions, UploadApiResponse } from 'cloudinary'
import httpStatus from 'http-status'
import { cloudinary } from '../lib/cloudinary'
import { AppError } from './AppError'

export interface IUploadedFile {
    url: string
    publicId: string
}

// Every upload lives under this root, e.g. housing/users/<userId>, housing/properties/<propertyId>
const ROOT_FOLDER = 'housing'

/**
 * Streams an in-memory file (from multer) to Cloudinary.
 * `resourceType: 'image'` makes Cloudinary reject anything that isn't really an image,
 * even if the client lied about the MIME type.
 */
const uploadBuffer = async (
    buffer: Buffer,
    folder: string,
    options: Omit<UploadApiOptions, 'folder'> = {},
): Promise<IUploadedFile> => {
    try {
        const result = await new Promise<UploadApiResponse>((resolve, reject) => {
            cloudinary.uploader
                .upload_stream(
                    { resource_type: 'image', ...options, folder: `${ROOT_FOLDER}/${folder}` },
                    (error, uploadResult) => {
                        if (error || !uploadResult) {
                            reject(error ?? new Error('No result returned from Cloudinary'))
                            return
                        }
                        resolve(uploadResult)
                    },
                )
                .end(buffer)
        })

        return { url: result.secure_url, publicId: result.public_id }
    } catch (error) {
        console.error('Cloudinary upload failed:', error)
        throw new AppError(httpStatus.BAD_GATEWAY, 'Failed To Upload File. Please Try Again')
    }
}

const uploadMany = async (
    files: Express.Multer.File[],
    folder: string,
    options?: Omit<UploadApiOptions, 'folder'>,
) => {
    const results = await Promise.allSettled(
        files.map((file) => uploadBuffer(file.buffer, folder, options)),
    )
    const uploaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))

    // All or nothing: if one upload failed, remove the ones that succeeded
    if (uploaded.length !== files.length) {
        await deleteFiles(uploaded.map((file) => file.publicId))
        throw new AppError(httpStatus.BAD_GATEWAY, 'Failed To Upload Files. Please Try Again')
    }

    return uploaded
}

/**
 * Best-effort cleanup: never throws, so it can't break a request that already succeeded.
 * A failed delete only leaves an orphaned file in Cloudinary, which is logged.
 */
const deleteFiles = async (
    publicIds: (string | null | undefined)[],
    resourceType: 'image' | 'raw' = 'image',
) => {
    const ids = publicIds.filter((id): id is string => Boolean(id))

    const results = await Promise.allSettled(
        ids.map((publicId) =>
            cloudinary.uploader.destroy(publicId, { resource_type: resourceType }),
        ),
    )

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            console.error(`Failed to delete Cloudinary file ${ids[index]}:`, result.reason)
        }
    })
}

/**
 * Upload first, then run the DB write. If the DB write throws, the new files are deleted again,
 * so a failed request never leaves orphaned files behind.
 */
const withUploadRollback = async <T>(uploaded: IUploadedFile[], dbWrite: () => Promise<T>) => {
    try {
        return await dbWrite()
    } catch (error) {
        await deleteFiles(uploaded.map((file) => file.publicId))
        throw error
    }
}

export const cloudinaryUpload = {
    uploadBuffer,
    uploadMany,
    deleteFiles,
    withUploadRollback,
}
