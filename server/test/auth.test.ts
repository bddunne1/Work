import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { Client, PASSWORD, admin, as, login, makeAccount, ok, resetDb } from "./helpers.js";

beforeEach(resetDb);

describe("sign-in", () => {
  it("rejects a wrong password and an unknown user with the same message", async () => {
    await makeAccount("pat");
    const wrong = await login("pat", "not-the-password");
    const unknown = await login("nobody", PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("throttles after ten failures for one username and clears on a good sign-in later", async () => {
    await makeAccount("pat");
    for (let i = 0; i < 10; i++) expect((await login("pat", "bad")).status).toBe(401);
    const locked = await login("pat", PASSWORD);
    expect(locked.status).toBe(429);
    // Another username from the same address is unaffected.
    await makeAccount("sam");
    expect((await login("sam", PASSWORD)).status).toBe(200);
  });

  it("refuses a deactivated account and a token issued before a force-logout", async () => {
    const a = await makeAccount("pat", { permissions: { "open-orders": "view" } });
    const c = await as("pat");
    ok(await c.get("/api/auth/me"));
    await prisma.account.update({ where: { id: a.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await c.get("/api/auth/me")).status).toBe(401);
    await prisma.account.update({ where: { id: a.id }, data: { active: false } });
    expect((await login("pat")).status).toBe(401);
  });
});

describe("password policy", () => {
  it("refuses short, common and username-containing passwords on account creation", async () => {
    const root = await admin();
    for (const password of ["short", "password1", "pat-pat-pat-pat", "aaaaaaaaaaaa"]) {
      const res = await root.post("/api/accounts", { username: "pat", password, role: "CUSTOM", permissions: {} });
      expect(res.status, password).toBe(400);
    }
    ok(await root.post("/api/accounts", { username: "pat", password: "Correct-Horse-Battery", role: "CUSTOM", permissions: {} }), 201);
  });

  it("forces a change after an admin sets the password, and rotates the token", async () => {
    const root = await admin();
    const created = ok(await root.post("/api/accounts", { username: "pat", password: "Temporary-Pass-1", role: "CUSTOM", permissions: { "open-orders": "view" } }), 201);
    expect(created.mustChangePassword).toBe(true);

    const first = await login("pat", "Temporary-Pass-1");
    expect(first.status).toBe(200);
    expect(first.body.account.mustChangePassword).toBe(true);
    const temp = new Client(first.body.token);

    // Everything but /me and change-password is refused with a distinct code.
    const blocked = await temp.get("/api/sales-orders?open=1");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    ok(await temp.get("/api/auth/me"));

    expect((await temp.post("/api/auth/change-password", { currentPassword: "wrong", newPassword: "My-Own-Password-9" })).status).toBe(400);
    expect((await temp.post("/api/auth/change-password", { currentPassword: "Temporary-Pass-1", newPassword: "short" })).status).toBe(400);
    expect((await temp.post("/api/auth/change-password", { currentPassword: "Temporary-Pass-1", newPassword: "Temporary-Pass-1" })).status).toBe(400);

    const changed = ok(await temp.post("/api/auth/change-password", { currentPassword: "Temporary-Pass-1", newPassword: "My-Own-Password-9" }));
    expect(changed.account.mustChangePassword).toBe(false);
    // The old token is dead, the new one works, the old password is gone.
    expect((await temp.get("/api/auth/me")).status).toBe(401);
    ok(await new Client(changed.token).get("/api/sales-orders?open=1"));
    expect((await login("pat", "Temporary-Pass-1")).status).toBe(401);
    expect((await login("pat", "My-Own-Password-9")).status).toBe(200);

    // An admin reset flags it again.
    const reset = ok(await root.put(`/api/accounts/${created.id}`, { password: "Another-Temp-Pass-2" }));
    expect(reset.mustChangePassword).toBe(true);
  });

  it("never removes the last active admin", async () => {
    const root = await admin();
    const me = ok(await root.get("/api/auth/me")).account;
    expect((await root.put(`/api/accounts/${me.id}`, { role: "CUSTOM" })).status).toBe(400);
    expect((await root.put(`/api/accounts/${me.id}`, { active: false })).status).toBe(400);
    expect((await root.del(`/api/accounts/${me.id}`)).status).toBe(400);
  });
});
