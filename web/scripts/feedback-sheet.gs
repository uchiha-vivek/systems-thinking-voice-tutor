// Google Apps Script for the feedback sheet. Paste this into Extensions -> Apps Script in your
// Google Sheet, set the SECRET script property, and deploy it as a web app (see the README).
// The tutor's /api/feedback route posts each rating here, and this adds one row per rating.

const HEADERS = ["Received", "Helpful", "Rating (1-5)", "Comment", "Model", "Transcript lines", "ElevenLabs conversation id"];

function doPost(e) {
  const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || data.secret !== secret) return reply({ ok: false, error: "forbidden" });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  sheet.appendRow([
    new Date(),
    cell(data.helpful),
    typeof data.rating === "number" ? data.rating : "",
    cell(data.comment),
    cell(data.model),
    typeof data.turns === "number" ? data.turns : "",
    cell(data.conversation_id),
  ]);
  return reply({ ok: true });
}

// Text that starts with = + - or @ would run as a formula in the sheet, so mark it as plain text.
function cell(v) {
  const s = v == null ? "" : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
