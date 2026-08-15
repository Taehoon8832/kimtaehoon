/**
 * GitHub Actions용: 보드 JSON/JS 충돌 마커·빈 데이터 검증
 * Usage: node scripts/validate_board_json.mjs data/univ-notices.json univ-board-data.js ...
 */
import fs from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/validate_board_json.mjs <files...>");
  process.exit(1);
}

/** 실제 git 충돌 마커만 감지 (본문의 ======= 오탐 방지) */
function hasConflictMarkers(text) {
  return /^(<<<<<<<|>>>>>>>|=======)\s/m.test(text) || /^(<<<<<<<|>>>>>>>|=======)$/m.test(text);
}

function extractJson(text, file) {
  if (!file.endsWith(".js")) return text;
  const m = text.match(/^[^=\n]+=\s*([\s\S]*)$/);
  if (!m) throw new Error("js assignment not found");
  return m[1].trim().replace(/;\s*$/, "");
}

let failed = false;
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error("missing", f);
    failed = true;
    continue;
  }
  const raw = fs.readFileSync(f, "utf8");
  if (hasConflictMarkers(raw)) {
    console.error("conflict markers in", f);
    failed = true;
    continue;
  }
  try {
    const j = JSON.parse(extractJson(raw, f));
    const notices = j.notices;
    if (!Array.isArray(notices)) {
      console.error("no notices array in", f);
      failed = true;
      continue;
    }
    if (!notices.length) {
      console.error("empty notices in", f);
      failed = true;
      continue;
    }
    console.log(
      "ok",
      f,
      "notices",
      notices.length,
      j.minDate ? `minDate=${j.minDate}` : "",
      j.today ? `today=${j.today}` : ""
    );
  } catch (e) {
    console.error("parse fail", f, e.message);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
