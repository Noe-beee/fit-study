/**
 * Fit study backend — Google Apps Script bound to the study Google Sheet.
 *
 * Receives answers and photos from the study page (index.html on GitHub Pages) and stores them in
 * this Sheet and a Drive folder of the account that deploys it. Participants never sign in.
 *
 * Tabs (created by Study → Set up):
 *   part1         one row per part-1 submission (no e-mail address)
 *   contacts      pid + e-mail address only (kept apart from the answers)
 *   participants  pid, A/B order, status dates
 *   lists         each participant's 20 shirts, written by the researcher's list tool (or pasted; see SETUP.md)
 *   part2         one row per part-2 submission
 *   screenouts    eligibility screen-outs (reason and date only)
 *
 * The researcher's list tool (tools/study_participant.py) uses the "tool" action, protected by a key that is stored
 * only in this script's properties (Study → Set tool key) and in the researcher's Mac keychain.
 */

const PART2_LINK_BASE = 'https://noe-beee.github.io/fit-study/';   // the study page address (SETUP.md step 4)
const PHOTO_FOLDER_NAME = 'Fit study photos';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 5000;
const LIST_HEADER = ['pid', 'source', 'rank', 'product_id', 'brand', 'name', 'price', 'img_packshot', 'img_model'];
const HEADERS = {
  part1: ['pid', 'submitted_at', 'photos'],
  contacts: ['pid', 'email', 'created_at'],
  participants: ['pid', 'order', 'part1_at', 'link_sent_at', 'part2_at', 'photos_deleted_at'],
  lists: LIST_HEADER,
  part2: ['pid', 'submitted_at', 'order', 'list_A_source', 'list_B_source'],
  screenouts: ['at', 'reason']
};

/* ---------- Draft of the part-2 e-mail (edit before use) ---------- */
const LINK_MAIL_SUBJECT = 'Your personal link to part 2 of the fit study';
const LINK_MAIL_BODY = (link) =>
  'Hello,\n\n' +
  'thank you for taking part in part 1 of the fit study. Your personal link to part 2 (about 15 minutes) is:\n\n' +
  link + '\n\n' +
  'The link is only for you. If you have any questions, just reply to this e-mail.\n\n' +
  'Noelani Bradley\nHWR Berlin\n';

/* ================= Web endpoints ================= */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'lists') return out_(getLists_(String(p.pid || '')));
    return out_({ ok: true });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server' });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'part1') return out_(savePart1_(body));
    if (body.action === 'part2') return out_(savePart2_(body));
    if (body.action === 'screenout') return out_(saveScreenout_(body));
    if (body.action === 'tool') return out_(tool_(body));
    return out_({ ok: false, error: 'action' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= Part 1 ================= */

function savePart1_(body) {
  const email = String(body.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return { ok: false, error: 'email' };
  const photos = body.photos || {};
  if (!photos.flat) return { ok: false, error: 'photo' };

  const pid = newPid_();
  const now = new Date();
  const folder = photoFolder_();
  const saved = [];
  ['flat', 'label', 'worn', 'model'].forEach(function (kind) {
    if (!photos[kind]) return;
    const bytes = Utilities.base64Decode(String(photos[kind]));
    if (bytes.length > MAX_PHOTO_BYTES) return;
    folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', pid + '_' + kind + '.jpg'));
    saved.push(kind);
  });

  const row = Object.assign({ pid: pid, submitted_at: now, photos: saved.join('; ') }, clean_(body.answers));
  appendObj_('part1', row);
  appendObj_('contacts', { pid: pid, email: email, created_at: now });
  appendObj_('participants', { pid: pid, order: Math.random() < 0.5 ? 'AB' : 'BA', part1_at: now });
  notify_('New part 1 submission: ' + pid, 'Photos: ' + (saved.join(', ') || 'none') + '\nOpen the Sheet to see the answers.');
  return { ok: true };
}

function saveScreenout_(body) {
  appendObj_('screenouts', { at: new Date(), reason: String(body.reason || '').slice(0, 40) });
  return { ok: true };
}

/* ================= Part 2 ================= */

function getLists_(pid) {
  if (!/^[a-z0-9]{6,16}$/.test(pid)) return { ok: false, error: 'unknown' };
  const p = findRow_('participants', pid);
  if (!p) return { ok: false, error: 'unknown' };
  if (p.obj.part2_at) return { ok: false, error: 'done' };

  const sh = sheet_('lists');
  const values = sh.getDataRange().getValues();
  const head = values[0].map(String);
  const col = function (name) { return head.indexOf(name); };
  const bySource = { model: [], popularity: [] };
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][col('pid')]).trim().toLowerCase() !== pid) continue;
    const source = String(values[r][col('source')]).trim().toLowerCase();
    if (!bySource[source]) continue;
    bySource[source].push({
      rank: Number(values[r][col('rank')]),
      product_id: String(values[r][col('product_id')]),
      brand: String(values[r][col('brand')]),
      name: String(values[r][col('name')]),
      price: formatPrice_(values[r][col('price')]),
      img_packshot: String(values[r][col('img_packshot')]),
      img_model: String(values[r][col('img_model')])
    });
  }
  if (bySource.model.length !== 10 || bySource.popularity.length !== 10) return { ok: false, error: 'unknown' };
  const sortRank = function (a, b) { return a.rank - b.rank; };
  bySource.model.sort(sortRank); bySource.popularity.sort(sortRank);
  const strip = function (list) { return list.map(function (x) { delete x.rank; return x; }); };
  const ab = String(p.obj.order) === 'BA' ? ['popularity', 'model'] : ['model', 'popularity'];
  return { ok: true, lists: { A: strip(bySource[ab[0]]), B: strip(bySource[ab[1]]) } };   // the source is never sent to the page
}

function savePart2_(body) {
  const pid = String(body.pid || '');
  const p = findRow_('participants', pid);
  if (!p) return { ok: false, error: 'unknown' };
  if (p.obj.part2_at) return { ok: false, error: 'done' };
  const order = String(p.obj.order) === 'BA' ? 'BA' : 'AB';
  const now = new Date();
  const row = Object.assign({
    pid: pid, submitted_at: now, order: order,
    list_A_source: order === 'AB' ? 'model' : 'popularity',
    list_B_source: order === 'AB' ? 'popularity' : 'model'
  }, clean_(body.answers));
  appendObj_('part2', row);
  setCell_('participants', p.row, 'part2_at', now);
  notify_('New part 2 submission: ' + pid, 'Open the Sheet to see the answers.');
  return { ok: true };
}

/* ================= Researcher's list tool ================= */

function tool_(body) {
  const key = PropertiesService.getScriptProperties().getProperty('TOOL_KEY') || '';
  if (key.length < 32 || String(body.key || '') !== key) return { ok: false, error: 'key' };
  const pid = String(body.pid || '').trim().toLowerCase();
  if (!/^[a-z0-9]{6,16}$/.test(pid)) return { ok: false, error: 'pid' };
  const p = findRow_('participants', pid);
  if (!p) return { ok: false, error: 'unknown pid' };
  if (body.op === 'intake') return toolIntake_(pid);
  if (body.op === 'lists') return toolLists_(pid, p, body.rows, body.replace === true);
  return { ok: false, error: 'op' };
}

function toolIntake_(pid) {
  // The part-1 answers needed for intake and the participant's photos (never the e-mail address).
  const r = findRow_('part1', pid);
  if (!r) return { ok: false, error: 'no part1 row' };
  const answers = {};
  ['width_cm', 'length_cm', 'size_label', 'worn_way', 'shop_url', 'photos'].forEach(function (k) { answers[k] = r.obj[k]; });
  const photos = {};
  const files = photoFolder_().getFiles();
  while (files.hasNext()) {
    const f = files.next(), m = f.getName().match(/^([a-z0-9]+)_(flat|label|worn|model)\.jpg$/);
    if (m && m[1] === pid && !f.isTrashed()) photos[m[2]] = Utilities.base64Encode(f.getBlob().getBytes());
  }
  return { ok: true, answers: answers, photos: photos };
}

function toolLists_(pid, p, rows, replace) {
  if (p.obj.part2_at) return { ok: false, error: 'part 2 already done' };
  if (!Array.isArray(rows) || rows.length !== 20) return { ok: false, error: 'need 20 rows' };
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i];
    const k = String(x.source) + ':' + Number(x.rank);
    if (['model', 'popularity'].indexOf(String(x.source)) < 0 || !(Number(x.rank) >= 1 && Number(x.rank) <= 10) || seen[k])
      return { ok: false, error: 'rows must be ranks 1-10 for model and popularity' };
    if (!/^https:\/\/img01\.ztat\.net\//.test(String(x.img_packshot)) || !/^https:\/\/img01\.ztat\.net\//.test(String(x.img_model)))
      return { ok: false, error: 'image links must be shop image links' };
    seen[k] = true;
  }
  const sh = sheet_('lists');
  const values = sh.getDataRange().getValues();
  const c = values[0].map(String).indexOf('pid');
  const existing = [];
  for (let r = values.length - 1; r >= 1; r--) if (String(values[r][c]).trim().toLowerCase() === pid) existing.push(r + 1);
  if (existing.length && !replace) return { ok: false, error: 'lists exist for this pid (use --replace)' };
  existing.forEach(function (row) { sh.deleteRow(row); });          // bottom-up, so row numbers stay valid
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const out = rows.map(function (x) {
    const o = clean_(Object.assign({}, x, { pid: undefined }));
    o.pid = pid;
    return head.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, head.length).setValues(out);
  return { ok: true, written: out.length, replaced: existing.length };
}

/* ================= Researcher menu ================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Study')
    .addItem('Set up tabs and photo folder', 'setup')
    .addSeparator()
    .addItem('Send part 2 link to the selected participant', 'sendPart2LinkSelected')
    .addItem('Delete photos of the selected participant', 'deletePhotosSelected')
    .addSeparator()
    .addItem('Set tool key', 'setToolKey')
    .addToUi();
}

function setup() {
  Object.keys(HEADERS).forEach(function (name) { sheet_(name); });
  const folder = photoFolder_();
  SpreadsheetApp.getUi().alert('Tabs are ready. Photos are saved in the Drive folder "' + folder.getName() + '".');
}

function sendPart2LinkSelected() {
  const ui = SpreadsheetApp.getUi();
  const pid = selectedPid_();
  if (!pid) return ui.alert('Select a row with a pid in the participants or contacts tab first.');
  const c = findRow_('contacts', pid);
  if (!c) return ui.alert('No e-mail address found for ' + pid + '.');
  const lists = getLists_(pid);
  if (!lists.ok) return ui.alert('The lists for ' + pid + ' are not complete in the lists tab (10 model + 10 popularity rows needed), or part 2 is already done.');
  const link = PART2_LINK_BASE + '?pid=' + pid;
  const answer = ui.alert('Send the part 2 link to ' + c.obj.email + '?', LINK_MAIL_BODY(link), ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  MailApp.sendEmail({ to: String(c.obj.email), subject: LINK_MAIL_SUBJECT, body: LINK_MAIL_BODY(link), name: 'Fit study · HWR Berlin' });
  const p = findRow_('participants', pid);
  if (p) setCell_('participants', p.row, 'link_sent_at', new Date());
  ui.alert('Sent to ' + c.obj.email + '.');
}

function setToolKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Set tool key', 'Paste the key the list tool copied to your clipboard (Cmd + V), then OK.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = r.getResponseText().trim();
  if (!/^[A-Za-z0-9_-]{32,}$/.test(key)) return ui.alert('That does not look like the key (32+ letters and digits). Nothing was changed.');
  PropertiesService.getScriptProperties().setProperty('TOOL_KEY', key);
  ui.alert('Tool key saved.');
}

function deletePhotosSelected() {
  const ui = SpreadsheetApp.getUi();
  const pid = selectedPid_();
  if (!pid) return ui.alert('Select a row with a pid first.');
  if (ui.alert('Delete all photos of ' + pid + '?', 'They are moved to the Drive trash. Empty the trash to remove them for good.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const files = photoFolder_().getFiles();
  let n = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().indexOf(pid + '_') === 0) { f.setTrashed(true); n++; }
  }
  const p = findRow_('participants', pid);
  if (p) setCell_('participants', p.row, 'photos_deleted_at', new Date());
  ui.alert(n + ' photo(s) of ' + pid + ' moved to the trash.');
}

/* ================= Helpers ================= */

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function appendObj_(name, obj) {
  const sh = sheet_(name);
  let head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String).filter(String);
  const missing = Object.keys(obj).filter(function (k) { return head.indexOf(k) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
  }
  sh.appendRow(head.map(function (k) { return obj[k] === undefined ? '' : obj[k]; }));
}

function findRow_(name, pid) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(String);
  const c = head.indexOf('pid');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][c]).trim().toLowerCase() === pid) {
      const obj = {};
      head.forEach(function (h, i) { obj[h] = values[r][i]; });
      return { row: r + 1, obj: obj };
    }
  }
  return null;
}

function setCell_(name, row, column, value) {
  const sh = sheet_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const c = head.indexOf(column);
  if (c >= 0) sh.getRange(row, c + 1).setValue(value);
}

function selectedPid_() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (['participants', 'contacts', 'part1'].indexOf(sh.getName()) < 0) return '';
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const c = head.indexOf('pid');
  const r = sh.getActiveRange().getRow();
  if (c < 0 || r < 2) return '';
  return String(sh.getRange(r, c + 1).getValue()).trim().toLowerCase();
}

function newPid_() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (let tries = 0; tries < 50; tries++) {
    let pid = '';
    for (let i = 0; i < 8; i++) pid += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    if (!findRow_('participants', pid)) return pid;
  }
  throw new Error('pid');
}

function clean_(answers) {
  // Only plain values; text is shortened, and a leading = + - @ is neutralised so Sheets never runs it as a formula.
  const out = {};
  Object.keys(answers || {}).slice(0, 300).forEach(function (k) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(k) || HEADERS.part2.indexOf(k) >= 0 || k === 'pid') return;
    let v = answers[k];
    if (v === null || v === undefined) return;
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; return; }
    v = String(v).slice(0, MAX_TEXT);
    if (/^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = "'" + v;
    out[k] = v;
  });
  return out;
}

function formatPrice_(v) {
  const n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? String(v) : n.toFixed(2);
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function notify_(subject, body) {
  try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[Fit study] ' + subject, body); } catch (e) { console.error(e); }
}
