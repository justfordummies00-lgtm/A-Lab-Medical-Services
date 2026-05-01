// ============================================================
//  A-LAB — LabServicesCode.gs
//
//  Lab_Services sheet:
//    A=serv_id  B=cat_id  C=serv_name  D=default_fee
//    E=specimen_type  F=is_philhealth_covered
//    G=is_active  H=created_at  I=updated_at
//
//  Branch_Serv_Status sheet:
//    A=branch_id  B=serv_id  C=is_active  D=updated_at
// ============================================================

function getLabServSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName('Lab_Services');
  if (!sh) {
    sh = ss.insertSheet('Lab_Services');
    sh.getRange(1, 1, 1, 12).setValues([[
      'serv_id', 'cat_id', 'serv_name', 'default_fee',
      'specimen_type', 'is_philhealth_covered', 'is_active', 'created_at', 'updated_at',
      'service_type', 'is_consultation', 'template_url'
    ]]);
    sh.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  ensureServTypeCol_(sh);
  ensureServTemplateCol_(sh);
  return sh;
}

function ensureServTemplateCol_(sh) {
  if (sh.getLastColumn() < 12) {
    sh.getRange(1, 12).setValue('template_url');
  }
}

function getBranchServStatusSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName('Branch_Serv_Status');
  if (!sh) {
    sh = ss.insertSheet('Branch_Serv_Status');
    sh.getRange(1, 1, 1, 5).setValues([['branch_id', 'serv_id', 'is_active', 'updated_at', 'template_url']]);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  } else {
    ensureBssTemplateCol_(sh);
  }
  return sh;
}

function ensureBssTemplateCol_(sh) {
  if (sh.getLastColumn() < 5 && sh.getLastRow() > 0) {
    sh.getRange(1, 5).setValue('template_url');
  }
}

// ── READ (SA view) ────────────────────────────────────────────
// Returns all services with category name joined
// Also returns categories list for the modal dropdown
function getLabServices() {
  return withCache_('lab_services', 'sa', 60, _getLabServices_);
}

function _getLabServices_() {
  try {
    const ss = getSS_();
    const sh = getLabServSheet_();
    const lr = sh.getLastRow();
    const catSh = ss.getSheetByName('Categories');
    const deptSh = ss.getSheetByName('Departments');

    // Build dept map
    const deptMap = {};
    if (deptSh && deptSh.getLastRow() >= 2) {
      deptSh.getRange(2, 1, deptSh.getLastRow() - 1, 6).getValues()
        .filter(r => r[0])
        .forEach(r => { deptMap[String(r[0]).trim()] = String(r[5] || 'lab').trim(); });
    }

    // Build cat map — single read
    const catMap = {};
    const catTypeMap = {};
    const cats = [];
    if (catSh && catSh.getLastRow() >= 2) {
      catSh.getRange(2, 1, catSh.getLastRow() - 1, 3).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .forEach(r => {
          const catId = String(r[0]).trim();
          const deptId = String(r[1] || '').trim();
          catMap[catId] = String(r[2] || '').trim();
          catTypeMap[catId] = deptMap[deptId] || 'lab';
          cats.push({ cat_id: catId, dept_id: deptId, category_name: catMap[catId] });
        });
    }

    const data = lr < 2 ? [] :
      sh.getRange(2, 1, lr - 1, Math.max(sh.getLastColumn(), 12)).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .map(r => {
          const cId = String(r[1]).trim();
          const dynamicType = catTypeMap[cId] || 'lab';
          return {
            serv_id: String(r[0]).trim(),
            cat_id: cId,
            cat_name: catMap[cId] || '',
            serv_name: String(r[2] || '').trim(),
            default_fee: parseFloat(r[3]) || 0,
            specimen_type: String(r[4] || '').trim(),
            is_philhealth_covered: r[5] == 1 ? 1 : 0,
            is_active: r[6] == 1 ? 1 : 0,
            created_at: r[7] ? new Date(r[7]).toISOString() : '',
            updated_at: r[8] ? new Date(r[8]).toISOString() : '',
            service_type: dynamicType,
            is_consultation: dynamicType === 'consultation' ? 1 : 0,
            template_url: String(r[11] || '').trim()
          };
        });

    Logger.log('getLabServices: ' + data.length + ' services');
    return { success: true, data, cats };
  } catch (err) {
    Logger.log('getLabServices ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── READ (Branch Admin view) ──────────────────────────────────
// Returns services grouped by category with branch overrides applied
function getBranchServStatus(branchId) {
  return withCache_('lab_services', 'branch:' + (branchId || ''), 60, function() { return _getBranchServStatus_(branchId); });
}

function _getBranchServStatus_(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };

    const ss = getSS_();
    const sh = getLabServSheet_();
    const catSh = ss.getSheetByName('Categories');
    const deptSh = ss.getSheetByName('Departments');
    const bssSh = getBranchServStatusSheet_();

    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    // Build dept map
    const deptMap = {};
    if (deptSh && deptSh.getLastRow() >= 2) {
      deptSh.getRange(2, 1, deptSh.getLastRow() - 1, 6).getValues()
        .filter(r => r[0])
        .forEach(r => { deptMap[String(r[0]).trim()] = String(r[5] || 'lab').trim(); });
    }

    // Build cat map
    const catMap = {};
    const catTypeMap = {};
    if (catSh) {
      const clr = catSh.getLastRow();
      if (clr >= 2) {
        catSh.getRange(2, 1, clr - 1, 3).getValues()
          .filter(r => r[0])
          .forEach(r => {
            const cId = String(r[0]).trim();
            const dId = String(r[1] || '').trim();
            catMap[cId] = String(r[2] || '').trim();
            catTypeMap[cId] = deptMap[dId] || 'lab';
          });
      }
    }

    // Load master services
    const masterServs = sh.getRange(2, 1, lr - 1, Math.max(sh.getLastColumn(), 12)).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => {
        const cId = String(r[1]).trim();
        const dynamicType = catTypeMap[cId] || 'lab';
        return {
          serv_id: String(r[0]).trim(),
          cat_id: cId,
          cat_name: catMap[cId] || '',
          serv_name: String(r[2] || '').trim(),
          default_fee: parseFloat(r[3]) || 0,
          specimen_type: String(r[4] || '').trim(),
          master_active: r[6] == 1 ? 1 : 0,
          service_type: dynamicType,
          is_consultation: dynamicType === 'consultation' ? 1 : 0,
          template_url: String(r[11] || '').trim()
        };
      });

    // Load branch overrides
    const override = {};
    const blr = bssSh.getLastRow();
    if (blr >= 2) {
      bssSh.getRange(2, 1, blr - 1, 5).getValues()
        .filter(r => String(r[0]).trim() === branchId)
        .forEach(r => { 
           override[String(r[1]).trim()] = {
             is_active: r[2] == 1 ? 1 : 0,
             template_url: String(r[4]||'').trim()
           }; 
        });
    }

    // Group by category
    const grouped = {};
    const catOrder = [];
    masterServs.forEach(svc => {
      const key = svc.cat_id || '__none__';
      if (!grouped[key]) {
        grouped[key] = { cat_id: key, cat_name: svc.cat_name || 'Uncategorized', services: [] };
        catOrder.push(key);
      }
      const hasOverride = svc.serv_id in override;
      const branchActive = svc.master_active === 0
        ? 0
        : (hasOverride ? override[svc.serv_id].is_active : 1); // default active
      
      grouped[key].services.push(Object.assign({}, svc, {
         branch_active: branchActive
         // template_url already comes from svc (Lab_Services master)
      }));
    });

    const data = catOrder.map(k => grouped[k]);
    Logger.log('getBranchServStatus: ' + branchId + ' → ' + masterServs.length + ' services');
    return { success: true, data };

  } catch (err) {
    Logger.log('getBranchServStatus ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── CREATE ────────────────────────────────────────────────────
function createLabService(payload) {
  try {
    if (!payload.serv_name) return { success: false, message: 'Service name is required.' };
    if (!payload.cat_id) return { success: false, message: 'Category is required.' };
    if (payload.default_fee == null || isNaN(payload.default_fee)) return { success: false, message: 'Valid fee is required.' };

    const sh = getLabServSheet_();
    const now = new Date();

    // Duplicate name check within same category
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2, 2, lr - 1, 2).getValues();
      const dup = rows.some(r =>
        String(r[0]).trim() === payload.cat_id.trim() &&
        String(r[1]).trim().toLowerCase() === payload.serv_name.trim().toLowerCase()
      );
      if (dup) return { success: false, message: `"${payload.serv_name}" already exists in this category.` };
    }

    const servId = 'SERV-' + Math.random().toString(16).substr(2, 8).toUpperCase();

    // Dynamically derive type by Category->Department.
    // getCategories() returns a raw array, getDepartments() wraps in
    // { success, data } — unwrap the latter before .find().
    const allCats = getCategories();
    const catData = allCats.find(c => String(c.cat_id).trim() === String(payload.cat_id).trim());
    const deptId = catData ? String(catData.dept_id).trim() : null;
    const deptResp = getDepartments();
    const allDepts = (deptResp && deptResp.data) || [];
    const deptData = allDepts.find(d => String(d.dept_id).trim() === deptId);
    const derivedType = deptData ? deptData.department_type : 'lab';
    const isCon = derivedType === 'consultation' ? 1 : 0;

    sh.appendRow([
      servId,
      payload.cat_id.trim(),
      payload.serv_name.trim(),
      payload.default_fee,
      (payload.specimen_type || '').trim(),
      payload.is_philhealth_covered == 1 ? 1 : 0,
      1,
      now,
      now,
      derivedType,
      isCon,
      (payload.template_url || '').trim()
    ]);

    // Propagate to all branches (default active)
    propagateServToAllBranches_(servId);

    cacheBust_('lab_services');
    writeAuditLog_('SERV_CREATE', { serv_id: servId, serv_name: payload.serv_name });
    Logger.log('createLabService: ' + servId);
    return { success: true, serv_id: servId };

  } catch (err) {
    Logger.log('createLabService ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── UPDATE ────────────────────────────────────────────────────
function updateLabService(payload) {
  try {
    if (!payload.serv_id) return { success: false, message: 'Service ID is required.' };
    if (!payload.serv_name) return { success: false, message: 'Service name is required.' };
    if (!payload.cat_id) return { success: false, message: 'Category is required.' };
    if (payload.default_fee == null || isNaN(payload.default_fee)) return { success: false, message: 'Valid fee is required.' };

    const sh = getLabServSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Service not found.' };

    const allRows = sh.getRange(2, 1, lr - 1, Math.max(sh.getLastColumn(), 12)).getValues();

    // Duplicate name check within same category — exclude self
    const dup = allRows.some(r =>
      String(r[0]).trim() !== payload.serv_id.trim() &&
      String(r[1]).trim() === payload.cat_id.trim() &&
      String(r[2]).trim().toLowerCase() === payload.serv_name.trim().toLowerCase()
    );
    if (dup) return { success: false, message: `"${payload.serv_name}" already exists in this category.` };

    const rowIdx = allRows.findIndex(r => String(r[0]).trim() === payload.serv_id.trim());
    if (rowIdx === -1) return { success: false, message: 'Service not found.' };

    const existing = allRows[rowIdx];
    const createdAt = existing[7] || new Date();
    const isActive = existing[6];

    // Dynamically derive type — unwrap getDepartments() the same
    // way createLabService does.
    const allCats = getCategories();
    const catData = allCats.find(c => String(c.cat_id).trim() === String(payload.cat_id).trim());
    const deptId = catData ? String(catData.dept_id).trim() : null;
    const deptResp = getDepartments();
    const allDepts = (deptResp && deptResp.data) || [];
    const deptData = allDepts.find(d => String(d.dept_id).trim() === deptId);
    const derivedType = deptData ? deptData.department_type : 'lab';
    const isCon = derivedType === 'consultation' ? 1 : 0;

    // Preserve existing template_url if the payload doesn't include it.
    // (UI no longer edits template_url in Phase 1+2 cleanup; existing data
    // stays in the sheet as legacy reference.)
    var templateUrlValue = Object.prototype.hasOwnProperty.call(payload, 'template_url')
      ? (payload.template_url || '').trim()
      : (existing[11] || '');

    sh.getRange(rowIdx + 2, 2, 1, 11).setValues([[
      payload.cat_id.trim(),
      payload.serv_name.trim(),
      payload.default_fee,
      (payload.specimen_type || '').trim(),
      payload.is_philhealth_covered == 1 ? 1 : 0,
      isActive,
      createdAt,
      new Date(),
      derivedType,
      isCon,
      templateUrlValue
    ]]);

    cacheBust_('lab_services');
    writeAuditLog_('SERV_UPDATE', { serv_id: payload.serv_id, serv_name: payload.serv_name });
    Logger.log('updateLabService: ' + payload.serv_id);
    return { success: true };
  } catch (err) {
    Logger.log('updateLabService ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── SET TEMPLATE URL (inline SA save) ────────────────────────
function setLabServiceTemplate(servId, templateUrl) {
  try {
    if (!servId) return { success: false, message: 'Service ID required.' };
    const sh = getLabServSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Service not found.' };
    const ids = sh.getRange(2, 1, lr - 1, 1).getValues().flat().map(String);
    const rowIdx = ids.findIndex(id => id.trim() === servId.trim());
    if (rowIdx === -1) return { success: false, message: 'Service not found.' };
    sh.getRange(rowIdx + 2, 12).setValue((templateUrl || '').trim());
    sh.getRange(rowIdx + 2, 9).setValue(new Date());
    cacheBust_('lab_services');
    return { success: true };
  } catch (err) {
    Logger.log('setLabServiceTemplate ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── BATCH SAVE TEMPLATE URLS ─────────────────────────────────
function saveLabServiceTemplates(templates) {
  try {
    if (!templates || !templates.length) return { success: true };
    const sh = getLabServSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'No services found.' };
    const ids = sh.getRange(2, 1, lr - 1, 1).getValues().flat().map(String);
    const now = new Date();
    templates.forEach(function(t) {
      const rowIdx = ids.findIndex(id => id.trim() === String(t.serv_id || '').trim());
      if (rowIdx !== -1) {
        sh.getRange(rowIdx + 2, 12).setValue((t.template_url || '').trim());
        sh.getRange(rowIdx + 2, 9).setValue(now);
      }
    });
    cacheBust_('lab_services');
    return { success: true };
  } catch (err) {
    Logger.log('saveLabServiceTemplates ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── DELETE ────────────────────────────────────────────────────
function deleteLabService(servId) {
  try {
    if (!servId) return { success: false, message: 'Service ID required.' };

    const sh = getLabServSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Service not found.' };

    const ids = sh.getRange(2, 1, lr - 1, 1).getValues().flat().map(String);
    const rowIdx = ids.findIndex(id => id.trim() === servId.trim());
    if (rowIdx === -1) return { success: false, message: 'Service not found.' };

    sh.deleteRow(rowIdx + 2);

    // Clean up branch status rows for this service
    cleanServBranchStatus_(servId);

    cacheBust_('lab_services');
    writeAuditLog_('SERV_DELETE', { serv_id: servId });
    Logger.log('deleteLabService: ' + servId);
    return { success: true };

  } catch (err) {
    Logger.log('deleteLabService ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── SET BRANCH SERV STATUS ────────────────────────────────────
function setBranchServStatus(branchId, servId, isActive, templateUrl) {
  try {
    const sh = getBranchServStatusSheet_();
    const now = new Date();
    const lr = sh.getLastRow();
    
    // Ensure the parameter is undefined if not explicitly passed during a simple active toggle
    const isUpdatingUrl = typeof templateUrl !== 'undefined';

    if (lr >= 2) {
      const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === branchId && String(rows[i][1]).trim() === servId) {
          if (isUpdatingUrl) {
             sh.getRange(i + 2, 3, 1, 3).setValues([[isActive == 1 ? 1 : 0, now, (templateUrl||'').trim()]]);
          } else {
             sh.getRange(i + 2, 3, 1, 2).setValues([[isActive == 1 ? 1 : 0, now]]);
          }
          cacheBust_('lab_services');
          return { success: true };
        }
      }
    }
    sh.appendRow([branchId, servId, isActive == 1 ? 1 : 0, now, isUpdatingUrl ? (templateUrl||'').trim() : '']);
    cacheBust_('lab_services');
    return { success: true };
  } catch (err) {
    Logger.log('setBranchServStatus ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── PROPAGATE new service to all branches ────────────────────
function propagateServToAllBranches_(servId) {
  try {
    const brSh = getSS_().getSheetByName('Branches');
    if (!brSh) return;
    const lr = brSh.getLastRow();
    if (lr < 2) return;
    brSh.getRange(2, 1, lr - 1, 1).getValues()
      .map(r => String(r[0]).trim()).filter(Boolean)
      .forEach(branchId => setBranchServStatus(branchId, servId, 1));
    Logger.log('propagateServToAllBranches_: ' + servId);
  } catch (e) { Logger.log('propagateServToAllBranches_ ERROR: ' + e.message); }
}

// ── CLEANUP branch status rows when service deleted ──────────
function cleanServBranchStatus_(servId) {
  try {
    const sh = getBranchServStatusSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return;
    const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
    const toDelete = [];
    rows.forEach((r, i) => { if (String(r[1]).trim() === servId) toDelete.push(i + 2); });
    toDelete.sort((a, b) => b - a).forEach(row => sh.deleteRow(row));
  } catch (e) { Logger.log('cleanServBranchStatus_ ERROR: ' + e.message); }
}

// ── GET ALL BRANCHES + STATUS FOR A SERVICE (SA modal) ───────
// Returns every branch with is_active for the given service
function getServBranchStatus(servId) {
  try {
    if (!servId) return { success: false, message: 'Service ID required.' };

    const brSh = getSS_().getSheetByName('Branches');
    const bssSh = getBranchServStatusSheet_();
    if (!brSh) return { success: false, message: '"Branches" sheet not found.' };

    // Load all branches
    const brLR = brSh.getLastRow();
    if (brLR < 2) return { success: true, data: [] };

    const branches = brSh.getRange(2, 1, brLR - 1, 3).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({
        branch_id: String(r[0]).trim(),
        branch_name: String(r[1]).trim(),
        branch_code: String(r[2]).trim()
      }));

    // Load branch overrides for this service
    const override = {};
    const bssLR = bssSh.getLastRow();
    if (bssLR >= 2) {
      bssSh.getRange(2, 1, bssLR - 1, 3).getValues()
        .filter(r => String(r[1]).trim() === servId)
        .forEach(r => { override[String(r[0]).trim()] = r[2] == 1 ? 1 : 0; });
    }

    // Merge — default active if no override
    const data = branches.map(b => ({
      branch_id: b.branch_id,
      branch_name: b.branch_name,
      branch_code: b.branch_code,
      is_active: b.branch_id in override ? override[b.branch_id] : 1
    }));

    Logger.log('getServBranchStatus: ' + servId + ' → ' + data.length + ' branches');
    return { success: true, data };

  } catch (err) {
    Logger.log('getServBranchStatus ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── ENSURE service_type col (col 10) ─────────────────────────
// Non-breaking — appended after existing 9 cols
// Values: 'lab' (default) | 'xray'
function ensureServTypeCol_(sh) {
  if (!sh || sh.getLastRow() < 1) return;
  if (sh.getLastColumn() < 10) {
    sh.getRange(1, 10).setValue('service_type');
  }
  if (sh.getLastColumn() < 11) {
    sh.getRange(1, 11).setValue('is_consultation');
  }
}

//  SET CONSULTATION STATUS
function setServiceConsultation(servId, isConsult) {
  try {
    if (!servId) return { success: false, message: 'Service ID required.' };
    const sh = getLabServSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Service not found.' };

    const rows = sh.getRange(2, 1, lr - 1, 1).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === servId) {
        // Col 11 is is_consultation
        sh.getRange(i + 2, 11).setValue(isConsult == 1 ? 1 : 0);
        cacheBust_('lab_services');
        writeAuditLog_('SERV_CONSULTATION_UPDATE', { serv_id: servId, is_consultation: isConsult });
        return { success: true };
      }
    }
    return { success: false, message: 'Service not found.' };
  } catch (err) {
    Logger.log('setServiceConsultation ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  LAB SERVICE PARAMETERS
//  Configures test parameters per service (param name, unit, ref range)
//  Used by Tech Dashboard encoding form
//
//  Lab_Serv_Params sheet:
//    A=param_id  B=serv_id  C=param_name  D=unit
//    E=reference_range  F=sort_order  G=created_at  H=updated_at
//    I=field_type  J=options
// ════════════════════════════════════════════════════════════════

function getLabServParamsSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName('Lab_Serv_Params');
  if (!sh) {
    sh = ss.insertSheet('Lab_Serv_Params');
    sh.getRange(1, 1, 1, 10).setValues([[
      'param_id', 'serv_id', 'param_name', 'unit',
      'reference_range', 'sort_order', 'created_at', 'updated_at',
      'field_type', 'options'
    ]]);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  } else {
    // Migrate: add field_type/options columns if not present
    const lastCol = sh.getLastColumn();
    if (lastCol < 9) sh.getRange(1, 9).setValue('field_type');
    if (lastCol < 10) sh.getRange(1, 10).setValue('options');
  }
  return sh;
}

function getLabServiceParams(servId) {
  try {
    if (!servId) return { success: false, message: 'Service ID required.' };
    const sh = getLabServParamsSheet_();
    const lr = sh.getLastRow();
    const data = lr < 2 ? [] : sh.getRange(2, 1, lr - 1, Math.max(sh.getLastColumn(), 10)).getValues()
      .filter(r => r[0] && String(r[1]).trim() === servId)
      .sort((a, b) => (Number(a[5]) || 0) - (Number(b[5]) || 0))
      .map(r => ({
        param_id: String(r[0]).trim(),
        serv_id: String(r[1]).trim(),
        param_name: String(r[2] || '').trim(),
        unit: String(r[3] || '').trim(),
        reference_range: String(r[4] || '').trim(),
        sort_order: Number(r[5]) || 0,
        field_type: String(r[8] || 'numeric').trim() || 'numeric',
        options: String(r[9] || '').trim()
      }));

    // Also return the service's sheet template URL
    var templateUrl = '';
    const servSh = getLabServSheet_();
    const slr = servSh.getLastRow();
    if (slr >= 2) {
      const servRows = servSh.getRange(2, 1, slr - 1, 12).getValues();
      const servRow = servRows.find(r => String(r[0]).trim() === servId);
      if (servRow) templateUrl = String(servRow[11] || '').trim();
    }

    // Phase 1+2 cleanup: Sheet Template mode is removed; always return
    // 'params' so any stale 'sheet_template' value in lab_encoding_mode is
    // ignored. template_url is still returned for backwards-compat with
    // other callers but is no longer surfaced in the UI.
    return { success: true, data, template_url: templateUrl, encoding_mode: 'params' };
  } catch (e) {
    Logger.log('getLabServiceParams ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Save (full replace) parameters for a service
function saveLabServiceParams(servId, params) {
  try {
    if (!servId) return { success: false, message: 'Service ID required.' };
    const sh = getLabServParamsSheet_();
    const now = new Date();

    // Delete existing params for this service
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
      const toDelete = [];
      rows.forEach((r, i) => { if (String(r[1]).trim() === servId) toDelete.push(i + 2); });
      toDelete.sort((a, b) => b - a).forEach(row => sh.deleteRow(row));
    }

    // Insert new params
    if (params && params.length) {
      const newRows = params.map((p, i) => [
        'PRM-' + Math.random().toString(16).slice(2, 10).toUpperCase(),
        servId,
        (p.param_name || '').trim(),
        (p.unit || '').trim(),
        (p.reference_range || '').trim(),
        Number(p.sort_order) || (i + 1),
        now, now,
        (p.field_type || 'numeric').trim(),
        (p.options || '').trim()
      ]);
      sh.getRange(sh.getLastRow() + 1, 1, newRows.length, 10).setValues(newRows);
    }

    writeAuditLog_('SERV_PARAMS_SAVE', { serv_id: servId, count: (params || []).length });
    return { success: true };
  } catch (e) {
    Logger.log('saveLabServiceParams ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  X-RAY SIGNATURES (per branch)
//  Stored in System_Settings sheet as branch-specific keys
//
//  Keys:
//    xray_radtech_{branchId}  → Radiologic Technologist name + credentials
//    xray_radiologist_{branchId} → Radiologist name + credentials
// ════════════════════════════════════════════════════════════════

function getXraySignatures(branchId) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('System_Settings');
    if (!sh || sh.getLastRow() < 2) return { success: true, radtech: '', radiologist: '' };
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const get = key => {
      const r = rows.find(r => String(r[0]).trim() === key);
      if (!r) return '';
      try { return JSON.parse(String(r[1] || '').trim()); } catch(e) { return ''; }
    };
    return {
      success: true,
      radtech: get('xray_radtech_' + branchId),
      radiologist: get('xray_radiologist_' + branchId)
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function saveXraySignatures(branchId, radiologist) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const ss = getSS_();
    let sh = ss.getSheetByName('System_Settings');
    if (!sh) {
      sh = ss.insertSheet('System_Settings');
      sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
      sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      sh.setFrozenRows(1);
    }
    const upsert = (key, value) => {
      const lr = sh.getLastRow();
      if (lr >= 2) {
        const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
        const idx = rows.findIndex(r => String(r[0]).trim() === key);
        if (idx !== -1) {
          // Preserve existing signature_url if not provided in new value
          let existing = {};
          try { existing = JSON.parse(String(rows[idx][1] || '{}')); } catch(e) {}
          const merged = Object.assign({}, existing, value);
          sh.getRange(idx + 2, 2).setValue(JSON.stringify(merged));
          return;
        }
      }
      sh.appendRow([key, JSON.stringify(value)]);
    };
    upsert('xray_radiologist_' + branchId, radiologist || {});
    writeAuditLog_('XRAY_SIGNATURES_SAVE', { branch_id: branchId });
    return { success: true };
  } catch (e) {
    Logger.log('saveXraySignatures ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  LAB RESULT SIGNATURES (per branch)
//  Stored in System_Settings sheet as branch-specific JSON keys:
//    lab_medtech_{branchId}    → Medical Technologist name + credentials
//    lab_pathologist_{branchId} → Pathologist name + credentials
// ════════════════════════════════════════════════════════════════

function getLabSignatures(branchId) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('System_Settings');
    if (!sh || sh.getLastRow() < 2) return { success: true, medtech: '', pathologist: '' };
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const get = key => {
      const r = rows.find(r => String(r[0]).trim() === key);
      if (!r) return '';
      try { return JSON.parse(String(r[1] || '').trim()); } catch(e) { return ''; }
    };
    return {
      success: true,
      medtech:     get('lab_medtech_'     + branchId),
      pathologist: get('lab_pathologist_' + branchId)
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function saveLabSignatures(branchId, pathologist) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const ss = getSS_();
    let sh = ss.getSheetByName('System_Settings');
    if (!sh) {
      sh = ss.insertSheet('System_Settings');
      sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
      sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      sh.setFrozenRows(1);
    }
    const upsert = (key, value) => {
      const lr = sh.getLastRow();
      if (lr >= 2) {
        const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
        const idx = rows.findIndex(r => String(r[0]).trim() === key);
        if (idx !== -1) {
          // Preserve existing signature_url if not provided in new value
          let existing = {};
          try { existing = JSON.parse(String(rows[idx][1] || '{}')); } catch(e) {}
          const merged = Object.assign({}, existing, value);
          sh.getRange(idx + 2, 2).setValue(JSON.stringify(merged));
          return;
        }
      }
      sh.appendRow([key, JSON.stringify(value)]);
    };
    upsert('lab_pathologist_' + branchId, pathologist || {});
    writeAuditLog_('LAB_SIGNATURES_SAVE', { branch_id: branchId });
    return { success: true };
  } catch (e) {
    Logger.log('saveLabSignatures ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  PATIENT FOLDER CONFIGS (per branch)
//  Stored in System_Settings sheet as branch-specific keys
//
//  Keys:
//    patient_folder_{branchId} → Root folder ID for patient generation
// ════════════════════════════════════════════════════════════════
function getDriveFolderConfig(branchId) {
  try {
    const ss = getSS_();
    const sh = ss.getSheetByName('System_Settings');
    if (!sh || sh.getLastRow() < 2) return { success: true, root_folder_id: '' };
    
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const key = 'patient_folder_' + branchId;
    const match = rows.find(r => String(r[0]).trim() === key);
    
    let folderId = match ? String(match[1] || '').trim() : '';
    // If a full URL was previously saved, extract the ID now
    const folderUrlMatch = folderId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderUrlMatch) folderId = folderUrlMatch[1];
    return { success: true, root_folder_id: folderId };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function saveDriveFolderConfig(branchId, rootFolderId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const ss = getSS_();
    let sh = ss.getSheetByName('System_Settings');
    
    // Auto-extract ID from URL if user pastes full URL
    let extractedId = (rootFolderId || '').trim();
    const foldersMatch = extractedId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (foldersMatch) {
      extractedId = foldersMatch[1];
    } else if (extractedId.includes('id=')) {
      extractedId = extractedId.split('id=')[1].split('&')[0];
    }

    if (!sh) {
      sh = ss.insertSheet('System_Settings');
      sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
      sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      sh.setFrozenRows(1);
    }
    
    const key = 'patient_folder_' + branchId;
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2, 1, lr - 1, 1).getValues().flat().map(String);
      const idx = rows.findIndex(k => k.trim() === key);
      if (idx !== -1) { 
        sh.getRange(idx + 2, 2).setValue(extractedId); 
        writeAuditLog_('DRIVE_FOLDER_CONFIG_SAVE', { branch_id: branchId });
        return { success: true };
      }
    }
    sh.appendRow([key, extractedId]);
    writeAuditLog_('DRIVE_FOLDER_CONFIG_SAVE', { branch_id: branchId });
    return { success: true };
  } catch (e) {
    Logger.log('saveDriveFolderConfig ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}
