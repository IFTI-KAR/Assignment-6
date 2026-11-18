import { Router } from "express";
import { auth } from "../../middlewares/auth";
import { imageUpload } from "../../middlewares/upload";
import { validateRequest } from "../../middlewares/validateRequest";
import { UserController } from "./user.controller";
import { updateMeSchema } from "./user.validation";

const router = Router();

router.get("/me", auth(), UserController.getMe);
router.patch("/me", auth(), validateRequest(updateMeSchema), UserController.updateMe);
router.patch("/me/avatar", auth(), imageUpload.single("avatar"), UserController.updateAvatar);
router.delete("/me", auth(), UserController.deleteMe);

export const UserRoutes = router;
