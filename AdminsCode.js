// ============================================================
//  A-LAB — AdminsCode.gs
//  Backend CRUD for the Admins module.
//
//  Two sheets used:
//
//  "Super Admins" (existing) — for Super Admins only
//    A=Username  B=Email  C=Password  D=Role  E=Status
//
//  "Admins" (new) — for Branch Admins
//    A=admin_id  B=name  C=username  D=email  E=password
//    F=role      G=status  H=branch_ids  I=created_at  J=updated_at
//
//  getAdmins() reads from BOTH sheets and returns a unified list.
//  Super Admins are derived from the "Super Admins" sheet.
//  Branch Admins are stored in the "Admins" sheet.
// ============================================================

// ── SHEET ACCESSORS ──────────────────────────────────────────
function getAdminsSheet_() {
  const ss = getSS_();
  let sh   = ss.getSheetByName('Admins');
  if (!sh) {
    // Create sheet with headers on first use
    sh = ss.insertSheet('Admins');
    sh.getRange(1, 1, 1, 10).setValues([[
      'admin_id','name','username','email','password',
      'role','status','branch_ids','created_at','updated_at'
    ]]);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#0d9090').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getSuperAdminsSheet_() {
  const sh = getSS_().getSheetByName('Super Admins');
  if (!sh) throw new Error('"Super Admins" sheet not found.');
  return sh;
}

// ── READ ─────────────────────────────────────────────────────
// Returns unified list: Super Admins + Branch Admins
// Also returns branches list for the branch picker in the modal
function getAdmins(includeArchived) {
  const inc = !!includeArchived;
  const cacheKey = inc ? 'all:inc_arch' : 'all';
  return withCache_('admins', cacheKey, 60, function(){ return _getAdmins_(inc); });
}

function _getAdmins_(includeArchived) {
  try {
    const admins = [];

    // ── Super Admins from "Super Admins" sheet ──
    // Cols: A=Username B=Email C=Password D=Role E=Status
    const saSh = getSuperAdminsSheet_();
    const saLR = saSh.getLastRow();
    const saNumCols = Math.max(Math.min(saSh.getLastColumn(), 7), 6);
    const saArchCol = findArchiveCol_(saSh);
    if (saLR >= 2) {
      saSh.getRange(2, 1, saLR - 1, Math.max(saNumCols, saArchCol || 0)).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .filter(r => includeArchived || !isArchivedRow_(r, saArchCol))
        .forEach(r => {
          admins.push({
            admin_id:         'SA-' + String(r[0]).trim().replace(/\W/g,'').toUpperCase(),
            name:             String(r[0]).trim(),
            username:         String(r[0]).trim(),
            email:            String(r[1] || '').trim(),
            role:             String(r[3] || 'Super Admin').trim() || 'Super Admin',
            status:           String(r[4] || 'Active').trim() || 'Active',
            branch_ids:       '',
            branches_display: 'All Branches',
            photo_url:        String(r[5] || '').trim(),
            source:           'super_admins'
          });
        });
    }

    // ── Branch Admins from "Admins" sheet ──
    const sh = getAdminsSheet_();
    const lr = sh.getLastRow();
    const archCol = findArchiveCol_(sh);
    if (lr >= 2) {
      // Build branch name lookup
      const branchMap = buildBranchMap_();
      const cols = Math.max(11, sh.getLastColumn());

      sh.getRange(2, 1, lr - 1, cols).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .filter(r => includeArchived || !isArchivedRow_(r, archCol))
        .forEach(r => {
          const branchIds = String(r[7] || '').trim();
          const brDisp    = branchIds
            ? branchIds.split(',').map(bid => branchMap[bid.trim()] || bid.trim()).join(', ')
            : '';
          admins.push({
            admin_id:         String(r[0]).trim(),
            name:             String(r[1] || '').trim(),
            username:         String(r[2] || '').trim(),
            email:            String(r[3] || '').trim(),
            role:             String(r[5] || 'Branch Admin').trim(),
            status:           String(r[6] || 'Active').trim(),
            branch_ids:       branchIds,
            branches_display: brDisp,
            photo_url:        String(r[10] || '').trim(),
            source:           'admins'
          });
        });
    }

    // Also return branches for the picker
    const branches = getBranchesForPicker_();

    Logger.log('getAdmins: ' + admins.length + ' total');
    return { success: true, admins, branches };

  } catch (err) {
    Logger.log('getAdmins ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── BUILD BRANCH MAP ─────────────────────────────────────────
function buildBranchMap_() {
  const map = {};
  try {
    const sh = getSS_().getSheetByName('Branches');
    if (!sh) return map;
    const lr = sh.getLastRow();
    if (lr < 2) return map;
    sh.getRange(2, 1, lr - 1, 2).getValues().forEach(r => {
      if (r[0]) map[String(r[0]).trim()] = String(r[1] || '').trim();
    });
  } catch(e) { Logger.log('buildBranchMap_ error: ' + e.message); }
  return map;
}

function getBranchesForPicker_() {
  try {
    const sh = getSS_().getSheetByName('Branches');
    if (!sh) return [];
    const lr = sh.getLastRow();
    if (lr < 2) return [];
    return sh.getRange(2, 1, lr - 1, 4).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({
        branch_id:   String(r[0]).trim(),
        branch_name: String(r[1]).trim(),
        branch_code: String(r[2]).trim(),
        address:     String(r[3] || '').trim()
      }));
  } catch(e) { return []; }
}

// ── CREATE ───────────────────────────────────────────────────
function createAdmin(payload) {
  return withLock_(function() {
  try {
    if (!payload.name)     return { success: false, message: 'Full name is required.' };
    if (!payload.username) return { success: false, message: 'Username is required.' };
    if (!payload.password) return { success: false, message: 'Password is required.' };
    if (!payload.role)     return { success: false, message: 'Role is required.' };

    if (payload.role === 'Branch Admin' && !payload.branch_ids) {
      return { success: false, message: 'Assign at least one branch.' };
    }

    const uname = payload.username.trim().toLowerCase();

    if (payload.role === 'Super Admin') {
      // Add to "Super Admins" sheet
      const saSh = getSuperAdminsSheet_();
      const saLR = saSh.getLastRow();

      // Duplicate username check
      if (saLR >= 2) {
        const existing = saSh.getRange(2, 1, saLR - 1, 1).getValues().flat().map(v => String(v).trim().toLowerCase());
        if (existing.includes(uname)) return { success: false, message: `Username "${payload.username}" already exists.` };
      }

      saSh.appendRow([
        payload.username.trim(),
        (payload.email || '').trim(),
        payload.password.trim(),
        'Super Admin',
        payload.status || 'Active'
      ]);

      const adminId = 'SA-' + payload.username.trim().replace(/\W/g,'').toUpperCase();
      cacheBust_('admins');
      writeAuditLog_('ADMIN_CREATE', { admin_id: adminId, role: 'Super Admin', name: payload.name });
      return { success: true, admin_id: adminId };

    } else {
      // Add to "Admins" sheet
      const sh = getAdminsSheet_();
      const lr = sh.getLastRow();

      // Duplicate username check across both sheets
      if (lr >= 2) {
        const existing = sh.getRange(2, 1, lr - 1, 3).getValues().map(r => String(r[2]).trim().toLowerCase());
        if (existing.includes(uname)) return { success: false, message: `Username "${payload.username}" already exists.` };
      }
      // Also check Super Admins sheet
      const saSh = getSuperAdminsSheet_();
      const saLR = saSh.getLastRow();
      if (saLR >= 2) {
        const saNames = saSh.getRange(2, 1, saLR - 1, 1).getValues().flat().map(v => String(v).trim().toLowerCase());
        if (saNames.includes(uname)) return { success: false, message: `Username "${payload.username}" already exists.` };
      }

      const adminId = 'ADM-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      const now     = new Date();

      sh.appendRow([
        adminId,
        payload.name.trim(),
        payload.username.trim(),
        (payload.email    || '').trim(),
        payload.password.trim(),
        'Branch Admin',
        payload.status    || 'Active',
        (payload.branch_ids || '').trim(),
        now, now
      ]);

      cacheBust_('admins');
      writeAuditLog_('ADMIN_CREATE', { admin_id: adminId, role: 'Branch Admin', name: payload.name });
      return { success: true, admin_id: adminId };
    }

  } catch (err) {
    Logger.log('createAdmin ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
  });
}

// ── UPDATE ───────────────────────────────────────────────────
function updateAdmin(payload) {
  return withLock_(function() {
  try {
    if (!payload.admin_id) return { success: false, message: 'Admin ID is required.' };
    if (!payload.name)     return { success: false, message: 'Full name is required.' };
    if (!payload.username) return { success: false, message: 'Username is required.' };

    const uname = payload.username.trim().toLowerCase();

    if (payload.role === 'Super Admin') {
      // Update in "Super Admins" sheet — match by original username (stored as admin_id suffix)
      const saSh    = getSuperAdminsSheet_();
      const saLR    = saSh.getLastRow();
      if (saLR < 2)  return { success: false, message: 'Admin not found.' };

      const rows    = saSh.getRange(2, 1, saLR - 1, 5).getValues();
      const origUsername = payload.admin_id.replace(/^SA-/, '').toLowerCase();
      const rowIdx  = rows.findIndex(r => String(r[0]).trim().toLowerCase() === origUsername);
      if (rowIdx === -1) return { success: false, message: 'Super Admin not found.' };

      const sheetRow = rowIdx + 2;
      const newPass  = payload.password ? payload.password.trim() : rows[rowIdx][2];

      saSh.getRange(sheetRow, 1, 1, 5).setValues([[
        payload.username.trim(),
        (payload.email || '').trim(),
        newPass,
        'Super Admin',
        payload.status || 'Active'
      ]]);

      cacheBust_('admins');
      writeAuditLog_('ADMIN_UPDATE', { admin_id: payload.admin_id, name: payload.name });
      return { success: true };

    } else {
      // Update in "Admins" sheet
      const sh  = getAdminsSheet_();
      const lr  = sh.getLastRow();
      if (lr < 2) return { success: false, message: 'Admin not found.' };

      const allRows = sh.getRange(2,1,lr-1,10).getValues();
      const rowIdx  = allRows.findIndex(r => String(r[0]).trim() === payload.admin_id.trim());
      if (rowIdx === -1) return { success: false, message: 'Admin not found.' };

      // Duplicate username check — exclude self
      const unameLower = payload.username.trim().toLowerCase();
      const dupUser = allRows.some((r, i) =>
        i !== rowIdx && String(r[2]).trim().toLowerCase() === unameLower
      );
      if (dupUser) return { success: false, message: `Username "${payload.username}" already exists.` };
      // Also check Super Admins
      const saSh2 = getSuperAdminsSheet_();
      const saLR2 = saSh2.getLastRow();
      if (saLR2 >= 2) {
        const saNames = saSh2.getRange(2,1,saLR2-1,1).getValues().flat().map(v => String(v).trim().toLowerCase());
        if (saNames.includes(unameLower)) return { success: false, message: `Username "${payload.username}" already exists.` };
      }

      if (payload.role === 'Branch Admin' && !payload.branch_ids) {
        return { success: false, message: 'Assign at least one branch.' };
      }

      const existRow  = allRows[rowIdx];
      const existPass = String(existRow[4]||'').trim();
      const createdAt = existRow[8] || new Date();
      const newPass   = payload.password ? payload.password.trim() : existPass;

      sh.getRange(rowIdx+2, 2, 1, 9).setValues([[
        payload.name.trim(),
        payload.username.trim(),
        (payload.email || '').trim(),
        newPass,
        payload.role   || 'Branch Admin',
        payload.status || 'Active',
        (payload.branch_ids || '').trim(),
        createdAt,
        new Date()
      ]]);

      cacheBust_('admins');
      writeAuditLog_('ADMIN_UPDATE', { admin_id: payload.admin_id, name: payload.name });
      return { success: true };
    }

  } catch (err) {
    Logger.log('updateAdmin ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
  });
}

// ── DELETE ───────────────────────────────────────────────────
// Soft-delete: marks is_archived=1 in Super Admins or Admins sheet
// (depending on adminId prefix).  Reads filter archived rows out by
// default.  Refuses to archive the LAST active Super Admin to prevent
// system lockout.
function _setAdminArchive_(adminId, archived) {
  if (!adminId) return { success: false, message: 'Admin ID is required.' };

  if (adminId.startsWith('SA-')) {
    const saSh = getSuperAdminsSheet_();
    const saLR = saSh.getLastRow();
    if (saLR < 2) return { success: false, message: 'Admin not found.' };
    const origUsername = adminId.replace(/^SA-/, '').toLowerCase();
    const rows = saSh.getRange(2, 1, saLR - 1, 1).getValues().flat().map(String);
    const rowIdx = rows.findIndex(r => r.trim().toLowerCase() === origUsername);
    if (rowIdx === -1) return { success: false, message: 'Super Admin not found.' };

    if (archived) {
      // Refuse to archive the last active Super Admin
      const archCol = findArchiveCol_(saSh);
      const cols    = Math.max(saSh.getLastColumn(), 1);
      const allRows = saSh.getRange(2, 1, saLR - 1, cols).getValues();
      const activeOthers = allRows.filter((r, i) =>
        i !== rowIdx && r[0] && String(r[0]).trim() && !isArchivedRow_(r, archCol)
      ).length;
      if (activeOthers === 0) {
        return { success: false, message: 'Cannot archive the last active Super Admin.' };
      }
    }

    const col = ensureArchiveCol_(saSh);
    saSh.getRange(rowIdx + 2, col).setValue(archived ? 1 : 0);
  } else {
    const sh = getAdminsSheet_();
    const r  = setArchiveFlag_(sh, adminId, archived);
    if (!r.ok) return { success: false, message: 'Admin not found.' };
  }
  return { success: true };
}

function archiveAdmin(adminId) {
  return withLock_(function() {
    try {
      const r = _setAdminArchive_(adminId, true);
      if (!r.success) return r;
      cacheBust_('admins');
      writeAuditLog_('ADMIN_ARCHIVE', { admin_id: adminId });
      return { success: true };
    } catch (err) {
      Logger.log('archiveAdmin ERROR: ' + err.message);
      return { success: false, message: err.message };
    }
  });
}

function unarchiveAdmin(adminId) {
  return withLock_(function() {
    try {
      const r = _setAdminArchive_(adminId, false);
      if (!r.success) return r;
      cacheBust_('admins');
      writeAuditLog_('ADMIN_UNARCHIVE', { admin_id: adminId });
      return { success: true };
    } catch (err) {
      Logger.log('unarchiveAdmin ERROR: ' + err.message);
      return { success: false, message: err.message };
    }
  });
}

// Backward-compat — old UIs still call deleteAdmin; route to archive.
function deleteAdmin(adminId) { return archiveAdmin(adminId); }

// ── LOGIN — UPDATED ──────────────────────────────────────────
// Now checks BOTH sheets. Super Admins get full access.
// Branch Admins get branch_ids returned so the app can filter.
// This replaces loginSuperAdmin in Code.gs for the unified login.
function loginStaff_(usernameOrEmail, password) {
  Logger.log('loginAdmin: ' + usernameOrEmail);
  try {
    const inputUser = (usernameOrEmail || '').toString().trim().toLowerCase();
    const inputPass = (password || '').toString().trim();

    // ── Check Super Admins sheet first ──
    const saSh    = getSuperAdminsSheet_();
    const saLR    = saSh.getLastRow();
    const saArchCol = findArchiveCol_(saSh);
    if (saLR >= 2) {
      // Read enough cols to cover both the data range AND the is_archived
      // column — otherwise an archived SA whose archive flag lives past
      // the data columns would silently slip through the archive check.
      const numCols = Math.max(Math.min(saSh.getLastColumn(), 7), 6, saArchCol || 0);
      const saRows  = saSh.getRange(2, 1, saLR - 1, numCols).getValues();
      for (const row of saRows) {
        const username  = String(row[0] || '').trim();
        const email     = String(row[1] || '').trim().toLowerCase();
        const pass      = String(row[2] || '').trim();
        const role      = String(row[3] || 'Super Admin').trim() || 'Super Admin';
        const status    = String(row[4] || '').trim().toLowerCase();
        const photoUrl  = String(row[5] || '').trim();
        if (status === 'inactive') continue;
        if (isArchivedRow_(row, saArchCol)) continue;
        if ((username.toLowerCase() === inputUser || email === inputUser) && pass === inputPass) {
          Logger.log('loginAdmin: Super Admin match — ' + username);
          return {
            success:    true,
            admin_id:   'SA-' + username.replace(/\W/g,'').toUpperCase(),
            name:       username,
            username:   username,
            email:      email,
            role:       role,
            branch_ids: '',
            status:     'Active',
            photo_url:  photoUrl
          };
        }
      }
    }

    // ── Check Branch Admins sheet ──
    const sh      = getAdminsSheet_();
    const lr      = sh.getLastRow();
    const archCol = findArchiveCol_(sh);
    if (lr >= 2) {
      // Same archive-col extension as Super Admins above — don't let
      // an archived BA log in just because is_archived sits past col 12.
      const numCols = Math.max(Math.min(sh.getLastColumn(), 12), 11, archCol || 0);
      const rows    = sh.getRange(2, 1, lr - 1, numCols).getValues();
      for (const row of rows) {
        const username  = String(row[2] || '').trim();
        const email     = String(row[3] || '').trim().toLowerCase();
        const pass      = String(row[4] || '').trim();
        const role      = String(row[5] || 'Branch Admin').trim();
        const status    = String(row[6] || '').trim().toLowerCase();
        const branchIds = String(row[7] || '').trim();
        const photoUrl  = String(row[10]|| '').trim();
        if (status === 'inactive') continue;
        if (isArchivedRow_(row, archCol)) continue;
        if ((username.toLowerCase() === inputUser || email === inputUser) && pass === inputPass) {
          Logger.log('loginAdmin: Branch Admin match — ' + username);
          return {
            success:    true,
            admin_id:   String(row[0]).trim(),
            name:       String(row[1] || '').trim(),
            username:   username,
            email:      email,
            role:       role,
            branch_ids: branchIds,
            status:     'Active',
            photo_url:  photoUrl
          };
        }
      }
    }

    return { success: false, message: 'Invalid username/email or password.' };

  } catch (err) {
    Logger.log('loginAdmin ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}