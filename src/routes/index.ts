import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.routes";

const router = Router();

type ModuleRoute = { path: string; route: Router };

const moduleRoutes: ModuleRoute[] = [{ path: "/auth", route: AuthRoutes }];

for (const { path, route } of moduleRoutes) router.use(path, route);

export default router;
