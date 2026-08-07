process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shas = [
  "f508a22a",
  "9a2370d3",
  "127b29d4",
  "cd45470c",
  "c75a024c",
  "0a3080fc",
];

async function main() {
  let best = null;
  for (const sha of shas) {
    const u = `https://raw.githubusercontent.com/taehoon8832/kimtaehoon/${sha}/data/univ-notices.json`;
    const r = await fetch(u, { headers: { "User-Agent": "kimtaehoon-repair" } });
    const t = await r.text();
    const conflict = t.includes("<<<<<<<");
    let notices = 0;
    let ok = false;
    try {
      const j = JSON.parse(t);
      notices = (j.notices || []).length;
      ok = !conflict && notices > 0;
      if (ok && (!best || notices > best.notices)) {
        best = { sha, notices, payload: j };
      }
    } catch {
      /* ignore */
    }
    console.log(sha, r.status, "len", t.length, "conflict", conflict, "notices", notices);
  }
  if (!best) {
    console.error("no valid remote payload");
    process.exit(1);
  }
  // merge current academy notices if any
  let localNotices = [];
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "univ-notices.json"), "utf8"));
    localNotices = cur.notices || [];
  } catch {
    /* ignore */
  }
  const map = new Map();
  for (const n of [...(best.payload.notices || []), ...localNotices]) {
    if (!n?.dateISO || !n?.title || !n?.url) continue;
    if (n.dateISO < "2026-08-01") continue;
    map.set(`${n.univId}|${n.url}|${n.title}`, n);
  }
  const sources =
    best.payload.sources ||
    JSON.parse(fs.readFileSync(path.join(ROOT, "univ-sources.json"), "utf8"));
  // apply academy URL fixes from local sources
  const localSources = JSON.parse(
    fs.readFileSync(path.join(ROOT, "univ-sources.json"), "utf8")
  );
  const byId = new Map(localSources.map((s) => [s.id, s]));
  const mergedSources = sources.map((s) => {
    const loc = byId.get(s.id);
    if (!loc) return s;
    if (["u032", "u245", "u123", "u232", "u109"].includes(s.id)) {
      return { ...s, ...loc };
    }
    return s;
  });

  const notices = [...map.values()].sort((a, b) =>
    String(b.dateISO).localeCompare(String(a.dateISO))
  );
  const payload = {
    ...best.payload,
    minDate: "2026-08-01",
    updatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    sources: mergedSources,
    notices,
    status: "restored",
    statusReason: `restored_from=${best.sha} notices=${notices.length}`,
    stale: false,
  };
  fs.writeFileSync(
    path.join(ROOT, "data", "univ-notices.json"),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(ROOT, "univ-board-data.js"),
    "window.UNIV_BOARD_DATA=" + JSON.stringify(payload) + ";\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(ROOT, "univ-sources.json"),
    JSON.stringify(mergedSources, null, 2),
    "utf8"
  );
  console.log(
    "saved from",
    best.sha,
    "notices",
    notices.length,
    "univs",
    new Set(notices.map((n) => n.univId)).size
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
