import { v2 as cloudinaryV2 } from 'cloudinary'
import config from '../config'

cloudinaryV2.config({
    cloud_name: config.cloudinary_cloud_name,
    api_key: config.cloudinary_api_key,
    api_secret: config.cloudinary_api_secret,
    secure: true,
})

export const cloudinary = cloudinaryV2
