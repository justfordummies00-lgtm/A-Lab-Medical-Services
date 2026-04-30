// ============================================================
//  A-LAB — TechnologistsCode.gs
//
//  Technologists sheet columns:
//    A=tech_id      B=last_name    C=first_name   D=middle_name
//    E=suffix       F=branch_ids   G=email        H=username
//    I=password     J=role         K=created_at   L=updated_at
//    M=photo_url
// ============================================================

function getTechSheet_() {
  const sh = getSS_().getSheetByName('Technologists');
  if (!sh) throw new Error('"Technologists" sheet not found.');
  return sh;
}

function buildTechBranchMap_() {
  const map = {};
  try {
    const sh = getSS_().getSheetByName('Branches');
    if (!sh) return map;
    const lr = sh.getLastRow();
    if (lr < 2) return map;
    sh.getRange(2, 1, lr-1, 2).getValues().forEach(r => {
      if (r[0]) map[String(r[0]).trim()] = String(r[1]||'').trim();
    });
  } catch(e) {}
  return map;
}

function getTechBranchList_() {
  try {
    const sh = getSS_().getSheetByName('Branches');
    if (!sh) return [];
    const lr = sh.getLastRow();
    if (lr < 2) return [];
    return sh.getRange(2, 1, lr-1, 4).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({
        branch_id:   String(r[0]).trim(),
        branch_name: String(r[1]).trim(),
        branch_code: String(r[2]).trim(),
        address:     String(r[3]||'').trim()
      }));
  } catch(e) { return []; }
}

// ── READ ─────────────────────────────────────────────────────
function getTechnologists(branchIds, includeArchived) {
  const filter = (branchIds || '').toString().trim();
  const inc    = !!includeArchived;
  const cacheKey = (filter || 'all') + (inc ? ':inc_arch' : '');
  return withCache_('technologists', cacheKey, 60, function() { return _getTechnologists_(filter, inc); });
}

function _getTechnologists_(branchIds, includeArchived) {
  try {
    const sh = getTechSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [], branches: getTechBranchList_() };

    const branchMap = buildTechBranchMap_();
    const filterIds = branchIds ? branchIds.split(',').map(s => s.trim()).filter(Boolean) : [];
    const archCol   = findArchiveCol_(sh);

    const data = sh.getRange(2, 1, lr-1, Math.max(14, sh.getLastColumn())).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .filter(r => includeArchived || !isArchivedRow_(r, archCol))
      .map(r => {
        const bIds  = String(r[5]||'').trim();
        const bDisp = bIds
          ? bIds.split(',').map(bid => branchMap[bid.trim()] || bid.trim()).join(', ')
          : '';
        return {
          tech_id:          String(r[0]).trim(),
          last_name:        String(r[1]||'').trim(),
          first_name:       String(r[2]||'').trim(),
          middle_name:      String(r[3]||'').trim(),
          suffix:           String(r[4]||'').trim(),
          branch_ids:       bIds,
          branches_display: bDisp,
          email:            String(r[6]||'').trim(),
          username:         String(r[7]||'').trim(),
          role:             String(r[9]||'Medical Technologist').trim(),
            assigned_deps:    String(r[13]||'').trim(),
          photo_url:        String(r[12]||'').trim(),
          created_at:       r[10] ? new Date(r[10]).toISOString() : '',
          updated_at:       r[11] ? new Date(r[11]).toISOString() : ''
        };
      })
      .filter(d => {
        if (!filterIds.length) return true;
        const tBIds = d.branch_ids.split(',').map(s => s.trim()).filter(Boolean);
        return filterIds.some(bid => tBIds.includes(bid));
      });

    Logger.log('getTechnologists: ' + data.length);
    return { success: true, data, branches: getTechBranchList_() };
  } catch(e) {
    Logger.log('getTechnologists ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE ───────────────────────────────────────────────────
function createTechnologist(payload) {
  return withLock_(function() {
  try {
    if (!payload.last_name)  return { success: false, message: 'Last name is required.' };
    if (!payload.first_name) return { success: false, message: 'First name is required.' };
    if (!payload.username)   return { success: false, message: 'Username is required.' };
    if (!payload.password)   return { success: false, message: 'Password is required.' };
    if (!payload.branch_ids) return { success: false, message: 'Assign at least one branch.' };

    const sh  = getTechSheet_();
    const lr  = sh.getLastRow();
    const now = new Date();

    // Duplicate username check — col H (8)
    if (lr >= 2) {
      const usernames = sh.getRange(2, 8, lr-1, 1).getValues().flat().map(v => String(v).trim().toLowerCase());
      if (usernames.includes(payload.username.trim().toLowerCase()))
        return { success: false, message: `Username "${payload.username}" already exists.` };
    }

    const techId = 'TECH-' + Math.random().toString(16).substr(2,8).toUpperCase();

    sh.appendRow([
      techId,
      payload.last_name.trim(),
      payload.first_name.trim(),
      (payload.middle_name || '').trim(),
      (payload.suffix      || '').trim(),
      (payload.branch_ids  || '').trim(),
      (payload.email       || '').trim(),
      payload.username.trim(),
        payload.password.trim(),
        payload.role || 'Medical Technologist',
        now,
        now,
        '',
        (payload.assigned_deps || '').trim()
    ]);

    cacheBust_('technologists');
    writeAuditLog_('TECH_CREATE', { tech_id: techId, name: payload.last_name + ', ' + payload.first_name });
    Logger.log('createTechnologist: ' + techId);
    return { success: true, tech_id: techId };
  } catch(e) {
    Logger.log('createTechnologist ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
  });
}

// ── UPDATE ───────────────────────────────────────────────────
function updateTechnologist(payload) {
  return withLock_(function() {
  try {
    if (!payload.tech_id)    return { success: false, message: 'Tech ID is required.' };
    if (!payload.last_name)  return { success: false, message: 'Last name is required.' };
    if (!payload.first_name) return { success: false, message: 'First name is required.' };
    if (!payload.username)   return { success: false, message: 'Username is required.' };
    if (!payload.branch_ids) return { success: false, message: 'Assign at least one branch.' };

    const sh  = getTechSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Technologist not found.' };

    // Batch read all rows (14 cols: A–N)
    const allRows = sh.getRange(2,1,lr-1,14).getValues();
    const rowIdx  = allRows.findIndex(r => String(r[0]).trim() === payload.tech_id.trim());
    if (rowIdx === -1) return { success: false, message: 'Technologist not found.' };

    // Duplicate username check — exclude self (col H = index 7)
    const unameLower = payload.username.trim().toLowerCase();
    const dup = allRows.some((r, i) =>
      i !== rowIdx && String(r[7]).trim().toLowerCase() === unameLower
    );
    if (dup) return { success: false, message: `Username "${payload.username}" already exists.` };

    const existRow  = allRows[rowIdx];
    const createdAt = existRow[10] || new Date();  // col K
    const existPass = String(existRow[8]||'').trim(); // col I
    const password  = payload.password ? payload.password.trim() : existPass;

    sh.getRange(rowIdx+2, 2, 1, 13).setValues([[
      payload.last_name.trim(),
      payload.first_name.trim(),
      (payload.middle_name || '').trim(),
      (payload.suffix      || '').trim(),
      (payload.branch_ids  || '').trim(),
      (payload.email       || '').trim(),
      payload.username.trim(),
      password,
      payload.role || 'Medical Technologist',
      createdAt,
      new Date(),
      existRow[12] || '',
      (payload.assigned_deps || '').trim()
    ]]);

    cacheBust_('technologists');
    writeAuditLog_('TECH_UPDATE', { tech_id: payload.tech_id });
    return { success: true };
  } catch(e) {
    Logger.log('updateTechnologist ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
  });
}

// ── DELETE ───────────────────────────────────────────────────
function getTechRoleById(techId) {
  try {
    if (!techId) return { success: false, message: 'Tech ID required.' };
    const sh = getTechSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Not found.' };
    const rows = sh.getRange(2, 1, lr - 1, 10).getValues();
    const row = rows.find(r => String(r[0]).trim() === techId);
    if (!row) return { success: false, message: 'Not found.' };
    return { success: true, tech_role: String(row[9] || '').trim() }; // col J = index 9
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// Soft-delete: archives the row instead of removing it.  See Archive.gs.
function archiveTechnologist(techId) {
  return withLock_(function() {
    try {
      if (!techId) return { success: false, message: 'Tech ID is required.' };
      const sh = getTechSheet_();
      const r  = setArchiveFlag_(sh, techId, true);
      if (!r.ok) return { success: false, message: 'Technologist not found.' };
      cacheBust_('technologists');
      writeAuditLog_('TECH_ARCHIVE', { tech_id: techId });
      return { success: true };
    } catch(e) {
      Logger.log('archiveTechnologist ERROR: ' + e.message);
      return { success: false, message: e.message };
    }
  });
}

function unarchiveTechnologist(techId) {
  return withLock_(function() {
    try {
      if (!techId) return { success: false, message: 'Tech ID is required.' };
      const sh = getTechSheet_();
      const r  = setArchiveFlag_(sh, techId, false);
      if (!r.ok) return { success: false, message: 'Technologist not found.' };
      cacheBust_('technologists');
      writeAuditLog_('TECH_UNARCHIVE', { tech_id: techId });
      return { success: true };
    } catch(e) {
      Logger.log('unarchiveTechnologist ERROR: ' + e.message);
      return { success: false, message: e.message };
    }
  });
}

// Backward-compat — old UIs still call deleteTechnologist; route to archive.
function deleteTechnologist(techId) { return archiveTechnologist(techId); }