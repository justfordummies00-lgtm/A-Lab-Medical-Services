// ============================================================
// LabBundleRendererCode.gs
// Category-grouped lab result bundle renderer.
//
// Produces ONE combined .docx per order:
//   - Groups encoded lab items by cat_id.
//   - Each category becomes one page with a titled banner.
//   - Services in a category merge into one table when layouts match.
//   - Services with a sheet-template URL are skipped here and continue to
//     use the existing sheet_template flow (e.g. Hematology with formulas).
//
// Entry points (exposed to the client):
//   • generateLabResultsBundle(branchId, orderId, encodedBy)
//   • getLabBundleEligibility(branchId, orderId)   // client preview
//
// This file is additive — it does not modify existing per-item behaviour
// defined in ResultTemplatesCode.gs.
// ============================================================

// ─── COLUMN INDEX HELPERS ───────────────────────────────────
// RESULT_ITEMS columns (0-indexed):
//   0 rid, 1 order_id, 2 order_item_id, 3 label, 4 url, 5 unit,
//   6 service_id (unused today), 7 service_name,
//   8 encoded_by, 9 encoded_at,
//   10 raw_values_json, 11 xray_cd, 12 xray_fn, 13 xray_im
//
// Column 10 is reused as the raw-values JSON cache for lab items.
var LAB_RAW_VALUES_COL_IDX = 10; // zero-based -> column K

// ─── STORE RAW PARAM VALUES ON PER-ITEM SAVE ────────────────
// Called from saveLabResultAndPdf after a successful per-item DOCX save.
// Stores a JSON blob alongside the existing row so the bundle renderer
// can reassemble all items without re-opening every DOCX.
function saveLabItemRawValues_(branchId, orderId, orderItemId, payload) {
  try {
    var ss = getOrderSS_(branchId);
    var sh = _getResultItemsSheet_(ss);
    var lr = sh.getLastRow();
    if (lr < 2) return;

    var numCols = Math.max(sh.getLastColumn(), LAB_RAW_VALUES_COL_IDX + 1);
    var rows = sh.getRange(2, 1, lr - 1, numCols).getValues();
    var idx = rows.findIndex(function (r) {
      return String(r[1]).trim() === orderId &&
             String(r[2]).trim() === orderItemId &&
             (String(r[5]).trim() === 'LAB_DOCX' || String(r[5]).trim() === 'LAB_PDF');
    });
    if (idx === -1) return;

    var row = idx + 2;
    // Ensure the column exists
    if (sh.getLastColumn() < LAB_RAW_VALUES_COL_IDX + 1) {
      sh.getRange(1, LAB_RAW_VALUES_COL_IDX + 1).setValue('raw_values_json');
    }
    sh.getRange(row, LAB_RAW_VALUES_COL_IDX + 1).setValue(JSON.stringify(payload || {}));
  } catch (e) {
    Logger.log('saveLabItemRawValues_ ERROR: ' + e.message);
  }
}

// ─── READ ALL ENCODED LAB ITEMS FOR AN ORDER ────────────────
function _getEncodedLabItemsForOrder_(branchId, orderId) {
  var ss = getOrderSS_(branchId);
  var itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
  var riSh = _getResultItemsSheet_(ss);

  var items = [];
  if (!itemSh || itemSh.getLastRow() < 2) return items;
  if (!riSh  || riSh.getLastRow()  < 2) return items;

  var iCols = Math.max(itemSh.getLastColumn(), 16);
  var iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, iCols).getValues();

  var rCols = Math.max(riSh.getLastColumn(), LAB_RAW_VALUES_COL_IDX + 1);
  var rRows = riSh.getRange(2, 1, riSh.getLastRow() - 1, rCols).getValues();

  for (var i = 0; i < iRows.length; i++) {
    var ir = iRows[i];
    if (String(ir[1]).trim() !== orderId) continue;
    if (!ir[15]) continue; // encoded_at empty

    var orderItemId = String(ir[0]).trim();
    var servId      = String(ir[2] || '').trim();
    var servName    = String(ir[4] || '').trim();

    // Find the RESULT_ITEMS row for this lab item (LAB_DOCX / LAB_PDF / raw values)
    var ri = rRows.find(function (r) {
      return String(r[1]).trim() === orderId &&
             String(r[2]).trim() === orderItemId &&
             (String(r[5]).trim() === 'LAB_DOCX' ||
              String(r[5]).trim() === 'LAB_PDF'  ||
              String(r[5]).trim() === 'SHEET_TEMPLATE');
    });

    var unit = ri ? String(ri[5]).trim() : '';
    var rawJson = ri && ri[LAB_RAW_VALUES_COL_IDX] ? String(ri[LAB_RAW_VALUES_COL_IDX]) : '';
    var rawValues = null;
    if (rawJson) {
      try { rawValues = JSON.parse(rawJson); } catch (e) { rawValues = null; }
    }

    items.push({
      order_item_id: orderItemId,
      serv_id:       servId,
      serv_name:     servName,
      storage_unit:  unit,         // LAB_DOCX | SHEET_TEMPLATE | ''
      raw_values:    rawValues,    // array of {param_name, result_value, ...} or null
      docx_url:      ri ? String(ri[4] || '').trim() : ''
    });
  }
  return items;
}

// ─── LOOK UP CATEGORY NAME FOR A SERVICE ────────────────────
function _getCategoryForService_(servId, _cache) {
  if (_cache && _cache[servId]) return _cache[servId];
  var mss = getSS_();
  var servSh = mss.getSheetByName('Lab_Services');
  var catSh  = mss.getSheetByName('Categories');
  if (!servSh || !catSh) return { cat_id: '', category_name: 'UNKNOWN' };

  var servRows = servSh.getRange(2, 1, Math.max(servSh.getLastRow() - 1, 1), 12).getValues();
  var servRow = servRows.find(function (r) { return String(r[0]).trim() === servId; });
  if (!servRow) return { cat_id: '', category_name: 'UNKNOWN' };
  var catId = String(servRow[1] || '').trim();
  var templateUrl = String(servRow[11] || '').trim();

  var catRows = catSh.getRange(2, 1, Math.max(catSh.getLastRow() - 1, 1), 4).getValues();
  var catRow = catRows.find(function (r) { return String(r[0]).trim() === catId; });
  var out = {
    cat_id:        catId,
    category_name: catRow ? String(catRow[2] || '').trim() : 'UNKNOWN',
    has_template:  templateUrl !== ''
  };
  if (_cache) _cache[servId] = out;
  return out;
}

// ─── LAYOUT DETECTION ───────────────────────────────────────
// Given a flat list of param objects across all services in a category,
// decide the most appropriate rendering layout.
//   - 'tabular'  → 4 cols: TEST · RESULT · REFERENCE VALUE · UNIT
//   - 'keyvalue' → 2 cols: LABEL · VALUE
//   - 'mixed'    → 3 cols: LABEL · VALUE · (italic unit/ref)
function _detectCategoryLayout_(flatParams) {
  var dataParams = flatParams.filter(function (p) {
    var ft = (p.field_type || 'numeric').toLowerCase();
    return ft !== 'header' && ft !== 'subheader' && ft !== 'note';
  });
  if (dataParams.length === 0) return 'keyvalue';

  var withUnit = dataParams.filter(function (p) { return String(p.unit || '').trim() !== ''; }).length;
  var withRef  = dataParams.filter(function (p) { return String(p.reference_range || '').trim() !== ''; }).length;

  var allHaveEither = dataParams.every(function (p) {
    return String(p.unit || '').trim() !== '' || String(p.reference_range || '').trim() !== '';
  });
  if (allHaveEither && (withUnit > 0 || withRef > 0)) return 'tabular';

  if (withUnit === 0 && withRef === 0) return 'keyvalue';

  return 'mixed';
}

// ─── VALUE FORMATTER BY FIELD TYPE ──────────────────────────
function _formatValueForPrint_(fieldType, value) {
  var ft = String(fieldType || 'numeric').toLowerCase();
  var v  = String(value == null ? '' : value).trim();
  if (!v) return { text: 'blank', italic: true, gray: true };

  switch (ft) {
    case 'pos_neg':   return { text: v.toUpperCase(), italic: false, gray: false };
    case 'reactive':  return { text: v.toUpperCase(), italic: false, gray: false };
    case 'selection': return { text: v.toUpperCase(), italic: false, gray: false };
    default:          return { text: v, italic: false, gray: false };
  }
}

// ─── BUILD ROWS FOR ONE CATEGORY ────────────────────────────
// Returns { headers, rows, rowMeta, numCols }
//
// Services whose params include a top-level "header" field_type row (e.g.
// "COMPLETE BLOOD COUNT") will render that as an uppercase bold row that
// groups the following params. Otherwise, if we are merging multiple
// services into one table, each service's params are prefixed with a bold
// row = the service name (so the reader can still tell them apart).
function _buildCategoryRows_(serviceList, layout) {
  var headers = [];
  var rows = [];
  var rowMeta = [];
  var numCols;

  if (layout === 'tabular') {
    headers = ['TEST', 'RESULT', 'REFERENCE VALUE', 'UNIT'];
    numCols = 4;
  } else if (layout === 'mixed') {
    headers = ['TEST', 'RESULT', 'UNIT'];
    numCols = 3;
  } else {
    headers = ['TEST', 'RESULT'];
    numCols = 2;
  }

  var mergeMultiService = serviceList.length > 1;

  serviceList.forEach(function (svc) {
    // Emit service-level group header when we are merging services AND
    // the service's own params do not already start with a `header` row.
    var paramsSorted = (svc.params || []).slice().sort(function (a, b) {
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    });
    var firstIsHeader = paramsSorted.length > 0 &&
                        String(paramsSorted[0].field_type || '').toLowerCase() === 'header';

    if (mergeMultiService && !firstIsHeader) {
      var hrow = [svc.serv_name.toUpperCase()];
      for (var c = 1; c < numCols; c++) hrow.push('');
      rows.push(hrow);
      rowMeta.push({ type: 'service_header' });
    }

    paramsSorted.forEach(function (p) {
      var ft = String(p.field_type || 'numeric').toLowerCase();
      var result = (svc.resultsByParam && svc.resultsByParam[p.param_name]) || '';

      if (ft === 'header') {
        var hrow2 = [String(p.param_name || '').toUpperCase()];
        for (var c2 = 1; c2 < numCols; c2++) hrow2.push('');
        rows.push(hrow2);
        rowMeta.push({ type: 'header' });
        return;
      }
      if (ft === 'subheader') {
        var srow = [String(p.param_name || '')];
        for (var c3 = 1; c3 < numCols; c3++) srow.push('');
        rows.push(srow);
        rowMeta.push({ type: 'subheader' });
        return;
      }
      if (ft === 'note') {
        var nrow = [p.param_name || '', result];
        for (var c4 = 2; c4 < numCols; c4++) nrow.push('');
        rows.push(nrow);
        rowMeta.push({ type: 'note' });
        return;
      }

      var formatted = _formatValueForPrint_(ft, result);
      var indentStr = p.indent ? new Array(p.indent * 5 + 1).join(' ') : '';
      var label = indentStr + String(p.param_name || '');
      var refLines = String(p.reference_range || '').split('\n');
      var firstRef = refLines[0] || '';

      var row = [label, formatted.text];
      if (numCols === 3) {
        row.push(String(p.unit || ''));
      } else if (numCols === 4) {
        row.push(firstRef);
        row.push(String(p.unit || ''));
      }
      rows.push(row);
      rowMeta.push({
        type: 'data',
        indent: p.indent || 0,
        field_type: ft,
        italic: formatted.italic,
        gray:   formatted.gray
      });

      // continuation rows for multi-line reference ranges (tabular only)
      if (numCols === 4 && refLines.length > 1) {
        for (var rl = 1; rl < refLines.length; rl++) {
          rows.push(['', '', refLines[rl], '']);
          rowMeta.push({ type: 'continuation' });
        }
      }

      // Optional italic sub-label underneath (SEROLOGY "Antigen Screening Test")
      if (p.sub_label) {
        var slrow = [String(p.sub_label)];
        for (var c5 = 1; c5 < numCols; c5++) slrow.push('');
        rows.push(slrow);
        rowMeta.push({ type: 'sublabel' });
      }
    });
  });

  return { headers: headers, rows: rows, rowMeta: rowMeta, numCols: numCols };
}

// ─── TABLE STYLING (reuse existing helper) ──────────────────
// Adds support for two new row types used by the bundle renderer:
//   'service_header' → bold uppercase, full-width
//   (others are already handled by styleCompactTable_ in ResultTemplatesCode.gs)
function _styleBundleTable_(tbl, rowMeta, numCols) {
  // Delegate most styling, then post-process service_header rows.
  try { styleCompactTable_(tbl, rowMeta, numCols); } catch (e) {
    Logger.log('_styleBundleTable_ delegate ERROR: ' + e.message);
  }
  for (var r = 0; r < tbl.getNumRows(); r++) {
    var meta = rowMeta[r] || {};
    if (meta.type !== 'service_header') continue;
    var row = tbl.getRow(r);
    for (var c = 1; c < numCols; c++) {
      try { row.getCell(c).setText(''); } catch (e) {}
    }
    try {
      var cell0 = row.getCell(0);
      cell0.editAsText().setBold(true).setFontSize(11);
      cell0.setBackgroundColor('#F3F4F6');
      cell0.setPaddingTop(4).setPaddingBottom(4);
    } catch (e) {}
  }
}

// ─── MAIN ENTRY: GENERATE ONE COMBINED DOCX PER ORDER ───────
function generateLabResultsBundle(branchId, orderId, encodedBy) {
  try {
    if (!branchId || !orderId) {
      return { success: false, message: 'branchId and orderId are required.' };
    }

    // 1. Resolve template
    var rawTemplateDocId = getSettingValue_('lab_template_doc_id', '');
    var templateDocId = extractDriveFileId_(rawTemplateDocId) || String(rawTemplateDocId || '').trim();
    if (!templateDocId) {
      return {
        success: false,
        message: 'No Lab Result template configured. Go to Global Settings → Lab Result Template and paste your Google Doc link.'
      };
    }

    var templateFile;
    try { templateFile = DriveApp.getFileById(templateDocId); }
    catch (e) {
      return {
        success: false,
        message: 'Cannot access the Lab template Google Doc. Share it with the script account: ' +
          getEffectiveUserEmail_() + '. Error: ' + e.message
      };
    }
    if (templateFile.getMimeType() !== MimeType.GOOGLE_DOCS) {
      return { success: false, message: 'The lab template must be a Google Doc (not .docx).' };
    }

    // 2. Collect eligible items (param-mode, not sheet_template)
    var items = _getEncodedLabItemsForOrder_(branchId, orderId);
    var catCache = {};
    var eligible = [];
    var skippedSheetTemplate = [];

    items.forEach(function (it) {
      var catInfo = _getCategoryForService_(it.serv_id, catCache);
      if (catInfo.has_template || it.storage_unit === 'SHEET_TEMPLATE') {
        skippedSheetTemplate.push({
          serv_name: it.serv_name,
          url: it.docx_url,
          category_name: catInfo.category_name
        });
        return;
      }
      if (!it.raw_values) return; // can't render without raw values
      // Hydrate params & results from the stored raw values. Shape stored by
      // saveLabResultAndPdf is [{param_name, result_value, unit, reference_range, field_type, remarks}, ...]
      var params = it.raw_values.map(function (p) {
        return {
          param_name:      p.param_name,
          unit:            p.unit || '',
          reference_range: p.reference_range || '',
          field_type:      p.field_type || 'numeric',
          sort_order:      p.sort_order || 0,
          sub_label:       p.sub_label || '',
          indent:          p.indent || 0
        };
      });
      var resultsByParam = {};
      it.raw_values.forEach(function (p) {
        resultsByParam[p.param_name] = p.result_value || '';
      });
      eligible.push({
        serv_id:   it.serv_id,
        serv_name: it.serv_name,
        cat_id:    catInfo.cat_id,
        category_name: catInfo.category_name,
        params:    params,
        resultsByParam: resultsByParam
      });
    });

    if (eligible.length === 0) {
      return {
        success: false,
        message: 'No encoded param-mode lab items found for this order. ' +
                 (skippedSheetTemplate.length ? 'Sheet-template services are handled separately.' : '')
      };
    }

    // 3. Group by category, preserve insertion order
    var groups = {};
    var catOrder = [];
    eligible.forEach(function (s) {
      if (!groups[s.cat_id]) {
        groups[s.cat_id] = { category_name: s.category_name, services: [] };
        catOrder.push(s.cat_id);
      }
      groups[s.cat_id].services.push(s);
    });

    // 4. Fetch patient demographics for the template header/footer
    var patient = _fetchPatientForOrder_(branchId, orderId);

    // 5. Clone template
    var baseName = (patient.orderNo || orderId) + ' - COMBINED LAB RESULTS';
    var docCopy = templateFile.makeCopy(baseName + '_edit');
    var docDoc  = DocumentApp.openById(docCopy.getId());
    var body    = docDoc.getBody();

    // Header placeholder replacements
    var now = formatShortDate_(new Date());
    var replacements = {
      '{{PATIENT_NAME}}':  (patient.name || '').toUpperCase(),
      '{{AGE}}':           patient.age || '',
      '{{SEX}}':           (patient.sex || '').toUpperCase(),
      '{{BIRTHDATE}}':     patient.birthdate || '',
      '{{PHYSICIAN}}':     patient.physician || '',
      '{{COMPANY}}':       patient.company || '',
      '{{DATE}}':          now,
      '{{PATIENT_NO}}':    patient.orderNo || '',
      '{{MEDTECH_NAME}}':    patient.medtech_name || '',
      '{{MEDTECH_CRED}}':    patient.medtech_cred || '',
      '{{MEDTECH_LICENSE}}': patient.medtech_license_no || '',
      '{{PATHOLOGIST_NAME}}':    patient.pathologist_name || '',
      '{{PATHOLOGIST_CRED}}':    patient.pathologist_cred || '',
      '{{PATHOLOGIST_LICENSE}}': patient.pathologist_license_no || '',
      // The bundle renderer ignores {{SERVICE_NAME}} from the master template,
      // but we still blank it out so stray placeholders don't print.
      '{{SERVICE_NAME}}':  ''
    };
    _replaceEverywhere_(docDoc, replacements);

    // 6. Find the {{RESULTS_TABLE}} insertion anchor
    var anchorIdx = -1;
    for (var i = 0; i < body.getNumChildren(); i++) {
      var child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH &&
          child.asParagraph().getText().indexOf('{{RESULTS_TABLE}}') !== -1) {
        anchorIdx = i;
        break;
      }
    }
    if (anchorIdx === -1) {
      docDoc.saveAndClose();
      try { docCopy.setTrashed(true); } catch (e) {}
      return { success: false, message: 'Template is missing the {{RESULTS_TABLE}} placeholder paragraph.' };
    }
    body.removeChild(body.getChild(anchorIdx));

    // 7. Emit each category block in turn, with a page-break between
    var insertAt = anchorIdx;
    catOrder.forEach(function (catId, gi) {
      var grp = groups[catId];

      // Category banner paragraph (bordered, centered, uppercase, large)
      var bannerPara = body.insertParagraph(insertAt++, String(grp.category_name || '').toUpperCase());
      bannerPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      var bt = bannerPara.editAsText();
      bt.setBold(true).setFontSize(18);
      bannerPara.setSpacingBefore(6).setSpacingAfter(6);
      // Simulate the boxed banner with a 1-cell table so we get a border
      // (paragraph-level borders are unreliable in Apps Script).
      // We leave it as a simple centered large bold line to keep code
      // footprint small — visually it still reads as a "title".

      // Merged layout decision
      var flatParams = [];
      grp.services.forEach(function (s) { flatParams = flatParams.concat(s.params); });
      var layout = _detectCategoryLayout_(flatParams);

      var built = _buildCategoryRows_(grp.services, layout);
      var all = [built.headers].concat(built.rows);
      var meta = [{ type: 'thead' }].concat(built.rowMeta);

      // Thin divider under header like existing generateLabResult
      var divider = [];
      for (var dc = 0; dc < built.numCols; dc++) divider.push('');
      all.splice(1, 0, divider);
      meta.splice(1, 0, { type: 'divider' });

      var tbl = body.insertTable(insertAt++, all);
      _styleBundleTable_(tbl, meta, built.numCols);

      // Page break between categories (but not after the last one)
      if (gi < catOrder.length - 1) {
        var pbPara = body.insertParagraph(insertAt++, '');
        pbPara.appendPageBreak();
      }
    });

    cleanupTrailingBodyWhitespace_(body);
    docDoc.saveAndClose();

    // 8. Export to DOCX + save to patient folder
    var targetFolder = _resolvePatientFolder_(branchId, patient) || getDriveFolder_('A-Lab Results');
    Utilities.sleep(1200);
    var docxFile = exportDocx_(docCopy.getId(), baseName, targetFolder);
    try { docCopy.setTrashed(true); } catch (e) {}

    // 9. Record the bundle URL in RESULT_ITEMS under unit='LAB_BUNDLE_DOCX'
    var ss = getOrderSS_(branchId);
    var itemsSh = _getResultItemsSheet_(ss);
    var existing = getResultItemRowByType_(itemsSh, orderId, '', ['LAB_BUNDLE_DOCX']);
    if (existing !== -1) {
      itemsSh.getRange(existing, 5, 1, 6).setValues(
        [[docxFile.getUrl(), 'LAB_BUNDLE_DOCX', '', 'COMBINED LAB RESULTS', encodedBy || '', new Date()]]
      );
    } else {
      var rid = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      itemsSh.appendRow([rid, orderId, '', 'COMBINED LAB RESULTS', docxFile.getUrl(),
                         'LAB_BUNDLE_DOCX', '', '', encodedBy || '', new Date()]);
    }

    return {
      success: true,
      docxUrl: docxFile.getUrl(),
      filename: baseName,
      categories: catOrder.map(function (c) { return groups[c].category_name; }),
      skipped_sheet_template: skippedSheetTemplate
    };
  } catch (e) {
    Logger.log('generateLabResultsBundle ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ─── CLIENT-SIDE PREVIEW: what will the bundle contain? ─────
function getLabBundleEligibility(branchId, orderId) {
  try {
    var items = _getEncodedLabItemsForOrder_(branchId, orderId);
    var catCache = {};
    var groups = {};
    var catOrder = [];
    var sheetTemplateItems = [];

    items.forEach(function (it) {
      var catInfo = _getCategoryForService_(it.serv_id, catCache);
      if (catInfo.has_template || it.storage_unit === 'SHEET_TEMPLATE') {
        sheetTemplateItems.push({
          serv_name: it.serv_name, url: it.docx_url,
          category_name: catInfo.category_name
        });
        return;
      }
      if (!groups[catInfo.cat_id]) {
        groups[catInfo.cat_id] = { category_name: catInfo.category_name, services: [] };
        catOrder.push(catInfo.cat_id);
      }
      groups[catInfo.cat_id].services.push({
        serv_name: it.serv_name,
        has_raw_values: !!it.raw_values
      });
    });

    return {
      success: true,
      bundle_categories: catOrder.map(function (c) {
        return { category_name: groups[c].category_name, services: groups[c].services };
      }),
      skipped_sheet_template: sheetTemplateItems
    };
  } catch (e) {
    Logger.log('getLabBundleEligibility ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ─── HELPERS: placeholder replace in header/body/footer ─────
function _replaceEverywhere_(docDoc, replacements) {
  var body = docDoc.getBody();
  Object.keys(replacements).forEach(function (ph) {
    body.replaceText(ph, replacements[ph] || '');
  });
  var header = docDoc.getHeader();
  if (header) Object.keys(replacements).forEach(function (ph) {
    header.replaceText(ph, replacements[ph] || '');
  });
  var footer = docDoc.getFooter();
  if (footer) Object.keys(replacements).forEach(function (ph) {
    footer.replaceText(ph, replacements[ph] || '');
  });
}

// ─── HELPER: patient info for the bundle ────────────────────
function _fetchPatientForOrder_(branchId, orderId) {
  var patient = {};
  try {
    var ss = getOrderSS_(branchId);
    var ordSh = ss.getSheetByName('LAB_ORDER');
    if (!ordSh || ordSh.getLastRow() < 2) return patient;
    var oCols = Math.max(ordSh.getLastColumn(), 20);
    var ordRow = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, oCols).getValues()
      .find(function (r) { return String(r[0]).trim() === orderId; });
    if (!ordRow) return patient;

    patient.patient_id = String(ordRow[3] || '').trim();
    patient.physician  = String(ordRow[12] || '').trim();
    patient.orderNo    = String(ordRow[1] || '').trim();

    // Patient demographics from Patients sheet
    try {
      var mss = getSS_();
      var patSh = mss.getSheetByName('Patients_' + branchId) || mss.getSheetByName('Patients');
      if (patSh && patSh.getLastRow() >= 2) {
        var pRow = patSh.getRange(2, 1, patSh.getLastRow() - 1, 8).getValues()
          .find(function (r) { return String(r[0]).trim() === patient.patient_id; });
        if (pRow) {
          patient.name = (String(pRow[1] || '').trim() + ', ' + String(pRow[2] || '').trim())
            .replace(/,\s*$/, '').trim();
          patient.sex = String(pRow[4] || '').trim();
          var dob = pRow[5] ? new Date(pRow[5]) : null;
          patient.birthdate = dob ? formatShortDate_(dob) : '';
          patient.age = dob
            ? Math.floor((new Date() - dob) / (365.25 * 24 * 3600 * 1000)) + ''
            : '';
        }
      }
    } catch (e) { Logger.log('patient lookup: ' + e.message); }

    // Tech + pathologist signatures (best-effort)
    try {
      var encoder = '';
      var riSh = _getResultItemsSheet_(ss);
      if (riSh && riSh.getLastRow() >= 2) {
        var rrs = riSh.getRange(2, 1, riSh.getLastRow() - 1, Math.max(riSh.getLastColumn(), 10)).getValues();
        var row = rrs.find(function (r) {
          return String(r[1]).trim() === orderId &&
                 (String(r[5]).trim() === 'LAB_DOCX' || String(r[5]).trim() === 'LAB_PDF');
        });
        if (row) encoder = String(row[8] || '').trim();
      }
      if (encoder) {
        var ti = getTechInfo(encoder);
        if (ti && ti.success) {
          patient.medtech_name          = ti.name || '';
          patient.medtech_cred          = ti.credentials || '';
          patient.medtech_license_no    = ti.license_no || '';
          patient.medtech_signature_url = ti.signature_url || '';
        }
      }
      var ls = getLabSignatures(branchId);
      if (ls && ls.success && ls.pathologist) {
        patient.pathologist_name          = ls.pathologist.name || '';
        patient.pathologist_cred          = ls.pathologist.credentials || '';
        patient.pathologist_license_no    = ls.pathologist.license_no || '';
        patient.pathologist_signature_url = ls.pathologist.signature_url || '';
      }
    } catch (e) { Logger.log('signature lookup: ' + e.message); }
  } catch (e) { Logger.log('_fetchPatientForOrder_ ERROR: ' + e.message); }
  return patient;
}

// ─── HELPER: resolve the patient folder under the branch root
function _resolvePatientFolder_(branchId, patient) {
  try {
    var drvCfg = getDriveFolderConfig(branchId);
    var rootId = drvCfg && drvCfg.root_folder_id ? drvCfg.root_folder_id.trim() : '';
    rootId = extractDriveFileId_(rootId) || rootId;
    if (!rootId) return null;
    var rootFolder = DriveApp.getFolderById(rootId);
    var folderName = patient.name
      ? patient.name.trim() + ' - ' + (patient.patient_id || '').trim()
      : 'Patient - ' + (patient.patient_id || '');
    var fq = rootFolder.getFoldersByName(folderName);
    return fq.hasNext() ? fq.next() : rootFolder.createFolder(folderName);
  } catch (e) {
    Logger.log('_resolvePatientFolder_ ERROR: ' + e.message);
    return null;
  }
}

// ============================================================
// LAB RESULTS PREVIEW — Backend helpers for the HTML preview page
// ============================================================

// ─── GET ORDERS WITH ENCODED LAB RESULTS ─────────────────────
// Returns a list of orders that have at least one encoded lab item,
// suitable for the preview order-picker.
function getLabPreviewOrders(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };

    var mss = getSS_();
    var brSh = mss.getSheetByName('Branches');
    if (!brSh) return { success: false, message: 'Branches sheet not found.' };

    var brRows = brSh.getRange(2, 1, brSh.getLastRow() - 1, 8).getValues();
    var br = brRows.find(function (r) { return String(r[0]).trim() === branchId; });
    if (!br || !br[7]) return { success: false, message: 'Branch spreadsheet not configured.' };

    var bss = SpreadsheetApp.openById(String(br[7]).trim());
    var ordSh = bss.getSheetByName('LAB_ORDER');
    var itemSh = bss.getSheetByName('LAB_ORDER_ITEM');
    var patSh = bss.getSheetByName('Patients');

    if (!ordSh || ordSh.getLastRow() < 2) return { success: true, orders: [] };

    // Build patient map
    var patMap = {};
    if (patSh && patSh.getLastRow() >= 2) {
      patSh.getRange(2, 1, patSh.getLastRow() - 1, 6).getValues().forEach(function (r) {
        var pid = String(r[0] || '').trim();
        if (pid) patMap[pid] = {
          name: (String(r[1] || '').trim() + ', ' + String(r[2] || '').trim()).replace(/,\s*$/, '').trim(),
          sex: String(r[4] || '').trim()
        };
      });
    }

    // Count encoded items per order
    var encodedCounts = {};
    if (itemSh && itemSh.getLastRow() >= 2) {
      var iCols = Math.max(itemSh.getLastColumn(), 16);
      itemSh.getRange(2, 1, itemSh.getLastRow() - 1, iCols).getValues().forEach(function (r) {
        var oid = String(r[1] || '').trim();
        if (oid && r[15]) {
          encodedCounts[oid] = (encodedCounts[oid] || 0) + 1;
        }
      });
    }

    // Build order list
    var oCols = Math.max(ordSh.getLastColumn(), 20);
    var oRows = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, oCols).getValues();
    var orders = [];

    oRows.forEach(function (r) {
      var oid = String(r[0] || '').trim();
      if (!oid) return;
      var count = encodedCounts[oid] || 0;
      if (count === 0) return;

      var patientId = String(r[3] || '').trim();
      var pat = patMap[patientId] || {};
      var orderType = String(r[6] || '').trim().toUpperCase();

      // Skip X-Ray orders
      if (orderType === 'XRAY' || orderType === 'X-RAY') return;

      orders.push({
        order_id: oid,
        order_no: String(r[1] || '').trim(),
        patient_id: patientId,
        patient_name: String(r[11] || pat.name || '').trim(),
        status: String(r[5] || '').trim(),
        encoded_count: count,
        order_date: r[2] ? formatShortDate_(r[2]) : ''
      });
    });

    // Sort by most recent first
    orders.reverse();

    return { success: true, orders: orders };
  } catch (e) {
    Logger.log('getLabPreviewOrders ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ─── GET FULL LAB PREVIEW DATA FOR AN ORDER ──────────────────
// Returns patient info, categories with services and their params/results,
// and signature data — everything needed to render the HTML preview.
function getLabPreviewData(branchId, orderId) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'branchId and orderId required.' };

    // 1. Fetch patient info
    var patient = _fetchPatientForOrder_(branchId, orderId);

    // 2. Fetch all encoded lab items
    var items = _getEncodedLabItemsForOrder_(branchId, orderId);
    var catCache = {};
    var groups = {};
    var catOrder = [];

    // Pre-load Lab_Serv_Params sheet for fallback when raw_values are missing
    var paramSheetRows = null;
    function _getParamSheetRows() {
      if (paramSheetRows !== null) return paramSheetRows;
      try {
        var mss = getSS_();
        var psh = mss.getSheetByName('Lab_Serv_Params');
        if (!psh || psh.getLastRow() < 2) { paramSheetRows = []; return paramSheetRows; }
        paramSheetRows = psh.getRange(2, 1, psh.getLastRow() - 1, Math.max(psh.getLastColumn(), 10)).getValues();
      } catch (e) { paramSheetRows = []; }
      return paramSheetRows;
    }

    items.forEach(function (it) {
      var params;
      if (it.raw_values) {
        params = it.raw_values.map(function (p) {
          return {
            param_name: p.param_name,
            unit: p.unit || '',
            reference_range: p.reference_range || '',
            field_type: p.field_type || 'numeric',
            sort_order: p.sort_order || 0,
            sub_label: p.sub_label || '',
            indent: p.indent || 0,
            result_value: p.result_value || ''
          };
        });
      } else {
        // Fallback: load param definitions from Lab_Serv_Params master sheet
        var pRows = _getParamSheetRows();
        params = pRows
          .filter(function (r) { return String(r[1]).trim() === it.serv_id; })
          .sort(function (a, b) { return (Number(a[5]) || 0) - (Number(b[5]) || 0); })
          .map(function (r) {
            return {
              param_name: String(r[2] || '').trim(),
              unit: String(r[3] || '').trim(),
              reference_range: String(r[4] || '').trim(),
              field_type: String(r[8] || 'numeric').trim() || 'numeric',
              sort_order: Number(r[5]) || 0,
              sub_label: '',
              indent: 0,
              result_value: ''
            };
          });
      }
      if (!params.length) return;

      var catInfo = _getCategoryForService_(it.serv_id, catCache);
      if (!groups[catInfo.cat_id]) {
        groups[catInfo.cat_id] = { cat_id: catInfo.cat_id, category_name: catInfo.category_name, services: [] };
        catOrder.push(catInfo.cat_id);
      }

      groups[catInfo.cat_id].services.push({
        serv_id: it.serv_id,
        serv_name: it.serv_name,
        params: params
      });
    });

    if (catOrder.length === 0) {
      return { success: false, message: 'No encoded lab results found for this order.' };
    }

    // 3. Collect signature info
    var signatures = {};
    try {
      if (patient.medtech_name) {
        signatures.medtech_name = patient.medtech_name;
        signatures.medtech_cred = patient.medtech_cred || '';
        signatures.medtech_license_no = patient.medtech_license_no || '';
        signatures.medtech_signature_url = patient.medtech_signature_url || '';
      }
      if (patient.pathologist_name) {
        signatures.pathologist_name = patient.pathologist_name;
        signatures.pathologist_cred = patient.pathologist_cred || '';
        signatures.pathologist_license_no = patient.pathologist_license_no || '';
        signatures.pathologist_signature_url = patient.pathologist_signature_url || '';
      }
    } catch (e) {}

    // 4. Format patient for display
    var now = formatShortDate_(new Date());
    var displayPatient = {
      name: (patient.name || '').toUpperCase(),
      age: patient.age || '',
      sex: (patient.sex || '').toUpperCase(),
      birthdate: patient.birthdate || '',
      physician: patient.physician || '',
      company: patient.company || '',
      date: now
    };

    return {
      success: true,
      patient: displayPatient,
      signatures: signatures,
      categories: catOrder.map(function (cid) { return groups[cid]; })
    };
  } catch (e) {
    Logger.log('getLabPreviewData ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}
