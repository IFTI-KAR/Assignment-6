import { Router } from "express";
import { AmbulanceRoutes } from "../modules/ambulance/ambulance.routes";
import { AuthRoutes } from "../modules/auth/auth.routes";
import { DriverRoutes } from "../modules/driver/driver.routes";
import { EmergencyRoutes } from "../modules/emergency/emergency.routes";
import { HospitalRoutes } from "../modules/hospital/hospital.routes";
import { PaymentRoutes } from "../modules/payment/payment.routes";
import { UserRoutes } from "../modules/user/user.routes";

const router = Router();

type ModuleRoute = { path: string; route: Router };

const moduleRoutes: ModuleRoute[] = [
  { path: "/auth", route: AuthRoutes },
  { path: "/users", route: UserRoutes },
  { path: "/hospitals", route: HospitalRoutes },
  { path: "/ambulances", route: AmbulanceRoutes },
  { path: "/drivers", route: DriverRoutes },
  { path: "/emergencies", route: EmergencyRoutes },
  { path: "/payments", route: PaymentRoutes },
];

for (const { path, route } of moduleRoutes) router.use(path, route);

export default router;
