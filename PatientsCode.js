// ============================================================
//  A-LAB — PatientsCode.gs
//
//  Patients are stored in the BRANCH spreadsheet, not main SS.
//  Branch spreadsheet ID comes from Branches sheet col H.
//
//  Patients sheet columns (in branch SS):
//    A=patient_id    B=last_name    C=first_name   D=middle_name
//    E=sex           F=dob          G=contact      H=email
//    I=address       J=philhealth_pin
//    K=discount_ids  L=created_at   M=updated_at
// ============================================================

// ── SS CACHE (per execution) ─────────────────────────────────
// Branch SS opens are memoized through openSS_() in Cache.js so
// any module that touches the same branch SS in this invocation
// hits the same cached SpreadsheetApp object.
function getBranchSS_(branchId) {
  const brSh = getSS_().getSheetByName('Branches');
  if (!brSh) throw new Error('"Branches" sheet not found.');
  const lr   = brSh.getLastRow();
  if (lr < 2) throw new Error('No branches found.');
  const rows = brSh.getRange(2, 1, lr-1, 8).getValues();
  const row  = rows.find(r => String(r[0]).trim() === branchId.trim());
  if (!row) throw new Error('Branch "' + branchId + '" not found.');
  const ssId = String(row[7] || '').trim();
  if (!ssId) throw new Error('Branch "' + branchId + '" has no spreadsheet configured.');
  return openSS_(ssId);
}

// ── GET OR CREATE Patients sheet in branch SS ────────────────
function getPatientSheet_(branchId) {
  const ss = getBranchSS_(branchId);
  let sh   = ss.getSheetByName('Patients');
  if (!sh) {
    sh = ss.insertSheet('Patients');
    sh.getRange(1, 1, 1, 16).setValues([[
      'patient_id','last_name','first_name','middle_name',
      'sex','dob','contact','email','address',
      'philhealth_pin','discount_ids','created_at','updated_at',
      'home_branch_id','is_4ps','discount_id_no'
    ]]);
    sh.getRange(1, 1, 1, 16).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
    sh.getRange(2, 6, 1000, 1).setNumberFormat('yyyy-mm-dd');
    sh.getRange(2, 12, 1000, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else {
    // Migration: Add missing columns
    if (sh.getLastColumn() < 16) {
      if (sh.getLastColumn() < 15) {
        sh.getRange(1, 15, 1, 2).setValues([['is_4ps', 'discount_id_no']]).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      } else {
        sh.getRange(1, 16).setValue('discount_id_no').setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      }
    }
    if (sh.getLastColumn() < 18) {
      if (sh.getLastColumn() < 17) {
        sh.getRange(1, 17, 1, 2).setValues([['senior_citizen_id', 'pwd_id']]).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      } else {
        sh.getRange(1, 18).setValue('pwd_id').setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      }
    }
  }
  return sh;
}

// ── BUILD DISCOUNT MAP (from main SS) ───────────────────────
function buildDiscountMap_() {
  const map = {};
  try {
    const sh = getSS_().getSheetByName('Discounts');
    if (!sh) return map;
    const lr = sh.getLastRow();
    if (lr < 2) return map;
    sh.getRange(2, 1, lr-1, 5).getValues()
      .filter(r => r[0])
      .forEach(r => {
        map[String(r[0]).trim()] = {
          discount_id:   String(r[0]).trim(),
          discount_name: String(r[1]||'').trim(),
          type:          String(r[3]||'').trim(),
          value:         parseFloat(r[4])||0
        };
      });
  } catch(e) {}
  return map;
}

// ── READ ─────────────────────────────────────────────────────
function getPatients(branchId, includeArchived) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID is required.' };

    const sh  = getPatientSheet_(branchId);
    const lr  = sh.getLastRow();

    // Batch read patients + discounts from main SS simultaneously
    // discMap built from main SS (not branch SS — already in memory)
    const discMap = buildDiscountMap_();
    const archCol = findArchiveCol_(sh);

    const data = lr < 2 ? [] :
      sh.getRange(2, 1, lr-1, Math.max(sh.getLastColumn(), 18)).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .filter(r => includeArchived || !isArchivedRow_(r, archCol))
        .map(r => {
          const discIds  = String(r[10]||'').trim();
          const discDisp = discIds
            ? discIds.split(',').map(did => {
                const d = discMap[did.trim()];
                return d ? d.discount_name : did.trim();
              }).join(', ')
            : '';
          return {
            patient_id:        String(r[0]).trim(),
            last_name:         String(r[1]||'').trim(),
            first_name:        String(r[2]||'').trim(),
            middle_name:       String(r[3]||'').trim(),
            sex:               String(r[4]||'').trim(),
            dob:               r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
            contact:           String(r[6]||'').trim(),
            email:             String(r[7]||'').trim(),
            address:           String(r[8]||'').trim(),
            philhealth_pin:    String(r[9]||'').trim(),
            discount_ids:      discIds,
            discounts_display: discDisp,
            created_at:        r[11] ? new Date(r[11]).toISOString() : '',
            updated_at:        r[12] ? new Date(r[12]).toISOString() : '',
            home_branch_id:    String(r[13]||'').trim(),
            is_4ps:            r[14]==1?1:0,
            discount_id_no:    String(r[15]||'').trim(),
            senior_citizen_id: String(r[16]||'').trim(),
            pwd_id:            String(r[17]||'').trim()
          };
        });

    // Active discounts for form picker — reuse discMap already built
    const discounts = Object.values(discMap);

    Logger.log('getPatients: ' + branchId + ' → ' + data.length);
    return { success: true, data, discounts };
  } catch(e) {
    Logger.log('getPatients ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE ────────────────────────────────────────────────────
function createPatient(branchId, payload) {
  return withLock_(function() {
  try {
    if (!branchId)           return { success: false, message: 'Branch ID is required.' };
    if (!payload.last_name)  return { success: false, message: 'Last name is required.' };
    if (!payload.first_name) return { success: false, message: 'First name is required.' };
    if (!payload.sex)        return { success: false, message: 'Sex is required.' };
    if (!payload.dob)        return { success: false, message: 'Date of birth is required.' };
    if (!payload.contact)    return { success: false, message: 'Contact is required.' };
    if (!payload.address)    return { success: false, message: 'Address is required.' };

    const sh  = getPatientSheet_(branchId);
    const now = new Date();
    const patId = 'PAT-' + Math.random().toString(16).substr(2,8).toUpperCase();

    sh.appendRow([
      patId,
      payload.last_name.trim(),
      payload.first_name.trim(),
      (payload.middle_name    || '').trim(),
      payload.sex.trim(),
      payload.dob ? new Date(payload.dob) : '',
      payload.contact.trim(),
      (payload.email          || '').trim(),
      payload.address.trim(),
      (payload.philhealth_pin || '').trim(),
      (payload.discount_ids   || '').trim(),
      now, now,
      branchId,             // home_branch_id = enrolling branch
      payload.is_4ps ? 1 : 0,
      '',                                           // discount_id_no (legacy, kept for compat)
      (payload.senior_citizen_id || '').trim(),
      (payload.pwd_id            || '').trim()
    ]);

    writeAuditLog_('PATIENT_CREATE', { branch_id: branchId, patient_id: patId, name: payload.last_name + ', ' + payload.first_name });
    Logger.log('createPatient: ' + patId);

    // Auto-create patient Drive folder if branch has a root folder configured
    try {
      const drvCfg = getDriveFolderConfig(branchId);
      const rootFolderId = drvCfg && drvCfg.root_folder_id ? drvCfg.root_folder_id.trim() : '';
      if (rootFolderId) {
        const rootFolder = DriveApp.getFolderById(rootFolderId);
        const folderName = payload.last_name.trim() + ', ' + payload.first_name.trim() + ' - ' + patId;
        const existing = rootFolder.getFoldersByName(folderName);
        if (!existing.hasNext()) rootFolder.createFolder(folderName);
      }
    } catch(drvErr) {
      Logger.log('createPatient: Drive folder creation skipped: ' + drvErr.message);
    }

    return { success: true, patient_id: patId };
  } catch(e) {
    Logger.log('createPatient ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
  });
}

// ── UPDATE ────────────────────────────────────────────────────
function updatePatient(branchId, payload) {
  return withLock_(function() {
  try {
    if (!branchId)            return { success: false, message: 'Branch ID is required.' };
    if (!payload.patient_id)  return { success: false, message: 'Patient ID is required.' };
    if (!payload.last_name)   return { success: false, message: 'Last name is required.' };
    if (!payload.first_name)  return { success: false, message: 'First name is required.' };
    if (!payload.sex)         return { success: false, message: 'Sex is required.' };
    if (!payload.dob)         return { success: false, message: 'Date of birth is required.' };
    if (!payload.contact)     return { success: false, message: 'Contact is required.' };
    if (!payload.address)     return { success: false, message: 'Address is required.' };

    const sh  = getPatientSheet_(branchId);
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Patient not found.' };

    const cols   = Math.max(sh.getLastColumn(), 15);
    const allRows = sh.getRange(2, 1, lr-1, cols).getValues();
    const rowIdx  = allRows.findIndex(r => String(r[0]).trim() === payload.patient_id.trim());
    if (rowIdx === -1) return { success: false, message: 'Patient not found.' };

    const sheetRow    = rowIdx + 2;
    const existRow    = allRows[rowIdx];
    const createdAt   = existRow[11] || new Date();
    const homeBranch  = String(existRow[13]||branchId).trim(); // preserve home branch

    sh.getRange(sheetRow, 2, 1, 17).setValues([[
      payload.last_name.trim(),
      payload.first_name.trim(),
      (payload.middle_name    || '').trim(),
      payload.sex.trim(),
      payload.dob ? new Date(payload.dob) : '',
      payload.contact.trim(),
      (payload.email          || '').trim(),
      payload.address.trim(),
      (payload.philhealth_pin || '').trim(),
      (payload.discount_ids   || '').trim(),
      createdAt,
      new Date(),            // updated_at
      homeBranch,
      payload.is_4ps ? 1 : 0,
      '',                                           // discount_id_no (legacy)
      (payload.senior_citizen_id || '').trim(),
      (payload.pwd_id            || '').trim()
    ]]);

    writeAuditLog_('PATIENT_UPDATE', { branch_id: branchId, patient_id: payload.patient_id });
    return { success: true };
  } catch(e) {
    Logger.log('updatePatient ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
  });
}

// ── DELETE ────────────────────────────────────────────────────
// Soft-delete: archives the patient instead of removing the row.
// All historical orders / payments / results stay intact and remain
// queryable from the home branch's records.  See Archive.gs.
function archivePatient(branchId, patientId) {
  return withLock_(function() {
    try {
      if (!branchId)  return { success: false, message: 'Branch ID is required.' };
      if (!patientId) return { success: false, message: 'Patient ID is required.' };
      const sh = getPatientSheet_(branchId);
      const r  = setArchiveFlag_(sh, patientId, true);
      if (!r.ok) return { success: false, message: 'Patient not found.' };
      writeAuditLog_('PATIENT_ARCHIVE', { branch_id: branchId, patient_id: patientId });
      return { success: true };
    } catch(e) {
      Logger.log('archivePatient ERROR: ' + e.message);
      return { success: false, message: e.message };
    }
  });
}

function unarchivePatient(branchId, patientId) {
  return withLock_(function() {
    try {
      if (!branchId)  return { success: false, message: 'Branch ID is required.' };
      if (!patientId) return { success: false, message: 'Patient ID is required.' };
      const sh = getPatientSheet_(branchId);
      const r  = setArchiveFlag_(sh, patientId, false);
      if (!r.ok) return { success: false, message: 'Patient not found.' };
      writeAuditLog_('PATIENT_UNARCHIVE', { branch_id: branchId, patient_id: patientId });
      return { success: true };
    } catch(e) {
      Logger.log('unarchivePatient ERROR: ' + e.message);
      return { success: false, message: e.message };
    }
  });
}

// Backward-compat — old UIs still call deletePatient; route to archive.
function deletePatient(branchId, patientId) { return archivePatient(branchId, patientId); }

// ── GET BRANCHES FOR PATIENT VIEW (SA/BA selector) ───────────
function getBranchesForPatientView(branchIds) {
  try {
    const sh = getSS_().getSheetByName('Branches');
    if (!sh) return { success: true, data: [] };
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    const allowed = branchIds ? new Set(branchIds.split(',').map(s => s.trim()).filter(Boolean)) : null;
    const data = sh.getRange(2, 1, lr-1, 9).getValues()
      .filter(r => r[0] && String(r[0]).trim() && r[6] !== 'Inactive')
      .filter(r => !allowed || allowed.has(String(r[0]).trim()))
      .map(r => ({
        branch_id:      String(r[0]).trim(),
        branch_name:    String(r[1]).trim(),
        branch_code:    String(r[2]).trim(),
        spreadsheet_id: String(r[7]||'').trim()
      }));

    return { success: true, data };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  CROSS-BRANCH PATIENT ACCESS (Section 2.1 of spec)
//
//  Rules:
//  - Any branch can ENROLL a patient (already works)
//  - Patients sheet gets home_branch_id col (col 14, added via ensurePatientCols_)
//  - Viewing records from another branch requires permission from home branch
//  - Patient_Access_Grants sheet (main SS): patient_id | requesting_branch | 
//    home_branch | granted_by | granted_at | is_active
//
//  Flow:
//  1. Branch B tries to search patient enrolled at Branch A
//  2. Patient appears with locked=true if no grant exists
//  3. BA of Branch A grants access → Branch B can view full records
// ════════════════════════════════════════════════════════════════

// ── ENSURE home_branch_id col on Patients sheet ──────────────
function ensurePatientCols_(sh) {
  if (!sh || sh.getLastRow() < 1) return;
  const cols = sh.getLastColumn();
  if (cols < 14) sh.getRange(1, 14).setValue('home_branch_id');
}

// ── SEARCH PATIENTS ACROSS ALL BRANCHES (cross-branch) ───────
// Returns patients from all branches matching query
// Marks locked=true if requesting branch doesn't have access grant
function searchPatientsAcrossBranches(requestingBranchId, query) {
  try {
    if (!requestingBranchId || !query || query.trim().length < 2)
      return { success: false, message: 'Branch ID and query (min 2 chars) required.' };

    const ss   = getSS_();
    const brSh = ss.getSheetByName('Branches');
    if (!brSh || brSh.getLastRow() < 2) return { success: true, data: [] };

    const q = query.trim().toLowerCase();

    // Build access grants map for requesting branch
    const grantsSh = _getAccessGrantsSheet_();
    const grantedPatients = new Set();
    if (grantsSh && grantsSh.getLastRow() >= 2) {
      grantsSh.getRange(2,1,grantsSh.getLastRow()-1,6).getValues()
        .filter(r => r[0] && String(r[1]).trim() === requestingBranchId && r[5]==1)
        .forEach(r => grantedPatients.add(String(r[0]).trim()));
    }

    const branches = brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues()
      .filter(r => r[0] && r[7]);

    const results = [];
    for (const br of branches) {
      const branchId   = String(br[0]).trim();
      const branchName = String(br[1]).trim();
      const ssId       = String(br[7]).trim();

      try {
        const bss  = openSS_(ssId);
        const patSh = bss.getSheetByName('Patients');
        if (!patSh || patSh.getLastRow() < 2) continue;

        const cols    = Math.max(patSh.getLastColumn(), 13);
        const archCol = findArchiveCol_(patSh);
        patSh.getRange(2,1,patSh.getLastRow()-1,cols).getValues()
          .filter(r => r[0])
          .filter(r => !isArchivedRow_(r, archCol))
          .forEach(r => {
            const patId    = String(r[0]).trim();
            const lastName = String(r[1]||'').trim();
            const firstName= String(r[2]||'').trim();
            const contact  = String(r[6]||'').trim();
            const searchStr= [lastName, firstName, contact, patId].join(' ').toLowerCase();

            if (!searchStr.includes(q)) return;

            const homeBranch  = String(r[13]||branchId).trim(); // col 14 = home_branch_id
            const isHomeBranch = homeBranch === requestingBranchId || branchId === requestingBranchId;
            const hasGrant     = grantedPatients.has(patId);
            const locked       = !isHomeBranch && !hasGrant;

            // Locked rows surface only the bare minimum needed to recognise
            // the patient and request access — no contact, no address, no
            // discount IDs, no PhilHealth, no demographics beyond name.
            results.push(locked ? {
              patient_id:         patId,
              last_name:          lastName,
              first_name:         firstName,
              middle_name:        '',
              sex:                '',
              dob:                '',
              contact:            '',
              email:              '',
              address:            '',
              home_branch:        branchName,
              home_branch_id:     homeBranch,
              enrolled_branch_id: branchId,
              locked:             true,
              philhealth_pin:     '',
              discount_ids:       '',
              discounts_display:  '',
              senior_citizen_id:  '',
              pwd_id:             '',
              is_4ps:             0
            } : {
              patient_id:         patId,
              last_name:          lastName,
              first_name:         firstName,
              middle_name:        String(r[3]||'').trim(),
              sex:                String(r[4]||'').trim(),
              dob:                r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
              contact:            contact,
              email:              String(r[7]||'').trim(),
              address:            String(r[8]||'').trim(),
              home_branch:        branchName,
              home_branch_id:     homeBranch,
              enrolled_branch_id: branchId,
              locked:             false,
              philhealth_pin:     String(r[9]||'').trim(),
              discount_ids:       String(r[10]||'').trim(),
              senior_citizen_id:  String(r[16]||'').trim(),
              pwd_id:             String(r[17]||'').trim(),
              is_4ps:             r[14]==1 ? 1 : 0
            });
          });
      } catch(brErr) {
        Logger.log('searchPatientsAcrossBranches: branch ' + branchId + ' err: ' + brErr.message);
      }
    }

    Logger.log('searchPatientsAcrossBranches: ' + q + ' → ' + results.length + ' results');
    return { success: true, data: results };
  } catch(e) {
    Logger.log('searchPatientsAcrossBranches ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GRANT CROSS-BRANCH ACCESS ─────────────────────────────────
// Called by home branch BA to grant another branch access to a patient
function grantPatientAccess(patientId, homeBranchId, requestingBranchId, grantedBy) {
  try {
    if (!patientId || !homeBranchId || !requestingBranchId)
      return { success: false, message: 'Missing required parameters.' };
    if (homeBranchId === requestingBranchId)
      return { success: false, message: 'Cannot grant access to home branch.' };

    const sh  = _getAccessGrantsSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();

    // Check if grant already exists — upsert
    if (lr >= 2) {
      const rows = sh.getRange(2,1,lr-1,6).getValues();
      const idx  = rows.findIndex(r =>
        String(r[0]).trim() === patientId &&
        String(r[1]).trim() === requestingBranchId
      );
      if (idx !== -1) {
        sh.getRange(idx+2, 4, 1, 3).setValues([[grantedBy||'', now, 1]]);
        Logger.log('grantPatientAccess: updated existing grant ' + patientId + ' → ' + requestingBranchId);
        return { success: true, action: 'updated' };
      }
    }

    sh.appendRow([patientId, requestingBranchId, homeBranchId, grantedBy||'', now, 1]);
    writeAuditLog_('PATIENT_ACCESS_GRANT', {
      patient_id: patientId, from: homeBranchId, to: requestingBranchId
    });
    Logger.log('grantPatientAccess: ' + patientId + ' → ' + requestingBranchId);
    return { success: true, action: 'created' };
  } catch(e) {
    Logger.log('grantPatientAccess ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── REVOKE CROSS-BRANCH ACCESS ────────────────────────────────
function revokePatientAccess(patientId, requestingBranchId) {
  try {
    if (!patientId || !requestingBranchId) return { success: false, message: 'Missing params.' };
    const sh = _getAccessGrantsSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Grant not found.' };
    const rows = sh.getRange(2,1,lr-1,2).getValues();
    const idx  = rows.findIndex(r =>
      String(r[0]).trim() === patientId &&
      String(r[1]).trim() === requestingBranchId
    );
    if (idx === -1) return { success: false, message: 'Grant not found.' };
    sh.getRange(idx+2, 6).setValue(0); // is_active = 0
    Logger.log('revokePatientAccess: ' + patientId + ' from ' + requestingBranchId);
    return { success: true };
  } catch(e) {
    Logger.log('revokePatientAccess ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET ACCESS GRANTS FOR HOME BRANCH (BA manages these) ─────
function getPatientAccessGrants(homeBranchId) {
  try {
    if (!homeBranchId) return { success: false, message: 'Branch ID required.' };
    const sh = _getAccessGrantsSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    // Build branch name map
    const brMap = {};
    const brSh  = getSS_().getSheetByName('Branches');
    if (brSh && brSh.getLastRow() >= 2) {
      brSh.getRange(2,1,brSh.getLastRow()-1,2).getValues()
        .forEach(r => { brMap[String(r[0]).trim()] = String(r[1]).trim(); });
    }

    const data = sh.getRange(2,1,lr-1,6).getValues()
      .filter(r => r[0] && String(r[2]).trim() === homeBranchId && r[5]==1)
      .map(r => ({
        patient_id:         String(r[0]).trim(),
        requesting_branch:  String(r[1]).trim(),
        requesting_name:    brMap[String(r[1]).trim()] || String(r[1]).trim(),
        granted_by:         String(r[3]||'').trim(),
        granted_at:         r[4] ? new Date(r[4]).toISOString() : ''
      }));

    return { success: true, data };
  } catch(e) {
    Logger.log('getPatientAccessGrants ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── INTERNAL: get/create Patient_Access_Grants sheet ─────────
function _getAccessGrantsSheet_() {
  const ss = getSS_();
  let sh   = ss.getSheetByName('Patient_Access_Grants');
  if (!sh) {
    sh = ss.insertSheet('Patient_Access_Grants');
    sh.getRange(1,1,1,6).setValues([[
      'patient_id','requesting_branch','home_branch','granted_by','granted_at','is_active'
    ]]);
    sh.getRange(1,1,1,6).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── 4P'S CENSUS REPORT ───────────────────────────────────────
// Returns all patients flagged as 4P's beneficiaries
// SA = all branches, BA = own branch
function get4psCensus(branchIds) {
  try {
    const ss   = getSS_();
    const brSh = ss.getSheetByName('Branches');
    if (!brSh || brSh.getLastRow() < 2)
      return { success: false, message: 'No branches found.' };

    const allowedIds = branchIds
      ? new Set(branchIds.split(',').map(s => s.trim()).filter(Boolean))
      : null;

    const allBranches = brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues()
      .filter(r => r[0] && r[7])
      .filter(r => !allowedIds || allowedIds.has(String(r[0]).trim()))
      .map(r => ({
        branch_id:   String(r[0]).trim(),
        branch_name: String(r[1]).trim(),
        ss_id:       String(r[7]).trim()
      }));

    const results = [];
    for (const br of allBranches) {
      try {
        const bss   = openSS_(br.ss_id);
        const patSh = bss.getSheetByName('Patients');
        if (!patSh || patSh.getLastRow() < 2) continue;
        const cols = Math.max(patSh.getLastColumn(), 15);
        patSh.getRange(2,1,patSh.getLastRow()-1,cols).getValues()
          .filter(r => r[0] && r[14] == 1)  // col 15 = is_4ps
          .forEach(r => results.push({
            patient_id:     String(r[0]).trim(),
            last_name:      String(r[1]||'').trim(),
            first_name:     String(r[2]||'').trim(),
            middle_name:    String(r[3]||'').trim(),
            sex:            String(r[4]||'').trim(),
            dob:            r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
            contact:        String(r[6]||'').trim(),
            address:        String(r[8]||'').trim(),
            philhealth_pin: String(r[9]||'').trim(),
            branch_name:    br.branch_name,
            branch_id:      br.branch_id
          }));
      } catch(e) { Logger.log('get4psCensus branch err: ' + e.message); }
    }

    results.sort((a,b) => a.last_name.localeCompare(b.last_name));
    Logger.log('get4psCensus: ' + results.length + ' 4Ps patients');
    return { success: true, data: results, total: results.length };
  } catch(e) {
    Logger.log('get4psCensus ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}