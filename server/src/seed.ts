// One-time seed: creates the default admin account, matching the old
// localStorage app's seedDefaultAdmin (username "admin", password "123").
// Change this password immediately in any real deployment.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

async function main() {
  const existing = await prisma.account.findFirst({
    where: { username: { equals: "admin", mode: "insensitive" } },
  });
  if (existing) {
    console.log("Admin account already exists, skipping seed.");
    return;
  }
  const passwordHash = await bcrypt.hash("123", 10);
  await prisma.account.create({
    data: { username: "admin", passwordHash, role: "ADMIN", initials: "AD" },
  });
  console.log('Seeded admin account (username "admin", password "123").');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
