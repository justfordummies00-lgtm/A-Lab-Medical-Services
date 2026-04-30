// ============================================================
//  A-LAB — PatientIdTypesCode.gs
//
//  Patient_ID_Types sheet (lives on the MAIN spreadsheet):
//    A=id_type_id  B=name  C=description  D=is_builtin
//    E=is_archived  F=created_at  G=updated_at
//
//  "ID Type" is admin-managed metadata describing what kinds of
//  identification cards / numbers the system tracks for a
//  patient (PhilHealth PIN, PWD ID, Senior Citizen ID, Solo
//  Parent ID, …).  Discounts can later require a specific ID
//  type to be present before they can be applied to an order.
//
//  Three builtins (PhilHealth PIN, Senior Citizen ID, PWD ID)
//  are seeded on first init and map to the existing fixed
//  columns on the per-branch Patients sheet.  They cannot be
//  archived or have their id_type_id changed; they CAN be
//  renamed or have their description edited.
// ============================================================

// Builtin ID type IDs — kept stable so wiring elsewhere (the
// Patients sheet column mapping, future Discounts.requires_id_type_id)
// can rely on these constants.
var BUILTIN_ID_TYPES_ = [
  { id_type_id: 'IDT-PHILHEALTH', name: 'PhilHealth PIN',     description: 'PhilHealth Personal Identification Number', patients_col: 10 },
  { id_type_id: 'IDT-SENIOR',     name: 'Senior Citizen ID',  description: 'Senior Citizen identification number',      patients_col: 17 },
  { id_type_id: 'IDT-PWD',        name: 'PWD ID',             description: 'Person With Disability identification number', patients_col: 18 }
];

function _getIdTypeSheet_() {
  const sh = getSS_().getSheetByName('Patient_ID_Types');
  if (!sh) throw new Error('"Patient_ID_Types" sheet not found. Run initializeMainDatabase().');
  return sh;
}

// ── READ ─────────────────────────────────────────────────────
function getPatientIdTypes(includeArchived) {
  // Cache key includes the includeArchived flag so callers asking
  // for the visible list don't see archived rows.
  const key = includeArchived ? 'all-with-archived' : 'all';
  return withCache_('patient_id_types', key, 60, function() {
    return _getPatientIdTypes_(!!includeArchived);
  });
}

function _getPatientIdTypes_(includeArchived) {
  try {
    const sh = _getIdTypeSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    const rows = sh.getRange(2, 1, lr - 1, 7).getValues()
      .filter(r => r[0] && String(r[0]).trim());

    const data = rows
      .filter(r => includeArchived || (r[4] != 1))
      .map(r => ({
        id_type_id:  String(r[0]).trim(),
        name:        String(r[1] || '').trim(),
        description: String(r[2] || '').trim(),
        is_builtin:  r[3] == 1 ? 1 : 0,
        is_archived: r[4] == 1 ? 1 : 0,
        created_at:  r[5] ? new Date(r[5]).toISOString() : '',
        updated_at:  r[6] ? new Date(r[6]).toISOString() : ''
      }));

    return { success: true, data };
  } catch (e) {
    Logger.log('getPatientIdTypes ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── BUILTIN MAP ──────────────────────────────────────────────
// Internal helper used by PatientIdsCode to resolve a builtin
// id_type_id back to the Patients sheet column it lives in.
// Returns null for non-builtin IDs.
function getBuiltinIdTypePatientCol_(idTypeId) {
  if (!idTypeId) return null;
  const m = BUILTIN_ID_TYPES_.find(t => t.id_type_id === idTypeId);
  return m ? m.patients_col : null;
}

// ── SEED (called from initializeMainDatabase) ────────────────
// Idempotent: only inserts rows for builtin IDs that aren't
// already present.  Safe to call on every init.
function seedBuiltinIdTypes_() {
  try {
    const sh = _getIdTypeSheet_();
    const now = new Date();
    const existing = new Set();
    const lr = sh.getLastRow();
    if (lr >= 2) {
      sh.getRange(2, 1, lr - 1, 1).getValues().flat()
        .map(v => String(v).trim())
        .filter(Boolean)
        .forEach(v => existing.add(v));
    }
    let added = 0;
    BUILTIN_ID_TYPES_.forEach(t => {
      if (existing.has(t.id_type_id)) return;
      sh.appendRow([t.id_type_id, t.name, t.description, 1, 0, now, now]);
      added++;
    });
    if (added > 0) {
      cacheBust_('patient_id_types');
      Logger.log('seedBuiltinIdTypes_: seeded ' + added + ' builtin ID types.');
    }
    return added;
  } catch (e) {
    Logger.log('seedBuiltinIdTypes_ ERROR: ' + e.message);
    return 0;
  }
}

// ── CREATE (Super Admin only) ────────────────────────────────
function createPatientIdType(payload) {
  try {
    if (!payload || !payload.name || !String(payload.name).trim())
      return { success: false, message: 'ID type name is required.' };

    return withLock_(function() {
      const sh = _getIdTypeSheet_();
      const lr = sh.getLastRow();
      const now = new Date();

      const nameLc = String(payload.name).trim().toLowerCase();
      if (lr >= 2) {
        const names = sh.getRange(2, 2, lr - 1, 1).getValues().flat()
          .map(v => String(v || '').trim().toLowerCase());
        if (names.includes(nameLc))
          return { success: false, message: '"' + payload.name + '" already exists.' };
      }

      const idTypeId = 'IDT-' + Utilities.getUuid().slice(0, 8).toUpperCase();
      sh.appendRow([
        idTypeId,
        String(payload.name).trim(),
        String(payload.description || '').trim(),
        0,         // is_builtin
        0,         // is_archived
        now, now
      ]);

      cacheBust_('patient_id_types');
      writeAuditLog_('IDTYPE_CREATE', { id_type_id: idTypeId, name: payload.name });
      return { success: true, id_type_id: idTypeId };
    });
  } catch (e) {
    Logger.log('createPatientIdType ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE (Super Admin only) ────────────────────────────────
// Builtin rows can have their name and description changed but
// id_type_id and is_builtin stay locked.
function updatePatientIdType(payload) {
  try {
    if (!payload || !payload.id_type_id) return { success: false, message: 'ID type ID is required.' };
    if (!payload.name || !String(payload.name).trim())
      return { success: false, message: 'ID type name is required.' };

    return withLock_(function() {
      const sh = _getIdTypeSheet_();
      const lr = sh.getLastRow();
      if (lr < 2) return { success: false, message: 'ID type not found.' };

      const all = sh.getRange(2, 1, lr - 1, 7).getValues();
      const rowIdx = all.findIndex(r => String(r[0]).trim() === String(payload.id_type_id).trim());
      if (rowIdx === -1) return { success: false, message: 'ID type not found.' };

      const nameLc = String(payload.name).trim().toLowerCase();
      const dup = all.some((r, i) => i !== rowIdx && String(r[1] || '').trim().toLowerCase() === nameLc);
      if (dup) return { success: false, message: '"' + payload.name + '" already exists.' };

      const existing = all[rowIdx];
      const isBuiltin = existing[3] == 1 ? 1 : 0;
      const isArchived = existing[4] == 1 ? 1 : 0;
      const createdAt = existing[5] || new Date();

      sh.getRange(rowIdx + 2, 2, 1, 6).setValues([[
        String(payload.name).trim(),
        String(payload.description || '').trim(),
        isBuiltin,
        isArchived,
        createdAt,
        new Date()
      ]]);

      cacheBust_('patient_id_types');
      writeAuditLog_('IDTYPE_UPDATE', { id_type_id: payload.id_type_id, name: payload.name });
      return { success: true };
    });
  } catch (e) {
    Logger.log('updatePatientIdType ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── ARCHIVE (Super Admin only) ───────────────────────────────
// Builtin rows are protected from archive — they back fixed cols
// on the Patients sheet and removing them would break legacy
// reads.
function archivePatientIdType(idTypeId) {
  try {
    if (!idTypeId) return { success: false, message: 'ID type ID is required.' };

    return withLock_(function() {
      const sh = _getIdTypeSheet_();
      const lr = sh.getLastRow();
      if (lr < 2) return { success: false, message: 'ID type not found.' };

      const all = sh.getRange(2, 1, lr - 1, 7).getValues();
      const rowIdx = all.findIndex(r => String(r[0]).trim() === String(idTypeId).trim());
      if (rowIdx === -1) return { success: false, message: 'ID type not found.' };

      if (all[rowIdx][3] == 1)
        return { success: false, message: 'Built-in ID types cannot be archived.' };

      sh.getRange(rowIdx + 2, 5).setValue(1);          // is_archived
      sh.getRange(rowIdx + 2, 7).setValue(new Date()); // updated_at

      cacheBust_('patient_id_types');
      writeAuditLog_('IDTYPE_ARCHIVE', { id_type_id: idTypeId });
      return { success: true };
    });
  } catch (e) {
    Logger.log('archivePatientIdType ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UNARCHIVE (Super Admin only) ─────────────────────────────
function unarchivePatientIdType(idTypeId) {
  try {
    if (!idTypeId) return { success: false, message: 'ID type ID is required.' };

    return withLock_(function() {
      const sh = _getIdTypeSheet_();
      const lr = sh.getLastRow();
      if (lr < 2) return { success: false, message: 'ID type not found.' };

      const all = sh.getRange(2, 1, lr - 1, 7).getValues();
      const rowIdx = all.findIndex(r => String(r[0]).trim() === String(idTypeId).trim());
      if (rowIdx === -1) return { success: false, message: 'ID type not found.' };

      sh.getRange(rowIdx + 2, 5).setValue(0);
      sh.getRange(rowIdx + 2, 7).setValue(new Date());

      cacheBust_('patient_id_types');
      writeAuditLog_('IDTYPE_UNARCHIVE', { id_type_id: idTypeId });
      return { success: true };
    });
  } catch (e) {
    Logger.log('unarchivePatientIdType ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}
