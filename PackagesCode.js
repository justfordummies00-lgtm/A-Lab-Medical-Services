// ============================================================
//  A-LAB — PackagesCode.gs
//
//  Sheets:
//    Packages:          package_id | package_name | description | default_fee | is_active | created_at | updated_at
//    Package_Items:     item_id | package_id | serv_id | created_at
//    Branch_Packages:   bp_id | branch_id | package_name | description | default_fee | is_active | created_at | updated_at
//    Branch_Pkg_Items:  item_id | bp_id | serv_id | created_at
//    Branch_Pkg_Status: branch_id | package_id | is_active | updated_at  (global packages per-branch toggle)
// ============================================================

// ── SHEET ACCESSORS ──────────────────────────────────────────
function getPkgSheet_()       { return getOrCreate_('Packages',          ['package_id','package_name','description','default_fee','is_active','created_at','updated_at']); }
function getPkgItemsSheet_()  { return getOrCreate_('Package_Items',     ['item_id','package_id','serv_id','created_at']); }
function getBPkgSheet_()      { return getOrCreate_('Branch_Packages',   ['bp_id','branch_id','package_name','description','default_fee','is_active','created_at','updated_at']); }
function getBPkgItemsSheet_() { return getOrCreate_('Branch_Pkg_Items',  ['item_id','bp_id','serv_id','created_at']); }
function getBPkgStatusSheet_(){ return getOrCreate_('Branch_Pkg_Status', ['branch_id','package_id','is_active','updated_at']); }

function getOrCreate_(name, headers) {
  const ss = getSS_();
  let sh   = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── SERVICE LOOKUP HELPER — single read, 4 cols ───────────────
function buildServMap_() {
  const map = {};
  const sh  = getSS_().getSheetByName('Lab_Services');
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2,1,sh.getLastRow()-1,4).getValues()
    .filter(r => r[0])
    .forEach(r => {
      map[String(r[0]).trim()] = {
        serv_id:     String(r[0]).trim(),
        serv_name:   String(r[2]||'').trim(),
        default_fee: parseFloat(r[3])||0
      };
    });
  return map;
}

function buildCatMap_() {
  const map = {};
  const sh  = getSS_().getSheetByName('Categories');
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2,1,sh.getLastRow()-1,3).getValues()
    .filter(r => r[0])
    .forEach(r => { map[String(r[0]).trim()] = String(r[2]||'').trim(); });
  return map;
}

// ── READ: All services for picker — single getSS_ call ────────
function getServicesForPicker() {
  return withCache_('lab_services', 'picker', 60, _getServicesForPicker_);
}

function _getServicesForPicker_() {
  try {
    const ss     = getSS_();
    const sh     = ss.getSheetByName('Lab_Services');
    if (!sh || sh.getLastRow() < 2) return { success: true, data: [] };
    // Build catMap from same ss instance
    const catMap = {};
    const catSh  = ss.getSheetByName('Categories');
    if (catSh && catSh.getLastRow() >= 2) {
      catSh.getRange(2,1,catSh.getLastRow()-1,3).getValues()
        .filter(r => r[0])
        .forEach(r => { catMap[String(r[0]).trim()] = String(r[2]||'').trim(); });
    }
    const data = sh.getRange(2,1,sh.getLastRow()-1,Math.max(sh.getLastColumn(),10)).getValues()
      .filter(r => r[0] && r[6]==1)
      .map(r => ({
        serv_id:       String(r[0]).trim(),
        cat_id:        String(r[1]).trim(),
        cat_name:      catMap[String(r[1]).trim()] || '',
        serv_name:     String(r[2]||'').trim(),
        default_fee:   parseFloat(r[3])||0,
        specimen_type: String(r[4]||'').trim(),
        service_type:  String(r[9]||'lab').trim() || 'lab'
      }));
    return { success: true, data };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── READ: Global packages (SA view) ─────────────────────────
function getPackages() {
  return withCache_('packages', 'sa', 60, _getPackages_);
}

function _getPackages_() {
  try {
    const sh      = getPkgSheet_();
    const itemsSh = getPkgItemsSheet_();
    const servMap = buildServMap_();
    const lr      = sh.getLastRow();

    // Build items map: package_id → [serv_ids]
    const itemsMap = {};
    const ilr = itemsSh.getLastRow();
    if (ilr >= 2) {
      itemsSh.getRange(2, 1, ilr-1, 3).getValues()
        .filter(r => r[1])
        .forEach(r => {
          const pid = String(r[1]).trim();
          if (!itemsMap[pid]) itemsMap[pid] = [];
          itemsMap[pid].push(String(r[2]).trim());
        });
    }

    const data = lr < 2 ? [] :
      sh.getRange(2, 1, lr-1, 7).getValues()
        .filter(r => r[0])
        .map(r => {
          const pid      = String(r[0]).trim();
          const servIds  = itemsMap[pid] || [];
          const services = servIds.map(sid => servMap[sid] || { serv_id: sid, serv_name: sid, default_fee: 0 });
          return {
            package_id:   pid,
            package_name: String(r[1]||'').trim(),
            description:  String(r[2]||'').trim(),
            default_fee:  parseFloat(r[3])||0,
            is_active:    r[4]==1?1:0,
            created_at:   r[5] ? new Date(r[5]).toISOString() : '',
            serv_ids:     servIds,
            services:     services
          };
        });

    Logger.log('getPackages: ' + data.length);
    return { success: true, data };
  } catch(e) {
    Logger.log('getPackages ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── READ: Branch view (global + branch packages with status) ─
function getBranchPackages(branchId) {
  return withCache_('packages', 'branch:' + (branchId || ''), 60, function() { return _getBranchPackages_(branchId); });
}

function _getBranchPackages_(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };

    const servMap  = buildServMap_();
    const itemsSh  = getPkgItemsSheet_();
    const bItemsSh = getBPkgItemsSheet_();
    const statusSh = getBPkgStatusSheet_();

    // ── Global packages ──
    const pkgSh  = getPkgSheet_();
    const pkgLR  = pkgSh.getLastRow();

    // Build global items map
    const gItemsMap = {};
    const ilr = itemsSh.getLastRow();
    if (ilr >= 2) {
      itemsSh.getRange(2, 1, ilr-1, 3).getValues()
        .filter(r => r[1])
        .forEach(r => {
          const pid = String(r[1]).trim();
          if (!gItemsMap[pid]) gItemsMap[pid] = [];
          gItemsMap[pid].push(String(r[2]).trim());
        });
    }

    // Build branch override map for global packages
    const overrideMap = {};
    const slr = statusSh.getLastRow();
    if (slr >= 2) {
      statusSh.getRange(2, 1, slr-1, 3).getValues()
        .filter(r => String(r[0]).trim() === branchId)
        .forEach(r => { overrideMap[String(r[1]).trim()] = r[2]==1?1:0; });
    }

    const globalPkgs = pkgLR < 2 ? [] :
      pkgSh.getRange(2, 1, pkgLR-1, 7).getValues()
        .filter(r => r[0])
        .map(r => {
          const pid     = String(r[0]).trim();
          const servIds = gItemsMap[pid] || [];
          const mActive = r[4]==1?1:0;
          const bActive = mActive === 0 ? 0 : (pid in overrideMap ? overrideMap[pid] : 1);
          return {
            package_id:   pid,
            package_name: String(r[1]||'').trim(),
            description:  String(r[2]||'').trim(),
            default_fee:  parseFloat(r[3])||0,
            master_active: mActive,
            branch_active: bActive,
            serv_ids:     servIds,
            services:     servIds.map(sid => servMap[sid] || { serv_id: sid, serv_name: sid, default_fee: 0 }),
            source:       'global'
          };
        });

    // ── Branch packages ──
    const bPkgSh  = getBPkgSheet_();
    const bPkgLR  = bPkgSh.getLastRow();

    // Build branch items map
    const bItemsMap = {};
    const bilr = bItemsSh.getLastRow();
    if (bilr >= 2) {
      bItemsSh.getRange(2, 1, bilr-1, 3).getValues()
        .filter(r => r[1])
        .forEach(r => {
          const pid = String(r[1]).trim();
          if (!bItemsMap[pid]) bItemsMap[pid] = [];
          bItemsMap[pid].push(String(r[2]).trim());
        });
    }

    const branchPkgs = bPkgLR < 2 ? [] :
      bPkgSh.getRange(2, 1, bPkgLR-1, 8).getValues()
        .filter(r => r[0] && String(r[1]).trim() === branchId)
        .map(r => {
          const pid     = String(r[0]).trim();
          const servIds = bItemsMap[pid] || [];
          return {
            package_id:   pid,
            package_name: String(r[2]||'').trim(),
            description:  String(r[3]||'').trim(),
            default_fee:  parseFloat(r[4])||0,
            master_active: 1,
            branch_active: r[5]==1?1:0,
            serv_ids:     servIds,
            services:     servIds.map(sid => servMap[sid] || { serv_id: sid, serv_name: sid, default_fee: 0 }),
            source:       'branch',
            created_at:   r[6] ? new Date(r[6]).toISOString() : ''
          };
        });

    Logger.log('getBranchPackages: ' + branchId + ' → ' + globalPkgs.length + ' global, ' + branchPkgs.length + ' branch');
    return { success: true, global: globalPkgs, branch: branchPkgs };

  } catch(e) {
    Logger.log('getBranchPackages ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE: Global package (SA) ──────────────────────────────
function createPackage(payload) {
  try {
    if (!payload.package_name) return { success: false, message: 'Package name is required.' };
    if (!payload.serv_ids || !payload.serv_ids.length) return { success: false, message: 'Select at least one service.' };

    const sh      = getPkgSheet_();
    const itemsSh = getPkgItemsSheet_();
    const now     = new Date();

    // Duplicate name check
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const names = sh.getRange(2, 2, lr-1, 1).getValues().flat().map(v => String(v).trim().toLowerCase());
      if (names.includes(payload.package_name.trim().toLowerCase()))
        return { success: false, message: `Package "${payload.package_name}" already exists.` };
    }

    const pkgId = 'PKG-' + Math.random().toString(16).substr(2,8).toUpperCase();
    sh.appendRow([pkgId, payload.package_name.trim(), (payload.description||'').trim(), payload.default_fee||0, 1, now, now]);

    // Insert items
    payload.serv_ids.forEach(sid => {
      const itemId = 'PKGI-' + Math.random().toString(16).substr(2,8).toUpperCase();
      itemsSh.appendRow([itemId, pkgId, sid.trim(), now]);
    });

    // Propagate to all branches
    propagatePkgToAllBranches_(pkgId);

    cacheBust_('packages');
    writeAuditLog_('PKG_CREATE', { package_id: pkgId, package_name: payload.package_name });
    Logger.log('createPackage: ' + pkgId);
    return { success: true, package_id: pkgId };

  } catch(e) {
    Logger.log('createPackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE: Global package (SA) ──────────────────────────────
function updatePackage(payload) {
  try {
    if (!payload.package_id)   return { success: false, message: 'Package ID required.' };
    if (!payload.package_name) return { success: false, message: 'Package name is required.' };
    if (!payload.serv_ids || !payload.serv_ids.length) return { success: false, message: 'Select at least one service.' };

    const sh      = getPkgSheet_();
    const itemsSh = getPkgItemsSheet_();
    const now     = new Date();
    const lr      = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Package not found.' };

    const allRows = sh.getRange(2,1,lr-1,7).getValues();
    const rowIdx  = allRows.findIndex(r => String(r[0]).trim() === payload.package_id.trim());
    if (rowIdx === -1) return { success: false, message: 'Package not found.' };

    // Duplicate name check — exclude self
    const nameLower = payload.package_name.trim().toLowerCase();
    const dup = allRows.some((r, i) =>
      i !== rowIdx && String(r[1]).trim().toLowerCase() === nameLower
    );
    if (dup) return { success: false, message: `Package "${payload.package_name}" already exists.` };

    const existRow  = allRows[rowIdx];
    const createdAt = existRow[5] || now;
    const isActive  = existRow[4];

    sh.getRange(rowIdx+2, 2, 1, 6).setValues([[
      payload.package_name.trim(),
      (payload.description||'').trim(),
      payload.default_fee||0,
      isActive,
      createdAt,
      now
    ]]);

    // Replace items — batch read then delete in reverse
    const ilr = itemsSh.getLastRow();
    if (ilr >= 2) {
      const itemRows = itemsSh.getRange(2,1,ilr-1,2).getValues();
      const toDelete = [];
      itemRows.forEach((r, i) => {
        if (String(r[1]).trim() === payload.package_id.trim()) toDelete.push(i + 2);
      });
      toDelete.sort((a,b) => b - a).forEach(row => itemsSh.deleteRow(row));
    }
    payload.serv_ids.forEach(sid => {
      const itemId = 'PKGI-' + Math.random().toString(16).substr(2,8).toUpperCase();
      itemsSh.appendRow([itemId, payload.package_id.trim(), sid.trim(), now]);
    });

    cacheBust_('packages');
    writeAuditLog_('PKG_UPDATE', { package_id: payload.package_id, package_name: payload.package_name });
    return { success: true };
  } catch(e) {
    Logger.log('updatePackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── DELETE: Global package (SA) ──────────────────────────────
function deletePackage(pkgId) {
  try {
    if (!pkgId) return { success: false, message: 'Package ID required.' };

    const sh      = getPkgSheet_();
    const itemsSh = getPkgItemsSheet_();
    const stSh    = getBPkgStatusSheet_();

    // Delete package row
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const ids    = sh.getRange(2,1,lr-1,1).getValues().flat().map(String);
      const rowIdx = ids.findIndex(id => id.trim() === pkgId.trim());
      if (rowIdx !== -1) sh.deleteRow(rowIdx + 2);
    }

    // Delete items — batch read then delete in reverse
    const ilr = itemsSh.getLastRow();
    if (ilr >= 2) {
      const itemRows = itemsSh.getRange(2,1,ilr-1,2).getValues();
      const toDeleteI = [];
      itemRows.forEach((r,i) => { if (String(r[1]).trim() === pkgId) toDeleteI.push(i+2); });
      toDeleteI.sort((a,b) => b-a).forEach(row => itemsSh.deleteRow(row));
    }

    // Delete branch status rows — batch read then delete in reverse
    const slr = stSh.getLastRow();
    if (slr >= 2) {
      const stRows = stSh.getRange(2,1,slr-1,2).getValues();
      const toDeleteS = [];
      stRows.forEach((r,i) => { if (String(r[1]).trim() === pkgId) toDeleteS.push(i+2); });
      toDeleteS.sort((a,b) => b-a).forEach(row => stSh.deleteRow(row));
    }

    cacheBust_('packages');
    writeAuditLog_('PKG_DELETE', { package_id: pkgId });
    return { success: true };
  } catch(e) {
    Logger.log('deletePackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE: Branch package ────────────────────────────────────
function createBranchPackage(payload) {
  try {
    if (!payload.branch_id)    return { success: false, message: 'Branch ID required.' };
    if (!payload.package_name) return { success: false, message: 'Package name is required.' };
    if (!payload.serv_ids || !payload.serv_ids.length) return { success: false, message: 'Select at least one service.' };

    const sh      = getBPkgSheet_();
    const itemsSh = getBPkgItemsSheet_();
    const now     = new Date();

    // Duplicate name check within same branch
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2,1,lr-1,3).getValues();
      const dup  = rows.some(r =>
        String(r[1]).trim() === payload.branch_id.trim() &&
        String(r[2]).trim().toLowerCase() === payload.package_name.trim().toLowerCase()
      );
      if (dup) return { success: false, message: `Package "${payload.package_name}" already exists in this branch.` };
    }

    const bpId = 'BPK-' + Math.random().toString(16).substr(2,8).toUpperCase();
    sh.appendRow([bpId, payload.branch_id.trim(), payload.package_name.trim(), (payload.description||'').trim(), payload.default_fee||0, 1, now, now]);

    payload.serv_ids.forEach(sid => {
      const itemId = 'BPKI-' + Math.random().toString(16).substr(2,8).toUpperCase();
      itemsSh.appendRow([itemId, bpId, sid.trim(), now]);
    });

    cacheBust_('packages');
    writeAuditLog_('BPKG_CREATE', { bp_id: bpId, branch_id: payload.branch_id, package_name: payload.package_name });
    Logger.log('createBranchPackage: ' + bpId);
    return { success: true, package_id: bpId };
  } catch(e) {
    Logger.log('createBranchPackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE: Branch package ────────────────────────────────────
function updateBranchPackage(payload) {
  try {
    if (!payload.package_id)   return { success: false, message: 'Package ID required.' };
    if (!payload.package_name) return { success: false, message: 'Package name is required.' };
    if (!payload.serv_ids || !payload.serv_ids.length) return { success: false, message: 'Select at least one service.' };

    const sh      = getBPkgSheet_();
    const itemsSh = getBPkgItemsSheet_();
    const now     = new Date();
    const lr      = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Package not found.' };

    // Batch read
    const allRows = sh.getRange(2,1,lr-1,8).getValues();
    const rowIdx  = allRows.findIndex(r => String(r[0]).trim() === payload.package_id.trim());
    if (rowIdx === -1) return { success: false, message: 'Package not found.' };

    const existRow = allRows[rowIdx];
    const branchId = String(existRow[1]).trim();

    // Duplicate name check within same branch — exclude self
    const nameLower = payload.package_name.trim().toLowerCase();
    const dup = allRows.some((r, i) =>
      i !== rowIdx &&
      String(r[1]).trim() === branchId &&
      String(r[2]).trim().toLowerCase() === nameLower
    );
    if (dup) return { success: false, message: `Package "${payload.package_name}" already exists in this branch.` };

    const createdAt = existRow[6] || now;
    const isActive  = existRow[5];

    sh.getRange(rowIdx+2, 3, 1, 6).setValues([[
      payload.package_name.trim(),
      (payload.description||'').trim(),
      payload.default_fee||0,
      isActive,
      createdAt,
      now
    ]]);

    // Replace items — batch read then delete in reverse
    const ilr = itemsSh.getLastRow();
    if (ilr >= 2) {
      const itemRows = itemsSh.getRange(2,1,ilr-1,2).getValues();
      const toDelete = [];
      itemRows.forEach((r,i) => { if (String(r[1]).trim() === payload.package_id.trim()) toDelete.push(i+2); });
      toDelete.sort((a,b) => b-a).forEach(row => itemsSh.deleteRow(row));
    }
    payload.serv_ids.forEach(sid => {
      const itemId = 'BPKI-' + Math.random().toString(16).substr(2,8).toUpperCase();
      itemsSh.appendRow([itemId, payload.package_id.trim(), sid.trim(), now]);
    });

    cacheBust_('packages');
    writeAuditLog_('BPKG_UPDATE', { bp_id: payload.package_id, package_name: payload.package_name });
    return { success: true };
  } catch(e) {
    Logger.log('updateBranchPackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── DELETE: Branch package ────────────────────────────────────
function deleteBranchPackage(bpId) {
  try {
    if (!bpId) return { success: false, message: 'Package ID required.' };

    const sh      = getBPkgSheet_();
    const itemsSh = getBPkgItemsSheet_();

    // Delete package row
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const ids    = sh.getRange(2,1,lr-1,1).getValues().flat().map(String);
      const rowIdx = ids.findIndex(id => id.trim() === bpId.trim());
      if (rowIdx !== -1) sh.deleteRow(rowIdx + 2);
    }

    // Delete items — batch read then delete in reverse
    const ilr = itemsSh.getLastRow();
    if (ilr >= 2) {
      const itemRows = itemsSh.getRange(2,1,ilr-1,2).getValues();
      const toDelete = [];
      itemRows.forEach((r,i) => { if (String(r[1]).trim() === bpId) toDelete.push(i+2); });
      toDelete.sort((a,b) => b-a).forEach(row => itemsSh.deleteRow(row));
    }

    cacheBust_('packages');
    writeAuditLog_('BPKG_DELETE', { bp_id: bpId });
    return { success: true };
  } catch(e) {
    Logger.log('deleteBranchPackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SET BRANCH PACKAGE STATUS (global packages) ───────────────
function setBranchPkgStatus(branchId, pkgId, isActive) {
  try {
    const sh  = getBPkgStatusSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2, 1, lr-1, 2).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === branchId && String(rows[i][1]).trim() === pkgId) {
          sh.getRange(i+2, 3, 1, 2).setValues([[isActive==1?1:0, now]]);
          cacheBust_('packages');
          return { success: true };
        }
      }
    }
    sh.appendRow([branchId, pkgId, isActive==1?1:0, now]);
    cacheBust_('packages');
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── SET BRANCH PACKAGE ACTIVE (branch-owned packages) ────────
function setBranchOwnPkgStatus(bpId, isActive) {
  try {
    const sh  = getBPkgSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Package not found.' };
    const ids    = sh.getRange(2, 1, lr-1, 1).getValues().flat().map(String);
    const rowIdx = ids.findIndex(id => id.trim() === bpId.trim());
    if (rowIdx === -1) return { success: false, message: 'Package not found.' };
    sh.getRange(rowIdx + 2, 6).setValue(isActive==1?1:0);
    cacheBust_('packages');
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── GET BRANCH STATUS FOR A GLOBAL PACKAGE (SA modal) ────────
function getPkgBranchStatus(pkgId) {
  try {
    if (!pkgId) return { success: false, message: 'Package ID required.' };
    const brSh  = getSS_().getSheetByName('Branches');
    const stSh  = getBPkgStatusSheet_();
    if (!brSh) return { success: false, message: '"Branches" sheet not found.' };

    const brLR = brSh.getLastRow();
    if (brLR < 2) return { success: true, data: [] };

    const branches = brSh.getRange(2, 1, brLR-1, 3).getValues()
      .filter(r => r[0]).map(r => ({ branch_id: String(r[0]).trim(), branch_name: String(r[1]).trim(), branch_code: String(r[2]).trim() }));

    const override = {};
    const slr = stSh.getLastRow();
    if (slr >= 2) {
      stSh.getRange(2, 1, slr-1, 3).getValues()
        .filter(r => String(r[1]).trim() === pkgId)
        .forEach(r => { override[String(r[0]).trim()] = r[2]==1?1:0; });
    }

    const data = branches.map(b => ({
      branch_id:   b.branch_id,
      branch_name: b.branch_name,
      branch_code: b.branch_code,
      is_active:   b.branch_id in override ? override[b.branch_id] : 1
    }));

    return { success: true, data };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── PROPAGATE global package to all branches ─────────────────
function propagatePkgToAllBranches_(pkgId) {
  try {
    const brSh = getSS_().getSheetByName('Branches');
    if (!brSh) return;
    const lr = brSh.getLastRow();
    if (lr < 2) return;
    brSh.getRange(2, 1, lr-1, 1).getValues()
      .map(r => String(r[0]).trim()).filter(Boolean)
      .forEach(branchId => setBranchPkgStatus(branchId, pkgId, 1));
    Logger.log('propagatePkgToAllBranches_: ' + pkgId);
  } catch(e) { Logger.log('propagatePkgToAllBranches_ ERROR: ' + e.message); }
}

// ── GET ALL BRANCH PACKAGES (SA read-only view) ───────────────
// Returns all branch packages across all branches with branch names
function getAllBranchPackages() {
  try {
    const sh      = getBPkgSheet_();
    const itemsSh = getBPkgItemsSheet_();
    const servMap = buildServMap_();
    const lr      = sh.getLastRow();

    // Build branch items map
    const bItemsMap = {};
    const bilr = itemsSh.getLastRow();
    if (bilr >= 2) {
      itemsSh.getRange(2, 1, bilr-1, 3).getValues()
        .filter(r => r[1])
        .forEach(r => {
          const pid = String(r[1]).trim();
          if (!bItemsMap[pid]) bItemsMap[pid] = [];
          bItemsMap[pid].push(String(r[2]).trim());
        });
    }

    const data = lr < 2 ? [] :
      sh.getRange(2, 1, lr-1, 8).getValues()
        .filter(r => r[0])
        .map(r => {
          const pid     = String(r[0]).trim();
          const servIds = bItemsMap[pid] || [];
          return {
            bp_id:        pid,
            package_id:   pid,
            branch_id:    String(r[1]).trim(),
            package_name: String(r[2]||'').trim(),
            description:  String(r[3]||'').trim(),
            default_fee:  parseFloat(r[4])||0,
            is_active:    r[5]==1?1:0,
            created_at:   r[6] ? new Date(r[6]).toISOString() : '',
            serv_ids:     servIds,
            services:     servIds.map(sid => servMap[sid] || { serv_id: sid, serv_name: sid, default_fee: 0 })
          };
        });

    Logger.log('getAllBranchPackages: ' + data.length);
    return { success: true, data };
  } catch(e) {
    Logger.log('getAllBranchPackages ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── ARCHIVE / UNARCHIVE GLOBAL PACKAGE (SA only) ─────────────
// is_archived is stored as col 8 in Packages sheet (after created_at/updated_at)
// getOrCreate_ already defines 7 cols — we extend via ensureArchiveCol_

function ensurePkgArchiveCol_() {
  const sh   = getPkgSheet_();
  const cols = sh.getLastColumn();
  if (cols < 8) sh.getRange(1, 8).setValue('is_archived');
  return sh;
}

function archivePackage(pkgId, archive) {
  try {
    if (!pkgId) return { success: false, message: 'Package ID required.' };
    const sh  = ensurePkgArchiveCol_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Package not found.' };
    const ids = sh.getRange(2,1,lr-1,1).getValues().flat().map(String);
    const idx = ids.findIndex(id => id.trim() === pkgId.trim());
    if (idx === -1) return { success: false, message: 'Package not found.' };
    sh.getRange(idx+2, 8).setValue(archive ? 1 : 0);
    sh.getRange(idx+2, 7).setValue(new Date()); // updated_at
    writeAuditLog_(archive ? 'PKG_ARCHIVE' : 'PKG_UNARCHIVE', { package_id: pkgId });
    Logger.log('archivePackage: ' + pkgId + ' archive=' + archive);
    return { success: true };
  } catch(e) {
    Logger.log('archivePackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Update getPackages to return is_archived and filter by default (exclude archived)
// Called with includeArchived=true to show archived packages
function getPackagesWithArchived(includeArchived) {
  try {
    const sh      = ensurePkgArchiveCol_();
    const itemsSh = getPkgItemsSheet_();
    const servMap = buildServMap_();
    const lr      = sh.getLastRow();

    const gItemsMap = {};
    const ilr = itemsSh.getLastRow();
    if (ilr >= 2) {
      itemsSh.getRange(2,1,ilr-1,3).getValues()
        .filter(r => r[1])
        .forEach(r => {
          const pid = String(r[1]).trim();
          if (!gItemsMap[pid]) gItemsMap[pid] = [];
          gItemsMap[pid].push(String(r[2]).trim());
        });
    }

    const cols = Math.max(sh.getLastColumn(), 8);
    const data = lr < 2 ? [] :
      sh.getRange(2,1,lr-1,cols).getValues()
        .filter(r => r[0])
        .filter(r => includeArchived || !r[7]) // r[7] = is_archived
        .map(r => {
          const pid     = String(r[0]).trim();
          const servIds = gItemsMap[pid] || [];
          return {
            package_id:   pid,
            package_name: String(r[1]||'').trim(),
            description:  String(r[2]||'').trim(),
            default_fee:  parseFloat(r[3])||0,
            is_active:    r[4]==1?1:0,
            is_archived:  r[7]==1?1:0,
            created_at:   r[5] ? new Date(r[5]).toISOString() : '',
            updated_at:   r[6] ? new Date(r[6]).toISOString() : '',
            serv_ids:     servIds,
            services:     servIds.map(sid => servMap[sid] || { serv_id: sid, serv_name: sid, default_fee: 0 })
          };
        });

    return { success: true, data };
  } catch(e) {
    Logger.log('getPackagesWithArchived ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  PACKAGE APPROVAL WORKFLOW
//  When SA edits a global package → creates a PENDING approval
//  BA reviews → Approve (applies edit) or Reject (discards)
// ════════════════════════════════════════════════════════════════
//  BRANCH PACKAGE APPROVAL FLOW (BA → SA)
//
//  When BA creates or edits a branch package:
//    → Creates a PENDING entry in Pkg_BA_Approvals sheet
//    → Package is written to Branch_Packages with is_active=0 and approval_status=PENDING
//  SA reviews → Approve (activates) or Reject (marks rejected)
//
//  Pkg_BA_Approvals (main SS):
//    approval_id | branch_id | action | package_name | description
//    default_fee | serv_ids_json | bp_id | requested_by
//    requested_at | status | reviewed_by | reviewed_at | reject_reason
// ════════════════════════════════════════════════════════════════

function _getBAPkgApprovalSheet_() {
  const ss = getSS_();
  let sh   = ss.getSheetByName('Pkg_BA_Approvals');
  if (!sh) {
    sh = ss.insertSheet('Pkg_BA_Approvals');
    sh.getRange(1,1,1,14).setValues([[
      'approval_id','branch_id','action','package_name','description',
      'default_fee','serv_ids_json','bp_id','requested_by',
      'requested_at','status','reviewed_by','reviewed_at','reject_reason'
    ]]);
    sh.getRange(1,1,1,14).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── BA submits new package for SA approval ────────────────────
function submitBranchPackageForApproval(payload) {
  try {
    if (!payload.branch_id)    return { success: false, message: 'Branch ID required.' };
    if (!payload.package_name) return { success: false, message: 'Package name is required.' };
    if (!payload.serv_ids || !payload.serv_ids.length)
      return { success: false, message: 'Select at least one service.' };

    const sh      = getBPkgSheet_();
    const itemsSh = getBPkgItemsSheet_();
    const apvSh   = _getBAPkgApprovalSheet_();
    const now     = new Date();

    // Duplicate name check within same branch
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const rows = sh.getRange(2,1,lr-1,3).getValues();
      const dup  = rows.some(r =>
        String(r[1]).trim() === payload.branch_id.trim() &&
        String(r[2]).trim().toLowerCase() === payload.package_name.trim().toLowerCase()
      );
      if (dup) return { success: false, message: `Package "${payload.package_name}" already exists in this branch.` };
    }

    // Write to Branch_Packages with is_active=0 (inactive until approved)
    const bpId = 'BPK-' + Math.random().toString(16).substr(2,8).toUpperCase();
    sh.appendRow([bpId, payload.branch_id.trim(), payload.package_name.trim(),
      (payload.description||'').trim(), payload.default_fee||0,
      0,   // is_active = 0 (pending approval)
      now, now]);

    payload.serv_ids.forEach(sid => {
      const itemId = 'BPKI-' + Math.random().toString(16).substr(2,8).toUpperCase();
      itemsSh.appendRow([itemId, bpId, sid.trim(), now]);
    });

    // Create approval request
    const approvalId = 'APV-' + Math.random().toString(16).substr(2,8).toUpperCase();
    apvSh.appendRow([
      approvalId, payload.branch_id.trim(), 'CREATE',
      payload.package_name.trim(), (payload.description||'').trim(),
      payload.default_fee||0, JSON.stringify(payload.serv_ids||[]),
      bpId, (payload.requested_by||'BA').trim(),
      now, 'PENDING', '', '', ''
    ]);

    writeAuditLog_('BA_PKG_SUBMITTED', { approval_id: approvalId, bp_id: bpId, package_name: payload.package_name });
    Logger.log('submitBranchPackageForApproval: ' + approvalId);
    return { success: true, approval_id: approvalId, package_id: bpId, status: 'PENDING' };
  } catch(e) {
    Logger.log('submitBranchPackageForApproval ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── BA submits edited package for SA approval ─────────────────
function submitBranchPackageEditForApproval(payload) {
  try {
    if (!payload.package_id)   return { success: false, message: 'Package ID required.' };
    if (!payload.package_name) return { success: false, message: 'Package name is required.' };
    if (!payload.serv_ids || !payload.serv_ids.length)
      return { success: false, message: 'Select at least one service.' };

    const apvSh = _getBAPkgApprovalSheet_();
    const now   = new Date();

    // Cancel any existing PENDING approval for this package
    const apvLr = apvSh.getLastRow();
    if (apvLr >= 2) {
      apvSh.getRange(2,1,apvLr-1,14).getValues().forEach((r,i) => {
        if (String(r[7]).trim() === payload.package_id && String(r[10]).trim() === 'PENDING') {
          apvSh.getRange(i+2, 11).setValue('SUPERSEDED');
        }
      });
    }

    const approvalId = 'APV-' + Math.random().toString(16).substr(2,8).toUpperCase();
    apvSh.appendRow([
      approvalId, (payload.branch_id||'').trim(), 'EDIT',
      payload.package_name.trim(), (payload.description||'').trim(),
      payload.default_fee||0, JSON.stringify(payload.serv_ids||[]),
      payload.package_id.trim(), (payload.requested_by||'BA').trim(),
      now, 'PENDING', '', '', ''
    ]);

    writeAuditLog_('BA_PKG_EDIT_SUBMITTED', { approval_id: approvalId, bp_id: payload.package_id, package_name: payload.package_name });
    Logger.log('submitBranchPackageEditForApproval: ' + approvalId);
    return { success: true, approval_id: approvalId, status: 'PENDING' };
  } catch(e) {
    Logger.log('submitBranchPackageEditForApproval ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET ALL PENDING BA APPROVALS (for SA) ────────────────────
function getBAPendingApprovals() {
  try {
    const sh  = _getBAPkgApprovalSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    // Build branch name map
    const brMap = {};
    const brSh  = getSS_().getSheetByName('Branches');
    if (brSh && brSh.getLastRow() >= 2) {
      brSh.getRange(2,1,brSh.getLastRow()-1,2).getValues()
        .forEach(r => { brMap[String(r[0]).trim()] = String(r[1]).trim(); });
    }

    const data = sh.getRange(2,1,lr-1,14).getValues()
      .filter(r => r[0] && String(r[10]).trim() === 'PENDING')
      .map(r => {
        let serv_ids = [];
        try { serv_ids = JSON.parse(String(r[6]||'[]')); } catch(e) {}
        const brId = String(r[1]||'').trim();
        return {
          approval_id:   String(r[0]).trim(),
          branch_id:     brId,
          branch_name:   brMap[brId] || brId,
          action:        String(r[2]).trim(),
          package_name:  String(r[3]||'').trim(),
          description:   String(r[4]||'').trim(),
          default_fee:   parseFloat(r[5])||0,
          serv_ids:      serv_ids,
          bp_id:         String(r[7]||'').trim(),
          requested_by:  String(r[8]||'').trim(),
          requested_at:  r[9] ? new Date(r[9]).toISOString() : '',
          status:        String(r[10]).trim()
        };
      });

    Logger.log('getBAPendingApprovals: ' + data.length + ' pending');
    return { success: true, data };
  } catch(e) {
    Logger.log('getBAPendingApprovals ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SA approves a BA package submission ───────────────────────
function approveBranchPackage(approvalId, reviewedBy) {
  try {
    if (!approvalId) return { success: false, message: 'Approval ID required.' };
    const sh  = _getBAPkgApprovalSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Approval not found.' };

    const rows = sh.getRange(2,1,lr-1,14).getValues();
    const idx  = rows.findIndex(r => String(r[0]).trim() === approvalId);
    if (idx === -1) return { success: false, message: 'Approval not found.' };

    const row    = rows[idx];
    const status = String(row[10]).trim();
    if (status !== 'PENDING') return { success: false, message: 'No longer pending.' };

    const action = String(row[2]).trim();
    const bpId   = String(row[7]).trim();
    const now    = new Date();

    let serv_ids = [];
    try { serv_ids = JSON.parse(String(row[6]||'[]')); } catch(e) {}

    if (action === 'CREATE') {
      // Activate the package
      const bSh  = getBPkgSheet_();
      const bLr  = bSh.getLastRow();
      if (bLr >= 2) {
        const bRows = bSh.getRange(2,1,bLr-1,6).getValues();
        const bIdx  = bRows.findIndex(r => String(r[0]).trim() === bpId);
        if (bIdx !== -1) bSh.getRange(bIdx+2, 6).setValue(1); // is_active = 1
      }
    } else if (action === 'EDIT') {
      // Apply the edit via updateBranchPackage
      const result = updateBranchPackage({
        package_id:   bpId,
        package_name: String(row[3]||'').trim(),
        description:  String(row[4]||'').trim(),
        default_fee:  parseFloat(row[5])||0,
        serv_ids:     serv_ids
      });
      if (!result.success) return result;
    }

    // Mark approved
    sh.getRange(idx+2, 11, 1, 3).setValues([['APPROVED', reviewedBy||'SA', now]]);
    writeAuditLog_('SA_PKG_APPROVED', { approval_id: approvalId, bp_id: bpId, action });
    Logger.log('approveBranchPackage: ' + approvalId);
    return { success: true };
  } catch(e) {
    Logger.log('approveBranchPackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SA rejects a BA package submission ────────────────────────
function rejectBranchPackage(approvalId, reviewedBy, reason) {
  try {
    if (!approvalId) return { success: false, message: 'Approval ID required.' };
    const sh  = _getBAPkgApprovalSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Approval not found.' };

    const rows = sh.getRange(2,1,lr-1,14).getValues();
    const idx  = rows.findIndex(r => String(r[0]).trim() === approvalId);
    if (idx === -1) return { success: false, message: 'Approval not found.' };
    if (String(rows[idx][10]).trim() !== 'PENDING')
      return { success: false, message: 'No longer pending.' };

    const now  = new Date();
    sh.getRange(idx+2, 11, 1, 4).setValues([['REJECTED', reviewedBy||'SA', now, reason||'']]);

    // Keep package inactive (is_active stays 0 for CREATE rejections)
    writeAuditLog_('SA_PKG_REJECTED', { approval_id: approvalId, reason: reason||'' });
    Logger.log('rejectBranchPackage: ' + approvalId);
    return { success: true };
  } catch(e) {
    Logger.log('rejectBranchPackage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET BA'S OWN APPROVAL HISTORY (for BA to see status) ─────
function getMyPackageApprovals(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const sh  = _getBAPkgApprovalSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    const data = sh.getRange(2,1,lr-1,14).getValues()
      .filter(r => r[0] && String(r[1]).trim() === branchId)
      .map(r => {
        let serv_ids = [];
        try { serv_ids = JSON.parse(String(r[6]||'[]')); } catch(e) {}
        return {
          approval_id:   String(r[0]).trim(),
          action:        String(r[2]).trim(),
          package_name:  String(r[3]||'').trim(),
          description:   String(r[4]||'').trim(),
          default_fee:   parseFloat(r[5])||0,
          serv_ids:      serv_ids,
          bp_id:         String(r[7]||'').trim(),
          requested_at:  r[9] ? new Date(r[9]).toISOString() : '',
          status:        String(r[10]).trim(),
          reviewed_at:   r[12] ? new Date(r[12]).toISOString() : '',
          reject_reason: String(r[13]||'').trim()
        };
      })
      .sort((a,b) => b.requested_at.localeCompare(a.requested_at));

    return { success: true, data };
  } catch(e) {
    Logger.log('getMyPackageApprovals ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}