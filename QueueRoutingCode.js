// ============================================================
//  Queue Routing Configuration
//  Stores per-role queue routing rules in master SS.
//
//  Queue_Routing sheet:
//    A=role  B=filter_type  C=filter_values  D=updated_at
//
//  filter_type: 'dept_type' | 'category'
//  filter_values: comma-separated dept_types OR cat_ids
// ============================================================

function getQueueRoutingSheet_() {
  const ss = getSS_();
  let sh = ss.getSheetByName('Queue_Routing');
  if (!sh) {
    sh = ss.insertSheet('Queue_Routing');
    sh.getRange(1, 1, 1, 4).setValues([['role', 'filter_type', 'filter_values', 'updated_at']])
      .setFontWeight('bold').setBackground('#0d9090').setFontColor('#fff');
    sh.setFrozenRows(1);
    const now = new Date();
    sh.getRange(2, 1, 4, 4).setValues([
      ['Medical Technologist',    'dept_type', 'lab',                      now],
      ['Radiologic Technologist', 'dept_type', 'xray',                     now],
      ['Liaison Officer',         'category',  '',                         now],
      ['Receptionist',            'dept_type', 'lab,xray,consultation,others', now]
    ]);
  }
  return sh;
}

function getQueueRoutingConfig() {
  return withCache_('queue_routing', 'all', 120, _getQueueRoutingConfig_);
}

function _getQueueRoutingConfig_() {
  try {
    const sh = getQueueRoutingSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };
    const rows = sh.getRange(2, 1, lr - 1, 4).getValues();
    const data = rows.filter(r => r[0]).map(r => ({
      role:          String(r[0]).trim(),
      filter_type:   String(r[1] || 'dept_type').trim(),
      filter_values: String(r[2] || '').trim()
    }));
    return { success: true, data };
  } catch (e) {
    Logger.log('getQueueRoutingConfig ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

function saveQueueRoutingConfig(rows) {
  try {
    if (!Array.isArray(rows)) return { success: false, message: 'Invalid payload.' };
    const sh = getQueueRoutingSheet_();
    if (sh.getLastRow() > 1)
      sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
    if (!rows.length) return { success: true };
    const now = new Date();
    const values = rows.map(r => [
      String(r.role         || '').trim(),
      String(r.filter_type  || 'dept_type').trim(),
      String(r.filter_values || '').trim(),
      now
    ]);
    sh.getRange(2, 1, values.length, 4).setValues(values);
    cacheBust_('queue_routing');
    writeAuditLog_('QUEUE_ROUTING_SAVE', { rows: rows.length });
    return { success: true };
  } catch (e) {
    Logger.log('saveQueueRoutingConfig ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}
