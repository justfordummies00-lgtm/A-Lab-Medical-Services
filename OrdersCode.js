// ============================================================
//  A-LAB — OrdersCode.gs  (optimized)
// ============================================================

// ── SS CACHE (per execution) ─────────────────────────────────
const _ssCache_ = {};

function getOrderSS_(branchId) {
  if (_ssCache_[branchId]) return _ssCache_[branchId];
  const sh = getSS_().getSheetByName('Branches');
  if (!sh) throw new Error('Branches sheet not found.');
  const lr = sh.getLastRow();
  const rows = sh.getRange(2, 1, lr - 1, 8).getValues();
  const row = rows.find(r => String(r[0]).trim() === branchId);
  if (!row || !row[7]) throw new Error('Branch spreadsheet not configured for: ' + branchId);
  const ss = SpreadsheetApp.openById(String(row[7]).trim());
  _ssCache_[branchId] = ss;
  return ss;
}

function getOrCreateSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── ORDER SEQ ────────────────────────────────────────────────
function nextOrderNo_(ss, branchCode, year) {
  let sh = ss.getSheetByName('Settings');
  if (!sh) {
    sh = ss.insertSheet('Settings');
    sh.getRange(1, 1, 2, 2).setValues([['key', 'value'], ['order_seq', '0']]);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  const lr = sh.getLastRow();
  const rows = lr >= 2 ? sh.getRange(2, 1, lr - 1, 2).getValues() : [];
  const key = 'order_seq_' + year;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      const next = (parseInt(rows[i][1]) || 0) + 1;
      sh.getRange(i + 2, 2).setValue(next);
      return 'ALAB-' + branchCode + '-' + year + '-' + String(next).padStart(6, '0');
    }
  }
  sh.appendRow([key, 1]);
  return 'ALAB-' + branchCode + '-' + year + '-000001';
}

function getBranchCode_(branchId) {
  try {
    const sh = getSS_().getSheetByName('Branches');
    if (!sh) return 'LAB';
    const lr = sh.getLastRow();
    if (lr < 2) return 'LAB';
    const rows = sh.getRange(2, 1, lr - 1, 3).getValues();
    const row = rows.find(r => String(r[0]).trim() === branchId);
    return row ? String(row[2]).trim().toUpperCase() : 'LAB';
  } catch (e) { return 'LAB'; }
}

function writeBranchAudit_(ss, actorId, action, entityType, entityId, before, after) {
  try {
    const sh = getOrCreateSheet_(ss, 'AUDIT_LOG',
      ['audit_id', 'timestamp', 'actor_id', 'action', 'entity_type', 'entity_id', 'before_json', 'after_json']);
    sh.appendRow(['AUD-' + Math.random().toString(16).substr(2, 8).toUpperCase(),
    new Date(), actorId, action, entityType, entityId,
    before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '']);
  } catch (e) { }
}

// ── READ ORDERS — reads snapshots directly, no cross-sheet lookups ──
function getOrders(branchId, filters) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const ss = getOrderSS_(branchId);
    const ordSh = getOrCreateSheet_(ss, 'LAB_ORDER',
      ['order_id', 'order_no', 'branch_id', 'patient_id', 'doctor_id',
        'order_date', 'status', 'created_by', 'created_at', 'updated_at', 'notes',
        'patient_name', 'doctor_name', 'created_by_name', 'net_amount',
        'doctor_id_2', 'doctor_name_2', 'philhealth_pin', 'philhealth_claim']);
    const lr = ordSh.getLastRow();
    const oCols = Math.max(ordSh.getLastColumn(), 24);
    const orders = lr < 2 ? [] : ordSh.getRange(2, 1, lr - 1, oCols).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({
        order_id: String(r[0]).trim(),
        order_no: String(r[1]).trim(),
        patient_id: String(r[3]).trim(),
        doctor_id: String(r[4]).trim(),
        order_date: r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
        status: String(r[6]).trim(),
        created_by: String(r[7]).trim(),
        notes: String(r[10] || '').trim(),
        patient_name: String(r[11] || '').trim() || String(r[3]).trim(),
        doctor_name: String(r[12] || '').trim(),
        created_by_name: String(r[13] || '').trim() || String(r[7]).trim(),
        net_amount: Number(r[14]) || 0,
        doctor_id_2: String(r[15] || '').trim(),
        doctor_name_2: String(r[16] || '').trim(),
        philhealth_pin: String(r[17] || '').trim(),
        philhealth_claim: Number(r[18]) || 0,
        transferred_to_branch: String(r[19] || '').trim(),
        transfer_status: String(r[20] || '').trim(),
        order_types: String(r[21] || 'lab').trim() || 'lab',
        order_cat_ids: String(r[22] || '').trim(),
        payment_status: String(r[23] || 'UNPAID').trim() || 'UNPAID'
      }));

    const filtered = (filters && filters.status)
      ? orders.filter(o => o.status === filters.status)
      : orders.filter(o => o.status !== 'ARCHIVED');

    Logger.log('getOrders: ' + branchId + ' → ' + filtered.length);
    return { success: true, data: filtered };
  } catch (e) {
    Logger.log('getOrders ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET ORDER DETAIL (batch all reads) ───────────────────────
function getOrderDetail(branchId, orderId) {
  try {
    const ss = getOrderSS_(branchId);

    // Read LAB_ORDER, LAB_ORDER_ITEM, PAYMENT in parallel arrays
    const ordSh = ss.getSheetByName('LAB_ORDER');
    const itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    const paySh = ss.getSheetByName('PAYMENT');
    const patSh = ss.getSheetByName('Patients');

    if (!ordSh) return { success: false, message: 'LAB_ORDER sheet not found.' };

    // Batch read all needed data at once — 24 cols
    const ordLR = ordSh.getLastRow();
    const ordCols = Math.max(ordSh.getLastColumn(), 24);
    const ordRows = ordLR >= 2 ? ordSh.getRange(2, 1, ordLR - 1, ordCols).getValues() : [];
    const row = ordRows.find(r => String(r[0]).trim() === orderId);
    if (!row) return { success: false, message: 'Order not found.' };

    const order = {
      order_id: String(row[0]).trim(),
      order_no: String(row[1]).trim(),
      branch_id: String(row[2]).trim(),
      patient_id: String(row[3]).trim(),
      doctor_id: String(row[4]).trim(),
      order_date: row[5] ? new Date(row[5]).toISOString().split('T')[0] : '',
      status: String(row[6]).trim(),
      created_by: String(row[7]).trim(),
      notes: String(row[10] || '').trim(),
      patient_name: String(row[11] || '').trim(),
      doctor_name: String(row[12] || '').trim(),
      created_by_name: String(row[13] || '').trim(),
      net_amount: Number(row[14]) || 0,
      doctor_id_2: String(row[15] || '').trim(),
      doctor_name_2: String(row[16] || '').trim(),
      philhealth_pin: String(row[17] || '').trim(),
      philhealth_claim: Number(row[18]) || 0,
      order_types: String(row[21] || 'lab').trim() || 'lab',
      payment_status: String(row[23] || 'UNPAID').trim() || 'UNPAID'
    };
    // Fallback patient name from Patients sheet if snapshot missing
    if (!order.patient_name && patSh && patSh.getLastRow() >= 2) {
      const pat = patSh.getRange(2, 1, patSh.getLastRow() - 1, 3).getValues()
        .find(r => String(r[0]).trim() === order.patient_id);
      if (pat) order.patient_name = pat[1] + ', ' + pat[2];
    }

    // Items — read 21 cols (13 original + 6 timestamps + 2 package source)
    const items = [];
    if (itemSh && itemSh.getLastRow() >= 2) {
      const itemCols = Math.max(itemSh.getLastColumn(), 21);
      itemSh.getRange(2, 1, itemSh.getLastRow() - 1, itemCols).getValues()
        .filter(r => r[0] && String(r[1]).trim() === orderId)
        .forEach(r => items.push({
          order_item_id: String(r[0]).trim(),
          lab_id: String(r[2]).trim(),
          dept_id: String(r[3]).trim(),
          lab_name: String(r[4]).trim(),
          qty: Number(r[5]) || 1,
          unit_fee: Number(r[6]) || 0,
          line_gross: Number(r[7]) || 0,
          discount_id: String(r[8] || '').trim(),
          discount_amount: Number(r[9]) || 0,
          line_net: Number(r[10]) || 0,
          status: String(r[12] || 'PENDING').trim(),
          // MedTech checkpoints
          extracted_at: r[13] ? new Date(r[13]).toISOString() : null,
          processed_at: r[14] ? new Date(r[14]).toISOString() : null,
          encoded_at: r[15] ? new Date(r[15]).toISOString() : null,
          released_at: r[16] ? new Date(r[16]).toISOString() : null,
          // Liaison Officer steps
          collected_at: r[17] ? new Date(r[17]).toISOString() : null,
          submitted_at: r[18] ? new Date(r[18]).toISOString() : null,
          // Package source
          source_pkg_id: String(r[19] || '').trim(),
          source_pkg_name: String(r[20] || '').trim()
        }));
    }

    // Payments
    const payments = [];
    let totalPaid = 0;
    if (paySh && paySh.getLastRow() >= 2) {
      paySh.getRange(2, 1, paySh.getLastRow() - 1, 9).getValues()
        .filter(r => r[0] && String(r[1]).trim() === orderId && String(r[7]).trim() !== 'VOIDED')
        .forEach(r => {
          const amt = Number(r[3]) || 0;
          totalPaid += amt;
          payments.push({
            payment_id: String(r[0]).trim(),
            paid_at: r[2] ? new Date(r[2]).toISOString() : '',
            amount: amt,
            method: String(r[4] || 'CASH').trim(),
            reference_no: String(r[5] || '').trim(),
            status: String(r[7] || 'POSTED').trim(),
            remarks: String(r[8] || '').trim(),
            acknowledge_no: String(r[9] || '').trim()
          });
        });
    }

    const gross = items.reduce((s, i) => s + i.line_gross, 0);
    const discAmt = items.reduce((s, i) => s + i.discount_amount, 0);
    const net = items.reduce((s, i) => s + i.line_net, 0);
    const balance = Math.max(0, net - totalPaid);

    // PhilHealth claims for this order
    const philClaims = [];
    const philClaimSh = ss.getSheetByName('PHILHEALTH_CLAIMS');
    if (philClaimSh && philClaimSh.getLastRow() >= 2) {
      philClaimSh.getRange(2, 1, philClaimSh.getLastRow() - 1, 9).getValues()
        .filter(r => r[0] && String(r[1]).trim() === orderId)
        .forEach(r => philClaims.push({
          claim_id: String(r[0]).trim(),
          amount_claimed: Number(r[4]) || 0,
          year: String(r[5]).trim(),
          status: String(r[6] || 'PENDING').trim(),
          filed_at: r[7] ? new Date(r[7]).toISOString() : '',
          remarks: String(r[8] || '').trim()
        }));
    }

    // Result file (if any)
    let resultData = null;
    const resultSh = ss.getSheetByName('RESULT');
    if (resultSh && resultSh.getLastRow() >= 2) {
      const rRow = resultSh.getRange(2, 1, resultSh.getLastRow() - 1, 9).getValues()
        .find(r => r[0] && String(r[1]).trim() === orderId);
      if (rRow) resultData = {
        result_id: String(rRow[0]).trim(),
        result_file_id: String(rRow[4] || '').trim(),
        drive_url: String(rRow[5] || '').trim(),
        uploaded_by: String(rRow[6] || '').trim(),
        uploaded_at: rRow[7] ? new Date(rRow[7]).toISOString() : null,
        notes: String(rRow[8] || '').trim()
      };
    }

    return {
      success: true, order, items, payments, philhealth_claims: philClaims,
      result: resultData,
      totals: { gross, discount_amount: discAmt, net, total_paid: totalPaid, balance }
    };
  } catch (e) {
    Logger.log('getOrderDetail ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE FULL ORDER (atomic) ───────────────────────────────
function createFullOrder(branchId, payload) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    if (!payload.patient_id) return { success: false, message: 'Patient is required.' };
    if (!payload.items || !payload.items.length) return { success: false, message: 'At least one test is required.' };

    const ss = getOrderSS_(branchId);
    const mainSS = getSS_();
    const now = new Date();
    const year = now.getFullYear();
    const branchCode = getBranchCode_(branchId);
    const orderId = 'ORD-' + Math.random().toString(16).substr(2, 8).toUpperCase();
    const orderNo = nextOrderNo_(ss, branchCode, year);
    const techId = payload.created_by || '';

    // ── Resolve name snapshots ──
    const patSh = ss.getSheetByName('Patients');
    let patientName = payload.patient_id;
    let philhealthPin = '';
    if (patSh && patSh.getLastRow() >= 2) {
      const pr = patSh.getRange(2, 1, patSh.getLastRow() - 1, 10).getValues()
        .find(r => String(r[0]).trim() === payload.patient_id);
      if (pr) {
        patientName = pr[1] + ', ' + pr[2];
        philhealthPin = String(pr[9] || '').trim(); // col J = philhealth_pin
      }
    }

    // Primary doctor
    let doctorName = '';
    if (payload.doctor_id) {
      const drSh = mainSS.getSheetByName('Doctors');
      if (drSh && drSh.getLastRow() >= 2) {
        const dr = drSh.getRange(2, 1, drSh.getLastRow() - 1, 3).getValues()
          .find(r => String(r[0]).trim() === payload.doctor_id);
        if (dr) doctorName = dr[1] + ', ' + dr[2];
      }
    }

    // 2nd opinion doctor
    let doctorName2 = '';
    if (payload.doctor_id_2) {
      const drSh = mainSS.getSheetByName('Doctors');
      if (drSh && drSh.getLastRow() >= 2) {
        const dr2 = drSh.getRange(2, 1, drSh.getLastRow() - 1, 3).getValues()
          .find(r => String(r[0]).trim() === payload.doctor_id_2);
        if (dr2) doctorName2 = dr2[1] + ', ' + dr2[2];
      }
    }

    // Tech name
    let createdByName = techId;
    const techSh = mainSS.getSheetByName('Technologists');
    if (techSh && techSh.getLastRow() >= 2) {
      const tc = techSh.getRange(2, 1, techSh.getLastRow() - 1, 3).getValues()
        .find(r => String(r[0]).trim() === techId);
      if (tc) createdByName = tc[2] + ' ' + tc[1];
    }

    // ── PhilHealth claim computation ──
    let philhealthClaim = 0;
    const philEnabled = getSettingValue_('philhealth_enabled', '1') === '1';

    const effectivePin = (payload.use_philhealth && payload.philhealth_pin)
      ? payload.philhealth_pin
      : philhealthPin;

    if (philEnabled && payload.use_philhealth && effectivePin) {
      const balResult = getPhilhealthBalance(branchId, payload.patient_id);
      const remaining = balResult.success ? balResult.remaining : 0;
      if (remaining > 0) {
        const hasClientCoverage = payload.items.some(i => i.is_philhealth_covered !== undefined);
        if (hasClientCoverage) {
          const coveredTotal = payload.items.reduce((s, i) =>
            s + (i.is_philhealth_covered ? (Number(i.unit_fee) || 0) : 0), 0);
          const grossAmt = payload.items.reduce((s, i) => s + (Number(i.unit_fee) || 0), 0);
          const discAmt = payload.items.reduce((s, i) => s + (Number(i.discount_amount) || 0), 0);
          philhealthClaim = Math.min(coveredTotal, remaining, Math.max(0, grossAmt - discAmt));
          philhealthClaim = Math.max(0, philhealthClaim);
        } else {
          const coveredIds = getPhilhealthCoveredIds_();
          philhealthClaim = computePhilhealthClaim_(payload.items, coveredIds, remaining);
        }
      }
    } else if (philEnabled && !payload.use_philhealth && philhealthPin) {
      philhealthClaim = 0;
    }

    if (payload.use_philhealth && effectivePin) philhealthPin = effectivePin;

    const grossAmount = payload.items.reduce((s, i) => s + (Number(i.unit_fee) || 0), 0);
    const discAmount = payload.items.reduce((s, i) => s + (Number(i.discount_amount) || 0), 0);
    const netAmount = Math.max(0, grossAmount - discAmount);
    const patientPays = Math.max(0, netAmount - philhealthClaim);

    // ── 1. Write LAB_ORDER row (24 cols) ──
    const orderTypesSet = new Set();
    payload.items.forEach(item => {
      const stypes = String(item.service_type || 'lab').toLowerCase().split(',');
      stypes.forEach(stype => {
        orderTypesSet.add(stype.trim() || 'lab');
      });
    });
    const orderTypes = Array.from(orderTypesSet).join(',') || 'lab';

    const orderCatIds = [...new Set(
      payload.items.map(i => String(i.cat_id || '').trim()).filter(Boolean)
    )].join(',');

    // ── Compute payment_status ──
    let paymentStatus = 'UNPAID';
    if (payload.payment && Number(payload.payment.amount) > 0) {
      const paidAmt = Number(payload.payment.amount);
      if (paidAmt >= patientPays) paymentStatus = 'PAID';
      else paymentStatus = 'PARTIAL';
    }

    const ordSh = getOrCreateSheet_(ss, 'LAB_ORDER',
      ['order_id', 'order_no', 'branch_id', 'patient_id', 'doctor_id',
        'order_date', 'status', 'created_by', 'created_at', 'updated_at', 'notes',
        'patient_name', 'doctor_name', 'created_by_name', 'net_amount',
        'doctor_id_2', 'doctor_name_2', 'philhealth_pin', 'philhealth_claim',
        'transferred_to_branch', 'transfer_status', 'order_types', 'order_cat_ids',
        'payment_status']);
    // Append 24 columns
    ordSh.appendRow([
      orderId, orderNo, branchId,
      payload.patient_id.trim(), (payload.doctor_id || '').trim(),
      now, 'IN_QUEUE', techId, now, now, (payload.notes || '').trim(),
      patientName, doctorName, createdByName, netAmount,
      (payload.doctor_id_2 || '').trim(), doctorName2,
      philhealthPin, philhealthClaim,
      '', '', orderTypes, orderCatIds, paymentStatus
    ]);

    // ── 2. Write LAB_ORDER_ITEM rows (batch) ──
    const itemSh = getOrCreateSheet_(ss, 'LAB_ORDER_ITEM',
      ['order_item_id', 'order_id', 'lab_id', 'dept_id', 'lab_name', 'qty', 'unit_fee',
        'line_gross', 'discount_id', 'discount_amount', 'line_net', 'tat_due_at', 'status']);
    ensureItemCols_(itemSh);
    const itemRows = payload.items.map(item => {
      const qty = Number(item.qty) || 1, fee = Number(item.unit_fee) || 0;
      const disc = Number(item.discount_amount) || 0;
      return ['ITEM-' + Math.random().toString(16).substr(2, 8).toUpperCase(), orderId,
        item.lab_id || '', item.dept_id || '', item.lab_name || '',
        qty, fee, qty * fee, item.discount_id || '', disc, qty * fee - disc, '', 'PENDING',
        '', '', '', '', '', '',  // cols 14-19 (checkpoints)
        item.source_pkg_id || '', item.source_pkg_name || ''  // cols 20-21
      ];
    });
    if (itemRows.length) {
      itemSh.getRange(itemSh.getLastRow() + 1, 1, itemRows.length, 21).setValues(itemRows);
    }

    // ── 3. Write PAYMENT row (only if payment was provided) ──
    if (payload.payment && Number(payload.payment.amount) > 0) {
      const paySh = getOrCreateSheet_(ss, 'PAYMENT',
        ['payment_id', 'order_id', 'paid_at', 'amount', 'method',
          'reference_no', 'received_by', 'status', 'remarks', 'acknowledge_no']);
      const pay = payload.payment;
      paySh.appendRow(['PAY-' + Math.random().toString(16).substr(2, 8).toUpperCase(),
        orderId, now, Number(pay.amount), (pay.method || 'CASH').trim(),
        (pay.reference_no || '').trim(), (pay.received_by || techId).trim(),
        'POSTED', '', (pay.acknowledge_no || '').trim()]);
    }

    // ── 4. Write PhilHealth claim + update ledger ──
    if (philhealthClaim > 0 && philhealthPin) {
      writePhilhealthClaim_(ss, orderId, payload.patient_id, philhealthPin, philhealthClaim, year);
      updatePhilhealthLedger_(ss, payload.patient_id, philhealthPin, year, philhealthClaim);
    }

    writeBranchAudit_(ss, techId, 'CREATE_FULL_ORDER', 'ORDER', orderId, null,
      {
        order_no: orderNo, patient_id: payload.patient_id,
        items: itemRows.length, philhealth_claim: philhealthClaim
      });
    writeAuditLog_('ORDER_CREATE', { branch_id: branchId, order_id: orderId, order_no: orderNo });
    Logger.log('createFullOrder: ' + orderId + ' / ' + orderNo + ' | PH claim: ' + philhealthClaim);

    return {
      success: true, order_id: orderId, order_no: orderNo,
      patient_name: patientName, doctor_name: doctorName,
      doctor_name_2: doctorName2, created_by_name: createdByName,
      net_amount: netAmount, philhealth_claim: philhealthClaim,
      patient_pays: patientPays
    };
  } catch (e) {
    Logger.log('createFullOrder ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE ORDER ─────────────────────────────────────────────
function createOrder(branchId, payload) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    if (!payload.patient_id) return { success: false, message: 'Patient is required.' };
    const ss = getOrderSS_(branchId);
    const sh = getOrCreateSheet_(ss, 'LAB_ORDER',
      ['order_id', 'order_no', 'branch_id', 'patient_id', 'doctor_id',
        'order_date', 'status', 'created_by', 'created_at', 'updated_at', 'notes']);
    const now = new Date();
    const branchCode = getBranchCode_(branchId);
    const orderId = 'ORD-' + Math.random().toString(16).substr(2, 8).toUpperCase();
    const orderNo = nextOrderNo_(ss, branchCode, now.getFullYear());
    sh.appendRow([orderId, orderNo, branchId, payload.patient_id.trim(),
      (payload.doctor_id || '').trim(), now, 'DRAFT',
      payload.created_by || '', now, now, (payload.notes || '').trim()]);
    writeBranchAudit_(ss, payload.created_by || '', 'CREATE_ORDER', 'ORDER', orderId, null, { order_no: orderNo });
    writeAuditLog_('ORDER_CREATE', { branch_id: branchId, order_id: orderId, order_no: orderNo });
    Logger.log('createOrder: ' + orderId + ' / ' + orderNo);
    return { success: true, order_id: orderId, order_no: orderNo };
  } catch (e) {
    Logger.log('createOrder ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SAVE ORDER ITEMS ─────────────────────────────────────────
function saveOrderItems(branchId, orderId, items) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Branch and Order ID required.' };
    const ss = getOrderSS_(branchId);
    const sh = getOrCreateSheet_(ss, 'LAB_ORDER_ITEM',
      ['order_item_id', 'order_id', 'lab_id', 'dept_id', 'lab_name', 'qty', 'unit_fee',
        'line_gross', 'discount_id', 'discount_amount', 'line_net', 'tat_due_at', 'status']);
    // Delete existing items for this order
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const ids = sh.getRange(2, 2, lr - 1, 1).getValues().flat().map(String);
      const toDelete = ids.reduce((a, id, i) => { if (id.trim() === orderId) a.push(i + 2); return a; }, []);
      toDelete.reverse().forEach(row => sh.deleteRow(row));
    }
    // Batch append all items
    const rows = items.map(item => {
      const qty = Number(item.qty) || 1;
      const unitFee = Number(item.unit_fee) || 0;
      const lineGross = qty * unitFee;
      const discAmt = Number(item.discount_amount) || 0;
      return ['ITEM-' + Math.random().toString(16).substr(2, 8).toUpperCase(), orderId,
      item.lab_id || '', item.dept_id || '', item.lab_name || '',
        qty, unitFee, lineGross, item.discount_id || '', discAmt, lineGross - discAmt, '', 'PENDING'];
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 13).setValues(rows);
    updateOrderTimestamp_(ss, orderId);
    return { success: true };
  } catch (e) {
    Logger.log('saveOrderItems ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CONFIRM ORDER ────────────────────────────────────────────
function confirmOrder(branchId, orderId, techId) {
  return updateOrderStatus_(branchId, orderId, 'OPEN', techId, 'CONFIRM_ORDER');
}

// ── POST PAYMENT ─────────────────────────────────────────────
function postPayment(branchId, orderId, payload) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Branch and Order ID required.' };
    if (!payload.amount || Number(payload.amount) <= 0) return { success: false, message: 'Valid amount required.' };
    if (!payload.method) return { success: false, message: 'Payment method required.' };
    const ss = getOrderSS_(branchId);
    const sh = getOrCreateSheet_(ss, 'PAYMENT',
      ['payment_id', 'order_id', 'paid_at', 'amount', 'method',
        'reference_no', 'received_by', 'status', 'remarks']);
    const payId = 'PAY-' + Math.random().toString(16).substr(2, 8).toUpperCase();
    sh.appendRow([payId, orderId, new Date(), Number(payload.amount),
      payload.method.trim(), (payload.reference_no || '').trim(),
      (payload.received_by || '').trim(), 'POSTED', (payload.remarks || '').trim()]);
    // Update payment_status based on balance
    const detail = getOrderDetail(branchId, orderId);
    if (detail.success) {
      const newPayStatus = detail.totals.balance <= 0 ? 'PAID' : 'PARTIAL';
      updatePaymentStatus_(ss, orderId, newPayStatus);
    } else {
      updateOrderTimestamp_(ss, orderId);
    }
    writeBranchAudit_(ss, payload.received_by || '', 'POST_PAYMENT', 'PAYMENT', payId, null, { amount: payload.amount });
    writeAuditLog_('PAYMENT_POSTED', { branch_id: branchId, order_id: orderId, payment_id: payId, amount: payload.amount });
    return { success: true, payment_id: payId };
  } catch (e) {
    Logger.log('postPayment ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE ORDER STATUS ───────────────────────────────────────
function updateOrderStatus(branchId, orderId, newStatus, techId) {
  return updateOrderStatus_(branchId, orderId, newStatus, techId, 'UPDATE_STATUS');
}

function updateOrderStatus_(branchId, orderId, newStatus, actorId, action) {
  try {
    const ss = getOrderSS_(branchId);
    const sh = ss.getSheetByName('LAB_ORDER');
    if (!sh) return { success: false, message: 'LAB_ORDER sheet not found.' };
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Order not found.' };
    const ids = sh.getRange(2, 1, lr - 1, 1).getValues().flat().map(String);
    const idx = ids.findIndex(id => id.trim() === orderId);
    if (idx === -1) return { success: false, message: 'Order not found.' };
    const shRow = idx + 2;
    const prev = sh.getRange(shRow, 7).getValue();
    // Batch update status + updated_at
    sh.getRange(shRow, 7, 1, 4).setValues([[newStatus, String(actorId || ''),
      sh.getRange(shRow, 9).getValue(), new Date()]]);
    writeBranchAudit_(ss, actorId || '', action || 'UPDATE_STATUS', 'ORDER', orderId,
      { status: prev }, { status: newStatus });
    return { success: true };
  } catch (e) {
    Logger.log('updateOrderStatus_ ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── ARCHIVE ORDER ─────────────────────────────────────────────
// Sets status to ARCHIVED. Archived orders are hidden from tech dashboards.
// Only allowed on DRAFT or OPEN orders (not yet in progress).
function archiveOrder(branchId, orderId, actorId) {
  try {
    const ss = getOrderSS_(branchId);
    const sh = ss.getSheetByName('LAB_ORDER');
    if (!sh) return { success: false, message: 'LAB_ORDER sheet not found.' };
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Order not found.' };
    const rows = sh.getRange(2, 1, lr - 1, 7).getValues();
    const idx = rows.findIndex(r => String(r[0]).trim() === orderId);
    if (idx === -1) return { success: false, message: 'Order not found.' };
    const currentStatus = String(rows[idx][6]).trim();
    const allowedStatuses = ['DRAFT', 'OPEN'];
    if (!allowedStatuses.includes(currentStatus)) {
      return { success: false, message: 'Only DRAFT or OPEN orders can be archived.' };
    }
    const shRow = idx + 2;
    sh.getRange(shRow, 7).setValue('ARCHIVED');
    sh.getRange(shRow, 10).setValue(new Date());
    writeBranchAudit_(ss, actorId || '', 'ARCHIVE_ORDER', 'ORDER', orderId,
      { status: currentStatus }, { status: 'ARCHIVED' });
    return { success: true };
  } catch (e) {
    Logger.log('archiveOrder ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE ORDER (edit patient, doctor, notes, date) ──────────
function updateOrder(branchId, orderId, payload, actorId) {
  try {
    const ss = getOrderSS_(branchId);
    const mainSS = getSS_();
    const sh = ss.getSheetByName('LAB_ORDER');
    if (!sh) return { success: false, message: 'LAB_ORDER sheet not found.' };
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Order not found.' };
    const oCols = Math.max(sh.getLastColumn(), 24);
    const rows = sh.getRange(2, 1, lr - 1, oCols).getValues();
    const idx = rows.findIndex(r => String(r[0]).trim() === orderId);
    if (idx === -1) return { success: false, message: 'Order not found.' };
    const shRow = idx + 2;

    // Resolve patient name
    let patientName = payload.patient_id;
    let philhealthPin = String(rows[idx][17] || '').trim();
    const patSh = ss.getSheetByName('Patients');
    if (patSh && patSh.getLastRow() >= 2 && payload.patient_id) {
      const pr = patSh.getRange(2, 1, patSh.getLastRow() - 1, 10).getValues()
        .find(r => String(r[0]).trim() === payload.patient_id);
      if (pr) { patientName = pr[1] + ', ' + pr[2]; philhealthPin = String(pr[9] || '').trim(); }
    }

    // Resolve doctor names
    let doctorName = '', doctorName2 = '';
    const drSh = mainSS.getSheetByName('Doctors');
    if (drSh && drSh.getLastRow() >= 2) {
      const drRows = drSh.getRange(2, 1, drSh.getLastRow() - 1, 3).getValues();
      if (payload.doctor_id) {
        const dr = drRows.find(r => String(r[0]).trim() === payload.doctor_id);
        if (dr) doctorName = dr[1] + ', ' + dr[2];
      }
      if (payload.doctor_id_2) {
        const dr2 = drRows.find(r => String(r[0]).trim() === payload.doctor_id_2);
        if (dr2) doctorName2 = dr2[1] + ', ' + dr2[2];
      }
    }

    // Update columns: patient_id(4), doctor_id(5), order_date(6 stays), notes(11),
    // patient_name(12), doctor_name(13), doctor_id_2(16), doctor_name_2(17), philhealth_pin(18), updated_at(10)
    sh.getRange(shRow, 4).setValue(payload.patient_id || rows[idx][3]);
    sh.getRange(shRow, 5).setValue(payload.doctor_id || '');
    sh.getRange(shRow, 6).setValue(payload.order_date ? new Date(payload.order_date) : rows[idx][5]);
    sh.getRange(shRow, 10).setValue(new Date());
    sh.getRange(shRow, 11).setValue(payload.notes || '');
    sh.getRange(shRow, 12).setValue(patientName);
    sh.getRange(shRow, 13).setValue(doctorName);
    sh.getRange(shRow, 16).setValue(payload.doctor_id_2 || '');
    sh.getRange(shRow, 17).setValue(doctorName2);
    sh.getRange(shRow, 18).setValue(payload.philhealth_pin || philhealthPin);

    writeBranchAudit_(ss, actorId || '', 'UPDATE_ORDER', 'ORDER', orderId, null, payload);
    return { success: true };
  } catch (e) {
    Logger.log('updateOrder ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

function updateOrderTimestamp_(ss, orderId) {
  try {
    const sh = ss.getSheetByName('LAB_ORDER');
    if (!sh || sh.getLastRow() < 2) return;
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat().map(String);
    const idx = ids.findIndex(id => id.trim() === orderId);
    if (idx !== -1) sh.getRange(idx + 2, 10).setValue(new Date());
  } catch (e) { }
}

function updatePaymentStatus_(ss, orderId, paymentStatus) {
  try {
    const sh = ss.getSheetByName('LAB_ORDER');
    if (!sh || sh.getLastRow() < 2) return;
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat().map(String);
    const idx = ids.findIndex(id => id.trim() === orderId);
    if (idx !== -1) {
      // Ensure col 24 header exists
      if (sh.getLastColumn() < 24) sh.getRange(1, 24).setValue('payment_status');
      sh.getRange(idx + 2, 24).setValue(paymentStatus);
      sh.getRange(idx + 2, 10).setValue(new Date()); // updated_at
    }
  } catch (e) { Logger.log('updatePaymentStatus_ ERROR: ' + e.message); }
}

// Save encoding for a single order item (called from Tech Dashboard per-service workflow)
function saveItemEncoding(branchId, orderId, itemId, encodingData, encodedBy) {
  try {
    if (!branchId || !orderId || !itemId) return { success: false, message: 'Missing required params.' };
    const ss = getOrderSS_(branchId);
    const rSh = _getResultItemsSheet_(ss);
    const now = new Date();

    // Delete existing result rows for this specific item (upsert per item)
    const lr = rSh.getLastRow();
    if (lr >= 2) {
      const rows = rSh.getRange(2, 1, lr - 1, 3).getValues();
      const toDelete = [];
      rows.forEach((r, i) => {
        if (String(r[1]).trim() === orderId && String(r[2]).trim() === itemId) toDelete.push(i + 2);
      });
      toDelete.sort((a, b) => b - a).forEach(row => rSh.deleteRow(row));
    }

    // Ensure extra cols for xray fields
    const shCols = rSh.getLastColumn();
    if (shCols < 14) {
      if (shCols < 11) rSh.getRange(1, 11).setValue('result_type');
      if (shCols < 12) rSh.getRange(1, 12).setValue('clinical_data');
      if (shCols < 13) rSh.getRange(1, 13).setValue('findings');
      if (shCols < 14) rSh.getRange(1, 14).setValue('impression');
    }

    const resultType = String(encodingData.result_type || 'lab').trim();

    if (resultType === 'xray') {
      // X-Ray: single row with clinical_data/findings/impression
      const resultItemId = 'RI-' + Math.random().toString(16).slice(2, 10).toUpperCase();
      const row = [resultItemId, orderId, itemId,
        (encodingData.lab_name || '').trim(), '', '', '', '',
        encodedBy || '', now,
        'xray',
        (encodingData.clinical_data || '').trim(),
        (encodingData.findings || '').trim(),
        (encodingData.impression || '').trim()
      ];
      rSh.appendRow(row);
    } else {
      // Lab: one row per parameter
      const params = encodingData.params || [];
      params.forEach(p => {
        const resultItemId = 'RI-' + Math.random().toString(16).slice(2, 10).toUpperCase();
        rSh.appendRow([resultItemId, orderId, itemId,
          (p.param_name || encodingData.lab_name || '').trim(),
          (p.result_value || '').trim(),
          (p.unit || '').trim(),
          (p.reference_range || '').trim(),
          (p.remarks || '').trim(),
          encodedBy || '', now,
          'lab', '', '', ''
        ]);
      });
    }

    // Mark item encoded_at in LAB_ORDER_ITEM
    const itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    if (itemSh && itemSh.getLastRow() >= 2) {
      ensureItemCols_(itemSh);
      const iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, 2).getValues();
      const iIdx = iRows.findIndex(r => String(r[0]).trim() === itemId);
      if (iIdx !== -1) itemSh.getRange(iIdx + 2, 16).setValue(now);
    }

    // Check if all items encoded → auto-advance order to FOR_RELEASE
    _checkOrderProgress_(ss, itemSh || ss.getSheetByName('LAB_ORDER_ITEM'), orderId, branchId);

    writeBranchAudit_(ss, encodedBy || '', 'ENCODE_ITEM', 'ORDER_ITEM', itemId, null,
      { order_id: orderId, result_type: resultType });
    return { success: true };
  } catch (e) {
    Logger.log('saveItemEncoding ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Get encoding for a specific item
function getItemEncoding(branchId, orderId, itemId) {
  try {
    if (!branchId || !orderId || !itemId) return { success: false, message: 'Missing params.' };
    const ss = getOrderSS_(branchId);
    const rSh = ss.getSheetByName('RESULT_ITEMS');
    if (!rSh || rSh.getLastRow() < 2) return { success: true, data: [] };

    const cols = Math.max(rSh.getLastColumn(), 14);
    const data = rSh.getRange(2, 1, rSh.getLastRow() - 1, cols).getValues()
      .filter(r => r[0] && String(r[1]).trim() === orderId && String(r[2]).trim() === itemId)
      .map(r => ({
        result_item_id: String(r[0]).trim(),
        lab_name: String(r[3] || '').trim(),
        result_value: String(r[4] || '').trim(),
        unit: String(r[5] || '').trim(),
        reference_range: String(r[6] || '').trim(),
        remarks: String(r[7] || '').trim(),
        encoded_by: String(r[8] || '').trim(),
        encoded_at: r[9] ? new Date(r[9]).toISOString() : '',
        result_type: String(r[10] || 'lab').trim(),
        clinical_data: String(r[11] || '').trim(),
        findings: String(r[12] || '').trim(),
        impression: String(r[13] || '').trim()
      }));

    return { success: true, data };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ── GET PATIENT RESULTS (all encoded results for a patient) ──────
function getPatientResults(branchId, patientId) {
  try {
    if (!branchId || !patientId) return { success: false, message: 'Missing params.' };
    const ss = getOrderSS_(branchId);

    const ordSh  = ss.getSheetByName('LAB_ORDER');
    const itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    const rSh    = ss.getSheetByName('RESULT_ITEMS');

    if (!ordSh || ordSh.getLastRow() < 2) return { success: true, data: [] };

    // All orders for this patient
    const ordCols = Math.max(ordSh.getLastColumn(), 24);
    const orders = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, ordCols).getValues()
      .filter(r => r[0] && String(r[3]).trim() === patientId)
      .map(r => ({
        order_id: String(r[0]).trim(),
        order_no: String(r[1]).trim(),
        order_date: r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
        status: String(r[6]).trim()
      }));

    if (!orders.length) return { success: true, data: [] };

    const orderIds = new Set(orders.map(o => o.order_id));
    const orderMap = {};
    orders.forEach(o => { orderMap[o.order_id] = o; o.items = []; });

    // Items for these orders
    const itemMap = {};
    if (itemSh && itemSh.getLastRow() >= 2) {
      const itemCols = Math.max(itemSh.getLastColumn(), 16);
      itemSh.getRange(2, 1, itemSh.getLastRow() - 1, itemCols).getValues()
        .filter(r => r[0] && orderIds.has(String(r[1]).trim()))
        .forEach(r => {
          const item = {
            item_id: String(r[0]).trim(),
            order_id: String(r[1]).trim(),
            serv_id: String(r[2]).trim(),
            serv_name: String(r[3]).trim(),
            service_type: String(r[15] || 'lab').trim(),
            results: []
          };
          itemMap[item.item_id] = item;
          if (orderMap[item.order_id]) orderMap[item.order_id].items.push(item);
        });
    }

    // Encoded results
    if (rSh && rSh.getLastRow() >= 2) {
      const rCols = Math.max(rSh.getLastColumn(), 14);
      rSh.getRange(2, 1, rSh.getLastRow() - 1, rCols).getValues()
        .filter(r => r[0] && itemMap[String(r[2]).trim()])
        .forEach(r => {
          const itemId = String(r[2]).trim();
          itemMap[itemId].results.push({
            lab_name: String(r[3] || '').trim(),
            result_value: String(r[4] || '').trim(),
            unit: String(r[5] || '').trim(),
            reference_range: String(r[6] || '').trim(),
            remarks: String(r[7] || '').trim(),
            encoded_by: String(r[8] || '').trim(),
            encoded_at: r[9] ? new Date(r[9]).toISOString() : '',
            result_type: String(r[10] || 'lab').trim(),
            clinical_data: String(r[11] || '').trim(),
            findings: String(r[12] || '').trim(),
            impression: String(r[13] || '').trim()
          });
        });
    }

    // Return only orders with at least one encoded item
    const data = orders
      .filter(o => o.items.some(i => i.results.length > 0))
      .sort((a, b) => b.order_date.localeCompare(a.order_date));

    return { success: true, data };
  } catch (e) {
    Logger.log('getPatientResults ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET BRANCH PATIENTS (patient search in wizard) ────────────
function getBranchPatients(branchId, query) {
  try {
    const ss = getOrderSS_(branchId); // reuses cached SS
    const sh = ss.getSheetByName('Patients');
    if (!sh || sh.getLastRow() < 2) return { success: true, data: [] };
    const q = (query || '').toLowerCase().trim();
    const lr = sh.getLastRow();
    // Single batch read
    const data = sh.getRange(2, 1, lr - 1, 11).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({
        patient_id: String(r[0]).trim(),
        last_name: String(r[1] || '').trim(),
        first_name: String(r[2] || '').trim(),
        middle_name: String(r[3] || '').trim(),
        sex: String(r[4] || '').trim(),
        dob: r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
        contact: String(r[6] || '').trim(),
        philhealth_pin: String(r[9] || '').trim(),
        discount_ids: String(r[10] || '').trim()
      }))
      .filter(p => !q || [p.last_name, p.first_name, p.contact, p.patient_id].join(' ').toLowerCase().includes(q));
    return { success: true, data };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ── GET BRANCH LAB SERVICES + PACKAGES + DISCOUNTS ───────────
function getBranchLabServices(branchId) {
  try {
    const ss = getSS_();

    // ── Services ──
    const srvSh = ss.getSheetByName('Lab_Services');
    const catSh = ss.getSheetByName('Categories');
    const deptSh = ss.getSheetByName('Departments');

    // Build dept map
    const deptMap = {};
    if (deptSh && deptSh.getLastRow() >= 2) {
      deptSh.getRange(2, 1, deptSh.getLastRow() - 1, 2).getValues()
        .forEach(r => { deptMap[String(r[0]).trim()] = String(r[1] || '').trim(); });
    }

    // Build category → dept map
    const catDeptMap = {};
    const catNameMap = {};
    if (catSh && catSh.getLastRow() >= 2) {
      catSh.getRange(2, 1, catSh.getLastRow() - 1, 3).getValues()
        .forEach(r => {
          const cid = String(r[0]).trim();
          catDeptMap[cid] = String(r[1]).trim();
          catNameMap[cid] = String(r[2]).trim();
        });
    }

    // Branch service overrides
    const bssSh = ss.getSheetByName('Branch_Serv_Status');
    const enabledSvcs = new Set();
    if (bssSh && bssSh.getLastRow() >= 2) {
      bssSh.getRange(2, 1, bssSh.getLastRow() - 1, 3).getValues()
        .filter(r => String(r[0]).trim() === branchId && r[2] == 1)
        .forEach(r => enabledSvcs.add(String(r[1]).trim()));
    }

    // NEW: read up to col 11 to get is_consultation (col 11 = r[10])
    const services = srvSh && srvSh.getLastRow() >= 2
      ? srvSh.getRange(2, 1, srvSh.getLastRow() - 1, Math.max(srvSh.getLastColumn(), 11)).getValues()
        .filter(r => r[0] && r[6] == 1) // active
        .filter(r => enabledSvcs.size === 0 || enabledSvcs.has(String(r[0]).trim()))
        .map(r => {
          const sid = String(r[0]).trim();
          const catId = String(r[1] || '').trim();
          const deptId = catDeptMap[catId] || '';
          return {
            lab_id: sid,
            lab_name: String(r[2] || '').trim(),
            cat_id: catId,
            cat_name: catNameMap[catId] || '',
            dept_id: deptId,
            dept_name: deptMap[deptId] || '',
            default_fee: Number(r[3]) || 0,
            unit_fee: Number(r[3]) || 0,
            is_philhealth_covered: r[5] == 1 ? 1 : 0,
            service_type: String(r[9] || 'lab').trim() || 'lab',
            is_consultation: r[10] == 1 ? 1 : 0,   // NEW: col 11
            type: 'service'
          };
        })
      : [];

    // ── Packages ──
    const pkgSh = ss.getSheetByName('Packages');
    const pkgItemSh = ss.getSheetByName('Package_Items');
    const bPkgSh = ss.getSheetByName('Branch_Pkg_Status');
    const bOwnPkgSh = ss.getSheetByName('Branch_Packages');
    const bOwnItemSh = ss.getSheetByName('Branch_Pkg_Items');

    // Build FULL service name+fee+type map from ALL active services
    const svcNameMap = {};
    const svcFeeMap = {};
    const svcTypeMap = {};  // NEW: track service_type per lab_id
    if (srvSh && srvSh.getLastRow() >= 2) {
      srvSh.getRange(2, 1, srvSh.getLastRow() - 1, 10).getValues()
        .filter(r => r[0])
        .forEach(r => {
          const sid = String(r[0]).trim();
          svcNameMap[sid] = String(r[2] || '').trim();
          svcFeeMap[sid] = Number(r[3]) || 0;
          svcTypeMap[sid] = String(r[9] || 'lab').trim().toLowerCase();
        });
    }

    const enabledGlobalPkgs = new Set();
    let hasGlobalStatus = false;
    if (bPkgSh && bPkgSh.getLastRow() >= 2) {
      bPkgSh.getRange(2, 1, bPkgSh.getLastRow() - 1, 3).getValues()
        .filter(r => String(r[0]).trim() === branchId)
        .forEach(r => {
          hasGlobalStatus = true;
          if (r[2] == 1) enabledGlobalPkgs.add(String(r[1]).trim());
        });
    }

    // Global package items map
    const pkgItemsMap = {};
    if (pkgItemSh && pkgItemSh.getLastRow() >= 2) {
      pkgItemSh.getRange(2, 1, pkgItemSh.getLastRow() - 1, 3).getValues()
        .forEach(r => {
          const pid = String(r[1]).trim();
          if (!pkgItemsMap[pid]) pkgItemsMap[pid] = [];
          pkgItemsMap[pid].push(String(r[2]).trim());
        });
    }

    const packages = [];
    if (pkgSh && pkgSh.getLastRow() >= 2) {
      pkgSh.getRange(2, 1, pkgSh.getLastRow() - 1, 7).getValues()
        .filter(r => r[0] && r[4] == 1) // master active only
        .filter(r => !hasGlobalStatus || enabledGlobalPkgs.has(String(r[0]).trim()))
        .forEach(r => {
          const pid = String(r[0]).trim();
          const sids = pkgItemsMap[pid] || [];
          // NEW: compute service_type from constituent items
          const pkgTypes = new Set();
          sids.forEach(sid => {
            const st = svcTypeMap[sid] || 'lab';
            pkgTypes.add(st || 'lab');
          });
          const pkgServiceType = Array.from(pkgTypes).join(',') || 'lab';
          packages.push({
            lab_id: pid,
            lab_name: String(r[1] || '').trim(),
            dept_id: 'PACKAGE',
            dept_name: 'Packages',
            cat_name: '',
            unit_fee: Number(r[3]) || 0,
            default_fee: Number(r[3]) || 0,
            item_ids: sids,
            items_display: sids.map(sid => svcNameMap[sid] || sid).join(', '),
            pkg_services: sids.map(sid => ({
              lab_id: sid,
              lab_name: svcNameMap[sid] || sid,
              service_type: svcTypeMap[sid] || 'lab',
              dept_id: 'PKG_SVC'
            })),
            type: 'package',
            service_type: pkgServiceType   // NEW
          });
        });
    }

    // Branch-specific packages
    if (bOwnPkgSh && bOwnPkgSh.getLastRow() >= 2) {
      const bPkgItemsMap = {};
      if (bOwnItemSh && bOwnItemSh.getLastRow() >= 2) {
        bOwnItemSh.getRange(2, 1, bOwnItemSh.getLastRow() - 1, 3).getValues()
          .forEach(r => {
            const bpid = String(r[1]).trim();
            if (!bPkgItemsMap[bpid]) bPkgItemsMap[bpid] = [];
            bPkgItemsMap[bpid].push(String(r[2]).trim());
          });
      }
      bOwnPkgSh.getRange(2, 1, bOwnPkgSh.getLastRow() - 1, 8).getValues()
        .filter(r => r[0] && String(r[1]).trim() === branchId && r[5] == 1)
        .forEach(r => {
          const bpid = String(r[0]).trim();
          const sids = bPkgItemsMap[bpid] || [];
          // NEW: compute service_type from constituent items
          const pkgTypes = new Set();
          sids.forEach(sid => {
            const st = svcTypeMap[sid] || 'lab';
            pkgTypes.add(st || 'lab');
          });
          const pkgServiceType = Array.from(pkgTypes).join(',') || 'lab';
          packages.push({
            lab_id: bpid,
            lab_name: String(r[2] || '').trim(),
            dept_id: 'PACKAGE',
            dept_name: 'Packages',
            cat_name: '',
            unit_fee: Number(r[4]) || 0,
            default_fee: Number(r[4]) || 0,
            item_ids: sids,
            items_display: sids.map(sid => svcNameMap[sid] || sid).join(', '),
            pkg_services: sids.map(sid => ({
              lab_id: sid,
              lab_name: svcNameMap[sid] || sid,
              service_type: svcTypeMap[sid] || 'lab',
              dept_id: 'PKG_SVC'
            })),
            type: 'package',
            service_type: pkgServiceType   // NEW
          });
        });
    }

    // ── Discounts ──
    const discSh = ss.getSheetByName('Discounts');
    const discounts = discSh && discSh.getLastRow() >= 2
      ? discSh.getRange(2, 1, discSh.getLastRow() - 1, 6).getValues()
        .filter(r => r[0] && r[5] == 1)
        .map(r => ({
          discount_id: String(r[0]).trim(),
          discount_name: String(r[1] || '').trim(),
          type: String(r[3] || '').trim(),
          value: Number(r[4]) || 0
        }))
      : [];

    return { success: true, services, packages, discounts };
  } catch (e) {
    Logger.log('getBranchLabServices ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET BRANCH DOCTORS ────────────────────────────────────────
function getBranchDoctors(branchId) {
  try {
    const sh = getSS_().getSheetByName('Doctors');
    if (!sh || sh.getLastRow() < 2) return { success: true, data: [] };
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues()
      .filter(r => r[0] && String(r[11] || '').includes(branchId))
      .map(r => ({
        doctor_id: String(r[0]).trim(),
        last_name: String(r[1] || '').trim(),
        first_name: String(r[2] || '').trim(),
        specialty: String(r[5] || '').trim()
      }));
    return { success: true, data };
  } catch (e) { return { success: false, message: e.message }; }
}

// ── GET ACTIVE DISCOUNTS ─────────────────────────────────────
function getOrderDiscounts() {
  try {
    const sh = getSS_().getSheetByName('Discounts');
    if (!sh || sh.getLastRow() < 2) return { success: true, data: [] };
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues()
      .filter(r => r[0] && r[5] == 1)
      .map(r => ({
        discount_id: String(r[0]).trim(),
        discount_name: String(r[1] || '').trim(),
        type: String(r[3] || '').trim(),
        value: Number(r[4]) || 0
      }));
    return { success: true, data };
  } catch (e) { return { success: false, message: e.message }; }
}

// ════════════════════════════════════════════════════════════════
//  CRITICAL PHASE — Per-Item Processing Checklist + Result Upload
//
//  LAB_ORDER_ITEM extended to 21 cols:
//    1=order_item_id  2=order_id   3=lab_id     4=dept_id
//    5=lab_name       6=qty        7=unit_fee   8=line_gross
//    9=discount_id   10=disc_amt  11=line_net  12=tat_due_at
//   13=status        14=extracted_at 15=processed_at
//   16=encoded_at   17=released_at  18=collected_at 19=submitted_at
//   20=source_pkg_id  21=source_pkg_name
// ════════════════════════════════════════════════════════════════

// ── ENSURE extended LAB_ORDER_ITEM headers (21 cols) ────────
function ensureItemCols_(sh) {
  const lr = sh.getLastRow();
  if (lr < 1) return;
  const cols = sh.getLastColumn();
  const allHeaders = ['extracted_at', 'processed_at', 'encoded_at', 'released_at',
    'collected_at', 'submitted_at', 'source_pkg_id', 'source_pkg_name'];
  for (let i = 0; i < allHeaders.length; i++) {
    const colNum = 14 + i; // cols 14-21
    if (cols < colNum) sh.getRange(1, colNum).setValue(allHeaders[i]);
  }
}

// ── GET ITEM CHECKPOINTS ──────────────────────────────────────
function getItemCheckpoints(branchId, orderId) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Branch and Order ID required.' };
    const ss = getOrderSS_(branchId);
    const sh = ss.getSheetByName('LAB_ORDER_ITEM');
    if (!sh || sh.getLastRow() < 2) return { success: true, data: [] };

    ensureItemCols_(sh);
    const lr = sh.getLastRow();
    const cols = sh.getLastColumn();
    const rows = sh.getRange(2, 1, lr - 1, Math.max(cols, 21)).getValues();

    // Build lab_id → cat_id and service_type lookup from master Lab_Services sheet
    const labCatMap = {};
    const labTypeMap = {};
    try {
      const masterSS = getSS_();
      const svSh = masterSS.getSheetByName('Lab_Services');
      if (svSh && svSh.getLastRow() >= 2) {
        svSh.getRange(2, 1, svSh.getLastRow() - 1, 10).getValues()
          .forEach(r => {
            const sid = String(r[0]).trim();
            labCatMap[sid] = String(r[1] || '').trim();
            labTypeMap[sid] = String(r[9] || 'lab').trim().toLowerCase() || 'lab';
          });
      }
    } catch (e) { /* non-fatal */ }

    const data = rows
      .filter(r => r[0] && String(r[1]).trim() === orderId)
      .map(r => ({
        order_item_id: String(r[0]).trim(),
        order_id: String(r[1]).trim(),
        lab_id: String(r[2]).trim(),
        serv_id: String(r[2]).trim(),
        dept_id: String(r[3] || '').trim(),
        cat_id: labCatMap[String(r[2]).trim()] || '',
        lab_name: String(r[4]).trim(),
        qty: Number(r[5]) || 1,
        unit_fee: Number(r[6]) || 0,
        line_net: Number(r[10]) || 0,
        status: String(r[12] || 'PENDING').trim(),
        service_type: labTypeMap[String(r[2]).trim()] || 'lab',
        // MedTech checkpoints
        extracted_at: r[13] ? new Date(r[13]).toISOString() : null,
        processed_at: r[14] ? new Date(r[14]).toISOString() : null,
        encoded_at: r[15] ? new Date(r[15]).toISOString() : null,
        released_at: r[16] ? new Date(r[16]).toISOString() : null,
        // Liaison Officer steps
        collected_at: r[17] ? new Date(r[17]).toISOString() : null,
        submitted_at: r[18] ? new Date(r[18]).toISOString() : null,
        // Package source
        source_pkg_id: String(r[19] || '').trim(),
        source_pkg_name: String(r[20] || '').trim()
      }));

    return { success: true, data };
  } catch (e) {
    Logger.log('getItemCheckpoints ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE ITEM CHECKPOINT ────────────────────────────────────
function updateItemCheckpoint(branchId, orderId, itemId, checkpoint, checked) {
  try {
    if (!branchId || !orderId || !itemId || !checkpoint)
      return { success: false, message: 'Missing required parameters.' };

    const colMap = {
      extracted: 14, processed: 15, encoded: 16, released: 17,  // MedTech
      collected: 18, submitted: 19                               // Liaison
    };
    const col = colMap[checkpoint];
    if (!col) return { success: false, message: 'Invalid checkpoint: ' + checkpoint };

    const ss = getOrderSS_(branchId);
    const sh = ss.getSheetByName('LAB_ORDER_ITEM');
    if (!sh || sh.getLastRow() < 2) return { success: false, message: 'No items found.' };

    ensureItemCols_(sh);
    const lr = sh.getLastRow();
    const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
    const idx = rows.findIndex(r => String(r[0]).trim() === itemId && String(r[1]).trim() === orderId);
    if (idx === -1) return { success: false, message: 'Item not found.' };

    const shRow = idx + 2;
    sh.getRange(shRow, col).setValue(checked ? new Date() : '');

    // Auto-advance order status based on overall completion
    const result = _checkOrderProgress_(ss, sh, orderId, branchId);
    Logger.log('updateItemCheckpoint: ' + itemId + ' ' + checkpoint + '=' + checked + ' → ' + result.newStatus);
    return { success: true, order_status: result.newStatus };
  } catch (e) {
    Logger.log('updateItemCheckpoint ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CHECK ORDER PROGRESS → auto-advance status ───────────────
function _checkOrderProgress_(ss, sh, orderId, branchId) {
  try {
    const lr = sh.getLastRow();
    const cols = Math.max(sh.getLastColumn(), 17);
    const rows = sh.getRange(2, 1, lr - 1, cols).getValues()
      .filter(r => r[0] && String(r[1]).trim() === orderId);

    if (!rows.length) return { newStatus: null };

    const allExtracted = rows.every(r => r[13]);
    const allProcessed = rows.every(r => r[14]);
    const allEncoded = rows.every(r => r[15]);
    const allReleased = rows.every(r => r[16]);
    const anyStarted = rows.some(r => r[13] || r[14] || r[15] || r[16]);

    const ordSh = ss.getSheetByName('LAB_ORDER');
    if (!ordSh) return { newStatus: null };
    const ordLR = ordSh.getLastRow();
    const ordIds = ordSh.getRange(2, 1, ordLR - 1, 1).getValues().flat().map(String);
    const ordIdx = ordIds.findIndex(id => id.trim() === orderId);
    if (ordIdx === -1) return { newStatus: null };
    const current = String(ordSh.getRange(ordIdx + 2, 7).getValue()).trim();

    let newStatus = current;

    if (allReleased && current !== 'RELEASED') {
      newStatus = 'RELEASED';
    } else if (allEncoded && !allReleased && current !== 'FOR_RELEASE' && current !== 'RELEASED') {
      newStatus = 'FOR_RELEASE';
    } else if (anyStarted && current === 'IN_QUEUE') {
      newStatus = 'IN_PROGRESS';
    }

    if (newStatus !== current) {
      ordSh.getRange(ordIdx + 2, 7, 1, 2).setValues([[newStatus, new Date()]]);
      writeBranchAudit_(ss, 'system', 'AUTO_STATUS', 'ORDER', orderId,
        { status: current }, { status: newStatus });
      Logger.log('_checkOrderProgress_: ' + orderId + ' → ' + newStatus);
    }

    return { newStatus };
  } catch (e) {
    Logger.log('_checkOrderProgress_ ERROR: ' + e.message);
    return { newStatus: null };
  }
}

// ── MARK ORDER IN PROGRESS ───────────────────────────────────
function markOrderInProgress(branchId, orderId) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Missing parameters.' };
    const ss = getOrderSS_(branchId);
    const ordSh = ss.getSheetByName('LAB_ORDER');
    if (!ordSh) return { success: false, message: 'LAB_ORDER sheet not found.' };
    const ordLR = ordSh.getLastRow();
    const data = ordSh.getRange(2, 1, ordLR - 1, 7).getValues();
    const idx = data.findIndex(r => String(r[0]).trim() === orderId);
    if (idx === -1) return { success: false, message: 'Order not found.' };
    const current = String(data[idx][6]).trim();
    if (current === 'IN_QUEUE') {
      ordSh.getRange(idx + 2, 7, 1, 2).setValues([['IN_PROGRESS', new Date()]]);
      writeBranchAudit_(ss, 'system', 'AUTO_STATUS', 'ORDER', orderId,
        { status: 'IN_QUEUE' }, { status: 'IN_PROGRESS' });
    }
    return { success: true };
  } catch (e) {
    Logger.log('markOrderInProgress ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET ORDER RESULT ─────────────────────────────────────────
function getOrderResult(branchId, orderId) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Branch and Order ID required.' };
    const ss = getOrderSS_(branchId);
    const sh = getOrCreateSheet_(ss, 'RESULT',
      ['result_id', 'order_id', 'branch_id', 'patient_id',
        'result_file_id', 'drive_url', 'uploaded_by', 'uploaded_at', 'notes']);

    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: null };
    const rows = sh.getRange(2, 1, lr - 1, 9).getValues();
    const row = rows.find(r => r[0] && String(r[1]).trim() === orderId);
    if (!row) return { success: true, data: null };

    return {
      success: true, data: {
        result_id: String(row[0]).trim(),
        order_id: String(row[1]).trim(),
        result_file_id: String(row[4] || '').trim(),
        drive_url: String(row[5] || '').trim(),
        uploaded_by: String(row[6] || '').trim(),
        uploaded_at: row[7] ? new Date(row[7]).toISOString() : null,
        notes: String(row[8] || '').trim()
      }
    };
  } catch (e) {
    Logger.log('getOrderResult ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPLOAD ORDER RESULT (PDF to Drive) ───────────────────────
function uploadOrderResult(branchId, orderId, patientId, base64Data, fileName, uploadedBy, notes) {
  try {
    if (!branchId || !orderId || !base64Data) return { success: false, message: 'Missing required data.' };

    const ss = getOrderSS_(branchId);

    // Get or create patient folder in Drive
    const folderName = 'A-Lab Results / ' + branchId + ' / ' + (patientId || 'Unknown');
    let folder;
    try {
      const q = DriveApp.getFoldersByName(folderName);
      folder = q.hasNext() ? q.next() : DriveApp.createFolder(folderName);
    } catch (fe) {
      folder = DriveApp.getRootFolder();
    }

    // Decode base64 + create file
    const decoded = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decoded, 'application/pdf', fileName || 'result_' + orderId + '.pdf');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileId = file.getId();
    const driveUrl = 'https://drive.google.com/file/d/' + fileId + '/view';

    // Write to RESULT sheet (upsert)
    const sh = getOrCreateSheet_(ss, 'RESULT',
      ['result_id', 'order_id', 'branch_id', 'patient_id',
        'result_file_id', 'drive_url', 'uploaded_by', 'uploaded_at', 'notes']);

    const lr = sh.getLastRow();
    if (lr >= 2) {
      const ids = sh.getRange(2, 2, lr - 1, 1).getValues().flat().map(String);
      const existing = ids.findIndex(id => id.trim() === orderId);
      if (existing !== -1) sh.deleteRow(existing + 2);
    }

    const resultId = 'RES-' + Math.random().toString(16).substr(2, 8).toUpperCase();
    sh.appendRow([resultId, orderId, branchId, patientId || '',
      fileId, driveUrl, uploadedBy || '', new Date(), notes || '']);

    writeBranchAudit_(ss, uploadedBy || '', 'UPLOAD_RESULT', 'RESULT', resultId, null,
      { order_id: orderId, file: fileName });
    writeAuditLog_('RESULT_UPLOAD', { branch_id: branchId, order_id: orderId, result_id: resultId });

    Logger.log('uploadOrderResult: ' + resultId + ' → ' + fileId);
    return { success: true, result_id: resultId, drive_url: driveUrl, file_id: fileId };
  } catch (e) {
    Logger.log('uploadOrderResult ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GENERATE RESULT SPREADSHEET (from template) ──────────────
function generateResultSpreadsheet(branchId, orderId, servId, patientId, testName, patientName, orderNo, orderItemId) {
  try {
    if (!branchId || !orderId || !servId) return { success: false, message: 'Missing required parameters.' };

    // 1. Get Template URL from global Lab_Services sheet (col 12)
    const ss = getSS_();
    let templateUrl = '';
    try {
      const lsSh = ss.getSheetByName('Lab_Services');
      if (lsSh && lsSh.getLastRow() >= 2) {
        const lsCols = Math.max(lsSh.getLastColumn(), 12);
        const lsData = lsSh.getRange(2, 1, lsSh.getLastRow() - 1, lsCols).getValues();
        const match = lsData.find(r => String(r[0]).trim() === servId);
        if (match) templateUrl = String(match[11] || '').trim();
      }
    } catch(e) { /* non-fatal */ }
    if (!templateUrl) return { success: false, message: 'No Master Template is linked to this service. Please configure it in Lab Services settings.' };

    let templateId = templateUrl;
    if (templateUrl.includes('/d/')) {
       templateId = templateUrl.split('/d/')[1].split('/')[0];
    } else if (templateUrl.includes('id=')) {
       templateId = templateUrl.split('id=')[1].split('&')[0];
    }

    // 2. Get the Root Patient Folder ID
    let rootFolderId = '';
    try {
       const drvCfg = getDriveFolderConfig(branchId);
       rootFolderId = drvCfg.root_folder_id || '';
    } catch(e) {
       // fallback
       const stSh = ss.getSheetByName('System_Settings');
       if (stSh && stSh.getLastRow() >= 2) {
         const match = stSh.getRange(2, 1, stSh.getLastRow() - 1, 2).getValues().find(r => String(r[0]).trim() === 'patient_folder_' + branchId);
         if (match) rootFolderId = String(match[1]).trim();
       }
    }

    // 3. Ensure patient sub-folder
    let targetFolder;
    if (rootFolderId) {
      try {
        const rootFolder = DriveApp.getFolderById(rootFolderId);
        const folderName = (patientName||'Patient') + ' - ' + (patientId||'ID');
        const q = rootFolder.getFoldersByName(folderName);
        targetFolder = q.hasNext() ? q.next() : rootFolder.createFolder(folderName);
      } catch (e) {
        Logger.log('Root folder invalid, falling back');
        targetFolder = DriveApp.getRootFolder();
      }
    } else {
       // fallback A-Lab Results
       const fallName = 'A-Lab Results / ' + branchId + ' / ' + (patientId || 'Unknown');
       const fq = DriveApp.getFoldersByName(fallName);
       targetFolder = fq.hasNext() ? fq.next() : DriveApp.createFolder(fallName);
    }

    // 4. Duplicate the Sheet
    const templateFile = DriveApp.getFileById(templateId);
    if (!templateFile) return { success: false, message: 'Template file is not accessible! Ensure it is shared with the system email.' };
    
    const newName = (orderNo || orderId) + ' - ' + (testName || 'Result');
    const newCopy = templateFile.makeCopy(newName, targetFolder);
    const driveUrl = newCopy.getUrl();

    // 5. Save copy to RESULT_ITEMS
    const ordSs = getOrderSS_(branchId);
    const itemsSh = _getResultItemsSheet_(ordSs);

    const lr = itemsSh.getLastRow();
    if (lr >= 2) {
      const colC = orderItemId || servId;
      const idx = itemsSh.getRange(2, 1, lr - 1, 3).getValues().findIndex(r => String(r[1]).trim() === orderId && String(r[2]).trim() === colC);
      if (idx !== -1) {
         itemsSh.getRange(idx + 2, 5, 1, 6).setValues([[driveUrl, 'RESULT_LINK', '', '', '', new Date()]]);
         return { success: true, drive_url: driveUrl };
      }
    }

    // A=result_item_id B=order_id C=order_item_id D=lab_name E=result_value F=unit G=reference_range H=remarks I=encoded_by J=encoded_at
    const resultItemId = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
    itemsSh.appendRow([resultItemId, orderId, orderItemId || servId, 'Result Sheet', driveUrl, 'RESULT_LINK', '', '', '', new Date()]);
    
    return { success: true, drive_url: driveUrl };
    
  } catch (e) {
    Logger.log('generateResultSpreadsheet ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}


// ════════════════════════════════════════════════════════════════
//  INTER-BRANCH ORDER TRANSFERS
// ════════════════════════════════════════════════════════════════

// ── ENSURE LAB_ORDER transfer cols ───────────────────────────
function ensureOrderTransferCols_(sh) {
  if (!sh || sh.getLastRow() < 1) return;
  const cols = sh.getLastColumn();
  if (cols < 20) sh.getRange(1, 20).setValue('transferred_to_branch');
  if (cols < 21) sh.getRange(1, 21).setValue('transfer_status');
  if (cols < 22) sh.getRange(1, 22).setValue('order_types'); // comma-sep: lab,xray
}

// ── TRANSFER ORDER ────────────────────────────────────────────
function transferOrder(fromBranchId, orderId, toBranchId, reason, actorId) {
  try {
    if (!fromBranchId || !orderId || !toBranchId)
      return { success: false, message: 'Missing required parameters.' };
    if (fromBranchId === toBranchId)
      return { success: false, message: 'Cannot transfer to the same branch.' };

    const fromSS = getOrderSS_(fromBranchId);
    const toSS = getOrderSS_(toBranchId);
    const fromOrdSh = fromSS.getSheetByName('LAB_ORDER');
    if (!fromOrdSh) return { success: false, message: 'LAB_ORDER not found.' };

    const lr = fromOrdSh.getLastRow();
    if (lr < 2) return { success: false, message: 'Order not found.' };
    ensureOrderTransferCols_(fromOrdSh);
    const cols = Math.max(fromOrdSh.getLastColumn(), 21);
    const rows = fromOrdSh.getRange(2, 1, lr - 1, cols).getValues();
    const rowIdx = rows.findIndex(r => String(r[0]).trim() === orderId);
    if (rowIdx === -1) return { success: false, message: 'Order not found.' };

    const origRow = rows[rowIdx];
    const curStatus = String(origRow[6]).trim();
    if (!['OPEN', 'PAID'].includes(curStatus))
      return { success: false, message: 'Only OPEN or PAID orders can be transferred.' };
    if (origRow[19] && String(origRow[19]).trim())
      return { success: false, message: 'Order already transferred.' };

    // Flag originating branch order
    const shRow = rowIdx + 2;
    fromOrdSh.getRange(shRow, 20, 1, 2).setValues([[toBranchId, 'PENDING']]);
    fromOrdSh.getRange(shRow, 10).setValue(new Date()); // updated_at

    // Write mirror copy to performing branch
    const toOrdSh = getOrCreateSheet_(toSS, 'LAB_ORDER',
      ['order_id', 'order_no', 'branch_id', 'patient_id', 'doctor_id',
        'order_date', 'status', 'created_by', 'created_at', 'updated_at', 'notes',
        'patient_name', 'doctor_name', 'created_by_name', 'net_amount',
        'doctor_id_2', 'doctor_name_2', 'philhealth_pin', 'philhealth_claim',
        'transferred_to_branch', 'transfer_status']);
    ensureOrderTransferCols_(toOrdSh);

    const mirrorId = orderId + '-TFR';
    const mirrorNote = '[TRANSFER from ' + fromBranchId + '] ' + (reason || '') + ' | orig: ' + String(origRow[10] || '');
    const now = new Date();
    toOrdSh.appendRow([
      mirrorId,
      String(origRow[1]).trim() + '-TFR',
      fromBranchId,
      String(origRow[3]).trim(),
      String(origRow[4]).trim(),
      origRow[5],
      'PAID',
      actorId || '',
      now, now,
      mirrorNote,
      String(origRow[11] || '').trim(),
      String(origRow[12] || '').trim(),
      actorId || '',
      Number(origRow[14]) || 0,
      String(origRow[15] || '').trim(),
      String(origRow[16] || '').trim(),
      String(origRow[17] || '').trim(),
      Number(origRow[18]) || 0,
      fromBranchId,
      'TRANSFER_IN'
    ]);

    // Mirror order items too
    const fromItemSh = fromSS.getSheetByName('LAB_ORDER_ITEM');
    if (fromItemSh && fromItemSh.getLastRow() >= 2) {
      const toItemSh = getOrCreateSheet_(toSS, 'LAB_ORDER_ITEM',
        ['order_item_id', 'order_id', 'lab_id', 'dept_id', 'lab_name', 'qty', 'unit_fee',
          'line_gross', 'discount_id', 'discount_amount', 'line_net', 'tat_due_at', 'status']);
      const iRows = fromItemSh.getRange(2, 1, fromItemSh.getLastRow() - 1, 13).getValues()
        .filter(r => r[0] && String(r[1]).trim() === orderId);
      if (iRows.length) {
        const mirrorItems = iRows.map(r => [
          'ITEM-' + Math.random().toString(16).substr(2, 8).toUpperCase(),
          mirrorId, r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], '', 'PENDING'
        ]);
        toItemSh.getRange(toItemSh.getLastRow() + 1, 1, mirrorItems.length, 13).setValues(mirrorItems);
      }
    }

    writeBranchAudit_(fromSS, actorId || '', 'TRANSFER_ORDER', 'ORDER', orderId,
      { status: curStatus }, { transferred_to: toBranchId, reason });
    writeAuditLog_('ORDER_TRANSFER', { from: fromBranchId, to: toBranchId, order_id: orderId });
    Logger.log('transferOrder: ' + orderId + ' → ' + toBranchId);
    return { success: true, mirror_id: mirrorId };

  } catch (e) {
    Logger.log('transferOrder ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET TRANSFERRED-IN ORDERS (for performing branch) ────────
function getTransferredOrders(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const ss = getOrderSS_(branchId);
    const ordSh = ss.getSheetByName('LAB_ORDER');
    if (!ordSh || ordSh.getLastRow() < 2) return { success: true, data: [] };

    const cols = Math.max(ordSh.getLastColumn(), 21);
    const data = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, cols).getValues()
      .filter(r => r[0] && String(r[20] || '').trim() === 'TRANSFER_IN')
      .map(r => ({
        order_id: String(r[0]).trim(),
        order_no: String(r[1]).trim(),
        from_branch_id: String(r[19] || '').trim(),
        patient_id: String(r[3]).trim(),
        patient_name: String(r[11] || '').trim(),
        status: String(r[6]).trim(),
        net_amount: Number(r[14]) || 0,
        order_date: r[5] ? new Date(r[5]).toISOString().split('T')[0] : '',
        is_transfer: true
      }));

    Logger.log('getTransferredOrders: ' + branchId + ' → ' + data.length);
    return { success: true, data };
  } catch (e) {
    Logger.log('getTransferredOrders ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── COMPLETE TRANSFER ─────────────────────────────────────────
function completeTransfer(branchId, mirrorOrderId, actorId) {
  try {
    if (!branchId || !mirrorOrderId) return { success: false, message: 'Missing params.' };
    const ss = getOrderSS_(branchId);
    const ordSh = ss.getSheetByName('LAB_ORDER');
    if (!ordSh || ordSh.getLastRow() < 2) return { success: false, message: 'Order not found.' };

    ensureOrderTransferCols_(ordSh);
    const cols = Math.max(ordSh.getLastColumn(), 21);
    const rows = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, cols).getValues();
    const rowIdx = rows.findIndex(r => String(r[0]).trim() === mirrorOrderId);
    if (rowIdx === -1) return { success: false, message: 'Transfer order not found.' };

    const shRow = rowIdx + 2;
    ordSh.getRange(shRow, 7).setValue('RELEASED');
    ordSh.getRange(shRow, 21).setValue('COMPLETED');
    ordSh.getRange(shRow, 10).setValue(new Date());

    // Try to update originating branch order transfer_status
    const origOrderId = mirrorOrderId.replace('-TFR', '');
    const fromBranchId = String(rows[rowIdx][19] || '').trim();
    if (fromBranchId) {
      try {
        const fromSS = getOrderSS_(fromBranchId);
        const fromOrd = fromSS.getSheetByName('LAB_ORDER');
        if (fromOrd && fromOrd.getLastRow() >= 2) {
          ensureOrderTransferCols_(fromOrd);
          const fCols = Math.max(fromOrd.getLastColumn(), 21);
          const fRows = fromOrd.getRange(2, 1, fromOrd.getLastRow() - 1, fCols).getValues();
          const fIdx = fRows.findIndex(r => String(r[0]).trim() === origOrderId);
          if (fIdx !== -1) {
            fromOrd.getRange(fIdx + 2, 7).setValue('RELEASED');
            fromOrd.getRange(fIdx + 2, 21).setValue('COMPLETED');
            fromOrd.getRange(fIdx + 2, 10).setValue(new Date());
          }
        }
      } catch (fErr) { Logger.log('completeTransfer: could not update origin: ' + fErr.message); }
    }

    writeBranchAudit_(ss, actorId || '', 'COMPLETE_TRANSFER', 'ORDER', mirrorOrderId, null, { status: 'COMPLETED' });
    Logger.log('completeTransfer: ' + mirrorOrderId);
    return { success: true };
  } catch (e) {
    Logger.log('completeTransfer ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  ENCODE RESULTS (MedTech)
// ════════════════════════════════════════════════════════════════

function _getResultItemsSheet_(bss) {
  let sh = bss.getSheetByName('RESULT_ITEMS');
  if (!sh) {
    sh = bss.insertSheet('RESULT_ITEMS');
    sh.getRange(1, 1, 1, 10).setValues([[
      'result_item_id', 'order_id', 'order_item_id', 'lab_name',
      'result_value', 'unit', 'reference_range', 'remarks', 'encoded_by', 'encoded_at'
    ]]);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
    sh.setFrozenRows(1);
  } else {
    // Ensure new cols exist for existing sheets
    const cols = sh.getLastColumn();
    if (cols < 10) {
      if (cols < 6) sh.getRange(1, 6).setValue('unit');
      if (cols < 7) sh.getRange(1, 7).setValue('reference_range');
      if (cols < 8) sh.getRange(1, 8).setValue('remarks');
      if (cols < 9) sh.getRange(1, 9).setValue('encoded_by');
      if (cols < 10) sh.getRange(1, 10).setValue('encoded_at');
    }
  }
  return sh;
}

// Save encoded results for an order (MedTech encodes per item)
function saveOrderEncoding(branchId, orderId, items, encodedBy) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Missing required params.' };
    if (!items || !items.length) return { success: false, message: 'No items to encode.' };

    const ss = getOrderSS_(branchId);
    const rSh = _getResultItemsSheet_(ss);
    const now = new Date();

    // Delete existing result items for this order (upsert)
    const lr = rSh.getLastRow();
    if (lr >= 2) {
      const rows = rSh.getRange(2, 1, lr - 1, 2).getValues();
      const toDelete = [];
      rows.forEach((r, i) => { if (String(r[1]).trim() === orderId) toDelete.push(i + 2); });
      toDelete.sort((a, b) => b - a).forEach(row => rSh.deleteRow(row));
    }

    // Insert new encoded results
    items.forEach(item => {
      const resultItemId = 'RI-' + Math.random().toString(16).substr(2, 8).toUpperCase();
      rSh.appendRow([
        resultItemId,
        orderId,
        item.order_item_id || '',
        (item.lab_name || '').trim(),
        (item.result_value || '').trim(),
        (item.unit || '').trim(),
        (item.reference_range || '').trim(),
        (item.remarks || '').trim(),
        encodedBy || '',
        now
      ]);
    });

    // Mark all items as encoded in LAB_ORDER_ITEM
    const itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    if (itemSh && itemSh.getLastRow() >= 2) {
      ensureItemCols_(itemSh);
      const iCols = Math.max(itemSh.getLastColumn(), 19);
      const iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, iCols).getValues();
      iRows.forEach((r, i) => {
        if (String(r[1]).trim() === orderId) {
          itemSh.getRange(i + 2, 16).setValue(now); // encoded_at = col 16
        }
      });
    }

    // Auto-advance order status to FOR_RELEASE
    const ordSh = ss.getSheetByName('LAB_ORDER');
    if (ordSh && ordSh.getLastRow() >= 2) {
      const cols = Math.max(ordSh.getLastColumn(), 10);
      const oRows = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, cols).getValues();
      const oIdx = oRows.findIndex(r => String(r[0]).trim() === orderId);
      if (oIdx !== -1) {
        ordSh.getRange(oIdx + 2, 7).setValue('FOR_RELEASE');
        ordSh.getRange(oIdx + 2, 10).setValue(now);
      }
    }

    writeBranchAudit_(ss, encodedBy || '', 'ENCODE_RESULTS', 'ORDER', orderId, null, { items_count: items.length });
    Logger.log('saveOrderEncoding: ' + orderId + ' → ' + items.length + ' items');
    return { success: true, order_id: orderId };
  } catch (e) {
    Logger.log('saveOrderEncoding ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Get encoded results for an order
function getOrderEncoding(branchId, orderId) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Missing params.' };
    const ss = getOrderSS_(branchId);
    const rSh = _getResultItemsSheet_(ss);
    const lr = rSh.getLastRow();
    if (lr < 2) return { success: true, data: [] };

    const data = rSh.getRange(2, 1, lr - 1, Math.max(rSh.getLastColumn(), 10)).getValues()
      .filter(r => r[0] && String(r[1]).trim() === orderId)
      .map(r => ({
        result_item_id: String(r[0]).trim(),
        order_item_id: String(r[2]).trim(),
        lab_name: String(r[3] || '').trim(),
        result_value: String(r[4] || '').trim(),
        unit: String(r[5] || '').trim(),
        reference_range: String(r[6] || '').trim(),
        remarks: String(r[7] || '').trim(),
        encoded_by: String(r[8] || '').trim(),
        encoded_at: r[9] ? new Date(r[9]).toISOString() : ''
      }));

    return { success: true, data };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// Release order — mark all items released_at + order status RELEASED
function releaseOrder(branchId, orderId, releasedBy) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Missing params.' };
    const ss = getOrderSS_(branchId);
    const now = new Date();

    // Mark all items released
    const itemSh = ss.getSheetByName('LAB_ORDER_ITEM');
    if (itemSh && itemSh.getLastRow() >= 2) {
      ensureItemCols_(itemSh);
      const iCols = Math.max(itemSh.getLastColumn(), 19);
      const iRows = itemSh.getRange(2, 1, itemSh.getLastRow() - 1, iCols).getValues();
      iRows.forEach((r, i) => {
        if (String(r[1]).trim() === orderId) {
          itemSh.getRange(i + 2, 17).setValue(now); // released_at = col 17
        }
      });
    }

    // Update order status to RELEASED
    const ordSh = ss.getSheetByName('LAB_ORDER');
    if (ordSh && ordSh.getLastRow() >= 2) {
      const cols = Math.max(ordSh.getLastColumn(), 10);
      const oRows = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, cols).getValues();
      const oIdx = oRows.findIndex(r => String(r[0]).trim() === orderId);
      if (oIdx !== -1) {
        ordSh.getRange(oIdx + 2, 7).setValue('RELEASED');
        ordSh.getRange(oIdx + 2, 10).setValue(now);
      }
    }

    // Auto-update PhilHealth claim status to CLAIMED on release
    const phSh = getPhilhealthClaimsSheet_(ss);
    if (phSh && phSh.getLastRow() >= 2) {
      const phRows = phSh.getRange(2, 1, phSh.getLastRow() - 1, 7).getValues();
      phRows.forEach((r, i) => {
        if (String(r[1]).trim() === orderId) {
          const currentStatus = String(r[6] || 'PENDING').trim();
          if (currentStatus === 'PENDING') {
            phSh.getRange(i + 2, 7).setValue('CLAIMED');
          }
        }
      });
    }

    writeBranchAudit_(ss, releasedBy || '', 'RELEASE_ORDER', 'ORDER', orderId, null, { status: 'RELEASED' });
    Logger.log('releaseOrder: ' + orderId);
    return { success: true };
  } catch (e) {
    Logger.log('releaseOrder ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── ENROLL PATIENT (quick, from order wizard) ──────────────────
function enrollPatientQuick(branchId, payload) {
  var mapped = {
    last_name: payload.last_name || '',
    first_name: payload.first_name || '',
    middle_name: payload.middle_name || '',
    sex: payload.sex || '',
    dob: payload.dob || payload.birthdate || '',
    contact: payload.contact || payload.contact_no || '',
    email: payload.email || '',
    address: payload.address || '',
    philhealth_pin: payload.philhealth_pin || '',
    discount_ids: '',
    is_4ps: payload.is_4ps || 0
  };
  var result = createPatient(branchId, mapped);
  if (result.success) {
    result.last_name = mapped.last_name.trim();
    result.first_name = mapped.first_name.trim();
    result.middle_name = mapped.middle_name.trim();
    result.sex = mapped.sex;
    result.dob = mapped.dob;
    result.contact = mapped.contact;
    result.philhealth_pin = mapped.philhealth_pin;
  }
  return result;
}

// ── SET ORDER FOR RELEASE (from X-Ray checklist) ───────────────
function setOrderForRelease(branchId, orderId, techId) {
  try {
    if (!branchId || !orderId) return { success: false, message: 'Branch and Order ID required.' };
    const ss = getOrderSS_(branchId);
    const ordSh = ss.getSheetByName('LAB_ORDER');
    if (!ordSh || ordSh.getLastRow() < 2) return { success: false, message: 'Order not found.' };

    const rows = ordSh.getRange(2, 1, ordSh.getLastRow() - 1, 10).getValues();
    const oIdx = rows.findIndex(r => String(r[0]).trim() === orderId);
    if (oIdx === -1) return { success: false, message: 'Order not found.' };

    ordSh.getRange(oIdx + 2, 7).setValue('FOR_RELEASE'); // col G = status
    ordSh.getRange(oIdx + 2, 10).setValue(new Date());   // col J = updated_at

    writeBranchAudit_(ss, techId || '', 'SET_FOR_RELEASE', 'ORDER', orderId, null, { status: 'FOR_RELEASE' });
    Logger.log('setOrderForRelease: ' + orderId);
    return { success: true };
  } catch (e) {
    Logger.log('setOrderForRelease ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}