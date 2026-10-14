import { describe, it, expect, beforeEach } from "vitest";
import { createGas } from "./gas-mock.js";

// End-to-end through doPost(), with Google services simulated in memory. Fictional data only.
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
function newCase(token, name = "תיק בדיקה") {
  const r = gas.post({ action: "mutate", token, op: "createCase", input: { case: { name }, firstTask: { title: "שיחה", due: todayIL() } } });
  expect(r.ok).toBe(true);
  return r;
}

describe("setup and sign-in", () => {
  it("setup creates the tables, the Drive folders and a one-time code", () => {
    expect(code).toMatch(/^[0-9A-F]{8}$/);
    for (const t of ["users", "cases", "tasks", "logs", "documents", "audit"]) expect(gas.sheets[t]).toBeTruthy();
    const names = Object.values(gas.drive.folders).map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["משכנותיך - מערכת ניהול (פרטי)", "גיבויים", "תיקים - מסמכים"]));
    expect(gas.post({ action: "status" })).toMatchObject({ ok: true, installed: true, hasUsers: false });
  });
  it("first admin with the code (once); then e-mail + password", () => {
    expect(gas.post({ action: "setupAdmin", code: "XXXX", ...ADMIN }).ok).toBe(false);
    signIn();
    expect(gas.post({ action: "setupAdmin", code, ...ADMIN }).ok).toBe(false);
    expect(gas.post({ action: "login", email: "admin@example.com", password: "nope" }).error).toBe("bad_login");
    const r = gas.post({ action: "login", email: " ADMIN@example.com ", password: ADMIN.password });
    expect(r.ok).toBe(true);
    const boot = gas.post({ action: "bootstrap", token: r.token });
    expect(boot.ok).toBe(true);
    expect(JSON.stringify(boot)).not.toMatch(/_passHash|_salt|_passVer/);
    expect(boot.meta).toMatchObject({ today: todayIL(), maxUploadMb: 25 });
    expect(boot.meta.driveUrl).toMatch(/^https:\/\/drive\.google\.com\//);
  });
  it("locks after repeated failures; rejects forged tokens; password change revokes old tokens", () => {
    const token = signIn();
    expect(gas.post({ action: "bootstrap", token: token.replace(/.$/, (c) => (c === "A" ? "B" : "A")) }).error).toBe("auth");
    const r = gas.post({ action: "changePassword", token, current: ADMIN.password, password: "NewSecret999" });
    expect(r.ok).toBe(true);
    expect(gas.post({ action: "bootstrap", token }).error).toBe("auth");
    for (let i = 0; i < 5; i++) gas.post({ action: "login", email: ADMIN.email, password: "wrong" });
    expect(gas.post({ action: "login", email: ADMIN.email, password: "NewSecret999" }).error).toBe("locked");
  });
});

describe("data through mutate", () => {
  it("case → task done with next step → update → close; all persisted as text in the sheet", () => {
    const token = signIn();
    const c = newCase(token);
    const done = gas.post({ action: "mutate", token, op: "completeTask", input: { id: c.taskId, result: "notdone", note: "לא ענה", next: { title: "לנסות שוב", due: todayIL(), owner: "ברוך (דוגמה)" } } });
    expect(done.ok).toBe(true);
    expect(gas.post({ action: "mutate", token, op: "addLog", input: { caseId: c.id, text: "עדכון" } }).ok).toBe(true);
    expect(gas.post({ action: "mutate", token, op: "setCaseStatus", input: { id: c.id, status: "closed", reason: "הסתיים" } }).ok).toBe(true);
    gas.ctx._tableCache = {};
    const db = gas.ctx.loadDb();
    expect(db.cases[0]).toMatchObject({ name: "תיק בדיקה", status: "closed", closeReason: "הסתיים" });
    expect(db.tasks).toHaveLength(2);
    expect(db.tasks.every((t) => t.done === "true")).toBe(true);
    expect(db.tasks[0]).toMatchObject({ result: "notdone", note: "לא ענה" });
    expect(db.tasks[1]).toMatchObject({ owner: "ברוך (דוגמה)", steps: "2", prevId: db.tasks[0].id });
    expect(db.logs.length).toBe(2);
    const audit = JSON.stringify(gas.sheets.audit._cells());
    expect(audit).toMatch(/completeTask/);
    expect(audit).not.toMatch(/תיק בדיקה|לא ענה|הסתיים/);
  });
  it("deleting a task removes it from the sheet", () => {
    const token = signIn();
    const r = gas.post({ action: "mutate", token, op: "addTask", input: { kind: "mine", title: "x", due: todayIL() } });
    expect(gas.post({ action: "mutate", token, op: "deleteTask", input: { id: r.id } }).ok).toBe(true);
    gas.ctx._tableCache = {};
    expect(gas.ctx.loadDb().tasks).toHaveLength(0);
  });
  it("refuses unknown operations and writes to the users table", () => {
    const token = signIn();
    expect(gas.post({ action: "mutate", token, op: "nope" }).error).toBe("unknown_action");
    expect(gas.post({ action: "mutate", token, op: "addDocument", input: {} }).error).toBe("unknown_action");
    expect(() => gas.ctx.persist({ users: [{ id: "x", role: "ADMIN" }] })).toThrow();
  });
});

describe("documents in Google Drive", () => {
  const PDF = Buffer.from("%PDF-1.4 example").toString("base64");
  it("uploads into the case's own folder and records the link", () => {
    const token = signIn();
    const c = newCase(token, "כהן (דוגמה)");
    const r = gas.post({ action: "uploadDocument", token, caseId: c.id, name: "טופס.pdf", mime: "application/pdf", data: PDF, note: "טופס חתום" });
    expect(r.ok).toBe(true);
    const doc = r.changes.documents[0];
    expect(doc).toMatchObject({ caseId: c.id, name: "טופס.pdf", mime: "application/pdf", size: 16 });
    expect(doc.url).toMatch(/^https:\/\/drive\.google\.com\/file\/d\//);
    const file = gas.drive.files[doc.fileId];
    const folder = gas.drive.folders[file.parent];
    expect(folder.name).toBe("כהן (דוגמה)");
    expect(gas.drive.folders[folder.parent].name).toBe("תיקים - מסמכים");
    // a second upload reuses the same folder
    const r2 = gas.post({ action: "uploadDocument", token, caseId: c.id, name: "b.txt", mime: "text/plain", data: Buffer.from("x").toString("base64") });
    expect(gas.drive.files[r2.changes.documents[0].fileId].parent).toBe(folder.id);
    // folder link
    const f = gas.post({ action: "caseFolder", token, caseId: c.id });
    expect(f.url).toBe(folder.getUrl());
  });
  it("removing a document deletes the row and moves the file to the Drive trash", () => {
    const token = signIn();
    const c = newCase(token);
    const r = gas.post({ action: "uploadDocument", token, caseId: c.id, name: "a.pdf", mime: "application/pdf", data: PDF });
    const doc = r.changes.documents[0];
    expect(gas.post({ action: "mutate", token, op: "removeDocument", input: { id: doc.id } }).ok).toBe(true);
    expect(gas.drive.files[doc.fileId].trashed).toBe(true);
    gas.ctx._tableCache = {};
    expect(gas.ctx.loadDb().documents).toHaveLength(0);
  });
  it("rejects empty, broken or unknown-case uploads, and needs a token", () => {
    const token = signIn();
    const c = newCase(token);
    expect(gas.post({ action: "uploadDocument", token, caseId: c.id, name: "a", data: "" }).ok).toBe(false);
    expect(gas.post({ action: "uploadDocument", token, caseId: c.id, name: "a", data: "@@@" }).ok).toBe(false);
    expect(gas.post({ action: "uploadDocument", token, caseId: "nope", name: "a", data: PDF }).error).toBe("not_found");
    expect(gas.post({ action: "uploadDocument", caseId: c.id, name: "a", data: PDF }).error).toBe("auth");
    expect(Object.keys(gas.drive.files)).toHaveLength(0);
  });
});

describe("nightly job", () => {
  it("e-mails (without case details) when an open case has no next step", () => {
    const token = signIn();
    const c = newCase(token);
    gas.ctx.dailyJob();
    expect(gas.mails).toHaveLength(0);
    gas.post({ action: "mutate", token, op: "completeTask", input: { id: c.taskId } });
    gas.ctx.dailyJob();
    expect(gas.mails).toHaveLength(1);
    expect(JSON.stringify(gas.mails)).not.toMatch(/תיק בדיקה|שיחה/);
  });
});
