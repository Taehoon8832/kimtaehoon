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

let failed = false;
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error("missing", f);
    failed = true;
    continue;
  }
  let t = fs.readFileSync(f, "utf8");
  if (t.includes("<<<<<<<") || t.includes(">>>>>>>") || t.includes("=======")) {
    console.error("conflict markers in", f);
    failed = true;
    continue;
  }
  try {
    if (f.endsWith(".js")) {
      t = t.split("=").slice(1).join("=").trim().replace(/;$/, "");
    }
    const j = JSON.parse(t);
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
