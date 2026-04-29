// ============================================================
//  A-LAB — DepartmentsCode.gs
//  Backend CRUD for Departments + Categories modules.
//
//  Departments sheet: A=dept_id B=department_name C=is_active
//                     D=created_at E=updated_at F=department_type
//
//  Categories sheet:  A=cat_id B=dept_id C=category_name
//                     D=is_active E=created_at F=updated_at
// ============================================================

function getDeptSheet_() {
  const sh = getSS_().getSheetByName('Departments');
  if (!sh) throw new Error('"Departments" sheet not found.');
  return sh;
}

function getCatSheet_() {
  const sh = getSS_().getSheetByName('Categories');
  if (!sh) throw new Error('"Categories" sheet not found.');
  return sh;
}

// ── READ ─────────────────────────────────────────────────────
// Returns departments with their categories nested
function getDepartments() {
  return withCache_('departments', 'all', 60, _getDepartments_);
}

function _getDepartments_() {
  try {
    const deptSh = getDeptSheet_();
    const catSh  = getCatSheet_();
    const deptLR = deptSh.getLastRow();
    const catLR  = catSh.getLastRow();

    // Build categories map: dept_id → [categories]
    const catMap = {};
    if (catLR >= 2) {
      catSh.getRange(2, 1, catLR - 1, 6).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .forEach(r => {
          const deptId = String(r[1] || '').trim();
          if (!catMap[deptId]) catMap[deptId] = [];
          catMap[deptId].push({
            cat_id:        String(r[0]).trim(),
            dept_id:       deptId,
            category_name: String(r[2] || '').trim(),
            is_active:     r[3] == 1 || r[3] === true || r[3] === 'TRUE' ? 1 : 0,
            created_at:    r[4] ? new Date(r[4]).toISOString() : '',
            updated_at:    r[5] ? new Date(r[5]).toISOString() : ''
          });
        });
    }

    const data = deptLR < 2 ? [] :
      deptSh.getRange(2, 1, deptLR - 1, 6).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .map(r => ({
          dept_id:         String(r[0]).trim(),
          department_name: String(r[1] || '').trim(),
          is_active:       r[2] == 1 || r[2] === true || r[2] === 'TRUE' ? 1 : 0,
          created_at:      r[3] ? new Date(r[3]).toISOString() : '',
          updated_at:      r[4] ? new Date(r[4]).toISOString() : '',
          department_type: String(r[5] || 'lab').trim(),
          categories:      catMap[String(r[0]).trim()] || []
        }));

    Logger.log('getDepartments: ' + data.length + ' departments');
    return { success: true, data };

  } catch (err) {
    Logger.log('getDepartments ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── CREATE ───────────────────────────────────────────────────
function createDepartment(payload) {
  try {
    if (!payload.department_name) return { success: false, message: 'Department name is required.' };

    const deptSh = getDeptSheet_();
    const catSh  = getCatSheet_();
    const now    = new Date();

    // Duplicate name check
    const lr = deptSh.getLastRow();
    if (lr >= 2) {
      const names = deptSh.getRange(2, 2, lr - 1, 1).getValues().flat().map(v => String(v).trim().toLowerCase());
      if (names.includes(payload.department_name.trim().toLowerCase())) {
        return { success: false, message: `Department "${payload.department_name}" already exists.` };
      }
    }

    const deptId   = 'DEPT-' + Math.random().toString(16).substr(2, 8).toUpperCase();
    const isActive = payload.is_active == 1 ? 1 : 0;
    const deptType = payload.department_type || 'lab';

    deptSh.appendRow([deptId, payload.department_name.trim(), isActive, now, now, deptType]);

    // Insert categories — with duplicate name check within dept
    const savedCats = [];
    const cats = payload.categories || [];
    const seenCatNames = new Set();
    cats.filter(c => c.category_name && c.category_name.trim()).forEach(cat => {
      const nameLower = cat.category_name.trim().toLowerCase();
      if (seenCatNames.has(nameLower)) return; // skip duplicate
      seenCatNames.add(nameLower);
      const catId    = 'CAT-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      const catActive = isActive === 0 ? 0 : (cat.is_active == 1 ? 1 : 0);
      catSh.appendRow([catId, deptId, cat.category_name.trim(), catActive, now, now]);
      savedCats.push({ cat_id: catId, dept_id: deptId, category_name: cat.category_name.trim(), is_active: catActive, created_at: now.toISOString(), updated_at: now.toISOString() });
    });

    cacheBust_('departments');
    writeAuditLog_('DEPT_CREATE', { dept_id: deptId, department_name: payload.department_name, categories: savedCats.length });
    Logger.log('createDepartment: ' + deptId + ' with ' + savedCats.length + ' categories');

    // Propagate new dept + cats to all existing branches (default active)
    propagateDeptToAllBranches_(deptId);
    savedCats.forEach(cat => propagateCatToAllBranches_(cat.cat_id));

    return { success: true, dept_id: deptId, categories: savedCats };

  } catch (err) {
    Logger.log('createDepartment ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── UPDATE ───────────────────────────────────────────────────
// - Updates department name + is_active
// - Cascades is_active=0 to ALL categories if department set inactive
// - Handles category adds, updates, and deletes
function updateDepartment(payload) {
  try {
    if (!payload.dept_id)         return { success: false, message: 'Department ID is required.' };
    if (!payload.department_name) return { success: false, message: 'Department name is required.' };

    const deptSh   = getDeptSheet_();
    const catSh    = getCatSheet_();
    const now      = new Date();
    const isActive = payload.is_active == 1 ? 1 : 0;

    // ── Batch read depts once ──
    const deptLR   = deptSh.getLastRow();
    if (deptLR < 2) return { success: false, message: 'Department not found.' };
    const deptRows = deptSh.getRange(2,1,deptLR-1,6).getValues();

    // Duplicate name check — exclude self
    const nameLower = payload.department_name.trim().toLowerCase();
    const dupName = deptRows.find(r =>
      String(r[0]).trim() !== payload.dept_id.trim() &&
      String(r[1]).trim().toLowerCase() === nameLower
    );
    if (dupName) return { success: false, message: `Department "${payload.department_name}" already exists.` };

    const dRowIdx = deptRows.findIndex(r => String(r[0]).trim() === payload.dept_id.trim());
    if (dRowIdx === -1) return { success: false, message: 'Department not found.' };
    const createdAt = deptRows[dRowIdx][3];
    const deptType = payload.department_type || 'lab';
    deptSh.getRange(dRowIdx+2, 2, 1, 5).setValues([[payload.department_name.trim(), isActive, createdAt, now, deptType]]);

    // ── Handle categories — batch read once ──
    const catLR   = catSh.getLastRow();
    const catRows = catLR >= 2 ? catSh.getRange(2,1,catLR-1,6).getValues() : [];

    const existingCatIds = [];
    catRows.forEach((r, i) => {
      if (String(r[1]).trim() === payload.dept_id.trim())
        existingCatIds.push({ cat_id: String(r[0]).trim(), rowIdx: i });
    });

    const incomingCats = payload.categories || [];
    const incomingIds  = incomingCats.filter(c => c.cat_id).map(c => c.cat_id);
    const toDelete     = existingCatIds.filter(e => !incomingIds.includes(e.cat_id));
    toDelete.sort((a,b) => b.rowIdx - a.rowIdx).forEach(d => catSh.deleteRow(d.rowIdx + 2));

    // Re-read after deletes
    const catLR2   = catSh.getLastRow();
    const catRows2 = catLR2 >= 2 ? catSh.getRange(2,1,catLR2-1,6).getValues() : [];
    const catIdxMap = {};
    catRows2.forEach((r, i) => { catIdxMap[String(r[0]).trim()] = { idx: i, createdAt: r[4] }; });

    // Build existing cat names for this dept (duplicate check within dept)
    const existingCatNames = catRows2
      .filter(r => String(r[1]).trim() === payload.dept_id.trim())
      .map(r => String(r[2]).trim().toLowerCase());

    incomingCats.filter(c => c.category_name && c.category_name.trim()).forEach(cat => {
      const catActive = isActive === 0 ? 0 : (cat.is_active == 1 ? 1 : 0);
      if (cat.cat_id) {
        const entry = catIdxMap[cat.cat_id.trim()];
        if (entry) {
          catSh.getRange(entry.idx+2, 3, 1, 4).setValues([[cat.category_name.trim(), catActive, entry.createdAt, now]]);
        }
      } else {
        // Duplicate category name check within same dept
        const newName = cat.category_name.trim().toLowerCase();
        if (existingCatNames.includes(newName))
          return; // skip duplicate silently (frontend should prevent this)
        existingCatNames.push(newName);
        const catId = 'CAT-' + Math.random().toString(16).substr(2,8).toUpperCase();
        catSh.appendRow([catId, payload.dept_id, cat.category_name.trim(), catActive, now, now]);
        propagateCatToAllBranches_(catId);
      }
    });

    if (isActive === 0) {
      const cascadeLR = catSh.getLastRow();
      if (cascadeLR >= 2) {
        const allCatData = catSh.getRange(2,1,cascadeLR-1,4).getValues();
        allCatData.forEach((r, i) => {
          if (String(r[1]).trim() === payload.dept_id.trim() && r[3] != 0)
            catSh.getRange(i+2, 4).setValue(0);
        });
      }
      cascadeGlobalDeptInactive_(payload.dept_id);
    }

    cacheBust_('departments');
    writeAuditLog_('DEPT_UPDATE', { dept_id: payload.dept_id, department_name: payload.department_name, is_active: isActive });
    Logger.log('updateDepartment: updated ' + payload.dept_id);
    return { success: true };
  } catch (err) {
    Logger.log('updateDepartment ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── DELETE ───────────────────────────────────────────────────
function deleteDepartment(deptId) {
  try {
    if (!deptId) return { success: false, message: 'Department ID is required.' };

    const deptSh = getDeptSheet_();
    const catSh  = getCatSheet_();

    // Delete department row
    const deptLR = deptSh.getLastRow();
    if (deptLR >= 2) {
      const rows   = deptSh.getRange(2,1,deptLR-1,1).getValues().flat().map(String);
      const rowIdx = rows.findIndex(id => id.trim() === deptId.trim());
      if (rowIdx !== -1) deptSh.deleteRow(rowIdx + 2);
    }

    // Delete all cats of this dept — batch read, delete in reverse
    const catLR = catSh.getLastRow();
    if (catLR >= 2) {
      const catRows = catSh.getRange(2,1,catLR-1,2).getValues();
      const toDelete = [];
      catRows.forEach((r, i) => {
        if (String(r[1]).trim() === deptId.trim()) toDelete.push(i + 2);
      });
      toDelete.sort((a,b) => b - a).forEach(row => catSh.deleteRow(row));
    }

    cacheBust_('departments');
    writeAuditLog_('DEPT_DELETE', { dept_id: deptId });
    Logger.log('deleteDepartment: deleted ' + deptId + ' + its categories');
    return { success: true };
  } catch (err) {
    Logger.log('deleteDepartment ERROR: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── CASCADE: SA sets dept inactive → force all branch statuses inactive ──
function cascadeGlobalDeptInactive_(deptId) {
  try {
    const bdsSh = getSS_().getSheetByName('Branch_Dept_Status');
    const bcsSh = getSS_().getSheetByName('Branch_Cat_Status');
    const catSh = getSS_().getSheetByName('Categories');

    // Get all cat IDs for this dept
    const catIds = [];
    if (catSh) {
      const lr = catSh.getLastRow();
      if (lr >= 2) {
        catSh.getRange(2, 1, lr-1, 2).getValues()
          .filter(r => String(r[1]).trim() === deptId)
          .forEach(r => catIds.push(String(r[0]).trim()));
      }
    }

    // Force all branch dept statuses inactive
    if (bdsSh) {
      const lr = bdsSh.getLastRow();
      if (lr >= 2) {
        const rows = bdsSh.getRange(2, 1, lr-1, 2).getValues();
        rows.forEach((r, i) => {
          if (String(r[1]).trim() === deptId) bdsSh.getRange(i+2, 3).setValue(0);
        });
      }
    }

    // Force all branch cat statuses inactive for this dept's cats
    if (bcsSh && catIds.length) {
      const lr = bcsSh.getLastRow();
      if (lr >= 2) {
        const rows = bcsSh.getRange(2, 1, lr-1, 2).getValues();
        rows.forEach((r, i) => {
          if (catIds.includes(String(r[1]).trim())) bcsSh.getRange(i+2, 3).setValue(0);
        });
      }
    }

    Logger.log('cascadeGlobalDeptInactive_: ' + deptId);
  } catch(e) { Logger.log('cascadeGlobalDeptInactive_ ERROR: ' + e.message); }
}