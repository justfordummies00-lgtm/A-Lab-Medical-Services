// ============================================================
//  A-LAB — BranchesCode.gs
//  Backend CRUD for the Branches module.
// ============================================================

// ── SHEET ACCESSOR ──────────────────────────────────────────
function getBranchSheet_() {
  const sh = getSS_().getSheetByName('Branches');
  if (!sh) throw new Error('"Branches" sheet not found.');
  return sh;
}

// ── READ ────────────────────────────────────────────────────
// Columns: A=branch_id B=branch_name C=branch_code D=address
//          E=contact   F=email       G=status      H=spreadsheet_id
//          I=spreadsheet_url  J=created_at  K=updated_at
//
// branchIds — comma-separated list of allowed branch IDs.
//   Pass empty string or omit for Super Admin (returns all).
//   Pass branch_ids from session for Branch Admin (filtered).
function getBranches(branchIds) {
  const filter = (branchIds || '').toString().trim();
  return withCache_('branches', filter || 'all', 60, function() {
    try {
      const sh      = getBranchSheet_();
      const lastRow = sh.getLastRow();
      if (lastRow < 2) return { success: true, data: [] };

      // Parse allowed IDs — empty = Super Admin = all
      const allowedSet = filter
        ? new Set(filter.split(',').map(id => id.trim()).filter(Boolean))
        : null;  // null = no filter

      const rows = sh.getRange(2, 1, lastRow - 1, 11).getValues();
      const data = rows
        .filter(r => {
          if (!r[0] || !String(r[0]).trim()) return false;
          if (allowedSet && !allowedSet.has(String(r[0]).trim())) return false;
          return true;
        })
        .map(r => ({
          branch_id:       String(r[0]  || '').trim(),
          branch_name:     String(r[1]  || '').trim(),
          branch_code:     String(r[2]  || '').trim(),
          address:         String(r[3]  || '').trim(),
          contact:         String(r[4]  || '').trim(),
          email:           String(r[5]  || '').trim(),
          status:          String(r[6]  || 'Active').trim(),
          spreadsheet_id:  String(r[7]  || '').trim(),
          spreadsheet_url: String(r[8]  || '').trim(),
          created_at:      r[9]  ? new Date(r[9]).toISOString()  : '',
          updated_at:      r[10] ? new Date(r[10]).toISOString() : ''
        }));

      Logger.log('getBranches: ' + data.length + ' records' + (allowedSet ? ' (filtered)' : ''));
      return { success: true, data };
    } catch (err) {
      Logger.log('getBranches ERROR: ' + err.message);
      return { success: false, message: err.message };
    }
  });
}

// ── CREATE ───────────────────────────────────────────────────
// Auto-creates a dedicated Google Spreadsheet for the branch.
// The SS ID and URL are generated here — never set by the user.
function createBranch(payload) {
  try {
    if (!payload.branch_name) return { success: false, message: 'Branch name is required.' };
    if (!payload.branch_code) return { success: false, message: 'Branch code is required.' };
    if (!payload.address)     return { success: false, message: 'Address is required.' };

    const sh      = getBranchSheet_();
    const lastRow = sh.getLastRow();

    // ── Limit check ──
    // lastRow - 1 represents the number of existing branches (row 1 is header)
    if (lastRow - 1 >= 3) {
      return { success: false, message: 'Limit reached. You can only create up to 3 branches. Please contact your admin to add more.' };
    }

    // ── Duplicate code check ──
    if (lastRow >= 2) {
      const codes = sh.getRange(2, 3, lastRow - 1, 1).getValues().flat().map(String);
      if (codes.some(c => c.trim().toUpperCase() === payload.branch_code.trim().toUpperCase())) {
        return { success: false, message: `Branch code "${payload.branch_code}" already exists.` };
      }
    }

    // ── Auto-create branch spreadsheet ──
    const ssName   = `A-Lab | ${payload.branch_name.trim()} [${payload.branch_code.trim().toUpperCase()}]`;
    const branchSS = SpreadsheetApp.create(ssName);
    const ssId     = branchSS.getId();
    const ssUrl    = branchSS.getUrl();

    // Seed the new spreadsheet with default sheets
    setupBranchSpreadsheet_(branchSS, payload);

    // ── Generate branch ID ──
    const branchId = 'BR-' + Math.random().toString(16).substr(2, 8).toUpperCase();

    // ── Create Branch Folder in Google Drive (if configured) ──
    const branchDbFolderId = getSettingValue_('alab_branch_db_id', '');
    if (branchDbFolderId) {
      try {
        const branchDbFolder = DriveApp.getFolderById(branchDbFolderId);
        const newBranchFolder = branchDbFolder.createFolder(`${payload.branch_code.trim().toUpperCase()} - ${payload.branch_name.trim()}`);
        
        // Move the newly created spreadsheet into this folder
        const ssFile = DriveApp.getFileById(ssId);
        ssFile.moveTo(newBranchFolder);
        
        // Create Patients folder inside the newly created branch folder
        const patientsFolder = newBranchFolder.createFolder("Patients");
        
        // Save the patients folder ID in System_Settings
        saveSystemSetting('patient_folder_' + branchId, patientsFolder.getId(), 'System');
        
        Logger.log(`Created branch folder and moved SS: ${newBranchFolder.getName()}`);
      } catch (err) {
        Logger.log(`Failed to create/move branch folder in Drive: ${err.message}`);
      }
    }
    const now      = new Date();

    sh.appendRow([
      branchId,
      payload.branch_name.trim(),
      payload.branch_code.trim().toUpperCase(),
      (payload.address  || '').trim(),
      (payload.contact  || '').trim(),
      (payload.email    || '').trim(),
      (payload.status   || 'Active').trim(),
      ssId,
      ssUrl,
      now,  // created_at
      now   // updated_at
    ]);

    cacheBust_('branches');
    writeAuditLog_('BRANCH_CREATE', {
      branch_id:       branchId,
      branch_name:     payload.branch_name,
      spreadsheet_id:  ssId
    });
    Logger.log('createBranch: created ' + branchId + ' → SS ' + ssId);

    return {
      success:         true,
      branch_id:       branchId,
      spreadsheet_id:  ssId,
      spreadsheet_url: ssUrl
    };

  } catch (err) {
    Logger.log('createBranch ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── SETUP BRANCH SPREADSHEET ─────────────────────────────────
function setupBranchSpreadsheet_(ss, payload) {
  try {
    const code = (payload.branch_code || '').trim().toUpperCase();
    const name = (payload.branch_name || '').trim();
    const hdr  = (sh, cols) => { sh.getRange(1,1,1,cols.length).setValues([cols]).setFontWeight('bold').setBackground('#0d9090').setFontColor('#fff'); sh.setFrozenRows(1); };

    // ── LAB_ORDER (rename default sheet) — 19 cols ──
    const orderSh = ss.getSheets()[0];
    orderSh.setName('LAB_ORDER');
    orderSh.setTabColor('#0d9090');
    hdr(orderSh, ['order_id','order_no','branch_id','patient_id','doctor_id',
      'order_date','status','created_by','created_at','updated_at','notes',
      'patient_name','doctor_name','created_by_name','net_amount',
      'doctor_id_2','doctor_name_2','philhealth_pin','philhealth_claim']);

    // ── LAB_ORDER_ITEM ──
    const itemSh = ss.insertSheet('LAB_ORDER_ITEM');
    hdr(itemSh, ['order_item_id','order_id','lab_id','dept_id','lab_name',
      'qty','unit_fee','line_gross','discount_id','discount_amount','line_net',
      'tat_due_at','status']);

    // ── PAYMENT ──
    const paySh = ss.insertSheet('PAYMENT');
    hdr(paySh, ['payment_id','order_id','paid_at','amount','method',
      'reference_no','received_by','status','remarks']);

    // ── RESULT ──
    const resSh = ss.insertSheet('RESULT');
    hdr(resSh, ['result_id','order_item_id','performed_by','verified_by',
      'performed_at','verified_at','result_status','result_summary',
      'result_file_id','patient_folder_id','notes']);

    // ── Patients ──
    const patSh = ss.insertSheet('Patients');
    hdr(patSh, ['patient_id','last_name','first_name','middle_name',
      'sex','dob','contact','email','address',
      'philhealth_pin','discount_ids','created_at','updated_at']);
    patSh.getRange(2,6,1000,1).setNumberFormat('yyyy-mm-dd');
    patSh.getRange(2,12,1000,2).setNumberFormat('yyyy-mm-dd hh:mm:ss');

    // ── AUDIT_LOG ──
    const auditSh = ss.insertSheet('AUDIT_LOG');
    hdr(auditSh, ['audit_id','timestamp','actor_id','action',
      'entity_type','entity_id','before_json','after_json']);

    // ── PHILHEALTH_LEDGER ──
    const ledgerSh = ss.insertSheet('PHILHEALTH_LEDGER');
    hdr(ledgerSh, ['ledger_id','patient_id','philhealth_pin','year',
      'total_claimed','last_updated']);

    // ── PHILHEALTH_CLAIMS ──
    const claimsSh = ss.insertSheet('PHILHEALTH_CLAIMS');
    hdr(claimsSh, ['claim_id','order_id','patient_id','philhealth_pin',
      'amount_claimed','year','status','filed_at','remarks']);

    // ── Settings (order sequence counter) ──
    const settingsSh = ss.insertSheet('Settings');
    settingsSh.getRange(1,1,2,2).setValues([['key','value'],['order_seq','0']]);
    settingsSh.getRange(1,1,1,2).setFontWeight('bold').setBackground('#475569').setFontColor('#fff');

    // ── Branch Info ──
    const infoSh = ss.insertSheet('Branch Info');
    infoSh.getRange(1,1,6,2).setValues([
      ['Branch Name', name], ['Branch Code', code],
      ['Address', payload.address||''], ['Contact', payload.contact||''],
      ['Email',   payload.email||''],   ['Status',  payload.status||'Active']
    ]);
    infoSh.getRange(1,1,6,1).setFontWeight('bold');
    infoSh.setColumnWidth(1,140); infoSh.setColumnWidth(2,280);

    Logger.log('setupBranchSpreadsheet_: done for ' + name);
  } catch(err) {
    Logger.log('setupBranchSpreadsheet_ WARNING: ' + err.message);
  }
}

// ── UPDATE ───────────────────────────────────────────────────
// Updates branch details only — SS ID/URL are never changed after creation.
function updateBranch(payload) {
  try {
    if (!payload.branch_id)   return { success: false, message: 'Branch ID is required.' };
    if (!payload.branch_name) return { success: false, message: 'Branch name is required.' };
    if (!payload.branch_code) return { success: false, message: 'Branch code is required.' };
    if (!payload.address)     return { success: false, message: 'Address is required.' };

    const sh      = getBranchSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { success: false, message: 'Branch not found.' };

    // Single batch read — all cols at once
    const allRows = sh.getRange(2, 1, lastRow - 1, 11).getValues();

    // Duplicate code check + find row — one pass
    let rowIdx = -1;
    for (let i = 0; i < allRows.length; i++) {
      const id   = String(allRows[i][0]).trim();
      const code = String(allRows[i][2]).trim().toUpperCase();
      if (id !== payload.branch_id.trim() && code === payload.branch_code.trim().toUpperCase()) {
        return { success: false, message: `Branch code "${payload.branch_code}" is already used by another branch.` };
      }
      if (id === payload.branch_id.trim()) rowIdx = i;
    }
    if (rowIdx === -1) return { success: false, message: 'Branch not found.' };

    const existing  = allRows[rowIdx];
    const ssId      = existing[7] || '';
    const ssUrl     = existing[8] || '';
    const createdAt = existing[9] || new Date();
    const sheetRow  = rowIdx + 2;

    sh.getRange(sheetRow, 2, 1, 10).setValues([[
      payload.branch_name.trim(),
      payload.branch_code.trim().toUpperCase(),
      (payload.address || '').trim(),
      (payload.contact || '').trim(),
      (payload.email   || '').trim(),
      (payload.status  || 'Active').trim(),
      ssId, ssUrl, createdAt, new Date()
    ]]);

    // Update Branch Info sheet in branch SS (non-blocking best effort)
    if (ssId) {
      try {
        const infoSheet = openSS_(ssId).getSheetByName('Branch Info');
        if (infoSheet) {
          infoSheet.getRange(1, 2, 6, 1).setValues([
            [payload.branch_name.trim()],
            [payload.branch_code.trim().toUpperCase()],
            [(payload.address || '').trim()],
            [(payload.contact || '').trim()],
            [(payload.email   || '').trim()],
            [(payload.status  || 'Active').trim()]
          ]);
        }
      } catch(e) { Logger.log('updateBranch: branch SS info update failed: ' + e.message); }
    }

    cacheBust_('branches');
    writeAuditLog_('BRANCH_UPDATE', { branch_id: payload.branch_id, branch_name: payload.branch_name });
    Logger.log('updateBranch: updated ' + payload.branch_id);
    return { success: true };
  } catch (err) {
    Logger.log('updateBranch ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── DELETE ───────────────────────────────────────────────────
// Deletes the branch record. The branch spreadsheet is NOT deleted
// (data preservation — admin can manually delete if needed).
function deleteBranch(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID is required.' };

    const sh      = getBranchSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { success: false, message: 'Branch not found.' };

    const ids    = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String);
    const rowIdx = ids.findIndex(id => id.trim() === branchId.trim());
    if (rowIdx === -1) return { success: false, message: 'Branch not found.' };

    sh.deleteRow(rowIdx + 2);

    cacheBust_('branches');
    writeAuditLog_('BRANCH_DELETE', { branch_id: branchId });
    Logger.log('deleteBranch: deleted ' + branchId);
    return { success: true };

  } catch (err) {
    Logger.log('deleteBranch ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ============================================================
//  BRANCH DEPT/CAT STATUS
//
//  Branch_Dept_Status: branch_id | dept_id | is_active | updated_at
//  Branch_Cat_Status:  branch_id | cat_id  | is_active | updated_at
// ============================================================

function getBranchDeptStatusSheet_() {
  const ss = getSS_();
  let sh   = ss.getSheetByName('Branch_Dept_Status');
  if (!sh) {
    sh = ss.insertSheet('Branch_Dept_Status');
    sh.getRange(1,1,1,4).setValues([['branch_id','dept_id','is_active','updated_at']]);
    sh.getRange(1,1,1,4).setFontWeight('bold').setBackground('#0d9090').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getBranchCatStatusSheet_() {
  const ss = getSS_();
  let sh   = ss.getSheetByName('Branch_Cat_Status');
  if (!sh) {
    sh = ss.insertSheet('Branch_Cat_Status');
    sh.getRange(1,1,1,4).setValues([['branch_id','cat_id','is_active','updated_at']]);
    sh.getRange(1,1,1,4).setFontWeight('bold').setBackground('#0d9090').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── READ: Get branch-level dept+category status ───────────────
// Returns master departments with branch overrides applied
function getBranchDeptStatus(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };

    // Single getSS_() call — reuse for all sheet lookups
    const ss     = getSS_();
    const deptSh = ss.getSheetByName('Departments');
    const catSh  = ss.getSheetByName('Categories');
    const bdsSh  = getBranchDeptStatusSheet_();
    const bcsSh  = getBranchCatStatusSheet_();

    if (!deptSh) return { success: false, message: '"Departments" sheet not found.' };

    // Batch read all 4 sheets at once (GAS executes sequentially but no extra openById)
    const deptLR     = deptSh.getLastRow();
    if (deptLR < 2) return { success: true, data: [] };

    const masterDepts = deptSh.getRange(2,1,deptLR-1,5).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({ dept_id: String(r[0]).trim(), department_name: String(r[1]).trim(), master_active: r[2]==1?1:0 }));

    const catLR = catSh ? catSh.getLastRow() : 1;
    const masterCats = catLR >= 2
      ? catSh.getRange(2,1,catLR-1,4).getValues()
          .filter(r => r[0] && String(r[0]).trim())
          .map(r => ({ cat_id: String(r[0]).trim(), dept_id: String(r[1]).trim(), category_name: String(r[2]).trim(), master_active: r[3]==1?1:0 }))
      : [];

    // Build override maps in one pass each
    const deptOverride = {};
    const bdsLR = bdsSh.getLastRow();
    if (bdsLR >= 2) {
      bdsSh.getRange(2,1,bdsLR-1,3).getValues()
        .filter(r => String(r[0]).trim() === branchId)
        .forEach(r => { deptOverride[String(r[1]).trim()] = r[2]==1?1:0; });
    }

    const catOverride = {};
    const bcsLR = bcsSh.getLastRow();
    if (bcsLR >= 2) {
      bcsSh.getRange(2,1,bcsLR-1,3).getValues()
        .filter(r => String(r[0]).trim() === branchId)
        .forEach(r => { catOverride[String(r[1]).trim()] = r[2]==1?1:0; });
    }

    const data = masterDepts.map(dept => {
      const branchDeptActive = dept.master_active == 0 ? 0
        : (dept.dept_id in deptOverride ? deptOverride[dept.dept_id] : 1);
      const categories = masterCats
        .filter(c => c.dept_id === dept.dept_id)
        .map(cat => {
          const branchCatActive = dept.master_active == 0 || branchDeptActive == 0 || cat.master_active == 0 ? 0
            : (cat.cat_id in catOverride ? catOverride[cat.cat_id] : 1);
          return { cat_id: cat.cat_id, category_name: cat.category_name, master_active: cat.master_active, branch_active: branchCatActive };
        });
      return { dept_id: dept.dept_id, department_name: dept.department_name, master_active: dept.master_active, branch_active: branchDeptActive, categories };
    });

    Logger.log('getBranchDeptStatus: ' + branchId + ' → ' + data.length + ' depts');
    return { success: true, data };
  } catch (err) {
    Logger.log('getBranchDeptStatus ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── SET BRANCH DEPT STATUS ────────────────────────────────────
function setBranchDeptStatus(branchId, deptId, isActive) {
  try {
    const sh  = getBranchDeptStatusSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2,1,lr-1,2).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === branchId && String(rows[i][1]).trim() === deptId) {
          sh.getRange(i+2,3,1,2).setValues([[isActive==1?1:0, now]]);
          if (isActive == 0) cascadeBranchCatStatus_(branchId, deptId, 0);
          return { success: true };
        }
      }
    }
    sh.appendRow([branchId, deptId, isActive==1?1:0, now]);
    if (isActive == 0) cascadeBranchCatStatus_(branchId, deptId, 0);
    return { success: true };
  } catch (err) {
    Logger.log('setBranchDeptStatus ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

function setBranchCatStatus(branchId, catId, isActive) {
  try {
    const sh  = getBranchCatStatusSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2,1,lr-1,2).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === branchId && String(rows[i][1]).trim() === catId) {
          sh.getRange(i+2,3,1,2).setValues([[isActive==1?1:0, now]]);
          return { success: true };
        }
      }
    }
    sh.appendRow([branchId, catId, isActive==1?1:0, now]);
    return { success: true };
  } catch (err) {
    Logger.log('setBranchCatStatus ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── CASCADE: batch update all cats of a dept for a branch ────
// Replaces the old loop of N individual setBranchCatStatus calls
function cascadeBranchCatStatus_(branchId, deptId, isActive) {
  try {
    const catSh = getSS_().getSheetByName('Categories');
    if (!catSh || catSh.getLastRow() < 2) return;

    // Get all cat IDs for this dept in one read
    const catIds = catSh.getRange(2,1,catSh.getLastRow()-1,2).getValues()
      .filter(r => String(r[1]).trim() === deptId)
      .map(r => String(r[0]).trim())
      .filter(Boolean);
    if (!catIds.length) return;

    const sh  = getBranchCatStatusSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();
    const val = isActive==1?1:0;

    // Read existing rows once, update in memory, batch write
    const existingRows = lr >= 2 ? sh.getRange(2,1,lr-1,2).getValues() : [];
    const toInsert = [];
    const updated  = new Set();

    // Update existing rows
    existingRows.forEach((row, i) => {
      if (String(row[0]).trim() === branchId && catIds.includes(String(row[1]).trim())) {
        sh.getRange(i+2,3,1,2).setValues([[val, now]]);
        updated.add(String(row[1]).trim());
      }
    });

    // Insert missing rows in one batch
    catIds.forEach(catId => {
      if (!updated.has(catId)) toInsert.push([branchId, catId, val, now]);
    });
    if (toInsert.length) {
      sh.getRange(sh.getLastRow()+1, 1, toInsert.length, 4).setValues(toInsert);
    }
    Logger.log('cascadeBranchCatStatus_: updated ' + catIds.length + ' cats for dept ' + deptId);
  } catch(e) { Logger.log('cascadeBranchCatStatus_ ERROR: ' + e.message); }
}

// ── PROPAGATE: batch upsert for all branches when new dept/cat created ──
function propagateDeptToAllBranches_(deptId) {
  try {
    const brSh = getSS_().getSheetByName('Branches');
    if (!brSh || brSh.getLastRow() < 2) return;
    const branchIds = brSh.getRange(2,1,brSh.getLastRow()-1,1).getValues()
      .map(r => String(r[0]).trim()).filter(Boolean);
    if (!branchIds.length) return;

    const sh  = getBranchDeptStatusSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();
    const existingRows = lr >= 2 ? sh.getRange(2,1,lr-1,2).getValues() : [];
    const existing = new Set(existingRows.map(r => String(r[0]).trim()+'|'+String(r[1]).trim()));

    const toInsert = branchIds
      .filter(bid => !existing.has(bid+'|'+deptId))
      .map(bid => [bid, deptId, 1, now]);
    if (toInsert.length) sh.getRange(sh.getLastRow()+1,1,toInsert.length,4).setValues(toInsert);
    Logger.log('propagateDeptToAllBranches_: ' + deptId + ' → ' + toInsert.length + ' inserted');
  } catch(e) { Logger.log('propagateDeptToAllBranches_ ERROR: ' + e.message); }
}

function propagateCatToAllBranches_(catId) {
  try {
    const brSh = getSS_().getSheetByName('Branches');
    if (!brSh || brSh.getLastRow() < 2) return;
    const branchIds = brSh.getRange(2,1,brSh.getLastRow()-1,1).getValues()
      .map(r => String(r[0]).trim()).filter(Boolean);
    if (!branchIds.length) return;

    const sh  = getBranchCatStatusSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();
    const existingRows = lr >= 2 ? sh.getRange(2,1,lr-1,2).getValues() : [];
    const existing = new Set(existingRows.map(r => String(r[0]).trim()+'|'+String(r[1]).trim()));

    const toInsert = branchIds
      .filter(bid => !existing.has(bid+'|'+catId))
      .map(bid => [bid, catId, 1, now]);
    if (toInsert.length) sh.getRange(sh.getLastRow()+1,1,toInsert.length,4).setValues(toInsert);
    Logger.log('propagateCatToAllBranches_: ' + catId + ' → ' + toInsert.length + ' inserted');
  } catch(e) { Logger.log('propagateCatToAllBranches_ ERROR: ' + e.message); }
}