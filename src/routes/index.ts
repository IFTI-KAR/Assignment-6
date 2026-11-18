import { Router } from "express";

const router = Router();

type ModuleRoute = { path: string; route: Router };

const moduleRoutes: ModuleRoute[] = [];

for (const { path, route } of moduleRoutes) router.use(path, route);

export default router;
