/**
 * Idempotent seed: safe to run multiple times.
 *   npm run db:seed
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run seed");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@rescue.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";

const hash = (pw: string) => bcrypt.hash(pw, 10);

// Dhaka coordinates
const hospitals = [
  {
    name: "Dhaka Medical College Hospital",
    address: "Secretariat Rd, Bakshibazar",
    city: "Dhaka",
    phone: "01711000001",
    latitude: 23.7258,
    longitude: 90.3976,
    totalEmergencyBeds: 120,
    availableBeds: 18,
    hasICU: true,
    specialties: ["Trauma", "Burn", "Cardiology", "Neurology"],
  },
  {
    name: "Square Hospital",
    address: "18/F Bir Uttam Qazi Nuruzzaman Sarak, Panthapath",
    city: "Dhaka",
    phone: "01711000002",
    latitude: 23.7527,
    longitude: 90.3815,
    totalEmergencyBeds: 40,
    availableBeds: 9,
    hasICU: true,
    specialties: ["Cardiology", "Neurology", "Pediatrics"],
  },
  {
    name: "Evercare Hospital Dhaka",
    address: "Plot 81, Block E, Bashundhara R/A",
    city: "Dhaka",
    phone: "01711000003",
    latitude: 23.8103,
    longitude: 90.4316,
    totalEmergencyBeds: 35,
    availableBeds: 6,
    hasICU: true,
    specialties: ["Cardiology", "Oncology", "Maternity"],
  },
  {
    name: "Kurmitola General Hospital",
    address: "Airport Rd, Dhaka Cantonment",
    city: "Dhaka",
    phone: "01711000004",
    latitude: 23.8203,
    longitude: 90.4072,
    totalEmergencyBeds: 60,
    availableBeds: 15,
    hasICU: false,
    specialties: ["General Surgery", "Orthopedics"],
  },
  {
    name: "Bangladesh Medical College Hospital",
    address: "Road 14/A, Dhanmondi",
    city: "Dhaka",
    phone: "01711000005",
    latitude: 23.7509,
    longitude: 90.3707,
    totalEmergencyBeds: 30,
    availableBeds: 0,
    hasICU: false,
    specialties: ["Maternity", "Pediatrics"],
  },
];

const drivers = [
  {
    name: "Rahim Uddin",
    email: "driver1@rescue.com",
    phone: "01811000001",
    license: "DK-0456789",
    reg: "DHAKA-METRO-CHA-11-1001",
    type: "ADVANCED",
    lat: 23.7465,
    lng: 90.376,
    station: "Dhanmondi Station",
    base: 1500,
    perKm: 80,
  },
  {
    name: "Karim Hossain",
    email: "driver2@rescue.com",
    phone: "01811000002",
    license: "DK-0456790",
    reg: "DHAKA-METRO-CHA-11-1002",
    type: "BASIC",
    lat: 23.7808,
    lng: 90.4007,
    station: "Mohakhali Station",
    base: 800,
    perKm: 50,
  },
  {
    name: "Jamal Mia",
    email: "driver3@rescue.com",
    phone: "01811000003",
    license: "DK-0456791",
    reg: "DHAKA-METRO-CHA-11-1003",
    type: "ICU",
    lat: 23.815,
    lng: 90.425,
    station: "Bashundhara Station",
    base: 3000,
    perKm: 120,
  },
  {
    name: "Sohel Rana",
    email: "driver4@rescue.com",
    phone: "01811000004",
    license: "DK-0456792",
    reg: "DHAKA-METRO-CHA-11-1004",
    type: "NEONATAL",
    lat: 23.729,
    lng: 90.41,
    station: "Motijheel Station",
    base: 2500,
    perKm: 100,
  },
] as const;

async function main() {
  console.log("🌱 Seeding database...");

  // ---- Admin ----
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", status: "ACTIVE", deletedAt: null },
    create: {
      name: "Dispatch Admin",
      email: ADMIN_EMAIL,
      password: await hash(ADMIN_PASSWORD),
      phone: "01700000000",
      role: "ADMIN",
    },
  });

  // ---- Patients ----
  const patientPw = await hash("Patient@12345");
  const patient = await prisma.user.upsert({
    where: { email: "patient@rescue.com" },
    update: {},
    create: {
      name: "Ayesha Rahman",
      email: "patient@rescue.com",
      password: patientPw,
      phone: "01911000001",
    },
  });
  await prisma.user.upsert({
    where: { email: "patient2@rescue.com" },
    update: {},
    create: {
      name: "Tanvir Ahmed",
      email: "patient2@rescue.com",
      password: patientPw,
      phone: "01911000002",
    },
  });

  // ---- Hospitals ----
  for (const h of hospitals) {
    const existing = await prisma.hospital.findFirst({ where: { name: h.name } });
    if (!existing) await prisma.hospital.create({ data: h });
  }

  // ---- Drivers + Ambulances (verified, on duty, AVAILABLE) ----
  const driverPw = await hash("Driver@12345");
  for (const d of drivers) {
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: {},
      create: {
        name: d.name,
        email: d.email,
        password: driverPw,
        phone: d.phone,
        role: "DRIVER",
        driverProfile: {
          create: {
            licenseNumber: d.license,
            licenseExpiry: new Date("2029-12-31"),
            experienceYears: 5,
            isVerified: true,
            isOnDuty: true,
            currentLat: d.lat,
            currentLng: d.lng,
            lastLocationAt: new Date(),
          },
        },
      },
      include: { driverProfile: true },
    });

    if (!user.driverProfile) {
      throw new Error(`Missing driverProfile for ${d.email}`);
    }

    await prisma.ambulance.upsert({
      where: { registrationNo: d.reg },
      update: {},
      create: {
        registrationNo: d.reg,
        type: d.type,
        status: "AVAILABLE",
        equipment:
          d.type === "BASIC"
            ? ["Oxygen", "First-aid kit", "Stretcher"]
            : ["Oxygen", "Defibrillator", "Ventilator", "Cardiac monitor", "Stretcher"],
        capacity: 1,
        baseFare: d.base,
        perKmRate: d.perKm,
        stationName: d.station,
        currentLat: d.lat,
        currentLng: d.lng,
        driverId: user.driverProfile.id,
      },
    });
  }

  // ---- An unverified driver applicant (for the verification demo) ----
  await prisma.user.upsert({
    where: { email: "newdriver@rescue.com" },
    update: {},
    create: {
      name: "Nayeem Islam",
      email: "newdriver@rescue.com",
      password: driverPw,
      phone: "01811000009",
      role: "DRIVER",
      driverProfile: {
        create: { licenseNumber: "DK-0999999", licenseExpiry: new Date("2028-06-30") },
      },
    },
  });

  // ---- A spare ambulance without driver ----
  await prisma.ambulance.upsert({
    where: { registrationNo: "DHAKA-METRO-CHA-11-1005" },
    update: {},
    create: {
      registrationNo: "DHAKA-METRO-CHA-11-1005",
      type: "BASIC",
      status: "OFFLINE",
      equipment: ["Oxygen", "Stretcher"],
      baseFare: 800,
      perKmRate: 50,
      stationName: "Uttara Station",
      currentLat: 23.8759,
      currentLng: 90.3795,
    },
  });

  await prisma.auditLog.create({
    data: { actorId: admin.id, actorRole: "ADMIN", action: "SEED_EXECUTED", entity: "System" },
  });

  const counts = {
    users: await prisma.user.count(),
    hospitals: await prisma.hospital.count(),
    ambulances: await prisma.ambulance.count(),
  };
  console.log("✅ Seed complete:", counts, `| patient: ${patient.email}`);
  console.log(`   Admin login → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
