import { describe, it, expect, beforeEach } from "vitest";
import { createGas } from "./gas-mock.js";

// End-to-end through doPost(), with Google services simulated in memory.
let gas, code;
const ADMIN = { email: "Admin@Example.com", password: "Secret12345", name: "מנהל בדיקה" };
const todayIL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

beforeEach(() => {
  gas = createGas();
  gas.ctx.setup();
  code = gas.props.SETUP_CODE;
});

function signIn() {
  const r = gas.post({ action: "setupAdmin", code, ...ADMIN });
  expect(r.ok).toBe(true);
  return r.token;
}

describe("Apps Script backend", () => {
  it("setup creates tables, default tags and a one-time code", () => {
    expect(code).toMatch(/^[0-9A-F]{8}$/);
    for (const t of ["users", "cases", "tags", "contacts", "tasks", "audit"]) expect(gas.sheets[t]).toBeTruthy();
    expect(gas.ctx.readTable("tags")).toHaveLength(8);
    expect(gas.post({ action: "status" })).toMatchObject({ ok: true, installed: true, hasUsers: false });
  });

  it("first admin: wrong code is refused, the right one works once", () => {
    expect(gas.post({ action: "setupAdmin", code: "XXXX", ...ADMIN }).ok).toBe(false);
    expect(gas.post({ action: "setupAdmin", code, ...ADMIN, password: "short" }).error).toBe("weak");
    signIn();
    expect(gas.post({ action: "setupAdmin", code, ...ADMIN }).ok).toBe(false); // code consumed
    expect(gas.post({ action: "status" }).hasUsers).toBe(true);
  });

  it("login by e-mail + password; secrets never reach the browser", () => {
    signIn();
    expect(gas.post({ action: "login", email: "admin@example.com", password: "nope" }).error).toBe("bad_login");
    const r = gas.post({ action: "login", email: " ADMIN@example.com ", password: ADMIN.password });
    expect(r.ok).toBe(true);
    expect(r.user).toEqual({ id: expect.any(String), name: ADMIN.name, email: "admin@example.com", role: "ADMIN", isActive: "true" });
    const boot = gas.post({ action: "bootstrap", token: r.token });
    expect(boot.ok).toBe(true);
    expect(JSON.stringify(boot)).not.toMatch(/_passHash|_salt|_passVer/);
    expect(boot.meta.today).toBe(todayIL());
  });

  it("locks an e-mail after repeated failures", () => {
    signIn();
    for (let i = 0; i < 5; i++) gas.post({ action: "login", email: ADMIN.email, password: "wrong" });
    expect(gas.post({ action: "login", email: ADMIN.email, password: ADMIN.password }).error).toBe("locked");
  });

  it("rejects missing, forged and expired tokens", () => {
    const token = signIn();
    expect(gas.post({ action: "bootstrap" }).error).toBe("auth");
    expect(gas.post({ action: "bootstrap", token: token.replace(/.$/, (c) => (c === "A" ? "B" : "A")) }).error).toBe("auth");
    gas.props.TOKEN_SECRET = "rotated";
    expect(gas.post({ action: "bootstrap", token }).error).toBe("auth");
  });

  it("changing the password revokes old tokens", () => {
    const token = signIn();
    expect(gas.post({ action: "changePassword", token, current: "bad", password: "NewSecret999" }).ok).toBe(false);
    const r = gas.post({ action: "changePassword", token, current: ADMIN.password, password: "NewSecret999" });
    expect(r.ok).toBe(true);
    expect(gas.post({ action: "bootstrap", token }).error).toBe("auth");
    expect(gas.post({ action: "bootstrap", token: r.token }).ok).toBe(true);
  });

  it("full chain through mutate: create → complete with next → close, persisted to the sheet", () => {
    const token = signIn();
    const today = todayIL();
    const c = gas.post({ action: "mutate", token, op: "createCase", input: { case: { fullName: "תיק בדיקה", tagIds: ["tg1"] }, firstTask: { title: "שיחה", dueDate: today } } });
    expect(c.ok).toBe(true);
    const bad = gas.post({ action: "mutate", token, op: "completeTask", input: { taskId: c.taskId, notes: "" , next: { title: "x", dueDate: today } } });
    expect(bad.ok).toBe(false);
    const n = gas.post({ action: "mutate", token, op: "completeTask", input: { taskId: c.taskId, notes: "בוצע", next: { title: "המשך", dueDate: today } } });
    expect(n.ok).toBe(true);
    const x = gas.post({ action: "mutate", token, op: "completeTask", input: { taskId: n.nextTaskId, notes: "סוף", closeCase: { reason: "הסתיים" } } });
    expect(x.ok).toBe(true);

    // Re-read from the "sheet" (strings, as Google returns them) and check the rules.
    gas.ctx._tableCache = {};
    const db = gas.ctx.loadDb();
    expect(db.cases[0]).toMatchObject({ fullName: "תיק בדיקה", status: "CLOSED", closeReason: "הסתיים", tagIds: "tg1" });
    expect(db.tasks).toHaveLength(2);
    expect(db.tasks.every((t) => t.isDone === "true")).toBe(true);
    expect(db.tasks[1].previousTaskId).toBe(db.tasks[0].id);
    expect(gas.ctx.MK.checkInvariant(db)).toEqual([]);
    expect(gas.sheets.tasks._format()).toBe("@");

    // The audit log records ids and action names - never case content.
    const audit = JSON.stringify(gas.sheets.audit._cells());
    expect(audit).toMatch(/completeTask/);
    expect(audit).not.toMatch(/תיק בדיקה|בוצע|הסתיים/);
  });

  it("unknown operations and users-table writes are refused", () => {
    const token = signIn();
    expect(gas.post({ action: "mutate", token, op: "nope", input: {} }).error).toBe("unknown_action");
    expect(gas.post({ action: "dropAll", token }).error).toBe("unknown_action");
    expect(() => gas.ctx.persist({ users: [{ id: "x", role: "ADMIN" }] })).toThrow();
  });

  it("resetAdminPassword: a new code lets the admin choose a new password", () => {
    signIn();
    gas.ctx.resetAdminPassword();
    const newCode = gas.props.SETUP_CODE;
    expect(gas.post({ action: "setupAdmin", code: newCode, email: "other@example.com", password: "Another12345" }).ok).toBe(false);
    const r = gas.post({ action: "setupAdmin", code: newCode, email: ADMIN.email, password: "Another12345" });
    expect(r.ok).toBe(true);
    expect(gas.post({ action: "login", email: ADMIN.email, password: "Another12345" }).ok).toBe(true);
    expect(gas.ctx.readTable("users")).toHaveLength(1);
  });

  it("the nightly job e-mails (without case details) when the chain rule is broken", () => {
    const token = signIn();
    gas.post({ action: "mutate", token, op: "createCase", input: { case: { fullName: "תיק בדיקה" }, firstTask: { title: "שיחה", dueDate: todayIL() } } });
    gas.ctx.dailyJob();
    expect(gas.mails).toHaveLength(0);
    gas.ctx._tableCache = {};
    const tasks = gas.ctx.readTable("tasks").map((t) => ({ ...t, isDone: "true" }));
    gas.ctx.writeTable("tasks", tasks);
    gas.ctx.dailyJob();
    expect(gas.mails).toHaveLength(1);
    expect(JSON.stringify(gas.mails)).not.toMatch(/תיק בדיקה|שיחה/);
  });
});
