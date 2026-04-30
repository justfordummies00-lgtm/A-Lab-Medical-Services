// ============================================================
//  A-LAB — PatientIdsCode.gs
//
//  Per-branch Patient_IDs sheet:
//    A=record_id  B=patient_id  C=id_type_id  D=id_value
//    E=created_at  F=updated_at  G=is_archived
//
//  Stores per-patient IDs for non-builtin ID types (Solo Parent,
//  Indigenous People, employee ID, etc.).  The three builtin
//  types — PhilHealth PIN, Senior Citizen ID, PWD ID — continue
//  to live in fixed Patients sheet columns (10, 17, 18).  All
//  reads here transparently fall back to those fixed columns
//  for builtin types so callers can use one helper regardless.
// ============================================================

function _getPatientIdsSheet_(branchId) {
  if (!branchId) throw new Error('Branch ID is required.');
  const ssId = _getBranchSpreadsheetId_(branchId);
  if (!ssId) throw new Error('Branch spreadsheet not found for ' + branchId + '.');
  const bss = openSS_(ssId);
  let sh = bss.getSheetByName('Patient_IDs');
  if (!sh) {
    // Auto-provision the sheet on first use so older branches that
    // pre-date this feature don't 500 the whole module.  This
    // mirrors what initializeBranchDatabase will create going forward.
    sh = bss.insertSheet('Patient_IDs');
    sh.getRange(1, 1, 1, 7)
      .setValues([['record_id','patient_id','id_type_id','id_value','created_at','updated_at','is_archived']])
      .setFontWeight('bold')
      .setBackground('#0d9090')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    Logger.log('_getPatientIdsSheet_: auto-provisioned Patient_IDs on branch ' + branchId);
  }
  return sh;
}

// Resolve "Branches" row → spreadsheet_id.  Mirrors the helper
// pattern used in OrdersCode / PatientsCode.
function _getBranchSpreadsheetId_(branchId) {
  const brSh = getSS_().getSheetByName('Branches');
  if (!brSh || brSh.getLastRow() < 2) return null;
  const rows = brSh.getRange(2, 1, brSh.getLastRow() - 1, 8).getValues();
  const hit = rows.find(r => String(r[0] || '').trim() === String(branchId).trim());
  return hit ? String(hit[7] || '').trim() : null;
}

// ── READ all extra IDs for one patient ───────────────────────
// Returns the rows in Patient_IDs PLUS synthesised rows for the
// three builtins by reading fixed Patients cols.  Frontend can
// render one unified list.
function getPatientIds(branchId, patientId) {
  try {
    if (!branchId || !patientId)
      return { success: false, message: 'Branch ID and patient ID are required.' };

    // Builtin slots — read them from the Patients sheet cols 10/17/18.
    const ssId = _getBranchSpreadsheetId_(branchId);
    if (!ssId) return { success: false, message: 'Branch spreadsheet not found.' };
    const bss = openSS_(ssId);
    const patSh = bss.getSheetByName('Patients');
    if (!patSh) return { success: false, message: 'Patients sheet not found.' };

    const cols = Math.max(patSh.getLastColumn(), 18);
    const lr   = patSh.getLastRow();
    let philhealth = '', senior = '', pwd = '';
    if (lr >= 2) {
      const rows = patSh.getRange(2, 1, lr - 1, cols).getValues();
      const hit  = rows.find(r => String(r[0] || '').trim() === String(patientId).trim());
      if (hit) {
        philhealth = String(hit[9]  || '').trim();   // col 10
        senior     = String(hit[16] || '').trim();   // col 17
        pwd        = String(hit[17] || '').trim();   // col 18
      }
    }

    const builtinList = [
      { id_type_id: 'IDT-PHILHEALTH', id_value: philhealth },
      { id_type_id: 'IDT-SENIOR',     id_value: senior },
      { id_type_id: 'IDT-PWD',        id_value: pwd }
    ];

    // Pull non-builtin rows from Patient_IDs.
    const sh = _getPatientIdsSheet_(branchId);
    const ridLast = sh.getLastRow();
    const extras = [];
    if (ridLast >= 2) {
      sh.getRange(2, 1, ridLast - 1, 7).getValues().forEach(r => {
        if (!r[0]) return;
        if (String(r[1] || '').trim() !== String(patientId).trim()) return;
        if (r[6] == 1) return;  // archived
        extras.push({
          record_id:   String(r[0]).trim(),
          id_type_id:  String(r[2] || '').trim(),
          id_value:    String(r[3] || '').trim(),
          created_at:  r[4] ? new Date(r[4]).toISOString() : '',
          updated_at:  r[5] ? new Date(r[5]).toISOString() : '',
          is_archived: 0
        });
      });
    }

    // Resolve each entry's display name from the ID Types catalog.
    const types = (_getPatientIdTypes_(true).data || []);
    const typeMap = {};
    types.forEach(t => { typeMap[t.id_type_id] = t; });

    const builtinResolved = builtinList
      .filter(b => !!b.id_value)  // hide empty builtin slots
      .map(b => {
        const t = typeMap[b.id_type_id];
        return {
          record_id:   '',          // builtin rows have no record_id
          id_type_id:  b.id_type_id,
          id_type_name: t ? t.name : b.id_type_id,
          id_value:    b.id_value,
          is_builtin:  1,
          is_archived: 0
        };
      });

    const extrasResolved = extras.map(e => {
      const t = typeMap[e.id_type_id];
      return {
        record_id:    e.record_id,
        id_type_id:   e.id_type_id,
        id_type_name: t ? t.name : e.id_type_id,
        id_value:     e.id_value,
        is_builtin:   0,
        is_archived:  e.is_archived,
        created_at:   e.created_at,
        updated_at:   e.updated_at
      };
    });

    return { success: true, data: builtinResolved.concat(extrasResolved) };
  } catch (e) {
    Logger.log('getPatientIds ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── INTERNAL: read one ID value (builtin OR extra) ───────────
// Returns the ID's value string (or '' if missing).  Used by
// Orders code (PR-D2) to gate ID-required discounts.
function getPatientIdValue_(branchId, patientId, idTypeId) {
  try {
    if (!branchId || !patientId || !idTypeId) return '';

    // Builtin → read fixed Patients col.
    const builtinCol = getBuiltinIdTypePatientCol_(idTypeId);
    if (builtinCol) {
      const ssId = _getBranchSpreadsheetId_(branchId);
      if (!ssId) return '';
      const patSh = openSS_(ssId).getSheetByName('Patients');
      if (!patSh || patSh.getLastRow() < 2) return '';
      const cols = Math.max(patSh.getLastColumn(), 18);
      const rows = patSh.getRange(2, 1, patSh.getLastRow() - 1, cols).getValues();
      const hit  = rows.find(r => String(r[0] || '').trim() === String(patientId).trim());
      return hit ? String(hit[builtinCol - 1] || '').trim() : '';
    }

    // Extra → look up Patient_IDs row.
    const sh = _getPatientIdsSheet_(branchId);
    if (sh.getLastRow() < 2) return '';
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    const hit  = rows.find(r =>
      String(r[1] || '').trim() === String(patientId).trim() &&
      String(r[2] || '').trim() === String(idTypeId).trim() &&
      r[6] != 1
    );
    return hit ? String(hit[3] || '').trim() : '';
  } catch (e) {
    Logger.log('getPatientIdValue_ ERROR: ' + e.message);
    return '';
  }
}

// ── CREATE / UPDATE one ID for one patient ───────────────────
// For builtin types the value is written to the fixed Patients
// column.  For non-builtin types a row is inserted (or updated)
// in the per-branch Patient_IDs sheet.  Used both from the
// Patient form ("Add ID") and from the order discount-gate
// (PR-D2) when a receptionist enters a missing ID inline.
function setPatientId(branchId, patientId, idTypeId, idValue) {
  try {
    if (!branchId || !patientId || !idTypeId)
      return { success: false, message: 'Branch ID, patient ID and ID type are required.' };

    const value = String(idValue == null ? '' : idValue).trim();

    return withLock_(function() {
      // Builtin → patch the fixed column on Patients.
      const builtinCol = getBuiltinIdTypePatientCol_(idTypeId);
      if (builtinCol) {
        const ssId = _getBranchSpreadsheetId_(branchId);
        if (!ssId) return { success: false, message: 'Branch spreadsheet not found.' };
        const patSh = openSS_(ssId).getSheetByName('Patients');
        if (!patSh || patSh.getLastRow() < 2) return { success: false, message: 'Patient not found.' };

        const ids = patSh.getRange(2, 1, patSh.getLastRow() - 1, 1).getValues().flat().map(v => String(v || '').trim());
        const rowIdx = ids.findIndex(v => v === String(patientId).trim());
        if (rowIdx === -1) return { success: false, message: 'Patient not found.' };

        patSh.getRange(rowIdx + 2, builtinCol).setValue(value);
        patSh.getRange(rowIdx + 2, 13).setValue(new Date()); // Patients updated_at lives at col M (13)

        writeAuditLog_('PATIENT_ID_SET_BUILTIN', {
          branch_id: branchId, patient_id: patientId, id_type_id: idTypeId
        });
        return { success: true };
      }

      // Non-builtin → upsert in Patient_IDs.
      const sh = _getPatientIdsSheet_(branchId);
      const lr = sh.getLastRow();
      const now = new Date();

      if (lr >= 2) {
        const rows = sh.getRange(2, 1, lr - 1, 7).getValues();
        const existingIdx = rows.findIndex(r =>
          String(r[1] || '').trim() === String(patientId).trim() &&
          String(r[2] || '').trim() === String(idTypeId).trim() &&
          r[6] != 1
        );
        if (existingIdx !== -1) {
          sh.getRange(existingIdx + 2, 4).setValue(value);
          sh.getRange(existingIdx + 2, 6).setValue(now);
          writeAuditLog_('PATIENT_ID_UPDATE', {
            branch_id: branchId, patient_id: patientId, id_type_id: idTypeId
          });
          return { success: true, record_id: String(rows[existingIdx][0]).trim() };
        }
      }

      const recordId = 'PID-' + Utilities.getUuid().slice(0, 8).toUpperCase();
      sh.appendRow([recordId, String(patientId).trim(), String(idTypeId).trim(), value, now, now, 0]);

      writeAuditLog_('PATIENT_ID_CREATE', {
        branch_id: branchId, patient_id: patientId, id_type_id: idTypeId, record_id: recordId
      });
      return { success: true, record_id: recordId };
    });
  } catch (e) {
    Logger.log('setPatientId ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── ARCHIVE one extra ID ─────────────────────────────────────
// Builtins can't be archived — to "remove" a builtin value just
// call setPatientId with an empty string.
function archivePatientId(branchId, recordId) {
  try {
    if (!branchId || !recordId) return { success: false, message: 'Branch ID and record ID are required.' };

    return withLock_(function() {
      const sh = _getPatientIdsSheet_(branchId);
      const lr = sh.getLastRow();
      if (lr < 2) return { success: false, message: 'Record not found.' };

      const rows = sh.getRange(2, 1, lr - 1, 7).getValues();
      const rowIdx = rows.findIndex(r => String(r[0] || '').trim() === String(recordId).trim());
      if (rowIdx === -1) return { success: false, message: 'Record not found.' };

      sh.getRange(rowIdx + 2, 7).setValue(1);
      sh.getRange(rowIdx + 2, 6).setValue(new Date());

      writeAuditLog_('PATIENT_ID_ARCHIVE', { branch_id: branchId, record_id: recordId });
      return { success: true };
    });
  } catch (e) {
    Logger.log('archivePatientId ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}
