// One-time seed: creates the first admin account.
//
//   ADMIN_PASSWORD=... npm run seed   uses that password as-is
//   npm run seed                      generates a random one, prints it once,
//                                     and forces a change on first sign-in
//
// The old fixed "admin" / "123" default is gone (review finding H-07 / R5-04).
import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { passwordProblem } from "./lib/password.js";
import { prisma } from "./prisma.js";

function randomPassword(): string {
  // 16 chars from an unambiguous alphabet - easy to read off a terminal once.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function main() {
  const existing = await prisma.account.findFirst({
    where: { username: { equals: "admin", mode: "insensitive" } },
  });
  if (existing) {
    console.log("Admin account already exists, skipping seed.");
    return;
  }
  const chosen = process.env.ADMIN_PASSWORD;
  if (chosen) {
    const problem = passwordProblem(chosen, "admin");
    if (problem) throw new Error(`ADMIN_PASSWORD rejected: ${problem}`);
  }
  const password = chosen ?? randomPassword();
  await prisma.account.create({
    data: {
      username: "admin",
      passwordHash: await bcrypt.hash(password, 10),
      role: "ADMIN",
      initials: "AD",
      // A password the operator typed is theirs to keep; a generated one is
      // a bootstrap credential and must be replaced at first sign-in.
      mustChangePassword: !chosen,
    },
  });
  if (chosen) {
    console.log('Seeded admin account (username "admin") with the password from ADMIN_PASSWORD.');
  } else {
    console.log(`Seeded admin account (username "admin").\n\n  Temporary password: ${password}\n\nIt is not stored anywhere else. Sign in and you will be asked to choose a new one.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
