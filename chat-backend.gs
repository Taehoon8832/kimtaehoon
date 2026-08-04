/**
 * 김태훈닷컴 방문자 통계(+레거시 채팅) 백엔드 (Google Apps Script)
 *
 * 메인 페이지 실시간 채팅 UI는 제거되었습니다.
 * 이 파일은 index.html 의 VISIT_API_URL(visitHit / visitStats)용으로 사용합니다.
 *
 * [배포 — 1회만]
 * 1. https://script.google.com  → 새 프로젝트
 * 2. 이 파일 전체를 Code.gs 에 붙여넣기
 * 3. 배포 → 새 배포 → 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스: 모든 사용자
 * 4. 웹 앱 URL을 복사해 index.html 의 VISIT_API_URL 에 넣기
 *
 * 예) const VISIT_API_URL = "https://script.google.com/macros/s/XXXX/exec";
 */

var SHEET_NAME = "messages";
var MAX_MESSAGES = 300;
var ADMIN_PASSWORD = "6485";

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "list";
  if (action === "list") {
    return json_({ ok: true, messages: listMessages_() });
  }
  if (action === "ping") {
    return json_({ ok: true, t: Date.now() });
  }
  if (action === "visitStats") {
    return json_({ ok: true, today: visitToday_(), total: visitTotal_() });
  }
  if (action === "visitHit") {
    return json_(recordVisit_());
  }
  return json_({ ok: false, error: "unknown_action" });
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = body.action || "";
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      if (action === "create") {
        var msg = body.message || {};
        if (!msg.id || !msg.nickname || !msg.text || !msg.passwordHash) {
          return json_({ ok: false, error: "invalid_message" });
        }
        createMessage_({
          id: String(msg.id).slice(0, 64),
          nickname: String(msg.nickname).slice(0, 16),
          text: String(msg.text).slice(0, 500),
          passwordHash: String(msg.passwordHash).slice(0, 128),
          sessionId: String(msg.sessionId || "").slice(0, 64),
          createdAt: Number(msg.createdAt) || Date.now(),
        });
        return json_({ ok: true, messages: listMessages_() });
      }

      if (action === "delete") {
        var id = String(body.id || "");
        var passwordHash = String(body.passwordHash || "");
        var adminPassword = String(body.adminPassword || "");
        var deleted = deleteMessage_(id, passwordHash, adminPassword);
        return json_({ ok: deleted, messages: listMessages_() });
      }

      if (action === "clear") {
        var adminPwd = String(body.adminPassword || "");
        var passwordHash2 = String(body.passwordHash || "");
        var cleared = clearMessages_(adminPwd, passwordHash2);
        return json_({ ok: cleared.ok, removed: cleared.removed, messages: listMessages_() });
      }

      return json_({ ok: false, error: "unknown_action" });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty("SPREADSHEET_ID");
  var ss;

  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (err) {
      ss = null;
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create("kimtaehoon-chat");
    props.setProperty("SPREADSHEET_ID", ss.getId());
  }

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["id", "nickname", "text", "passwordHash", "sessionId", "createdAt"]);
  }
  return sheet;
}

function listMessages_() {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  return values
    .slice(1)
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      return {
        id: String(r[0]),
        nickname: String(r[1]),
        text: String(r[2]),
        passwordHash: String(r[3]),
        sessionId: String(r[4] || ""),
        createdAt: Number(r[5]) || Date.now(),
      };
    })
    .sort(function (a, b) {
      return a.createdAt - b.createdAt;
    });
}

function createMessage_(msg) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === msg.id) return;
  }
  sheet.appendRow([
    msg.id,
    msg.nickname,
    msg.text,
    msg.passwordHash,
    msg.sessionId,
    msg.createdAt,
  ]);

  var last = sheet.getLastRow();
  if (last - 1 > MAX_MESSAGES) {
    sheet.deleteRows(2, last - 1 - MAX_MESSAGES);
  }
}

function deleteMessage_(id, passwordHash, adminPassword) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  var isAdmin = adminPassword === ADMIN_PASSWORD;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== id) continue;
    if (isAdmin || String(values[i][3]) === passwordHash) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function clearMessages_(adminPassword, passwordHash) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { ok: true, removed: 0 };

  if (adminPassword === ADMIN_PASSWORD) {
    var total = values.length - 1;
    sheet.getRange(2, 1, total, 6).clearContent();
    return { ok: true, removed: total };
  }

  if (!passwordHash) return { ok: false, removed: 0 };

  var removed = 0;
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][3]) === passwordHash) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  return { ok: removed > 0, removed: removed };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function seoulDate_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

function visitToday_() {
  var props = PropertiesService.getScriptProperties();
  var today = seoulDate_();
  if ((props.getProperty("VISIT_DATE") || "") !== today) return 0;
  return Number(props.getProperty("VISIT_TODAY") || 0);
}

function visitTotal_() {
  return Number(PropertiesService.getScriptProperties().getProperty("VISIT_TOTAL") || 0);
}

function recordVisit_() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var today = seoulDate_();
    var storedDate = props.getProperty("VISIT_DATE") || "";
    var todayCount = Number(props.getProperty("VISIT_TODAY") || 0);
    var total = Number(props.getProperty("VISIT_TOTAL") || 0);
    if (storedDate !== today) {
      todayCount = 0;
      props.setProperty("VISIT_DATE", today);
    }
    todayCount += 1;
    total += 1;
    props.setProperty("VISIT_TODAY", String(todayCount));
    props.setProperty("VISIT_TOTAL", String(total));
    return { ok: true, today: todayCount, total: total };
  } finally {
    lock.releaseLock();
  }
}
