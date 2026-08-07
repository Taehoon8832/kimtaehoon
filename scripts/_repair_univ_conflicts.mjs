/**
 * Resolve git conflict markers in univ board data by merging both sides.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_DATE = "2026-08-01";

function extractJsonObjects(text) {
  const objs = [];
  // conflicted window.UNIV_BOARD_DATA=... blocks
  const re = /window\.UNIV_BOARD_DATA\s*=\s*(\{[\s\S]*?\})\s*;/g;
  for (const m of text.matchAll(re)) {
    try {
      objs.push(JSON.parse(m[1]));
    } catch {
      /* ignore */
    }
  }
  if (objs.length) return objs;

  // conflicted pretty JSON file: strip markers then try parse of each side
  const sides = text.split(/<<<<<<<[^\n]*\n/);
  for (const side of sides) {
    const cleaned = side
      .replace(/^=======[\s\S]*?>>>>>>>[^\n]*\n?/gm, "")
      .replace(/^>>>>>>>[^\n]*\n?/gm, "")
      .replace(/^=======\n?/gm, "");
    // try full parse
    try {
      objs.push(JSON.parse(cleaned));
      continue;
    } catch {
      /* continue */
    }
  }

  // extract individual notice objects from conflicted regions
  const noticeRe =
    /\{\s*"id"\s*:\s*"[^"]+"\s*,\s*"univId"\s*:\s*"[^"]+"[\s\S]*?"dateISO"\s*:\s*"[^"]+"\s*,\s*"dateText"\s*:\s*"[^"]+"\s*\}/g;
  const notices = [];
  for (const m of text.matchAll(noticeRe)) {
    try {
      notices.push(JSON.parse(m[0]));
    } catch {
      /* ignore */
    }
  }
  if (notices.length) {
    // also get sources from non-conflict prefix if possible
    let sources = [];
    try {
      const srcMatch = text.match(/"sources"\s*:\s*(\[[\s\S]*?\])\s*,\s*"notices"/);
      if (srcMatch) sources = JSON.parse(srcMatch[1]);
    } catch {
      sources = JSON.parse(fs.readFileSync(path.join(ROOT, "univ-sources.json"), "utf8"));
    }
    objs.push({ sources, notices, minDate: MIN_DATE });
  }
  return objs;
}

function mergePayloads(parts) {
  const sources =
    parts.find((p) => Array.isArray(p.sources) && p.sources.length)?.sources ||
    JSON.parse(fs.readFileSync(path.join(ROOT, "univ-sources.json"), "utf8"));
  const priority = parts.find((p) => Array.isArray(p.priority))?.priority || [];
  const map = new Map();
  for (const p of parts) {
    for (const n of p.notices || []) {
      if (!n?.title || !n?.url || !n?.dateISO) continue;
      if (n.dateISO < MIN_DATE) continue;
      const k = `${n.univId}|${n.url}|${n.title}`;
      if (!map.has(k)) map.set(k, n);
    }
  }
  const notices = [...map.values()].sort((a, b) => {
    const d = String(b.dateISO).localeCompare(String(a.dateISO));
    return d || String(a.title).localeCompare(String(b.title), "ko");
  });
  return {
    minDate: MIN_DATE,
    updatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    sources,
    notices,
    priority,
    stale: false,
    status: "repaired",
    statusReason: `merged_conflict notices=${notices.length}`,
  };
}

function save(payload) {
  const jsonPath = path.join(ROOT, "data", "univ-notices.json");
  const jsPath = path.join(ROOT, "univ-board-data.js");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(
    jsPath,
    "window.UNIV_BOARD_DATA=" + JSON.stringify(payload) + ";\n",
    "utf8"
  );
}

const jsRaw = fs.readFileSync(path.join(ROOT, "univ-board-data.js"), "utf8");
const jsonRaw = fs.readFileSync(path.join(ROOT, "data", "univ-notices.json"), "utf8");
const parts = [...extractJsonObjects(jsRaw), ...extractJsonObjects(jsonRaw)];
console.log("parsed parts", parts.length, "notice totals", parts.map((p) => (p.notices || []).length));
const payload = mergePayloads(parts);
save(payload);
console.log("saved notices", payload.notices.length, "univs", new Set(payload.notices.map((n) => n.univId)).size);
