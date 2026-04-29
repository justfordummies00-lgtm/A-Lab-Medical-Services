// ============================================================
//  A-LAB — PhilhealthCode.gs
//
//  PHILHEALTH_LEDGER (branch SS):
//    A=ledger_id  B=patient_id  C=philhealth_pin  D=year
//    E=total_claimed  F=last_updated
//
//  PHILHEALTH_CLAIMS (branch SS):
//    A=claim_id  B=order_id  C=patient_id  D=philhealth_pin
//    E=amount_claimed  F=year  G=status  H=filed_at  I=remarks
// ============================================================

function getPhilhealthLedgerSheet_(ss) {
  return getOrCreateSheet_(ss, 'PHILHEALTH_LEDGER',
    ['ledger_id','patient_id','philhealth_pin','year',
     'total_claimed','last_updated']);
}

function getPhilhealthClaimsSheet_(ss) {
  return getOrCreateSheet_(ss, 'PHILHEALTH_CLAIMS',
    ['claim_id','order_id','patient_id','philhealth_pin',
     'amount_claimed','year','status','filed_at','remarks']);
}

// ── GET ANNUAL LIMIT (from System_Settings, default 1200) ───
function getPhilhealthLimit_() {
  try {
    return parseFloat(getSettingValue_('philhealth_annual_limit', '1200')) || 1200;
  } catch(e) { return 1200; }
}

// ── GET PHILHEALTH BALANCE ───────────────────────────────────
// Returns remaining benefit for a patient this year
function getPhilhealthBalance(branchId, patientId) {
  try {
    if (!branchId || !patientId) return { success: false, message: 'Branch and Patient ID required.' };
    const ss      = getOrderSS_(branchId);
    const sh      = getPhilhealthLedgerSheet_(ss);
    const limit   = getPhilhealthLimit_();
    const year    = new Date().getFullYear();
    const lr      = sh.getLastRow();
    let consumed  = 0;

    if (lr >= 2) {
      const rows = sh.getRange(2,1,lr-1,6).getValues();
      const row  = rows.find(r =>
        String(r[1]).trim() === patientId &&
        String(r[3]).trim() === String(year)
      );
      if (row) consumed = Number(row[4]) || 0;
    }

    return {
      success:   true,
      limit:     limit,
      consumed:  consumed,
      remaining: Math.max(0, limit - consumed),
      year:      year
    };
  } catch(e) {
    Logger.log('getPhilhealthBalance ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── COMPUTE PHILHEALTH CLAIM ─────────────────────────────────
// Given order items + covered service ids + remaining balance
// Returns how much PhilHealth covers for this order
function computePhilhealthClaim_(items, coveredLabIds, remaining) {
  if (!remaining || remaining <= 0) return 0;
  var covered = 0;
  items.forEach(function(item) {
    if (coveredLabIds.has(item.lab_id)) {
      covered += Number(item.unit_fee) || 0;
    }
  });
  return Math.min(covered, remaining);
}

// ── GET COVERED SERVICE IDS (philhealth covered) ─────────────
function getPhilhealthCoveredIds_() {
  try {
    const sh = getSS_().getSheetByName('Lab_Services');
    if (!sh || sh.getLastRow() < 2) return new Set();
    const rows = sh.getRange(2,1,sh.getLastRow()-1,6).getValues();
    const ids  = new Set();
    rows.filter(r => r[0] && r[5]==1) // is_philhealth_covered col F
        .forEach(r => ids.add(String(r[0]).trim()));
    return ids;
  } catch(e) { return new Set(); }
}

// ── UPDATE LEDGER ────────────────────────────────────────────
function updatePhilhealthLedger_(ss, patientId, philhealthPin, year, amountToAdd) {
  if (!amountToAdd || amountToAdd <= 0) return;
  const sh  = getPhilhealthLedgerSheet_(ss);
  const now = new Date();
  const lr  = sh.getLastRow();

  if (lr >= 2) {
    const rows = sh.getRange(2,1,lr-1,6).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][1]).trim() === patientId &&
          String(rows[i][3]).trim() === String(year)) {
        const newTotal = (Number(rows[i][4]) || 0) + amountToAdd;
        sh.getRange(i+2, 5, 1, 2).setValues([[newTotal, now]]);
        return;
      }
    }
  }
  // Not found — insert new ledger row
  const ledgerId = 'LDG-' + Math.random().toString(16).substr(2,8).toUpperCase();
  sh.appendRow([ledgerId, patientId, philhealthPin||'', String(year), amountToAdd, now]);
}

// ── WRITE CLAIM ──────────────────────────────────────────────
function writePhilhealthClaim_(ss, orderId, patientId, philhealthPin, amount, year) {
  if (!amount || amount <= 0) return;
  const sh      = getPhilhealthClaimsSheet_(ss);
  const claimId = 'CLM-' + Math.random().toString(16).substr(2,8).toUpperCase();
  sh.appendRow([
    claimId, orderId, patientId, philhealthPin||'',
    amount, String(year), 'PENDING', new Date(), ''
  ]);
}

// ── GET CLAIMS FOR ORDER ─────────────────────────────────────
function getPhilhealthClaims(branchId, orderId) {
  try {
    const ss = getOrderSS_(branchId);
    const sh = getPhilhealthClaimsSheet_(ss);
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };
    const data = sh.getRange(2,1,lr-1,9).getValues()
      .filter(r => r[0] && String(r[1]).trim() === orderId)
      .map(r => ({
        claim_id:       String(r[0]).trim(),
        order_id:       String(r[1]).trim(),
        patient_id:     String(r[2]).trim(),
        philhealth_pin: String(r[3]).trim(),
        amount_claimed: Number(r[4])||0,
        year:           String(r[5]).trim(),
        status:         String(r[6]||'PENDING').trim(),
        filed_at:       r[7] ? new Date(r[7]).toISOString() : '',
        remarks:        String(r[8]||'').trim()
      }));
    return { success: true, data };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── GET PATIENT PHILHEALTH BALANCE (public API) ──────────────
// Called from frontend when patient is selected in wizard
function getPatientPhilhealthInfo(branchId, patientId) {
  try {
    const bal    = getPhilhealthBalance(branchId, patientId);
    const limit  = getPhilhealthLimit_();
    const enabled = getSettingValue_('philhealth_enabled', '1') === '1';
    return {
      success:  true,
      enabled:  enabled,
      limit:    limit,
      consumed: bal.success ? bal.consumed  : 0,
      remaining:bal.success ? bal.remaining : limit,
      year:     new Date().getFullYear()
    };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ── GET ALL CLAIMS FOR BRANCH (for PhilHealth Claims page) ──
function getBranchPhilhealthClaims(branchId) {
  try {
    const mainSS = getSS_();
    const brSh   = mainSS.getSheetByName('Branches');

    // Build list of branches to query
    const branchesToQuery = [];
    if (branchId) {
      // Single branch
      if (brSh && brSh.getLastRow() >= 2) {
        const row = brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues()
          .find(r => String(r[0]).trim() === branchId);
        if (row && row[7]) branchesToQuery.push({ id: String(row[0]).trim(), ssId: String(row[7]).trim(), name: String(row[1]).trim() });
      }
    } else {
      // All branches — SA view
      if (brSh && brSh.getLastRow() >= 2) {
        brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues()
          .filter(r => r[0] && r[7])
          .forEach(r => branchesToQuery.push({
            id:   String(r[0]).trim(),
            ssId: String(r[7]).trim(),
            name: String(r[1]).trim()
          }));
      }
    }

    const allData = [];

    branchesToQuery.forEach(br => {
      try {
        const ss    = openSS_(br.ssId);
        const sh    = getPhilhealthClaimsSheet_(ss);
        const lr    = sh.getLastRow();

        // Patient name map
        const patSh  = ss.getSheetByName('Patients');
        const patMap = {};
        if (patSh && patSh.getLastRow() >= 2) {
          patSh.getRange(2,1,patSh.getLastRow()-1,3).getValues()
            .forEach(r => { if(r[0]) patMap[String(r[0]).trim()] = String(r[1]||'') + ', ' + String(r[2]||''); });
        }

        // Order no map
        const ordSh  = ss.getSheetByName('LAB_ORDER');
        const ordMap = {};
        if (ordSh && ordSh.getLastRow() >= 2) {
          ordSh.getRange(2,1,ordSh.getLastRow()-1,2).getValues()
            .forEach(r => { if(r[0]) ordMap[String(r[0]).trim()] = String(r[1]||'').trim(); });
        }

        if (lr >= 2) {
          sh.getRange(2,1,lr-1,9).getValues()
            .filter(r => r[0] && String(r[0]).trim())
            .forEach(r => {
              allData.push({
                claim_id:       String(r[0]).trim(),
                order_id:       String(r[1]).trim(),
                order_no:       ordMap[String(r[1]).trim()] || String(r[1]).trim(),
                patient_id:     String(r[2]).trim(),
                patient_name:   patMap[String(r[2]).trim()] || String(r[2]).trim(),
                philhealth_pin: String(r[3]).trim(),
                amount_claimed: Number(r[4])||0,
                year:           String(r[5]).trim(),
                status:         String(r[6]||'PENDING').trim(),
                filed_at:       r[7] ? new Date(r[7]).toISOString() : '',
                remarks:        String(r[8]||'').trim(),
                branch_id:      br.id,
                branch_name:    br.name
              });
            });
        }
      } catch(e) {
        Logger.log('getBranchPhilhealthClaims branch error: ' + br.id + ' ' + e.message);
      }
    });

    // Sort by filed_at desc
    allData.sort((a, b) => b.filed_at.localeCompare(a.filed_at));

    Logger.log('getBranchPhilhealthClaims: ' + (branchId||'ALL') + ' → ' + allData.length);
    return { success: true, data: allData, limit: getPhilhealthLimit_() };
  } catch(e) {
    Logger.log('getBranchPhilhealthClaims ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}