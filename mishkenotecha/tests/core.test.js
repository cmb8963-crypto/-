import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const MK = require("../js/core.js");

// Fictional data only.
const TODAY = "2026-10-12";
const NOW = "2026-10-12T08:00:00.000Z";
let n = 0;
const ctx = () => ({ now: NOW, today: TODAY, userId: "u1", uid: (p) => `${p}_${++n}` });
const run = (db, action, req) => {
  const res = MK.run(action, db, req, ctx());
  if (res.ok) MK.applyChanges(db, res.changes);
  return res;
};
const emptyDb = () => ({
  users: [], contacts: [{ id: "ct1", fullName: "איש קשר לדוגמה" }],
  tags: [{ id: "tg1", name: "תגית א", sortOrder: 0, isActive: true }, { id: "tg2", name: "תגית ב", sortOrder: 1, isActive: true }],
  cases: [], tasks: []
});
const newCase = (db, extra = {}) =>
  run(db, "createCase", {
    case: { fullName: "תיק לדוגמה", ...extra },
    firstTask: { title: "שיחת היכרות", dueDate: TODAY }
  });

let db;
beforeEach(() => { db = emptyDb(); n = 0; });

describe("dates (Asia/Jerusalem)", () => {
  it("today is the Israeli calendar day, not UTC", () => {
    // 22:30 UTC on Oct 11 is already 01:30 on Oct 12 in Jerusalem (UTC+3).
    expect(MK.todayYmd("2026-10-11T22:30:00Z")).toBe("2026-10-12");
    // 20:00 UTC is still the same day in Jerusalem.
    expect(MK.todayYmd("2026-10-11T20:00:00Z")).toBe("2026-10-11");
    // Winter time (UTC+2).
    expect(MK.todayYmd("2026-12-31T22:30:00Z")).toBe("2027-01-01");
  });
  it("formats dd/MM/yyyy and adds days across months", () => {
    expect(MK.fmtDate("2026-03-05")).toBe("05/03/2026");
    expect(MK.fmtDate("bad")).toBe("");
    expect(MK.addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(MK.addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(MK.diffDays("2026-10-12", "2026-10-19")).toBe(7);
  });
  it("validates real dates only", () => {
    expect(MK.isYmd("2026-02-30")).toBe(false);
    expect(MK.isYmd("2026-02-28")).toBe(true);
  });
  it("quick picks: tomorrow / 3 days / next week", () => {
    expect(MK.quickDates(TODAY).map((q) => q.date)).toEqual(["2026-10-13", "2026-10-15", "2026-10-19"]);
  });
});

describe("createCase", () => {
  it("creates a case with exactly one open task", () => {
    const res = newCase(db, { tagIds: ["tg1", "missing", "tg1"] });
    expect(res.ok).toBe(true);
    expect(db.cases).toHaveLength(1);
    const c = db.cases[0];
    expect(c.status).toBe("ACTIVE");
    expect(c.firstContactDate).toBe(TODAY);
    expect(c.tagIds).toBe("tg1");
    expect(MK.openTasksOfCase(db, c.id)).toHaveLength(1);
    expect(MK.checkInvariant(db)).toEqual([]);
  });
  it("requires name, first task and a due date that is not in the past", () => {
    expect(MK.run("createCase", db, { case: {}, firstTask: { title: "x", dueDate: TODAY } }, ctx()).fields.fullName).toBeTruthy();
    expect(MK.run("createCase", db, { case: { fullName: "א" }, firstTask: { dueDate: TODAY } }, ctx()).fields.taskTitle).toBeTruthy();
    expect(MK.run("createCase", db, { case: { fullName: "א" }, firstTask: { title: "x" } }, ctx()).fields.taskDue).toBeTruthy();
    expect(MK.run("createCase", db, { case: { fullName: "א" }, firstTask: { title: "x", dueDate: "2026-10-11" } }, ctx()).fields.taskDue).toBeTruthy();
    expect(MK.run("createCase", db, { case: { fullName: "א", status: "CLOSED" }, firstTask: { title: "x", dueDate: TODAY } }, ctx()).ok).toBe(false);
    expect(db.cases).toHaveLength(0);
  });
  it("does not mutate the db it receives", () => {
    const before = JSON.stringify(db);
    MK.run("createCase", db, { case: { fullName: "א" }, firstTask: { title: "x", dueDate: TODAY } }, ctx());
    expect(JSON.stringify(db)).toBe(before);
  });
});

describe("completeTask - chaining", () => {
  it("closing a task with a next task keeps one open task and links the chain", () => {
    const { caseId, taskId } = newCase(db);
    const res = run(db, "completeTask", { taskId, notes: "דובר, סוכם להמשיך", contactId: "ct1", next: { title: "לחזור אליו", dueDate: "2026-10-13" } });
    expect(res.ok).toBe(true);
    const done = MK.byId(db.tasks, taskId);
    expect(done.isDone).toBe(true);
    expect(done.completionNotes).toBe("דובר, סוכם להמשיך");
    expect(done.contactId).toBe("ct1");
    const open = MK.openTasksOfCase(db, caseId);
    expect(open).toHaveLength(1);
    expect(open[0].previousTaskId).toBe(taskId);
    expect(open[0].title).toBe("לחזור אליו");
    expect(MK.checkInvariant(db)).toEqual([]);
  });

  it("closing the case leaves no open task and records the reason", () => {
    const { caseId, taskId } = newCase(db);
    const res = run(db, "completeTask", { taskId, notes: "הטיפול הסתיים", closeCase: { reason: "הסתדר" } });
    expect(res.ok).toBe(true);
    const c = MK.byId(db.cases, caseId);
    expect(c.status).toBe("CLOSED");
    expect(c.closeReason).toBe("הסתדר");
    expect(c.closedAt).toBe(NOW);
    expect(MK.openTasksOfCase(db, caseId)).toHaveLength(0);
    expect(MK.checkInvariant(db)).toEqual([]);
  });

  it("refuses to mark done without a report or without choosing what's next - nothing is saved", () => {
    const { taskId } = newCase(db);
    const snapshot = JSON.stringify(db);
    const cases = [
      { taskId, next: { title: "x", dueDate: TODAY } },                                   // no report
      { taskId, notes: "   ", next: { title: "x", dueDate: TODAY } },                     // blank report
      { taskId, notes: "דיווח" },                                                        // nothing next
      { taskId, notes: "דיווח", next: { title: "x", dueDate: TODAY }, closeCase: { reason: "r" } }, // both
      { taskId, notes: "דיווח", next: { title: "", dueDate: TODAY } },                  // no next title
      { taskId, notes: "דיווח", next: { title: "x" } },                                  // no next date
      { taskId, notes: "דיווח", next: { title: "x", dueDate: "2026-10-01" } },          // past date
      { taskId, notes: "דיווח", closeCase: { reason: "" } },                            // no reason
      { taskId, notes: "דיווח", contactId: "nope", next: { title: "x", dueDate: TODAY } } // bad contact
    ];
    for (const req of cases) {
      const res = MK.run("completeTask", db, req, ctx());
      expect(res.ok, JSON.stringify(req)).toBe(false);
    }
    expect(JSON.stringify(db)).toBe(snapshot);
  });

  it("cannot complete the same task twice", () => {
    const { taskId } = newCase(db);
    run(db, "completeTask", { taskId, notes: "א", next: { title: "ב", dueDate: TODAY } });
    const res = MK.run("completeTask", db, { taskId, notes: "א", next: { title: "ג", dueDate: TODAY } }, ctx());
    expect(res.error).toBe("already_done");
    expect(MK.checkInvariant(db)).toEqual([]);
  });

  it("builds a continuous history across many steps", () => {
    const { caseId, taskId } = newCase(db);
    let current = taskId;
    for (let i = 0; i < 4; i++) {
      const r = run(db, "completeTask", { taskId: current, notes: `שלב ${i}`, next: { title: `משימה ${i}`, dueDate: TODAY } });
      current = r.nextTaskId;
      expect(MK.checkInvariant(db)).toEqual([]);
    }
    const chain = MK.chainOf(db, caseId);
    expect(chain).toHaveLength(5);
    for (let i = 1; i < chain.length; i++) expect(chain[i].previousTaskId).toBe(chain[i - 1].id);
    const tl = MK.timeline(db, caseId);
    expect(tl.map((t) => t.completionNotes)).toEqual(["שלב 3", "שלב 2", "שלב 1", "שלב 0"]);
  });

  it("refuses to work on a task whose case is already closed", () => {
    const { caseId, taskId } = newCase(db);
    // Corrupt data on purpose: closed case that still has an open task.
    MK.byId(db.cases, caseId).status = "CLOSED";
    const res = MK.run("completeTask", db, { taskId, notes: "x", next: { title: "y", dueDate: TODAY } }, ctx());
    expect(res.error).toBe("case_closed");
  });

  it("the final gate blocks a change that would leave two open tasks", () => {
    const { caseId, taskId } = newCase(db);
    // Simulate stale data: a second open task already exists for this case.
    db.tasks.push({ id: "extra", caseId, title: "כפילות", dueDate: TODAY, isDone: false, previousTaskId: "" });
    const res = MK.run("completeTask", db, { taskId, notes: "x", next: { title: "y", dueDate: TODAY } }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toBe("invariant");
  });

  it("general tasks complete without chaining and without a mandatory report", () => {
    const { taskId } = run(db, "createGeneralTask", { title: "הזמנת אולם לקורס", dueDate: TODAY, department: "GROOM_INSTRUCTORS", project: "קורס מדריכים" });
    expect(MK.byId(db.tasks, taskId).caseId).toBe("");
    expect(MK.run("completeTask", db, { taskId, next: { title: "x", dueDate: TODAY } }, ctx()).ok).toBe(false);
    const res = run(db, "completeTask", { taskId });
    expect(res.ok).toBe(true);
    expect(MK.byId(db.tasks, taskId).isDone).toBe(true);
  });
});

describe("postponeTask", () => {
  it("moves the date, counts each postpone and keeps the original date", () => {
    const { taskId } = newCase(db);
    run(db, "postponeTask", { taskId, dueDate: "2026-10-14" });
    run(db, "postponeTask", { taskId, dueDate: "2026-10-20" });
    const t = MK.byId(db.tasks, taskId);
    expect(t.dueDate).toBe("2026-10-20");
    expect(t.originalDueDate).toBe(TODAY);
    expect(t.postponeCount).toBe(2);
    expect(t.isDone).toBe(false);
    expect(MK.checkInvariant(db)).toEqual([]);
  });
  it("rejects past, invalid or unchanged dates", () => {
    const { taskId } = newCase(db);
    expect(MK.run("postponeTask", db, { taskId, dueDate: "2026-10-01" }, ctx()).ok).toBe(false);
    expect(MK.run("postponeTask", db, { taskId, dueDate: "2026-13-01" }, ctx()).ok).toBe(false);
    expect(MK.run("postponeTask", db, { taskId, dueDate: TODAY }, ctx()).error).toBe("same_date");
  });
});

describe("case status and reopening", () => {
  it("can switch between active and waiting, but not close directly", () => {
    const { caseId } = newCase(db);
    expect(run(db, "updateCase", { id: caseId, case: { status: "WAITING" } }).ok).toBe(true);
    expect(MK.byId(db.cases, caseId).status).toBe("WAITING");
    expect(MK.run("updateCase", db, { id: caseId, case: { status: "CLOSED" } }, ctx()).ok).toBe(false);
    expect(MK.checkInvariant(db)).toEqual([]);
  });
  it("updateCase keeps fields that were not sent", () => {
    const { caseId } = newCase(db, { city: "עיר לדוגמה", tagIds: "tg2" });
    run(db, "updateCase", { id: caseId, case: { isUrgent: true } });
    const c = MK.byId(db.cases, caseId);
    expect(c.city).toBe("עיר לדוגמה");
    expect(c.tagIds).toBe("tg2");
    expect(c.isUrgent).toBe(true);
  });
  it("reopening a closed case requires a new task and continues the chain", () => {
    const { caseId, taskId } = newCase(db);
    run(db, "completeTask", { taskId, notes: "x", closeCase: { reason: "r" } });
    expect(MK.run("reopenCase", db, { caseId, title: "" , dueDate: TODAY }, ctx()).ok).toBe(false);
    expect(MK.run("updateCase", db, { id: caseId, case: { status: "ACTIVE" } }, ctx()).ok).toBe(false);
    const res = run(db, "reopenCase", { caseId, title: "חזר לטיפול", dueDate: TODAY });
    expect(res.ok).toBe(true);
    const c = MK.byId(db.cases, caseId);
    expect(c.status).toBe("ACTIVE");
    expect(c.closeReason).toBe("");
    expect(MK.openTaskOfCase(db, caseId).previousTaskId).toBe(taskId);
    expect(MK.checkInvariant(db)).toEqual([]);
  });
});

describe("diary (home screen)", () => {
  it("groups overdue / today / next 7 days, urgent first, ignores closed and done", () => {
    db.cases.push(
      { id: "c1", fullName: "א", status: "ACTIVE", isUrgent: false, tagIds: "tg1" },
      { id: "c2", fullName: "ב", status: "ACTIVE", isUrgent: true, tagIds: "" },
      { id: "c3", fullName: "ג", status: "CLOSED", isUrgent: true, tagIds: "" }
    );
    db.tasks.push(
      { id: "t1", caseId: "c1", title: "באיחור", dueDate: "2026-10-10", isDone: false },
      { id: "t2", caseId: "c2", title: "היום דחוף", dueDate: TODAY, isDone: false },
      { id: "t3", caseId: "", title: "היום כללי", dueDate: TODAY, isDone: false, department: "FINANCE" },
      { id: "t4", caseId: "c1", title: "בעוד שבוע", dueDate: "2026-10-19", isDone: "false" },
      { id: "t5", caseId: "", title: "רחוק", dueDate: "2026-10-20", isDone: false },
      { id: "t6", caseId: "c3", title: "של תיק סגור", dueDate: TODAY, isDone: false },
      { id: "t7", caseId: "c2", title: "בוצעה", dueDate: TODAY, isDone: "true" }
    );
    const d = MK.diary(db, TODAY);
    expect(d.overdue.map((t) => t.id)).toEqual(["t1"]);
    expect(d.today.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(d.upcoming.map((t) => t.id)).toEqual(["t4"]);

    expect(MK.diary(db, TODAY, { tagId: "tg1" }).today).toHaveLength(0);
    expect(MK.diary(db, TODAY, { department: "FINANCE" }).today.map((t) => t.id)).toEqual(["t3"]);
    const ranged = MK.diary(db, TODAY, { from: "2026-10-19", to: "2026-10-25" });
    expect(ranged.upcoming.map((t) => t.id)).toEqual(["t4", "t5"]);
    expect(ranged.overdue).toHaveLength(0);
  });
});

describe("cases list", () => {
  it("searches by name or city, filters by status/tag and shows the next task", () => {
    newCase(db, { fullName: "כהן לדוגמה", city: "עיר א", tagIds: "tg1" });
    newCase(db, { fullName: "לוי לדוגמה", city: "עיר ב" });
    expect(MK.casesList(db, { q: "כהן" })).toHaveLength(1);
    expect(MK.casesList(db, { q: "עיר ב" })[0].case.fullName).toBe("לוי לדוגמה");
    expect(MK.casesList(db, { tagId: "tg1" })).toHaveLength(1);
    expect(MK.casesList(db, { status: "CLOSED" })).toHaveLength(0);
    expect(MK.casesList(db, {})[0].next.title).toBe("שיחת היכרות");
  });
});

describe("tags and contacts", () => {
  it("tag names are unique; tags are deactivated, not deleted", () => {
    expect(MK.run("saveTag", db, { name: "תגית א" }, ctx()).error).toBe("duplicate");
    const r = run(db, "saveTag", { name: "תגית חדשה" });
    expect(r.ok).toBe(true);
    run(db, "saveTag", { id: r.tagId, name: "תגית חדשה", isActive: false });
    expect(MK.activeTags(db).map((t) => t.name)).not.toContain("תגית חדשה");
    expect(db.tags).toHaveLength(3);
  });
  it("contacts require a name", () => {
    expect(MK.run("saveContact", db, { fullName: "" }, ctx()).ok).toBe(false);
    expect(run(db, "saveContact", { fullName: "יועץ לדוגמה", profession: "יועץ" }).ok).toBe(true);
  });
});

describe("misc", () => {
  it("unknown actions are refused", () => {
    expect(MK.run("dropEverything", db, {}, ctx()).error).toBe("unknown_action");
  });
  it("password rules", () => {
    expect(MK.passwordProblem("short1")).toBeTruthy();
    expect(MK.passwordProblem("onlyletters")).toBeTruthy();
    expect(MK.passwordProblem("letters1234")).toBe("");
  });
});
