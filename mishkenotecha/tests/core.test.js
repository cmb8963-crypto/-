import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const MK = require("../js/core.js");

// Fictional data only.
const TODAY = "2026-10-12";
const NOW = "2026-10-12T08:00:00.000Z";
let n = 0;
const ctx = () => ({ now: NOW, today: TODAY, userId: "u1", uid: (p) => `${p}_${++n}` });
let db;
const run = (op, input) => {
  const res = MK.run(op, db, input, ctx());
  if (res.ok) MK.apply(db, res);
  return res;
};
const tasks = () => db.tasks;
const newCase = (extra = {}, first = {}) =>
  run("createCase", { case: { name: "תיק לדוגמה", ...extra }, firstTask: { title: "שיחת היכרות", due: TODAY, ...first } });

beforeEach(() => { n = 0; db = { users: [], cases: [], tasks: [], logs: [], documents: [] }; });

describe("dates (Asia/Jerusalem)", () => {
  it("today is the Israeli calendar day, not UTC", () => {
    expect(MK.todayYmd("2026-10-11T22:30:00Z")).toBe("2026-10-12");
    expect(MK.todayYmd("2026-10-11T20:00:00Z")).toBe("2026-10-11");
    expect(MK.todayYmd("2026-12-31T22:30:00Z")).toBe("2027-01-01");
  });
  it("formats and calculates days", () => {
    expect(MK.fmtDate("2026-03-05")).toBe("05/03/2026");
    expect(MK.addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(MK.isYmd("2026-02-30")).toBe(false);
    expect(MK.relDay("2026-10-11", TODAY)).toBe("אתמול");
    expect(MK.ago("2026-09-21", TODAY)).toBe("לפני 21 ימים");
    expect(MK.quickDates(TODAY).map((q) => q.date)).toEqual([TODAY, "2026-10-13", "2026-10-15", "2026-10-19"]);
  });
});

describe("addTask", () => {
  it("adds each kind with its own fields and today's opening date", () => {
    expect(run("addTask", { kind: "mine", title: "להתקשר", due: TODAY }).ok).toBe(true);
    expect(run("addTask", { kind: "people", title: "לבדוק", due: TODAY, who: "יוסי (דוגמה)", what: "הצעת מחיר" }).ok).toBe(true);
    expect(run("addTask", { kind: "org", title: "תקציב", due: TODAY, dept: "כספים" }).ok).toBe(true);
    const t = tasks().find((x) => x.kind === "people");
    expect(t).toMatchObject({ who: "יוסי (דוגמה)", what: "הצעת מחיר", openedAt: TODAY, steps: 1, done: false, createdBy: "u1" });
  });
  it("validates title, date, person, case and department - nothing saved on error", () => {
    const before = JSON.stringify(db);
    expect(MK.run("addTask", db, { kind: "mine", due: TODAY }, ctx()).fields.title).toBeTruthy();
    expect(MK.run("addTask", db, { kind: "mine", title: "x", due: "2026-10-11" }, ctx()).fields.due).toBeTruthy();
    expect(MK.run("addTask", db, { kind: "people", title: "x", due: TODAY }, ctx()).fields.who).toBeTruthy();
    expect(MK.run("addTask", db, { kind: "case", title: "x", due: TODAY, caseId: "nope" }, ctx()).fields.caseId).toBeTruthy();
    expect(MK.run("addTask", db, { kind: "org", title: "x", due: TODAY, dept: "לא קיימת" }, ctx()).fields.dept).toBeTruthy();
    expect(JSON.stringify(db)).toBe(before);
  });
});

describe("cases", () => {
  it("createCase opens the case with its first task (with owner)", () => {
    const r = newCase({ city: "עיר א'", info: "נתון חשוב" }, { owner: "ברוך (דוגמה)" });
    expect(r.ok).toBe(true);
    const c = db.cases[0];
    expect(c).toMatchObject({ name: "תיק לדוגמה", city: "עיר א'", info: "נתון חשוב", status: "open", firstContact: TODAY });
    expect(tasks()[0]).toMatchObject({ kind: "case", caseId: c.id, owner: "ברוך (דוגמה)", title: "שיחת היכרות" });
  });
  it("needs a name and a first task", () => {
    expect(MK.run("createCase", db, { case: {}, firstTask: { title: "x", due: TODAY } }, ctx()).fields.name).toBeTruthy();
    expect(MK.run("createCase", db, { case: { name: "א" }, firstTask: { due: TODAY } }, ctx()).fields.ftTitle).toBeTruthy();
    expect(MK.run("createCase", db, { case: { name: "א", firstContact: "2099-01-01" }, firstTask: { title: "x", due: TODAY } }, ctx()).fields.firstContact).toBeTruthy();
  });
  it("updateCase keeps fields that were not sent", () => {
    const { id } = newCase({ city: "עיר א'", notes: "הערה" });
    run("updateCase", { id, case: { info: "חדש" } });
    expect(db.cases[0]).toMatchObject({ city: "עיר א'", notes: "הערה", info: "חדש" });
  });
  it("closing needs a reason, closes open tasks as not done and writes the history", () => {
    const { id } = newCase();
    expect(MK.run("setCaseStatus", db, { id, status: "closed" }, ctx()).ok).toBe(false);
    expect(run("setCaseStatus", { id, status: "closed", reason: "הסתדר" }).ok).toBe(true);
    expect(db.cases[0]).toMatchObject({ status: "closed", closeReason: "הסתדר" });
    expect(tasks()[0]).toMatchObject({ done: true, result: "notdone" });
    expect(db.logs[0].text).toContain("הסתדר");
    // no new tasks on a closed case; re-open works
    expect(MK.run("addTask", db, { kind: "case", caseId: id, title: "x", due: TODAY }, ctx()).ok).toBe(false);
    expect(run("setCaseStatus", { id, status: "open" }).ok).toBe(true);
    expect(db.cases[0].closeReason).toBe("");
  });
  it("updates go into the case history with a timestamp", () => {
    const { id } = newCase();
    expect(MK.run("addLog", db, { caseId: id, text: " " }, ctx()).ok).toBe(false);
    run("addLog", { caseId: id, text: "דיברתי עם ראש החבורה" });
    const tl = MK.caseTimeline(db, id);
    expect(tl[0]).toMatchObject({ type: "log", at: NOW });
  });
  it("search and status filter in the case list", () => {
    newCase({ name: "כהן (דוגמה)", city: "עיר א'" });
    newCase({ name: "לוי (דוגמה)", city: "עיר ב'" });
    expect(MK.casesList(db, { q: "עיר ב" })).toHaveLength(1);
    expect(MK.casesList(db, { q: "כהן" })[0].next.title).toBe("שיחת היכרות");
    expect(MK.casesList(db, { status: "closed" })).toHaveLength(0);
  });
});

describe("completeTask", () => {
  it("done / not done, with details, recorded on the task", () => {
    const { taskId } = newCase();
    run("completeTask", { id: taskId, result: "notdone", note: "לא ענה" });
    expect(tasks()[0]).toMatchObject({ done: true, result: "notdone", note: "לא ענה", completedAt: NOW });
    expect(MK.run("completeTask", db, { id: taskId }, ctx()).error).toBe("already_done");
  });
  it("a next step continues the same thread: kind, case, opening date and round", () => {
    const { taskId, id: caseId } = newCase({}, { owner: "ברוך (דוגמה)" });
    db.tasks[0].openedAt = "2026-09-21";
    const r = run("completeTask", { id: taskId, result: "done", note: "בוצע", next: { title: "לחזור אליו", due: "2026-10-13", owner: "" } });
    const nx = MK.byId(db.tasks, r.nextId);
    expect(nx).toMatchObject({ kind: "case", caseId, owner: "", title: "לחזור אליו", openedAt: "2026-09-21", steps: 2, prevId: taskId, done: false });
  });
  it("people follow-up 'not yet' comes back on a later date with the same person", () => {
    run("addTask", { kind: "people", title: "לבדוק עם יוסי", due: TODAY, who: "יוסי (דוגמה)", what: "הצעה" });
    const r = run("completeTask", { id: tasks()[0].id, result: "notdone", next: { due: "2026-10-14" } });
    expect(MK.byId(db.tasks, r.nextId)).toMatchObject({ kind: "people", who: "יוסי (דוגמה)", what: "הצעה", title: "לבדוק עם יוסי", steps: 2 });
  });
  it("rejects a next step without a valid date", () => {
    const { taskId } = newCase();
    expect(MK.run("completeTask", db, { id: taskId, next: { title: "x" } }, ctx()).fields.nextDue).toBeTruthy();
    expect(MK.run("completeTask", db, { id: taskId, next: { title: "x", due: "2026-10-01" } }, ctx()).ok).toBe(false);
    expect(tasks()[0].done).toBe(false);
  });
  it("undo re-opens the task and removes the untouched follow-up it created", () => {
    const { taskId } = newCase();
    run("completeTask", { id: taskId, next: { title: "המשך", due: TODAY } });
    expect(tasks()).toHaveLength(2);
    run("undoTask", { id: taskId });
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ done: false, result: "" });
  });
});

describe("postpone / edit / delete", () => {
  it("postpone counts and keeps the original date", () => {
    run("addTask", { kind: "mine", title: "x", due: TODAY });
    const id = tasks()[0].id;
    run("postponeTask", { id, due: "2026-10-14" });
    run("postponeTask", { id, due: "2026-10-20" });
    expect(tasks()[0]).toMatchObject({ due: "2026-10-20", original: TODAY, moved: 2 });
    expect(MK.run("postponeTask", db, { id, due: "2026-10-20" }, ctx()).error).toBe("same_date");
  });
  it("edit can change the kind and its links; delete removes", () => {
    const { id: caseId } = newCase();
    run("addTask", { kind: "mine", title: "x", due: TODAY });
    const id = tasks()[1].id;
    expect(MK.run("updateTask", db, { id, kind: "case", title: "x" }, ctx()).ok).toBe(false);
    run("updateTask", { id, kind: "case", title: "y", caseId, owner: "חיים (דוגמה)" });
    expect(MK.byId(db.tasks, id)).toMatchObject({ kind: "case", caseId, owner: "חיים (דוגמה)", title: "y" });
    run("deleteTask", { id });
    expect(MK.byId(db.tasks, id)).toBeNull();
  });
});

describe("documents", () => {
  it("adds a document row on the case and lists it in the history", () => {
    const { id } = newCase();
    const r = run("addDocument", { caseId: id, name: "טופס.pdf", mime: "application/pdf", size: 1200, fileId: "F1", url: "https://drive.google.com/file/d/F1/view", folderId: "D1" });
    expect(r.ok).toBe(true);
    expect(MK.caseDocuments(db, id)[0]).toMatchObject({ name: "טופס.pdf", fileId: "F1" });
    expect(db.cases[0].folderId).toBe("D1");
    expect(MK.caseTimeline(db, id).some((e) => e.type === "doc")).toBe(true);
    expect(run("removeDocument", { id: r.id }).fileId).toBe("F1");
    expect(db.documents).toHaveLength(0);
  });
  it("refuses unsafe links and oversized files", () => {
    const { id } = newCase();
    run("addDocument", { caseId: id, name: "a", url: "javascript:alert(1)" });
    expect(db.documents[0].url).toBe("");
    expect(MK.run("addDocument", db, { caseId: id, name: "b", size: 26 * 1024 * 1024 }, ctx()).fields.size).toBeTruthy();
  });
});

describe("diary", () => {
  it("groups by date, filters by kind and case, hides tasks of closed cases", () => {
    const { id: c1 } = newCase();
    run("addTask", { kind: "mine", title: "מחר", due: "2026-10-13" });
    run("addTask", { kind: "people", title: "היום", due: TODAY, who: "א" });
    db.tasks.push({ id: "old", kind: "mine", title: "באיחור", due: "2026-10-10", done: false });
    const d = MK.diary(db, TODAY);
    expect(d.overdue.map((t) => t.id)).toEqual(["old"]);
    expect(d.today).toHaveLength(2);
    expect(d.upcoming).toHaveLength(1);
    expect(MK.diary(db, TODAY, { kind: "people" }).today).toHaveLength(1);
    expect(MK.diary(db, TODAY, { caseId: c1 }).today).toHaveLength(1);
    const c = MK.counts(db, TODAY);
    expect(c).toMatchObject({ overdue: 1, today: 2, case: 1, people: 1, mine: 2, openCases: 1 });
  });
});

describe("misc", () => {
  it("unknown operations are refused; ops never mutate their input db", () => {
    expect(MK.run("dropAll", db, {}, ctx()).error).toBe("unknown_action");
    expect(MK.run("toString", db, {}, ctx()).error).toBe("unknown_action");
    const before = JSON.stringify(db);
    MK.run("createCase", db, { case: { name: "א" }, firstTask: { title: "x", due: TODAY } }, ctx());
    expect(JSON.stringify(db)).toBe(before);
  });
  it("password rules", () => {
    expect(MK.passwordProblem("short1")).toBeTruthy();
    expect(MK.passwordProblem("letters1234")).toBe("");
  });
});
