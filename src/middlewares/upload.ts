import multer from "multer";
import { AppError } from "../errors/AppError";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/** Memory storage only — the serverless filesystem is read-only/ephemeral. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new AppError(400, "Only JPEG, PNG or WEBP images are allowed", [
        { path: file.fieldname, message: `Unsupported type ${file.mimetype}` },
      ]));
    }
    cb(null, true);
  },
});
