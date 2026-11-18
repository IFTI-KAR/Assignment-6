import { type UploadApiResponse, v2 as cloudinary } from "cloudinary";
import { config } from "../config";
import { AppError } from "../errors/AppError";

const isConfigured = () =>
  !!(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret);

/** Streams an in-memory buffer (from multer) to Cloudinary — no disk access, serverless-safe. */
export const uploadImageBuffer = (buffer: Buffer, folder: string, publicId?: string) => {
  if (!isConfigured()) {
    throw new AppError(503, "File storage is not configured (missing Cloudinary credentials)");
  }
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });

  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
        transformation: [{ width: 400, height: 400, crop: "fill" }],
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Upload failed"));
        resolve(result);
      },
    );
    stream.end(buffer);
  });
};
