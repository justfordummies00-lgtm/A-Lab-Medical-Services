// ============================================================
//  A-LAB — DiscountsCode.gs
//
//  Discounts sheet:
//    A=discount_id  B=discount_name  C=description
//    D=type  E=value  F=is_active  G=created_at  H=updated_at
//
//  type: 'percentage' | 'fixed'
// ============================================================

function getDiscountSheet_() {
  const sh = getSS_().getSheetByName('Discounts');
  if (!sh) throw new Error('"Discounts" sheet not found.');
  return sh;
}

// ── READ ─────────────────────────────────────────────────────
function getDiscounts() {
  return withCache_('discounts', 'all', 60, _getDiscounts_);
}

function _getDiscounts_() {
  try {
    const sh = getDiscountSheet_();
    const lr = sh.getLastRow();
    const data = lr < 2 ? [] :
      sh.getRange(2, 1, lr-1, 8).getValues()
        .filter(r => r[0] && String(r[0]).trim())
        .map(r => ({
          discount_id:   String(r[0]).trim(),
          discount_name: String(r[1]||'').trim(),
          description:   String(r[2]||'').trim(),
          type:          String(r[3]||'percentage').trim(),
          value:         parseFloat(r[4])||0,
          is_active:     r[5]==1?1:0,
          created_at:    r[6] ? new Date(r[6]).toISOString() : '',
          updated_at:    r[7] ? new Date(r[7]).toISOString() : ''
        }));
    Logger.log('getDiscounts: ' + data.length);
    return { success: true, data };
  } catch(e) {
    Logger.log('getDiscounts ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── CREATE ────────────────────────────────────────────────────
function createDiscount(payload) {
  try {
    if (!payload.discount_name) return { success: false, message: 'Discount name is required.' };
    if (!payload.type)          return { success: false, message: 'Type is required.' };
    if (payload.value == null || isNaN(payload.value) || payload.value < 0)
      return { success: false, message: 'Valid value is required.' };
    if (payload.type === 'percentage' && payload.value > 100)
      return { success: false, message: 'Percentage cannot exceed 100.' };

    const sh  = getDiscountSheet_();
    const lr  = sh.getLastRow();
    const now = new Date();

    // Duplicate name check
    if (lr >= 2) {
      const names = sh.getRange(2, 2, lr-1, 1).getValues().flat().map(v => String(v).trim().toLowerCase());
      if (names.includes(payload.discount_name.trim().toLowerCase()))
        return { success: false, message: `"${payload.discount_name}" already exists.` };
    }

    const discId = 'DISC-' + Math.random().toString(16).substr(2,8).toUpperCase();
    sh.appendRow([
      discId,
      payload.discount_name.trim(),
      (payload.description||'').trim(),
      payload.type,
      payload.value,
      1,
      now, now
    ]);

    cacheBust_('discounts');
    writeAuditLog_('DISC_CREATE', { discount_id: discId, discount_name: payload.discount_name });
    Logger.log('createDiscount: ' + discId);
    return { success: true, discount_id: discId };
  } catch(e) {
    Logger.log('createDiscount ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE ────────────────────────────────────────────────────
function updateDiscount(payload) {
  try {
    if (!payload.discount_id)   return { success: false, message: 'Discount ID is required.' };
    if (!payload.discount_name) return { success: false, message: 'Discount name is required.' };
    if (!payload.type)          return { success: false, message: 'Type is required.' };
    if (payload.value == null || isNaN(payload.value) || payload.value < 0)
      return { success: false, message: 'Valid value is required.' };
    if (payload.type === 'percentage' && payload.value > 100)
      return { success: false, message: 'Percentage cannot exceed 100.' };

    const sh  = getDiscountSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Discount not found.' };

    // Single batch read
    const allRows = sh.getRange(2,1,lr-1,8).getValues();
    const rowIdx  = allRows.findIndex(r => String(r[0]).trim() === payload.discount_id.trim());
    if (rowIdx === -1) return { success: false, message: 'Discount not found.' };

    // Duplicate name check — exclude self
    const nameLower = payload.discount_name.trim().toLowerCase();
    const dup = allRows.some((r, i) =>
      i !== rowIdx && String(r[1]).trim().toLowerCase() === nameLower
    );
    if (dup) return { success: false, message: `"${payload.discount_name}" already exists.` };

    const existRow  = allRows[rowIdx];
    const createdAt = existRow[6] || new Date();
    const isActive  = existRow[5];

    sh.getRange(rowIdx+2, 2, 1, 7).setValues([[
      payload.discount_name.trim(),
      (payload.description||'').trim(),
      payload.type,
      payload.value,
      isActive,
      createdAt,
      new Date()
    ]]);

    cacheBust_('discounts');
    writeAuditLog_('DISC_UPDATE', { discount_id: payload.discount_id, discount_name: payload.discount_name });
    return { success: true };
  } catch(e) {
    Logger.log('updateDiscount ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── DELETE ────────────────────────────────────────────────────
function deleteDiscount(discountId) {
  try {
    if (!discountId) return { success: false, message: 'Discount ID is required.' };

    const sh  = getDiscountSheet_();
    const lr  = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Discount not found.' };

    const ids    = sh.getRange(2, 1, lr-1, 1).getValues().flat().map(String);
    const rowIdx = ids.findIndex(id => id.trim() === discountId.trim());
    if (rowIdx === -1) return { success: false, message: 'Discount not found.' };

    sh.deleteRow(rowIdx + 2);
    cacheBust_('discounts');
    writeAuditLog_('DISC_DELETE', { discount_id: discountId });
    Logger.log('deleteDiscount: ' + discountId);
    return { success: true };
  } catch(e) {
    Logger.log('deleteDiscount ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}