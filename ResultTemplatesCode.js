// ============================================================
// ResultTemplatesCode.gs
// X-Ray + Lab result generation using Google Doc templates
// Exports WORD (.docx) instead of PDF
// ============================================================

var XRAY_TEMPLATE_FOLDER   = 'A-Lab X-Ray Templates';
var XRAY_TEMPLATE_FILENAME = 'xray_result_template.docx';
var XRAY_RESULTS_FOLDER    = 'A-Lab Results';

// If your Google Workspace blocks public link sharing, this will be skipped safely.
var SHARE_GENERATED_SHEET_WITH_ANYONE_LINK = true;
var SHARE_GENERATED_SHEET_PERMISSION = 'EDIT';

// ── DRIVE ACCESS HELPERS ────────────────────────────────────
function getEffectiveUserEmail_() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function isProbablyEmail_(value) {
  value = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function extractDriveFileId_(urlOrId) {
  var value = String(urlOrId || '').trim();
  if (!value) return '';
  if (/^[A-Za-z0-9_-]{10,}$/.test(value) && value.indexOf('/') === -1) return value;
  var patterns = [
    /\/d\/([A-Za-z0-9_-]{10,})/,
    /[?&]id=([A-Za-z0-9_-]{10,})/,
    /\/folders\/([A-Za-z0-9_-]{10,})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = value.match(patterns[i]);
    if (m && m[1]) return m[1];
  }
  return '';
}

function applyGeneratedSheetSharing_(fileCopy, encodedBy) {
  var warnings = [];
  try {
    var email = String(encodedBy || '').trim();
    if (isProbablyEmail_(email)) fileCopy.addEditor(email);
  } catch (editorErr) {
    var msg = 'Could not add editor to generated sheet: ' + editorErr.message;
    Logger.log(msg); warnings.push(msg);
  }
  if (!SHARE_GENERATED_SHEET_WITH_ANYONE_LINK) return warnings.join(' ');
  try {
    var permission = String(SHARE_GENERATED_SHEET_PERMISSION || 'EDIT').toUpperCase() === 'VIEW'
      ? DriveApp.Permission.VIEW : DriveApp.Permission.EDIT;
    fileCopy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, permission);
  } catch (shareErr) {
    Logger.log('Could not set ANYONE_WITH_LINK sharing: ' + shareErr.message);
    try {
      if (String(SHARE_GENERATED_SHEET_PERMISSION || 'EDIT').toUpperCase() !== 'VIEW') {
        fileCopy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var fallbackMsg = 'Anyone-with-link EDIT was blocked, VIEW applied. Original error: ' + shareErr.message;
        Logger.log(fallbackMsg); warnings.push(fallbackMsg);
      } else {
        warnings.push('Anyone-with-link VIEW sharing was blocked. File generated but link-sharing not changed. ' + shareErr.message);
      }
    } catch (viewErr) {
      var skipMsg = 'Google Drive sharing skipped (Workspace restriction). File generated, link-sharing not changed. Error: ' + viewErr.message;
      Logger.log(skipMsg); warnings.push(skipMsg);
    }
  }
  return warnings.join(' ');
}

function getResultItemRowByType_(itemsSh, orderId, orderItemId, resultTypes) {
  if (!itemsSh || itemsSh.getLastRow() < 2) return -1;
  var typeSet = {};
  (resultTypes || []).forEach(function (t) { typeSet[String(t || '').trim()] = true; });
  if (Object.keys(typeSet).length === 0) return -1;
  var numCols = Math.max(itemsSh.getLastColumn(), 6);
  var rows = itemsSh.getRange(2, 1, itemsSh.getLastRow() - 1, numCols).getValues();
  var idx = rows.findIndex(function (r) {
    return String(r[1]).trim() === String(orderId).trim() &&
           String(r[2]).trim() === String(orderItemId).trim() &&
           typeSet[String(r[5] || '').trim()];
  });
  return idx === -1 ? -1 : idx + 2;
}

// ── TEMPLATE CONFIG (sections) ──────────────────────────────
function getXrayTemplateConfig() {
  try {
    var raw = getSettingValue_('xray_template_config', '');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    sections: [
      { id: 'clinical_data', label: 'CLINICAL DATA', required: false },
      { id: 'findings',      label: 'FINDINGS',      required: true  },
      { id: 'impression',    label: 'IMPRESSION',    required: true  }
    ]
  };
}

function saveXrayTemplateConfig(config) {
  try {
    var user = Session.getActiveUser().getEmail() || 'system';
    saveSystemSetting('xray_template_config', JSON.stringify(config), user);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function getLabEncodingMode() {
  return getSettingValue_('lab_encoding_mode', 'params');
}

function saveLabEncodingMode(mode) {
  try {
    var user = Session.getActiveUser().getEmail() || 'system';
    saveSystemSetting('lab_encoding_mode', mode === 'sheet_template' ? 'sheet_template' : 'params', user);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ── DRIVE HELPERS ───────────────────────────────────────────
function getDriveFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getXrayTemplateFile_() {
  var folder = getDriveFolder_(XRAY_TEMPLATE_FOLDER);
  var it = folder.getFilesByName(XRAY_TEMPLATE_FILENAME);
  return it.hasNext() ? it.next() : null;
}

// ── TEMPLATE INFO (for Configurations page) ─────────────────
function getXrayTemplateInfo() {
  var file = getXrayTemplateFile_();
  if (!file) {
    return { found: false, folderName: XRAY_TEMPLATE_FOLDER, filename: XRAY_TEMPLATE_FILENAME };
  }
  return {
    found:      true,
    folderName: XRAY_TEMPLATE_FOLDER,
    filename:   file.getName(),
    fileId:     file.getId(),
    updatedAt:  file.getLastUpdated().toISOString()
  };
}

// Removes trailing empty paragraphs and manual page breaks from the body.
function cleanupTrailingBodyWhitespace_(body) {
  if (!body) return;
  try {
    // Strip page breaks anywhere in the body
    var i = 0;
    while (i < body.getNumChildren()) {
      var child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        var para = child.asParagraph();
        for (var j = para.getNumChildren() - 1; j >= 0; j--) {
          var el = para.getChild(j);
          if (el.getType() === DocumentApp.ElementType.PAGE_BREAK) {
            try { el.removeFromParent(); } catch (e) {}
          }
        }
      }
      i++;
    }

    // Drop trailing empty paragraphs (best-effort)
    while (body.getNumChildren() > 1) {
      var lastIdx = body.getNumChildren() - 1;
      var last = body.getChild(lastIdx);
      if (last.getType() !== DocumentApp.ElementType.PARAGRAPH) break;

      var lpara = last.asParagraph();
      if (lpara.getText().trim() !== '') break;

      // Only remove plain empty paragraph (text-only)
      var isPlainEmpty = true;
      for (var k = 0; k < lpara.getNumChildren(); k++) {
        var t = lpara.getChild(k).getType();
        if (t !== DocumentApp.ElementType.TEXT) { isPlainEmpty = false; break; }
      }
      if (!isPlainEmpty) break;

      // Predecessor must be paragraph
      var prev = body.getChild(lastIdx - 1);
      if (prev.getType() !== DocumentApp.ElementType.PARAGRAPH) break;

      try { body.removeChild(last); } catch (e) { break; }
    }
  } catch (outerE) {
    Logger.log('cleanupTrailingBodyWhitespace_ ERROR: ' + outerE.message);
  }
}

// ── FORMAT DATE AS MM/DD/YYYY ────────────────────────────────
function formatShortDate_(dateVal) {
  if (!dateVal) return '';
  try {
    var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  } catch (e) { return String(dateVal); }
}

// ── REPLACE PLACEHOLDER THEN BOLD THE PARAGRAPH ─────────────
// Finds the paragraph(s) containing placeholder, replaces text, then bolds them.
function replaceThenBold_(body, placeholder, value) {
  var paraIndices = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH &&
        child.asParagraph().getText().indexOf(placeholder) !== -1) {
      paraIndices.push(i);
    }
  }
  body.replaceText(placeholder, value || '');
  paraIndices.forEach(function (idx) {
    try {
      var para = body.getChild(idx);
      if (para && para.getType() === DocumentApp.ElementType.PARAGRAPH) {
        para.editAsText().setBold(true);
      }
    } catch (e) {}
  });
}

// ── IMAGE PLACEHOLDER HELPER ─────────────────────────────────
// Replaces {{PLACEHOLDER}} with an inline image (signature).
// NOTE: This works best if placeholder is in its own paragraph.
function replaceWithImage_(container, placeholder, imageUrl) {
  var found = container.findText(placeholder);
  if (!found) return;
  if (!imageUrl) { container.replaceText(placeholder, ''); return; }

  try {
    // Extract Drive file ID from thumbnail URL or direct URL
    var fileId = null;
    var idMatch = imageUrl.match(/[?&]id=([^&]+)/);
    if (idMatch) {
      fileId = idMatch[1];
    } else {
      var pathMatch = imageUrl.match(/\/d\/([^\/]+)/);
      if (pathMatch) fileId = pathMatch[1];
    }

    var blob = fileId
      ? DriveApp.getFileById(fileId).getBlob()
      : UrlFetchApp.fetch(imageUrl).getBlob();

    var elem = found.getElement();      // usually TEXT
    var para = elem.getParent();        // usually PARAGRAPH
    var parent = para.getParent();      // BODY or FOOTER

    // Insert image before the paragraph that contains the placeholder
    var idx = parent.getChildIndex(para);
    var img = parent.insertImage(idx, blob);
    img.setWidth(150).setHeight(60);

    // Remove the original placeholder paragraph (now shifted +1)
    parent.removeChild(parent.getChild(idx + 1));
  } catch (e) {
    Logger.log('replaceWithImage_ ERROR [' + placeholder + ']: ' + e.message);
    container.replaceText(placeholder, '');
  }
}

// ── EXPORT GOOGLE DOC → WORD (.docx) ─────────────────────────
// Uses Drive export endpoint (no Advanced Drive service required)
function exportDocx_(googleDocId, baseName, targetFolder) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + googleDocId +
            '/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('DOCX export failed. HTTP ' + code + ': ' + resp.getContentText());
  }

  var blob = resp.getBlob().setName(baseName + '.docx');
  return targetFolder.createFile(blob);
}

// ── COMPACT TABLE STYLING (LAB) ─────────────────────────────
function styleCompactTable_(tbl, rowMeta, NUM_COLS) {
  var totalPts = 451;

  if (NUM_COLS === 2) {
    tbl.setColumnWidth(0, Math.round(totalPts * 0.55));
    tbl.setColumnWidth(1, Math.round(totalPts * 0.45));
  } else if (NUM_COLS === 3) {
    tbl.setColumnWidth(0, Math.round(totalPts * 0.45));
    tbl.setColumnWidth(1, Math.round(totalPts * 0.30));
    tbl.setColumnWidth(2, Math.round(totalPts * 0.25));
  } else {
    tbl.setColumnWidth(0, Math.round(totalPts * 0.38));
    tbl.setColumnWidth(1, Math.round(totalPts * 0.20));
    tbl.setColumnWidth(2, Math.round(totalPts * 0.17));
    tbl.setColumnWidth(3, Math.round(totalPts * 0.25));
  }

  for (var r = 0; r < tbl.getNumRows(); r++) {
    var row = tbl.getRow(r);
    var meta = rowMeta[r] || { type: 'data' };

    row.setMinimumHeight(1);

    // Thin dark divider row — simulates the header underline
    if (meta.type === 'divider') {
      for (var c = 0; c < NUM_COLS; c++) {
        var cell = row.getCell(c);
        cell.setBackgroundColor('#333333');
        cell.setPaddingTop(0);
        cell.setPaddingBottom(0);
        cell.setPaddingLeft(0);
        cell.setPaddingRight(0);
        cell.setAttributes({
          [DocumentApp.Attribute.BORDER_COLOR]: '#333333',
          [DocumentApp.Attribute.BORDER_WIDTH]: 0
        });
        cell.setText('');
      }
      continue;
    }

    for (var c = 0; c < NUM_COLS; c++) {
      var cell = row.getCell(c);

      cell.setBackgroundColor('#FFFFFF');
      cell.setPaddingTop(3);
      cell.setPaddingBottom(3);
      cell.setPaddingLeft(4);
      cell.setPaddingRight(4);

      // No borders on any cell
      cell.setAttributes({
        [DocumentApp.Attribute.BORDER_COLOR]: '#FFFFFF',
        [DocumentApp.Attribute.BORDER_WIDTH]: 0
      });

      for (var pi = 0; pi < cell.getNumChildren(); pi++) {
        var cp = cell.getChild(pi);
        if (cp.getType() === DocumentApp.ElementType.PARAGRAPH) {
          var p = cp.asParagraph();
          p.setSpacingBefore(0);
          p.setSpacingAfter(0);
          p.setLineSpacing(1.15);
        }
      }

      var txt = cell.editAsText();
      txt.setFontSize(11).setBold(false).setItalic(false);

      if (meta.type === 'thead') {
        txt.setBold(true);
      } else if (meta.type === 'header') {
        if (c === 0) txt.setBold(true);
        else cell.setText('');
      } else if (meta.type === 'subheader') {
        if (c === 0) txt.setItalic(true);
        else cell.setText('');
      } else if (meta.type === 'note') {
        txt.setItalic(true).setFontSize(10);
      } else if (meta.type === 'sublabel') {
        if (c === 0) txt.setItalic(true).setFontSize(10);
        else cell.setText('');
      } else if (meta.type === 'continuation') {
        // right-aligns the extra reference range line under col 0 and 1
        if (c === 0 || c === 1) cell.setText('');
      }
    }
  }

  tbl.setAttributes({
    [DocumentApp.Attribute.SPACING_BEFORE]: 0,
    [DocumentApp.Attribute.SPACING_AFTER]:  0
  });
}

// ───────────────────────────────────────────────────────────
//  X-RAY: GENERATE RESULT DOCX
// ───────────────────────────────────────────────────────────
function generateXrayResult(payload) {
  // payload: { patient, procedure, clinicalData, findings, impression,
  //            encodedBy, branchId, orderId, orderItemId, orderNo, reportDate }
  try {
    var rawTemplateDocId = getSettingValue_('xray_template_doc_id', '');
    var templateDocId = extractDriveFileId_(rawTemplateDocId) || String(rawTemplateDocId || '').trim();
    if (!templateDocId) {
      return {
        success: false,
        message: 'No X-Ray template configured. Go to Global Settings → X-Ray Result Template and paste your Google Doc link.'
      };
    }

    var templateFile;
    try {
      templateFile = DriveApp.getFileById(templateDocId);
    } catch (accessErr) {
      return {
        success: false,
        message: 'Cannot access the X-Ray template Google Doc. Share it with the script account: ' +
          getEffectiveUserEmail_() + '. Error: ' + accessErr.message
      };
    }
    if (templateFile.getMimeType() !== MimeType.GOOGLE_DOCS) {
      return {
        success: false,
        message: 'The template must be a Google Doc. If you uploaded .docx, open it and File → Save as Google Docs, then use that new link.'
      };
    }

    var p  = payload.patient || {};
    var reportDate = payload.reportDate || formatShortDate_(new Date());

    var replacements = {
      '{{PATIENT_NAME}}':     (p.name || '').toUpperCase(),
      '{{AGE}}':              p.age || '',
      '{{SEX}}':              (p.sex || '').toUpperCase(),
      '{{AGE_SEX}}':          (p.age || '') + '/' + (p.sex || '').toUpperCase(),
      '{{PATIENT_NO}}':       payload.orderNo || p.patient_no || p.patient_id || '',
      '{{BIRTHDATE}}':        p.birthdate ? formatShortDate_(p.birthdate) : '',
      '{{PHYSICIAN}}':        p.physician || '',
      '{{DATE}}':             reportDate,
      '{{SERVICE_NAME}}':     String(payload.procedure || '').toUpperCase(),
      '{{CLINICAL_DATA}}':    (payload.clinicalData || '').toUpperCase(),
      '{{FINDINGS}}':         payload.findings || ' ',
      '{{RADTECH_NAME}}':     p.radtech_name || '',
      '{{RADTECH_CRED}}':     p.radtech_cred || '',
      '{{RADIOLOGIST_NAME}}': p.radiologist_name || '',
      '{{RADIOLOGIST_CRED}}': p.radiologist_cred || ''
    };

    var safeProc = String(payload.procedure || 'RESULT').replace(/[^A-Za-z0-9 _-]/g, '').trim();
    var baseName = (payload.orderNo || payload.orderId || 'XRAY') + ' - ' + safeProc;

    // Copy template → fill placeholders
    var docCopy = templateFile.makeCopy(baseName + '_edit');
    var docDoc = DocumentApp.openById(docCopy.getId());
    var body = docDoc.getBody();

    Object.keys(replacements).forEach(function (ph) {
      body.replaceText(ph, replacements[ph] || '');
    });

    var footer = docDoc.getFooter();
    if (footer) {
      Object.keys(replacements).forEach(function (ph) {
        footer.replaceText(ph, replacements[ph] || '');
      });
    }

    // Bold the impression result
    replaceThenBold_(body, '{{IMPRESSION}}', payload.impression || ' ');

    // Signatures (body or footer)
    var c1 = (footer && footer.findText('{{RADTECH_SIGNATURE}}')) ? footer : body;
    replaceWithImage_(c1, '{{RADTECH_SIGNATURE}}', p.radtech_signature_url || '');

    var c2 = (footer && footer.findText('{{RADIOLOGIST_SIGNATURE}}')) ? footer : body;
    replaceWithImage_(c2, '{{RADIOLOGIST_SIGNATURE}}', p.radiologist_signature_url || '');

    cleanupTrailingBodyWhitespace_(body);
    docDoc.saveAndClose();

    // Determine target folder (patient folder under branch root if configured)
    var targetFolder = null;
    try {
      var drvCfg = getDriveFolderConfig(payload.branchId);
      var rootId = drvCfg && drvCfg.root_folder_id ? drvCfg.root_folder_id.trim() : '';
      rootId = extractDriveFileId_(rootId) || rootId;
      if (rootId) {
        var rootFolder = DriveApp.getFolderById(rootId);
        var folderName = p.name
          ? p.name.trim() + ' - ' + (p.patient_id || '').trim()
          : 'Patient - ' + (p.patient_id || '');
        var fq = rootFolder.getFoldersByName(folderName);
        targetFolder = fq.hasNext() ? fq.next() : rootFolder.createFolder(folderName);
      }
    } catch (e) {
      Logger.log('generateXrayResult: folder error: ' + e.message);
    }
    if (!targetFolder) targetFolder = getDriveFolder_(XRAY_RESULTS_FOLDER);

    // Export DOCX
    Utilities.sleep(1500);
    var docxFile = exportDocx_(docCopy.getId(), baseName, targetFolder);

    // Trash temp Google Doc copy
    try { docCopy.setTrashed(true); } catch (trashErr) { Logger.log('Could not trash temp X-Ray doc: ' + trashErr.message); }

    return {
      success: true,
      docxId: docxFile.getId(),
      docxUrl: docxFile.getUrl(),
      filename: baseName
    };
  } catch (e) {
    Logger.log('generateXrayResult ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SAVE X-RAY ENCODING: generate DOCX + record in RESULT_ITEMS + mark encoded ──
function saveXrayResultAndPdf(branchId, orderId, orderItemId, servId, servName,
                              clinicalData, findings, impression, encodedBy, orderNo) {
  // NOTE: Keeping function name for compatibility, but it now saves DOCX.
  try {
    if (!branchId || !orderId || !orderItemId)
      return { success: false, message: 'Missing required parameters.' };

    // 1) Patient info
    var ss     = getOrderSS_(branchId);
    var ordSh  = ss.getSheetByName('LAB_ORDER');
    var itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    var patient = {};

    if (ordSh && ordSh.getLastRow() >= 2) {
      var oCols = Math.max(ordSh.getLastColumn(), 20);
      var ordRow = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, oCols).getValues()
        .find(function (r) { return String(r[0]).trim() === orderId; });

      if (ordRow) {
        patient.name       = String(ordRow[11] || ordRow[3] || '').trim();
        patient.patient_id = String(ordRow[3] || '').trim();
        patient.physician  = String(ordRow[12] || '').trim();

        // Pull sex/dob/age from Patients sheet if available
        try {
          var masterSS = getSS_();
          var patSh = masterSS.getSheetByName('Patients_' + branchId) ||
                      masterSS.getSheetByName('Patients');
          if (!patSh) patSh = getOrderSS_(branchId).getSheetByName('Patients');

          if (patSh && patSh.getLastRow() >= 2) {
            var pRow = patSh.getRange(2, 1, patSh.getLastRow() - 1, 8).getValues()
              .find(function (r) { return String(r[0]).trim() === patient.patient_id; });

            if (pRow) {
              patient.name = String(pRow[1]).trim() + ', ' + String(pRow[2]).trim();
              patient.sex  = String(pRow[4] || '').trim();
              var dob = pRow[5] ? new Date(pRow[5]) : null;
              patient.birthdate = dob ? formatShortDate_(dob) : '';
              patient.age = dob ? Math.floor((new Date() - dob) / (365.25 * 24 * 3600 * 1000)) + '' : '';
            }
          }
        } catch (e) {}
      }
    }

    // 2) Radtech info (encoder)
    try {
      var techInfo = getTechInfo(encodedBy);
      if (techInfo && techInfo.success) {
        patient.radtech_name          = techInfo.name || '';
        patient.radtech_cred          = techInfo.credentials || '';
        patient.radtech_signature_url = techInfo.signature_url || '';
      }
    } catch (e) {}

    // 3) Radiologist (branch-level)
    try {
      var xraySig = getXraySignatures(branchId);
      if (xraySig && xraySig.success) {
        patient.radiologist_name          = xraySig.radiologist ? xraySig.radiologist.name : '';
        patient.radiologist_cred          = xraySig.radiologist ? xraySig.radiologist.credentials : '';
        patient.radiologist_signature_url = xraySig.radiologist ? (xraySig.radiologist.signature_url || '') : '';
      }
    } catch (e) {}

    // 4) Generate DOCX
    var gen = generateXrayResult({
      patient:      patient,
      procedure:    servName || servId,
      clinicalData: clinicalData || '',
      findings:     findings || '',
      impression:   impression || '',
      encodedBy:    encodedBy,
      branchId:     branchId,
      orderId:      orderId,
      orderItemId:  orderItemId,
      orderNo:      orderNo || orderId,
      reportDate:   formatShortDate_(new Date())
    });

    if (!gen.success) return { success: false, message: gen.message || 'DOCX generation failed.' };

    // 5) Save to RESULT_ITEMS (use XRAY_DOCX)
    var itemsSh = _getResultItemsSheet_(ss);
    var existingRow = getResultItemRowByType_(itemsSh, orderId, orderItemId, ['XRAY_DOCX', 'XRAY_PDF']);

    if (existingRow !== -1) {
      itemsSh.getRange(existingRow, 5, 1, 10)
        .setValues([[gen.docxUrl, 'XRAY_DOCX', '', '', encodedBy, new Date(), 'xray', clinicalData || '', findings || '', impression || '']]);
    } else {
      var rid = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      itemsSh.appendRow([
        rid,
        orderId,
        orderItemId,
        servName || 'X-Ray Result',
        gen.docxUrl,
        'XRAY_DOCX',
        '',
        '',
        encodedBy,
        new Date(),
        'xray',
        clinicalData || '',
        findings || '',
        impression || ''
      ]);
    }

    // 6) Mark encoded_at on LAB_ORDER_ITEM col 16
    if (itemSh && itemSh.getLastRow() >= 2) {
      ensureItemCols_(itemSh);
      var iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, 2).getValues();
      var iIdx = iRows.findIndex(function (r) {
        return String(r[0]).trim() === orderItemId && String(r[1]).trim() === orderId;
      });
      if (iIdx !== -1) itemSh.getRange(iIdx + 2, 16).setValue(new Date());
    }

    // 7) Auto-advance order status
    var progress = _checkOrderProgress_(ss, itemSh, orderId, branchId);

    return { success: true, docxUrl: gen.docxUrl, order_status: progress.newStatus };
  } catch (e) {
    Logger.log('saveXrayResultAndPdf ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  LAB RESULT DOCX GENERATION
//  Uses lab_template_doc_id (Google Doc) and inserts a results table.
// ════════════════════════════════════════════════════════════════
function generateLabResult(payload) {
  // payload: { patient, serviceName, params:[...], encodedBy, branchId, orderId, orderItemId, orderNo, reportDate }
  try {
    var rawTemplateDocId = getSettingValue_('lab_template_doc_id', '');
    var templateDocId = extractDriveFileId_(rawTemplateDocId) || String(rawTemplateDocId || '').trim();
    if (!templateDocId) {
      return {
        success: false,
        message: 'No Lab Result template configured. Go to Global Settings → Lab Result Template and paste your Google Doc link.'
      };
    }

    var templateFile;
    try {
      templateFile = DriveApp.getFileById(templateDocId);
    } catch (accessErr) {
      return {
        success: false,
        message: 'Cannot access the Lab template Google Doc. Share it with the script account: ' +
          getEffectiveUserEmail_() + '. Error: ' + accessErr.message
      };
    }
    if (templateFile.getMimeType() !== MimeType.GOOGLE_DOCS) {
      return {
        success: false,
        message: 'The lab template must be a Google Doc (not .docx). Open it → File > Save as Google Docs, then use that link.'
      };
    }

    var p   = payload.patient || {};
    var now = payload.reportDate || formatShortDate_(new Date());

    var replacements = {
      '{{PATIENT_NAME}}':     (p.name || '').toUpperCase(),
      '{{AGE}}':              p.age || '',
      '{{SEX}}':              (p.sex || '').toUpperCase(),
      '{{AGE_SEX}}':          (p.age || '') + (p.sex ? '/' + (p.sex || '').toUpperCase() : ''),
      '{{PATIENT_NO}}':       payload.orderNo || p.patient_no || p.patient_id || '',
      '{{BIRTHDATE}}':        p.birthdate ? formatShortDate_(p.birthdate) : '',
      '{{PHYSICIAN}}':        p.physician || '',
      '{{DATE}}':             now,
      '{{SERVICE_NAME}}':     String(payload.serviceName || '').toUpperCase(),
      '{{MEDTECH_NAME}}':         p.medtech_name || '',
      '{{MEDTECH_CRED}}':         p.medtech_cred || '',
      '{{MEDTECH_LICENSE}}':      p.medtech_license_no || '',
      '{{PATHOLOGIST_NAME}}':     p.pathologist_name || '',
      '{{PATHOLOGIST_CRED}}':     p.pathologist_cred || '',
      '{{PATHOLOGIST_LICENSE}}':  p.pathologist_license_no || ''
    };

    var safeService = String(payload.serviceName || 'LAB').replace(/[^A-Za-z0-9 _-]/g, '').trim();
    var baseName = (payload.orderNo || payload.orderId || 'LAB') + ' - ' + safeService;

    // Clone template
    var docCopy = templateFile.makeCopy(baseName + '_edit');
    var docDoc  = DocumentApp.openById(docCopy.getId());
    var body    = docDoc.getBody();

    // Replace placeholders (body + footer)
    Object.keys(replacements).forEach(function (ph) {
      body.replaceText(ph, replacements[ph] || '');
    });

    var footer = docDoc.getFooter();
    if (footer) {
      Object.keys(replacements).forEach(function (ph) {
        footer.replaceText(ph, replacements[ph] || '');
      });
    }

    // Find {{RESULTS_TABLE}} paragraph index
    var params = payload.params || [];
    var tableIdx = -1;
    for (var i = 0; i < body.getNumChildren(); i++) {
      var child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        var t = child.asParagraph().getText();
        if (t.indexOf('{{RESULTS_TABLE}}') !== -1) {
          tableIdx = i;
          break;
        }
      }
    }

    if (tableIdx !== -1) {
      // Dynamic columns: only include Unit/RefRange if present
      // Exclude structural/non-data row types from column detection
      var dataParams = params.filter(function (pp) {
        var ft = pp.field_type || 'numeric';
        return ft !== 'header' && ft !== 'subheader' && ft !== 'note';
      });

      var hasUnit = dataParams.some(function (pp) { return (pp.unit || '').trim() !== ''; });
      var hasRef  = dataParams.some(function (pp) { return (pp.reference_range || '').trim() !== ''; });

      var colHeaders = ['TEST', 'RESULT'];
      if (hasUnit) colHeaders.push('UNIT');
      if (hasRef)  colHeaders.push('REFERENCE RANGE');
      var NUM_COLS = colHeaders.length;

      var allRows = [colHeaders];
      var rowMeta = [{ type: 'thead' }];

      // Thin divider row after the header — acts as a horizontal rule
      var divRow = [];
      for (var di = 0; di < NUM_COLS; di++) divRow.push('');
      allRows.push(divRow);
      rowMeta.push({ type: 'divider' });

      params.forEach(function (pp) {
        var ft = pp.field_type || 'numeric';

        // ── Section headers ──────────────────────────────────────
        if (ft === 'header') {
          var hRow = [(pp.param_name || '').toUpperCase()];
          for (var k = 1; k < NUM_COLS; k++) hRow.push('');
          allRows.push(hRow);
          rowMeta.push({ type: 'header' });

        // ── Sub-headers (italic, not uppercased) ─────────────────
        } else if (ft === 'subheader') {
          var shRow = [pp.param_name || ''];
          for (var k = 1; k < NUM_COLS; k++) shRow.push('');
          allRows.push(shRow);
          rowMeta.push({ type: 'subheader' });

        // ── Note / computation rows (italic, spans cols 0-1) ─────
        } else if (ft === 'note') {
          var nRow = [pp.param_name || '', pp.result_value || ''];
          for (var k = 2; k < NUM_COLS; k++) nRow.push('');
          allRows.push(nRow);
          rowMeta.push({ type: 'note' });

        // ── Data rows: numeric / text / select ───────────────────
        } else {
          var indent  = pp.indent || 0;
          var prefix  = indent > 0 ? new Array(indent * 5 + 1).join(' ') : '';
          var resultVal = pp.result_value || pp.default_value || '';

          // Multi-line reference ranges (e.g. FEMALE …\nMALE …)
          var refLines = (pp.reference_range || '').split('\n');
          var firstRef = refLines[0] || '';

          var dRow = [prefix + (pp.param_name || ''), resultVal];
          if (hasUnit) dRow.push(pp.unit || '');
          if (hasRef)  dRow.push(firstRef);
          allRows.push(dRow);
          rowMeta.push({ type: 'data', indent: indent, field_type: ft });

          // Continuation rows for multi-line reference ranges
          for (var ri = 1; ri < refLines.length; ri++) {
            var contRow = ['', ''];
            if (hasUnit) contRow.push('');
            if (hasRef)  contRow.push(refLines[ri]);
            allRows.push(contRow);
            rowMeta.push({ type: 'continuation' });
          }

          // Optional sub-label row (italic, below the data row)
          if (pp.sub_label) {
            var slRow = [pp.sub_label];
            for (var k = 1; k < NUM_COLS; k++) slRow.push('');
            allRows.push(slRow);
            rowMeta.push({ type: 'sublabel' });
          }
        }
      });

      // Remove placeholder paragraph and insert table
      body.removeChild(body.getChild(tableIdx));
      var tbl = body.insertTable(tableIdx, allRows);
      styleCompactTable_(tbl, rowMeta, NUM_COLS);

      // Remove a leftover "Test" paragraph if template has one under placeholder
      var pos = body.getChildIndex(tbl);
      if (pos + 1 < body.getNumChildren()) {
        var next = body.getChild(pos + 1);
        if (next.getType() === DocumentApp.ElementType.PARAGRAPH) {
          var nt = next.asParagraph().getText().trim();
          if (nt === 'Test' || nt === '') {
            try { body.removeChild(next); } catch (e) {}
          }
        }
      }
    }

    // Signatures (body or footer)
    var sigC1 = (footer && footer.findText('{{MEDTECH_SIGNATURE}}')) ? footer : body;
    replaceWithImage_(sigC1, '{{MEDTECH_SIGNATURE}}', p.medtech_signature_url || '');

    var sigC2 = (footer && footer.findText('{{PATHOLOGIST_SIGNATURE}}')) ? footer : body;
    replaceWithImage_(sigC2, '{{PATHOLOGIST_SIGNATURE}}', p.pathologist_signature_url || '');

    cleanupTrailingBodyWhitespace_(body);
    docDoc.saveAndClose();

    // Determine patient folder
    var targetFolder = null;
    try {
      var drvCfg = getDriveFolderConfig(payload.branchId);
      var rootId = drvCfg && drvCfg.root_folder_id ? drvCfg.root_folder_id.trim() : '';
      rootId = extractDriveFileId_(rootId) || rootId;
      if (rootId) {
        var rootFolder = DriveApp.getFolderById(rootId);
        var folderName = p.name
          ? p.name.trim() + ' - ' + (p.patient_id || '').trim()
          : 'Patient - ' + (p.patient_id || '');
        var fq = rootFolder.getFoldersByName(folderName);
        targetFolder = fq.hasNext() ? fq.next() : rootFolder.createFolder(folderName);
      }
    } catch (e) {
      Logger.log('generateLabResult: folder error: ' + e.message);
    }
    if (!targetFolder) targetFolder = getDriveFolder_('A-Lab Results');

    // Export DOCX
    Utilities.sleep(1500);
    var docxFile = exportDocx_(docCopy.getId(), baseName, targetFolder);

    // Trash temporary Google Doc copy
    try { docCopy.setTrashed(true); } catch (trashErr) { Logger.log('Could not trash temp Lab doc: ' + trashErr.message); }

    return {
      success: true,
      docxId: docxFile.getId(),
      docxUrl: docxFile.getUrl(),
      filename: baseName
    };
  } catch (e) {
    Logger.log('generateLabResult ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SAVE LAB ENCODING: generate DOCX → record in RESULT_ITEMS ──
// ── GENERATE SHEET TEMPLATE FOR PATIENT ───────────────────────
function generateSheetTemplate(branchId, orderId, orderItemId, encodedBy) {
  try {
    if (!branchId || !orderId || !orderItemId)
      return { success: false, message: 'Missing required parameters.' };

    var ss     = getOrderSS_(branchId);
    var ordSh  = ss.getSheetByName('LAB_ORDER');
    var itemSh = ss.getSheetByName('LAB_ORDER_ITEM');

    // ── Get order + patient info ──────────────────────────────
    var patient = {}, orderDate = '', orderNo = '', doctorName = '', servId = '', servName = '';
    if (ordSh && ordSh.getLastRow() >= 2) {
      var oCols = Math.max(ordSh.getLastColumn(), 20);
      var ordRow = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, oCols).getValues()
        .find(function(r) { return String(r[0]).trim() === orderId; });
      if (ordRow) {
        patient.id   = String(ordRow[3] || '').trim();
        orderDate    = ordRow[4] ? Utilities.formatDate(new Date(ordRow[4]), Session.getScriptTimeZone(), 'MMMM dd, yyyy') : '';
        orderNo      = String(ordRow[1] || '').trim();
        doctorName   = String(ordRow[12] || '').trim();
      }
    }
    if (itemSh && itemSh.getLastRow() >= 2) {
      var iCols = Math.max(itemSh.getLastColumn(), 10);
      var itemRow = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, iCols).getValues()
        .find(function(r) { return String(r[0]).trim() === orderItemId && String(r[1]).trim() === orderId; });
      if (itemRow) {
        servId   = String(itemRow[2] || '').trim();
        servName = String(itemRow[4] || '').trim();
      }
    }

    // ── Get patient demographics ──────────────────────────────
    var mss = getSS_();
    var patSh = mss.getSheetByName('Patients_' + branchId) ||
                mss.getSheetByName('Patients') ||
                ss.getSheetByName('Patients');
    if (patSh && patient.id && patSh.getLastRow() >= 2) {
      var pCols = Math.max(patSh.getLastColumn(), 8);
      var patRow = patSh.getRange(2, 1, patSh.getLastRow() - 1, pCols).getValues()
        .find(function(r) { return String(r[0]).trim() === patient.id; });
      if (patRow) {
        patient.name = (String(patRow[1] || '').trim() + ', ' + String(patRow[2] || '').trim()).replace(/,\s*$/, '').trim();
        patient.sex  = String(patRow[4] || '').trim();
        patient.dob  = patRow[5];
        if (patient.dob) {
          var diff = Date.now() - new Date(patient.dob).getTime();
          patient.age  = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000)) + ' yrs';
        }
      }
    }

    // ── Get service template URL ──────────────────────────────
    var templateUrl = '';
    var labServSh = mss.getSheetByName('Lab_Services') || mss.getSheetByName('LAB_SERVICES');
    if (labServSh && servId && labServSh.getLastRow() >= 2) {
      var lRows = labServSh.getRange(2, 1, labServSh.getLastRow() - 1, 12).getValues();
      var lRow = lRows.find(function(r) { return String(r[0]).trim() === servId; });
      if (lRow) templateUrl = String(lRow[11] || '').trim();
    }
    if (!templateUrl) return { success: false, message: 'No sheet template configured for this service. Please add a template URL in Branch Settings → MedTech Sheet Templates.' };

    // ── Extract file ID from URL ──────────────────────────────
    var fileId = extractDriveFileId_(templateUrl);
    if (!fileId) return { success: false, message: 'Invalid template URL format. Please use a valid Google Sheets link.' };

    // ── Copy the template ─────────────────────────────────────
    var templateFile;
    try {
      templateFile = DriveApp.getFileById(fileId);
    } catch(accessErr) {
      return { success: false, message: 'Cannot access the service template file. Share it with the script account: ' +
        getEffectiveUserEmail_() + ' (at least Viewer access), then try again. Error: ' + accessErr.message };
    }
    if (templateFile.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      return { success: false, message: 'The service template must be a Google Sheet. Open the file and convert/save it as Google Sheets, then use that Google Sheets link.' };
    }
    var copyName = (patient.name || patient.id || 'Patient') + ' — ' + (servName || servId);

    // ── Find / create patient folder ──────────────────────────
    var targetFolder = null;
    var warnings = [];
    try {
      var drvCfg = getDriveFolderConfig(branchId);
      var rootId = drvCfg && drvCfg.root_folder_id ? drvCfg.root_folder_id.trim() : '';
      rootId = extractDriveFileId_(rootId) || rootId;
      if (rootId) {
        var rootFolder = DriveApp.getFolderById(rootId);
        var folderName = patient.name ? patient.name.trim() + ' - ' + (patient.id || '') : 'Patient - ' + (patient.id || '');
        var fq = rootFolder.getFoldersByName(folderName);
        targetFolder = fq.hasNext() ? fq.next() : rootFolder.createFolder(folderName);
      }
    } catch(folderErr) {
      var folderMsg = 'Could not access/create patient folder. File copied to script owner My Drive. Error: ' + folderErr.message;
      Logger.log(folderMsg); warnings.push(folderMsg);
    }

    var fileCopy;
    try {
      fileCopy = targetFolder ? templateFile.makeCopy(copyName, targetFolder) : templateFile.makeCopy(copyName);
    } catch(copyErr) {
      return { success: false, message: 'Cannot copy the service template. Make sure the script account has access. Script account: ' +
        getEffectiveUserEmail_() + '. Error: ' + copyErr.message };
    }

    var spreadsheet;
    try {
      spreadsheet = SpreadsheetApp.openById(fileCopy.getId());
    } catch(openErr) {
      try { fileCopy.setTrashed(true); } catch(trashErr) {}
      return { success: false, message: 'The copied template could not be opened as a Google Sheet. Error: ' + openErr.message };
    }

    // ── Replace placeholders across all sheets ────────────────
    var todayFormatted = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy');
    var placeholders = {
      '{{PATIENT_NAME}}' : patient.name      || '',
      '{{PATIENT_ID}}'   : patient.id        || '',
      '{{AGE}}'          : patient.age       || '',
      '{{SEX}}'          : patient.sex       || '',
      '{{BIRTHDATE}}'    : patient.dob ? Utilities.formatDate(new Date(patient.dob), Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
      '{{ORDER_NO}}'     : orderNo           || '',
      '{{ORDER_DATE}}'   : orderDate         || '',
      '{{DOCTOR}}'       : doctorName        || '',
      '{{SERVICE}}'      : servName          || '',
      '{{DATE_TODAY}}'   : todayFormatted,
      '{{DATE}}'         : todayFormatted
    };
    spreadsheet.getSheets().forEach(function(sheet) {
      Object.keys(placeholders).forEach(function(key) {
        sheet.createTextFinder(key).replaceAllWith(placeholders[key]);
      });
    });
    SpreadsheetApp.flush();

    // ── Set sharing safely (won't fail if Workspace blocks it) ─
    var sharingWarning = applyGeneratedSheetSharing_(fileCopy, encodedBy);
    if (sharingWarning) warnings.push(sharingWarning);
    var sheetUrl = fileCopy.getUrl();

    // ── Save to RESULT_ITEMS ──────────────────────────────────
    var riSh = _getResultItemsSheet_(ss);
    var riLr = riSh.getLastRow();
    var resultItemId = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
    var now = new Date();
    // Check for existing SHEET_TEMPLATE row
    var existingRowIdx = -1;
    if (riLr >= 2) {
      var riRows = riSh.getRange(2, 1, riLr - 1, 6).getValues();
      existingRowIdx = riRows.findIndex(function(r) {
        return String(r[1]).trim() === orderId &&
               String(r[2]).trim() === orderItemId &&
               String(r[5]).trim() === 'SHEET_TEMPLATE';
      });
    }
    if (existingRowIdx !== -1) {
      var shRow = existingRowIdx + 2;
      riSh.getRange(shRow, 5).setValue(sheetUrl);
      riSh.getRange(shRow, 9).setValue(encodedBy);
      riSh.getRange(shRow, 10).setValue(now);
    } else {
      riSh.appendRow([resultItemId, orderId, orderItemId, servName, sheetUrl, 'SHEET_TEMPLATE', '', '', encodedBy, now]);
    }

    Logger.log('generateSheetTemplate: ' + sheetUrl);
    var response = { success: true, sheetUrl: sheetUrl };
    if (warnings.length) response.warning = warnings.join(' ');
    return response;

  } catch (e) {
    Logger.log('generateSheetTemplate ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

function saveLabResultAndPdf(branchId, orderId, orderItemId, servId, servName, params, encodedBy, orderNo) {
  // NOTE: Keeping function name for compatibility, but it now saves DOCX.
  try {
    if (!branchId || !orderId || !orderItemId)
      return { success: false, message: 'Missing required parameters.' };

    var ss     = getOrderSS_(branchId);
    var ordSh  = ss.getSheetByName('LAB_ORDER');
    var itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    var patient = {};

    // Pull patient info from order
    if (ordSh && ordSh.getLastRow() >= 2) {
      var oCols = Math.max(ordSh.getLastColumn(), 20);
      var ordRow = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, oCols).getValues()
        .find(function (r) { return String(r[0]).trim() === orderId; });

      if (ordRow) {
        patient.name       = String(ordRow[11] || ordRow[3] || '').trim();
        patient.patient_id = String(ordRow[3] || '').trim();
        patient.physician  = String(ordRow[12] || '').trim();

        // Pull sex/dob/age from Patients sheet
        try {
          var masterSS = getSS_();
          var patSh = masterSS.getSheetByName('Patients_' + branchId) ||
                      masterSS.getSheetByName('Patients');
          if (!patSh) patSh = getOrderSS_(branchId).getSheetByName('Patients');

          if (patSh && patSh.getLastRow() >= 2) {
            var pRow = patSh.getRange(2, 1, patSh.getLastRow() - 1, 8).getValues()
              .find(function (r) { return String(r[0]).trim() === patient.patient_id; });

            if (pRow) {
              patient.name = String(pRow[1]).trim() + ', ' + String(pRow[2]).trim();
              patient.sex  = String(pRow[4] || '').trim();
              var dob = pRow[5] ? new Date(pRow[5]) : null;
              patient.birthdate = dob ? formatShortDate_(dob) : '';
              patient.age = dob ? Math.floor((new Date() - dob) / (365.25 * 24 * 3600 * 1000)) + '' : '';
            }
          }
        } catch (e) {}
      }
    }

    // Tech info (encoder)
    try {
      var techInfo = getTechInfo(encodedBy);
      if (techInfo && techInfo.success) {
        patient.medtech_name          = techInfo.name || '';
        patient.medtech_cred          = techInfo.credentials || '';
        patient.medtech_license_no    = techInfo.license_no || '';
        patient.medtech_signature_url = techInfo.signature_url || '';
      }
    } catch (e) {}

    // Pathologist (branch-level)
    try {
      var labSig = getLabSignatures(branchId);
      if (labSig && labSig.success) {
        patient.pathologist_name          = labSig.pathologist ? labSig.pathologist.name : '';
        patient.pathologist_cred          = labSig.pathologist ? labSig.pathologist.credentials : '';
        patient.pathologist_license_no    = labSig.pathologist ? (labSig.pathologist.license_no || '') : '';
        patient.pathologist_signature_url = labSig.pathologist ? (labSig.pathologist.signature_url || '') : '';
      }
    } catch (e) {}

    // Generate DOCX
    var gen = generateLabResult({
      patient:     patient,
      serviceName: servName || servId,
      params:      params || [],
      encodedBy:   encodedBy,
      branchId:    branchId,
      orderId:     orderId,
      orderItemId: orderItemId,
      orderNo:     orderNo || orderId,
      reportDate:  formatShortDate_(new Date())
    });
    if (!gen.success) return { success: false, message: gen.message || 'DOCX generation failed.' };

    // Save URL to RESULT_ITEMS (unit=LAB_DOCX)
    var itemsSh = _getResultItemsSheet_(ss);
    var existingRow = getResultItemRowByType_(itemsSh, orderId, orderItemId, ['LAB_DOCX', 'LAB_PDF']);

    if (existingRow !== -1) {
      itemsSh.getRange(existingRow, 5, 1, 6)
        .setValues([[gen.docxUrl, 'LAB_DOCX', '', '', encodedBy, new Date()]]);
    } else {
      var rid = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      itemsSh.appendRow([rid, orderId, orderItemId, servName || 'Lab Result', gen.docxUrl, 'LAB_DOCX', '', '', encodedBy, new Date()]);
    }

    // Cache raw param values so the combined bundle renderer can re-use them
    // without reopening each per-item DOCX. Safe no-op on failure.
    try { saveLabItemRawValues_(branchId, orderId, orderItemId, params || []); }
    catch (e) { Logger.log('saveLabItemRawValues_ call failed: ' + e.message); }

    // Mark encoded
    if (itemSh && itemSh.getLastRow() >= 2) {
      ensureItemCols_(itemSh);
      var iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, 2).getValues();
      var iIdx  = iRows.findIndex(function (r) {
        return String(r[0]).trim() === orderItemId && String(r[1]).trim() === orderId;
      });
      if (iIdx !== -1) itemSh.getRange(iIdx + 2, 16).setValue(new Date());
    }

    var progress = _checkOrderProgress_(ss, itemSh, orderId, branchId);
    return { success: true, docxUrl: gen.docxUrl, order_status: progress.newStatus };
  } catch (e) {
    Logger.log('saveLabResultAndPdf ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── DELETE ITEM RESULT ──────────────────────────────────────────
// Trashes the existing result file from Drive, clears the RESULT_ITEMS row,
// and resets encoded_at on LAB_ORDER_ITEM so the tech can re-encode.
// Returns previous xray fields for pre-fill on re-edit.
function deleteItemResult(branchId, orderId, orderItemId) {
  try {
    if (!branchId || !orderId || !orderItemId)
      return { success: false, message: 'Missing parameters.' };

    var ss  = getOrderSS_(branchId);
    var rSh = _getResultItemsSheet_(ss);
    if (rSh.getLastRow() < 2) return { success: false, message: 'No result found.' };

    var numCols = Math.max(rSh.getLastColumn(), 14);
    var rows = rSh.getRange(2, 1, rSh.getLastRow() - 1, numCols).getValues();
    var idx = rows.findIndex(function (r) {
      return String(r[1]).trim() === orderId &&
             String(r[2]).trim() === orderItemId &&
             String(r[5] || '').trim() !== 'SHEET_TEMPLATE';
    });
    if (idx === -1) return { success: false, message: 'Result not found.' };

    var row = rows[idx];
    var fileUrl = String(row[4] || '').trim(); // same column used for pdf/docx
    var prevCD = String(row[11] || '').trim();
    var prevFN = String(row[12] || '').trim();
    var prevIM = String(row[13] || '').trim();

    // Trash the Drive file
    if (fileUrl) {
      try {
        var fileIdToTrash = extractDriveFileId_(fileUrl);
        if (fileIdToTrash) DriveApp.getFileById(fileIdToTrash).setTrashed(true);
      } catch (e) {
        Logger.log('deleteItemResult: could not trash file: ' + e.message);
      }
    }

    // Clear cols 5-14 (10 columns)
    var clearCols = [];
    for (var i = 0; i < 10; i++) clearCols.push('');
    rSh.getRange(idx + 2, 5, 1, 10).setValues([clearCols]);

    // Reset encoded_at col 16 on LAB_ORDER_ITEM
    var itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    if (itemSh && itemSh.getLastRow() >= 2) {
      var iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, 2).getValues();
      var iIdx = iRows.findIndex(function (r) {
        return String(r[0]).trim() === orderItemId && String(r[1]).trim() === orderId;
      });
      if (iIdx !== -1) itemSh.getRange(iIdx + 2, 16).setValue('');
    }

    writeAuditLog_('RESULT_DELETED', { branch_id: branchId, order_id: orderId, item_id: orderItemId });
    return { success: true, clinical_data: prevCD, findings: prevFN, impression: prevIM };
  } catch (e) {
    Logger.log('deleteItemResult ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  PHASE 3a — PARAMS-ONLY SAVES (no Drive write)
//
//  The new Tech Dashboard flow splits "Save & Generate PDF" into two
//  steps: (1) Save params + mark encoded, then (2) review on the
//  Preview Result tab and click "Save to Drive" to generate the
//  combined .docx. The functions below cover step 1 — they persist
//  the encoded data to the per-order sheet but do NOT touch Drive.
//
//  Drive generation is still handled by the existing
//  generateLabResultsBundle / generateXrayResult helpers, called from
//  the new generateOrderResultDrive_ orchestrator below (Phase 3b
//  will rewrite those to build .docx files programmatically from
//  Template Settings).
// ════════════════════════════════════════════════════════════════

function saveLabResultParamsOnly(branchId, orderId, orderItemId, servId, servName, params, encodedBy) {
  try {
    if (!branchId || !orderId || !orderItemId)
      return { success: false, message: 'Missing required parameters.' };

    var ss      = getOrderSS_(branchId);
    var itemSh  = ss.getSheetByName('LAB_ORDER_ITEM');
    var itemsSh = _getResultItemsSheet_(ss);

    // Ensure raw_values_json column exists on RESULT_ITEMS (col K, idx 10)
    if (itemsSh.getLastColumn() < 11) {
      itemsSh.getRange(1, 11).setValue('raw_values_json');
    }

    var rawJson = JSON.stringify(params || []);

    // Find an existing LAB_DOCX / LAB_PDF row to update (preserving its url
    // if the tech is re-encoding after a Drive save). Otherwise create a
    // placeholder row with empty url.
    var existingRow = getResultItemRowByType_(itemsSh, orderId, orderItemId, ['LAB_DOCX', 'LAB_PDF']);
    if (existingRow !== -1) {
      // Keep url + encoded_by intact; refresh the raw_values JSON, label,
      // unit, and timestamp. Caller may later regenerate the .docx.
      itemsSh.getRange(existingRow, 4).setValue(servName || 'Lab Result');
      itemsSh.getRange(existingRow, 6).setValue('LAB_DOCX');
      itemsSh.getRange(existingRow, 9).setValue(encodedBy || '');
      itemsSh.getRange(existingRow, 10).setValue(new Date());
      itemsSh.getRange(existingRow, 11).setValue(rawJson);
    } else {
      var rid = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      itemsSh.appendRow([
        rid, orderId, orderItemId, servName || 'Lab Result',
        '',           // url — Drive write happens later via Save to Drive
        'LAB_DOCX', '', '',
        encodedBy || '', new Date(),
        rawJson
      ]);
    }

    // Mark encoded_at on LAB_ORDER_ITEM
    if (itemSh && itemSh.getLastRow() >= 2) {
      ensureItemCols_(itemSh);
      var iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, 2).getValues();
      var iIdx  = iRows.findIndex(function (r) {
        return String(r[0]).trim() === orderItemId && String(r[1]).trim() === orderId;
      });
      if (iIdx !== -1) itemSh.getRange(iIdx + 2, 16).setValue(new Date());
    }

    var progress = _checkOrderProgress_(ss, itemSh, orderId, branchId);
    return { success: true, order_status: progress.newStatus };
  } catch (e) {
    Logger.log('saveLabResultParamsOnly ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

function saveXrayResultParamsOnly(branchId, orderId, orderItemId, servId, servName,
                                  clinicalData, findings, impression, encodedBy) {
  try {
    if (!branchId || !orderId || !orderItemId)
      return { success: false, message: 'Missing required parameters.' };

    var ss      = getOrderSS_(branchId);
    var itemSh  = ss.getSheetByName('LAB_ORDER_ITEM');
    var itemsSh = _getResultItemsSheet_(ss);

    var existingRow = getResultItemRowByType_(itemsSh, orderId, orderItemId, ['XRAY_DOCX', 'XRAY_PDF']);
    if (existingRow !== -1) {
      // Update the 3 narrative fields + label + encoded_by; preserve url.
      itemsSh.getRange(existingRow, 4).setValue(servName || 'X-Ray Result');
      itemsSh.getRange(existingRow, 6).setValue('XRAY_DOCX');
      itemsSh.getRange(existingRow, 9).setValue(encodedBy || '');
      itemsSh.getRange(existingRow, 10).setValue(new Date());
      itemsSh.getRange(existingRow, 11).setValue('xray');
      itemsSh.getRange(existingRow, 12).setValue(clinicalData || '');
      itemsSh.getRange(existingRow, 13).setValue(findings || '');
      itemsSh.getRange(existingRow, 14).setValue(impression || '');
    } else {
      var rid = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      itemsSh.appendRow([
        rid, orderId, orderItemId, servName || 'X-Ray Result',
        '',           // url — Drive write happens later via Save to Drive
        'XRAY_DOCX', '', '',
        encodedBy || '', new Date(),
        'xray',
        clinicalData || '', findings || '', impression || ''
      ]);
    }

    if (itemSh && itemSh.getLastRow() >= 2) {
      ensureItemCols_(itemSh);
      var iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, 2).getValues();
      var iIdx  = iRows.findIndex(function (r) {
        return String(r[0]).trim() === orderItemId && String(r[1]).trim() === orderId;
      });
      if (iIdx !== -1) itemSh.getRange(iIdx + 2, 16).setValue(new Date());
    }

    var progress = _checkOrderProgress_(ss, itemSh, orderId, branchId);
    return { success: true, order_status: progress.newStatus };
  } catch (e) {
    Logger.log('saveXrayResultParamsOnly ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ─── PHASE 3a — ORDER-LEVEL "SAVE TO DRIVE" ORCHESTRATOR ────────
// Generates the combined lab .docx (via existing generateLabResultsBundle)
// and per-X-Ray .docx files (via existing saveXrayResultAndPdf logic).
// Returns a summary the client uses to update the Preview Result tab.
function generateOrderResultDrive(branchId, orderId, encodedBy) {
  try {
    if (!branchId || !orderId)
      return { success: false, message: 'branchId and orderId required.' };

    var ss      = getOrderSS_(branchId);
    var itemSh  = ss.getSheetByName('LAB_ORDER_ITEM');
    var itemsSh = _getResultItemsSheet_(ss);
    if (!itemSh || itemSh.getLastRow() < 2)
      return { success: false, message: 'No items found for this order.' };

    var labBundle  = null;
    var xrayResults = [];
    var labError   = null;
    var xrayErrors = [];

    // ── Lab portion: combined .docx via the bundle renderer ──
    try {
      labBundle = generateLabResultsBundle(branchId, orderId, encodedBy);
      if (!labBundle.success) labError = labBundle.message;
    } catch (e) {
      labError = e.message;
    }

    // After the bundle is generated, propagate the bundle URL to every
    // encoded lab service's RESULT_ITEMS row. This way the per-service
    // "View Result" button on the Encoding tab opens the same combined
    // .docx — which is the user-confirmed behavior:
    // "when i click the result on that 1 service and it is combined
    //  with the other result, so it will display that result".
    if (labBundle && labBundle.success && labBundle.docxUrl) {
      try {
        var rColsB = Math.max(itemsSh.getLastColumn(), 14);
        if (itemsSh.getLastRow() >= 2) {
          var rRowsB = itemsSh.getRange(2, 1, itemsSh.getLastRow() - 1, rColsB).getValues();
          rRowsB.forEach(function (r, idx) {
            if (String(r[1]).trim() !== orderId) return;
            var unit = String(r[5]).trim();
            if (unit !== 'LAB_DOCX' && unit !== 'LAB_PDF') return;
            // Update the url cell (col 5, 1-indexed) for this row.
            itemsSh.getRange(idx + 2, 5).setValue(labBundle.docxUrl);
          });
        }
      } catch (e) { Logger.log('generateOrderResultDrive propagate-bundle-url: ' + e.message); }
    }

    // ── X-Ray portion: one .docx per encoded X-Ray item ──
    // Each X-Ray service is rendered separately because the layout
    // (Clinical Data / Findings / Impression) is per-service, not
    // per-category like lab.
    var iCols = Math.max(itemSh.getLastColumn(), 16);
    var iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, iCols).getValues();

    // Loop the RESULT_ITEMS rows where unit is XRAY_DOCX/XRAY_PDF.
    var rCols = Math.max(itemsSh.getLastColumn(), 14);
    var rRows = itemsSh.getLastRow() >= 2
      ? itemsSh.getRange(2, 1, itemsSh.getLastRow() - 1, rCols).getValues()
      : [];
    rRows.forEach(function (r) {
      if (String(r[1]).trim() !== orderId) return;
      var unit = String(r[5]).trim();
      if (unit !== 'XRAY_DOCX' && unit !== 'XRAY_PDF') return;
      var orderItemId = String(r[2]).trim();
      var servName    = String(r[3]).trim();
      var clinicalData= String(r[11] || '').trim();
      var findings    = String(r[12] || '').trim();
      var impression  = String(r[13] || '').trim();

      // Look up serv_id from LAB_ORDER_ITEM (col 2 is order_id, col 0 is order_item_id, serv id at col 2 or 3?)
      var servId = '';
      var orderNo = '';
      var oRow = iRows.find(function (ir) {
        return String(ir[0]).trim() === orderItemId && String(ir[1]).trim() === orderId;
      });
      if (oRow) servId = String(oRow[2] || '').trim();

      try {
        var xres = saveXrayResultAndPdf(
          branchId, orderId, orderItemId, servId, servName,
          clinicalData, findings, impression,
          encodedBy || String(r[8] || '').trim(),
          orderNo
        );
        if (xres && xres.success) {
          xrayResults.push({ order_item_id: orderItemId, serv_name: servName, url: xres.docxUrl });
        } else {
          xrayErrors.push({ serv_name: servName, message: xres && xres.message });
        }
      } catch (e) {
        xrayErrors.push({ serv_name: servName, message: e.message });
      }
    });

    // Re-fetch order status after potential lab/xray updates
    var progress = _checkOrderProgress_(ss, itemSh, orderId, branchId);

    var ok = (labBundle && labBundle.success) || xrayResults.length > 0;
    if (!ok) {
      return {
        success: false,
        message: labError || 'No results were saved to Drive. Encode at least one service first.',
        lab_error: labError,
        xray_errors: xrayErrors
      };
    }

    return {
      success: true,
      lab_bundle_url: labBundle && labBundle.success ? labBundle.docxUrl : '',
      lab_categories: labBundle && labBundle.success ? labBundle.categories : [],
      lab_error: labError,
      xray_results: xrayResults,
      xray_errors: xrayErrors,
      order_status: progress.newStatus
    };
  } catch (e) {
    Logger.log('generateOrderResultDrive ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ─── PHASE 3a — RESOLVE THE "VIEW RESULT" URL FOR ANY SERVICE ───
// The new flow stores ONE combined lab .docx per order (LAB_BUNDLE_DOCX
// row) plus per-X-Ray .docx rows. This helper returns the right URL
// to open from the per-service "View Result" button on the Encoding tab.
function getOrderResultUrls(branchId, orderId) {
  try {
    if (!branchId || !orderId)
      return { success: false, message: 'branchId and orderId required.' };
    var ss = getOrderSS_(branchId);
    var itemsSh = _getResultItemsSheet_(ss);
    if (!itemsSh || itemsSh.getLastRow() < 2)
      return { success: true, lab_bundle_url: '', xray_urls: {}, lab_per_item_urls: {} };

    var rCols = Math.max(itemsSh.getLastColumn(), 14);
    var rRows = itemsSh.getRange(2, 1, itemsSh.getLastRow() - 1, rCols).getValues();
    var bundleUrl = '';
    var xrayUrls = {};
    var labPerItemUrls = {}; // legacy per-service .docx URLs — fallback only

    rRows.forEach(function (r) {
      if (String(r[1]).trim() !== orderId) return;
      var unit = String(r[5]).trim();
      var url  = String(r[4] || '').trim();
      if (!url) return;
      var orderItemId = String(r[2]).trim();
      if (unit === 'LAB_BUNDLE_DOCX') bundleUrl = url;
      else if (unit === 'XRAY_DOCX' || unit === 'XRAY_PDF') xrayUrls[orderItemId] = url;
      else if (unit === 'LAB_DOCX' || unit === 'LAB_PDF')   labPerItemUrls[orderItemId] = url;
    });

    return {
      success: true,
      lab_bundle_url: bundleUrl,
      xray_urls: xrayUrls,
      lab_per_item_urls: labPerItemUrls
    };
  } catch (e) {
    Logger.log('getOrderResultUrls ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}
