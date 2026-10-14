// A small in-memory stand-in for the Google Apps Script services used by Server.js,
// so the backend can be exercised end-to-end in Node. Fictional data only.
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function makeSheet(name) {
  let cells = []; // array of rows (arrays)
  let numberFormat = "";
  const sheet = {
    name,
    getDataRange() {
      return { getValues: () => (cells.length ? cells.map((r) => r.slice()) : [[""]]) };
    },
    getRange(row, col, nRows = 1, nCols = 1) {
      return {
        setValue(v) { while (cells.length < row) cells.push([]); cells[row - 1][col - 1] = v; },
        getValue() { return (cells[row - 1] || [])[col - 1] ?? ""; },
        setValues(vals) {
          for (let i = 0; i < nRows; i++) {
            while (cells.length < row + i) cells.push([]);
            for (let j = 0; j < nCols; j++) cells[row - 1 + i][col - 1 + j] = vals[i][j];
          }
        },
        setNumberFormat(f) { numberFormat = f; }
      };
    },
    clearContents() { cells = []; },
    appendRow(r) { cells.push(r.slice()); },
    getLastRow() { return cells.length; },
    setFrozenRows() {},
    _cells: () => cells,
    _format: () => numberFormat
  };
  return sheet;
}

export function createGas() {
  const props = {};
  const cache = {};
  const sheets = {};
  const logs = [];
  const mails = [];
  const spreadsheet = {
    getId: () => "ss1",
    getUrl: () => "https://docs.google.com/spreadsheets/d/ss1",
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => { delete sheets[s.name]; }
  };
  // A tiny in-memory Drive: folders and files with ids.
  const drive = { folders: {}, files: {} };
  let seq = 0;
  function makeFolder(name, parent) {
    const id = "fo" + (++seq);
    const f = {
      id, name, parent, trashed: false,
      getId: () => id, getName: () => f.name, getUrl: () => "https://drive.google.com/drive/folders/" + id, isTrashed: () => f.trashed,
      getFoldersByName: (n) => {
        const list = Object.values(drive.folders).filter((x) => x.parent === id && x.name === n && !x.trashed);
        return { hasNext: () => list.length > 0, next: () => list.shift() };
      },
      createFolder: (n) => makeFolder(n, id),
      createFile: (blob) => makeFile(blob, id),
      getFiles: () => ({ hasNext: () => false })
    };
    drive.folders[id] = f;
    return f;
  }
  function makeFile(blob, parent) {
    const id = "fi" + (++seq);
    const f = {
      id, parent, blob, trashed: false, description: "",
      getId: () => id, getUrl: () => "https://drive.google.com/file/d/" + id + "/view", getMimeType: () => blob.mime,
      setDescription: (d) => { f.description = d; }, setTrashed: (v) => { f.trashed = v; }, moveTo() {}, makeCopy() {}
    };
    drive.files[id] = f;
    return f;
  }
  const b64 = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; }
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { create: () => spreadsheet, openById: () => spreadsheet },
    DriveApp: {
      createFolder: (n) => makeFolder(n, ""),
      getFolderById: (id) => { if (!drive.folders[id]) throw new Error("no folder"); return drive.folders[id]; },
      getFileById: (id) => drive.files[id] || { moveTo() {}, makeCopy() {}, setTrashed() {} }
    },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => {
      const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, everyMinutes: () => b, create: () => ({}) };
      return b;
    } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
    Logger: { log: (s) => logs.push(String(s)) },
    Session: { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    MailApp: { sendEmail: (...a) => mails.push(a) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash("sha256").update(String(s), "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (s, key) => Array.from(crypto.createHmac("sha256", key).update(String(s), "utf8").digest()),
      base64EncodeWebSafe: (v) => b64(typeof v === "string" ? Buffer.from(v, "utf8") : Buffer.from(v.map((b) => b & 0xff))),
      base64DecodeWebSafe: (s) => Array.from(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name, getDataAsString: () => Buffer.from(bytes).toString("utf8") }),
      base64Decode: (s) => { if (!/^[A-Za-z0-9+/=]*$/.test(s)) throw new Error("bad base64"); return Array.from(Buffer.from(s, "base64")); },
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
          .formatToParts(d).map((x) => [x.type, x.value]));
        return fmt.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day);
      },
      sleep() {}
    },
    Intl, Date, JSON, Math, Object, Array, String, Number, Error, Buffer
  };
  vm.createContext(ctx);
  // Exactly what build.sh produces.
  const code = fs.readFileSync(path.join(here, "../js/core.js"), "utf8") + "\n" + fs.readFileSync(path.join(here, "../apps-script/src/Server.js"), "utf8");
  vm.runInContext(code, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  return { ctx, post, props, sheets, logs, mails, drive };
}
