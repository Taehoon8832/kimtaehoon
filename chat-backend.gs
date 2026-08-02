/**
 * 김태훈닷컴 실시간 대화 백엔드 (Google Apps Script)
 *
 * 사용 방법
 * 1. https://script.google.com 에서 새 프로젝트 생성
 * 2. 이 파일 내용을 Code.gs 에 붙여넣기
 * 3. 배포 > 새 배포 > 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: 모든 사용자
 * 4. 배포 후 받은 웹 앱 URL을 index.html 의 CHAT_API_URL 에 붙여넣기
 *
 * 예)
 *   const CHAT_API_URL = "https://script.google.com/macros/s/XXXX/exec";
 */

var SHEET_NAME = "messages";
var MAX_MESSAGES = 300;

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "list";
  if (action === "list") {
    return json_({ ok: true, messages: listMessages_() });
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
      return json_({ ok: true });
    }

    if (action === "delete") {
      var id = String(body.id || "");
      var passwordHash = String(body.passwordHash || "");
      var deleted = deleteMessage_(id, passwordHash);
      return json_({ ok: deleted });
    }

    return json_({ ok: false, error: "unknown_action" });
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
  var rows = values.slice(1);
  return rows
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

function deleteMessage_(id, passwordHash) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id && String(values[i][3]) === passwordHash) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
