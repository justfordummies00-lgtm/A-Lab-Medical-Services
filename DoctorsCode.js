// ============================================================
//  A-LAB — DoctorsCode.gs
//
//  Doctors sheet columns:
//    A=doctor_id   B=last_name    C=first_name   D=middle_name
//    E=suffix      F=specialty    G=license_no   H=contact
//    I=username    J=email        K=password     L=branch_ids
//    M=created_at  N=updated_at
// ============================================================

function getDoctorsSheet_() {
  const sh = getSS_().getSheetByName('Doctors');
  if (!sh) throw new Error('"Doctors" sheet not found.');
  return sh;
}

function getDoctorBranchList_() {
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

function buildDoctorBranchMap_() {
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

// ── READ ────────────────────────────────────────────────────
function getDoctors(branchIds) {
  const filter = (branchIds || '').toString().trim();
  return withCache_('doctors', filter || 'all', 60, function() { return _getDoctors_(filter); });
}

function _getDoctors_(branchIds) {
  try {
    const sh = getDoctorsSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [], branches: getDoctorBranchList_() };

    const branchMap = buildDoctorBranchMap_();
    const filterIds = branchIds ? branchIds.split(',').map(s => s.trim()).filter(Boolean) : [];

    const data = sh.getRange(2, 1, lr-1, 15).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => {
        const bIds  = String(r[11]||'').trim();
        const bDisp = bIds
          ? bIds.split(',').map(bid => branchMap[bid.trim()] || bid.trim()).join(', ')
          : '';
        return {
          doctor_id:        String(r[0]).trim(),
          last_name:        String(r[1]||'').trim(),
          first_name:       String(r[2]||'').trim(),
          middle_name:      String(r[3]||'').trim(),
          suffix:           String(r[4]||'').trim(),
          specialty:        String(r[5]||'').trim(),
          license_no:       String(r[6]||'').trim(),
          contact:          String(r[7]||'').trim(),
          username:         String(r[8]||'').trim(),
          email:            String(r[9]||'').trim(),
          branch_ids:       bIds,
          branches_display: bDisp,
          photo_url:        String(r[14]||'').trim(),
          created_at:       r[12] ? new Date(r[12]).toISOString() : '',
          updated_at:       r[13] ? new Date(r[13]).toISOString() : ''
        };
      })
      .filter(d => {
        if (!filterIds.length) return true;
        const dBIds = d.branch_ids.split(',').map(s => s.trim()).filter(Boolean);
        return filterIds.some(bid => dBIds.includes(bid));
      });

    Logger.log('getDoctors: ' + data.length);
    return { success: true, data, branches: getDoctorBranchList_() };
  } catch(e) {
    Logger.log('getDoctors ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE ───────────────────────────────────────────────────
function createDoctor(payload) {
  try {
    if (!payload.last_name)  return { success: false, message: 'Last name is required.' };
    if (!payload.first_name) return { success: false, message: 'First name is required.' };
    if (!payload.username)   return { success: false, message: 'Username is required.' };
    if (!payload.password)   return { success: false, message: 'Password is required.' };
    if (!payload.branch_ids) return { success: false, message: 'Assign at least one branch.' };

    const sh  = getDoctorsSheet_();
    const lr  = sh.getLastRow();
    const now = new Date();

    // Duplicate username check
    if (lr >= 2) {
      const usernames = sh.getRange(2, 9, lr-1, 1).getValues().flat().map(v => String(v).trim().toLowerCase());
      if (usernames.includes(payload.username.trim().toLowerCase()))
        return { success: false, message: `Username "${payload.username}" already exists.` };
    }

    const doctorId = 'DR-' + Math.random().toString(16).substr(2,8).toUpperCase();

    sh.appendRow([
      doctorId,
      payload.last_name.trim(),
      payload.first_name.trim(),
      (payload.middle_name || '').trim(),
      (payload.suffix      || '').trim(),
      (payload.specialty   || '').trim(),
      (payload.license_no  || '').trim(),
      (payload.contact     || '').trim(),
      payload.username.trim(),
      (payload.email       || '').trim(),
      payload.password.trim(),
      (payload.branch_ids  || '').trim(),
      now,  // created_at
      now   // updated_at
    ]);

    cacheBust_('doctors');
    writeAuditLog_('DOCTOR_CREATE', { doctor_id: doctorId, name: payload.last_name + ', ' + payload.first_name });
    Logger.log('createDoctor: ' + doctorId);
    return { success: true, doctor_id: doctorId };
  } catch(e) {
    Logger.log('createDoctor ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE ───────────────────────────────────────────────────
function updateDoctor(payload) {
  try {
    if (!payload.doctor_id)  return { success: false, message: 'Doctor ID is required.' };
    if (!payload.last_name)  return { success: false, message: 'Last name is required.' };
    if (!payload.first_name) return { success: false, message: 'First name is required.' };
    if (!payload.username)   return { success: false, message: 'Username is required.' };
    if (!payload.branch_ids) return { success: false, message: 'Assign at least one branch.' };

    const sh  = getDoctorsSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Doctor not found.' };

    // Batch read all rows
    const allRows = sh.getRange(2,1,lr-1,14).getValues();
    const rowIdx  = allRows.findIndex(r => String(r[0]).trim() === payload.doctor_id.trim());
    if (rowIdx === -1) return { success: false, message: 'Doctor not found.' };

    // Duplicate username check — exclude self (col I = index 8)
    const unameLower = payload.username.trim().toLowerCase();
    const dup = allRows.some((r, i) =>
      i !== rowIdx && String(r[8]).trim().toLowerCase() === unameLower
    );
    if (dup) return { success: false, message: `Username "${payload.username}" already exists.` };

    const existRow  = allRows[rowIdx];
    const createdAt = existRow[12] || new Date();  // col M
    const existPass = String(existRow[10]||'').trim(); // col K
    const password  = payload.password ? payload.password.trim() : existPass;

    sh.getRange(rowIdx+2, 2, 1, 13).setValues([[
      payload.last_name.trim(),
      payload.first_name.trim(),
      (payload.middle_name || '').trim(),
      (payload.suffix      || '').trim(),
      (payload.specialty   || '').trim(),
      (payload.license_no  || '').trim(),
      (payload.contact     || '').trim(),
      payload.username.trim(),
      (payload.email       || '').trim(),
      password,
      (payload.branch_ids  || '').trim(),
      createdAt,
      new Date()
    ]]);

    cacheBust_('doctors');
    writeAuditLog_('DOCTOR_UPDATE', { doctor_id: payload.doctor_id });
    return { success: true };
  } catch(e) {
    Logger.log('updateDoctor ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── DELETE ───────────────────────────────────────────────────
function deleteDoctor(doctorId) {
  try {
    if (!doctorId) return { success: false, message: 'Doctor ID is required.' };
    const sh  = getDoctorsSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Doctor not found.' };

    const ids    = sh.getRange(2, 1, lr-1, 1).getValues().flat().map(String);
    const rowIdx = ids.findIndex(id => id.trim() === doctorId.trim());
    if (rowIdx === -1) return { success: false, message: 'Doctor not found.' };

    sh.deleteRow(rowIdx + 2);
    cacheBust_('doctors');
    writeAuditLog_('DOCTOR_DELETE', { doctor_id: doctorId });
    return { success: true };
  } catch(e) {
    Logger.log('deleteDoctor ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET DOCTOR REFERRALS (orders) ───────────────────────────
function getDoctorReferrals(doctorId) {
  try {
    if (!doctorId) return { success: false, message: 'Doctor ID required.' };

    const ss    = getSS_();
    const brSh  = ss.getSheetByName('Branches');
    if (!brSh || brSh.getLastRow() < 2)
      return { success: true, data: [], stats: _emptyDrStats() };

    const brRows = brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues()
      .filter(r => r[0] && r[7]);

    const orders = [];

    brRows.forEach(br => {
      try {
        const bss   = openSS_(String(br[7]).trim());
        const ordSh = bss.getSheetByName('LAB_ORDER');
        if (!ordSh || ordSh.getLastRow() < 2) return;

        ordSh.getRange(2,1,ordSh.getLastRow()-1,19).getValues()
          .filter(r => r[0] && (
            String(r[4]).trim()  === doctorId ||  // doctor_id
            String(r[15]).trim() === doctorId      // doctor_id_2
          ))
          .forEach(r => {
            orders.push({
              order_id:        String(r[0]).trim(),
              order_no:        String(r[1]).trim(),
              branch_id:       String(r[2]).trim(),
              branch_name:     String(br[1]).trim(),
              patient_id:      String(r[3]).trim(),
              patient_name:    String(r[11]||r[3]||'').trim(),
              doctor_id:       String(r[4]).trim(),
              doctor_name:     String(r[12]||'').trim(),
              order_date:      r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
              status:          String(r[6]).trim(),
              notes:           String(r[10]||'').trim(),
              net_amount:      Number(r[14])||0,
              doctor_id_2:     String(r[15]||'').trim(),
              doctor_name_2:   String(r[16]||'').trim(),
              philhealth_pin:  String(r[17]||'').trim(),
              philhealth_claim:Number(r[18])||0,
              is_2nd_opinion:  String(r[15]).trim() === doctorId && String(r[4]).trim() !== doctorId
            });
          });
      } catch(e) { Logger.log('getDoctorReferrals branch error: ' + e.message); }
    });

    // Sort by date desc
    orders.sort((a,b) => b.order_date.localeCompare(a.order_date));

    // Compute stats
    const stats = _emptyDrStats();
    stats.total = orders.length;
    orders.forEach(o => {
      if (o.status === 'DRAFT' || o.status === 'OPEN') stats.pending++;
      if (o.status === 'PAID' || o.status === 'IN_PROGRESS' || o.status === 'FOR_RELEASE') stats.processing++;
      if (o.status === 'RELEASED') stats.released++;
    });

    Logger.log('getDoctorReferrals: ' + doctorId + ' → ' + orders.length);
    return { success: true, data: orders, stats };
  } catch(e) {
    Logger.log('getDoctorReferrals ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET DOCTOR PATIENTS ──────────────────────────────────────
// Unique patients from all orders the doctor referred
function getDoctorPatients(doctorId) {
  try {
    if (!doctorId) return { success: false, message: 'Doctor ID required.' };

    const refResult = getDoctorReferrals(doctorId);
    if (!refResult.success) return refResult;

    // Deduplicate by patient_id
    const seen = new Set();
    const patients = [];
    refResult.data.forEach(o => {
      if (!seen.has(o.patient_id)) {
        seen.add(o.patient_id);
        patients.push({
          patient_id:   o.patient_id,
          patient_name: o.patient_name,
          branch_name:  o.branch_name,
          last_order:   o.order_no,
          last_date:    o.order_date
        });
      }
    });

    Logger.log('getDoctorPatients: ' + doctorId + ' → ' + patients.length + ' unique patients');
    return { success: true, data: patients, total: patients.length };
  } catch(e) {
    Logger.log('getDoctorPatients ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── DOCTOR DASHBOARD STATS ───────────────────────────────────
function getDoctorDashboardStats(doctorId) {
  try {
    const refResult = getDoctorReferrals(doctorId);
    if (!refResult.success) return refResult;
    return { success: true, stats: refResult.stats, recent: refResult.data.slice(0, 5) };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function _emptyDrStats() {
  return { total:0, pending:0, processing:0, released:0 };
}

// ════════════════════════════════════════════════════════════════
//  CONSULTATION WORKFLOW (Section 6.3)
//  Doctors document findings per order in CONSULTATIONS sheet
//  CONSULTATIONS (main SS): consult_id | doctor_id | order_id |
//    patient_id | patient_name | findings | created_at | updated_at
// ════════════════════════════════════════════════════════════════

function _getConsultSheet_() {
  const ss = getSS_();
  let sh   = ss.getSheetByName('CONSULTATIONS');
  if (!sh) {
    sh = ss.insertSheet('CONSULTATIONS');
    sh.getRange(1,1,1,8).setValues([[
      'consult_id','doctor_id','order_id','patient_id',
      'patient_name','findings','created_at','updated_at'
    ]]);
    sh.getRange(1,1,1,8).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function saveConsultation(doctorId, orderId, patientId, patientName, findings) {
  try {
    if (!doctorId || !orderId)
      return { success: false, message: 'Doctor ID and Order ID required.' };
    if (!findings || !findings.trim())
      return { success: false, message: 'Findings cannot be empty.' };

    const sh  = _getConsultSheet_();
    const now = new Date();
    const lr  = sh.getLastRow();

    // Upsert — check if consultation already exists for this doctor+order
    if (lr >= 2) {
      const rows = sh.getRange(2,1,lr-1,4).getValues();
      const idx  = rows.findIndex(r =>
        String(r[1]).trim() === doctorId &&
        String(r[2]).trim() === orderId
      );
      if (idx !== -1) {
        // Update existing
        sh.getRange(idx+2, 6, 1, 3).setValues([[findings.trim(), rows[idx][6]||now, now]]);
        Logger.log('saveConsultation: updated ' + rows[idx][0]);
        return { success: true, consult_id: String(rows[idx][0]).trim(), action: 'updated' };
      }
    }

    // New consultation
    const consultId = 'CON-' + Math.random().toString(16).substr(2,8).toUpperCase();
    sh.appendRow([
      consultId, doctorId, orderId, patientId||'',
      (patientName||'').trim(), findings.trim(), now, now
    ]);
    writeAuditLog_('CONSULTATION_SAVE', { doctor_id: doctorId, order_id: orderId });
    Logger.log('saveConsultation: created ' + consultId);
    return { success: true, consult_id: consultId, action: 'created' };
  } catch(e) {
    Logger.log('saveConsultation ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

function getConsultations(doctorId) {
  try {
    if (!doctorId) return { success: false, message: 'Doctor ID required.' };
    const sh = _getConsultSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    const data = sh.getRange(2,1,lr-1,8).getValues()
      .filter(r => r[0] && String(r[1]).trim() === doctorId)
      .map(r => ({
        consult_id:   String(r[0]).trim(),
        doctor_id:    String(r[1]).trim(),
        order_id:     String(r[2]).trim(),
        patient_id:   String(r[3]).trim(),
        patient_name: String(r[4]||'').trim(),
        findings:     String(r[5]||'').trim(),
        created_at:   r[6] ? new Date(r[6]).toISOString() : '',
        updated_at:   r[7] ? new Date(r[7]).toISOString() : ''
      }))
      .sort((a,b) => b.updated_at.localeCompare(a.updated_at));

    Logger.log('getConsultations: ' + doctorId + ' → ' + data.length);
    return { success: true, data };
  } catch(e) {
    Logger.log('getConsultations ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

function getConsultationByOrder(doctorId, orderId) {
  try {
    if (!doctorId || !orderId) return { success: false, message: 'Missing params.' };
    const sh = _getConsultSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: null };

    const row = sh.getRange(2,1,lr-1,8).getValues()
      .find(r => r[0] && String(r[1]).trim() === doctorId && String(r[2]).trim() === orderId);

    if (!row) return { success: true, data: null };
    return {
      success: true,
      data: {
        consult_id:   String(row[0]).trim(),
        findings:     String(row[5]||'').trim(),
        updated_at:   row[7] ? new Date(row[7]).toISOString() : ''
      }
    };
  } catch(e) {
    return { success: false, message: e.message };
  }
}