// ============================================================
//  A-LAB — ReportsCode.gs
//  Income Tracking & Reports
//
//  getBranchIncomeReport(branchId, dateFrom, dateTo)
//    → summary, by_service, by_payment_method, by_day, orders
//
//  getAllBranchesIncomeReport(dateFrom, dateTo)
//    → same shape but aggregated across all branches
// ============================================================

// ── SINGLE BRANCH INCOME REPORT ──────────────────────────────
function getBranchIncomeReport(branchId, dateFrom, dateTo) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };

    const ss = _getReportSS_(branchId);
    if (!ss) return { success: false, message: 'Branch spreadsheet not configured.' };

    const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const to   = dateTo   ? new Date(dateTo   + 'T23:59:59') : null;

    const result = _buildReport_(ss, branchId, from, to);
    Logger.log('getBranchIncomeReport: ' + branchId + ' from=' + dateFrom + ' to=' + dateTo);
    return { success: true, ...result };
  } catch(e) {
    Logger.log('getBranchIncomeReport ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── ALL BRANCHES INCOME REPORT (SA) ──────────────────────────
function getAllBranchesIncomeReport(dateFrom, dateTo) {
  try {
    const ss   = getSS_();
    const brSh = ss.getSheetByName('Branches');
    if (!brSh || brSh.getLastRow() < 2)
      return { success: false, message: 'No branches found.' };

    const branches = brSh.getRange(2, 1, brSh.getLastRow()-1, 8).getValues()
      .filter(r => r[0] && r[7])
      .map(r => ({
        branch_id:   String(r[0]).trim(),
        branch_name: String(r[1]).trim(),
        branch_code: String(r[2]).trim(),
        ss_id:       String(r[7]).trim()
      }));

    const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const to   = dateTo   ? new Date(dateTo   + 'T23:59:59') : null;

    // Aggregate across all branches
    let totalRevenue = 0, totalOrders = 0, totalDiscount = 0, totalPhilhealth = 0, totalPatients = 0;
    const byService     = {};
    const byPayMethod   = {};
    const byDay         = {};
    const byBranch      = [];
    const allOrders     = [];

    for (const br of branches) {
      try {
        const bss    = openSS_(br.ss_id);
        const report = _buildReport_(bss, br.branch_id, from, to);

        totalRevenue    += report.summary.total_revenue;
        totalOrders     += report.summary.total_orders;
        totalDiscount   += report.summary.total_discount;
        totalPhilhealth += report.summary.total_philhealth;
        totalPatients   += report.summary.total_patients || 0;

        byBranch.push({
          branch_id:    br.branch_id,
          branch_name:  br.branch_name,
          branch_code:  br.branch_code,
          revenue:      report.summary.total_revenue,
          orders:       report.summary.total_orders,
          avg:          report.summary.avg_per_order
        });

        // Merge service breakdown
        report.by_service.forEach(s => {
          if (!byService[s.lab_id]) {
            byService[s.lab_id] = { lab_id: s.lab_id, lab_name: s.lab_name,
              dept_name: s.dept_name, qty: 0, gross: 0, discount: 0, net: 0 };
          }
          byService[s.lab_id].qty      += s.qty;
          byService[s.lab_id].gross    += s.gross;
          byService[s.lab_id].discount += s.discount;
          byService[s.lab_id].net      += s.net;
        });

        // Merge payment method
        report.by_payment_method.forEach(p => {
          byPayMethod[p.method] = (byPayMethod[p.method] || 0) + p.amount;
        });

        // Merge by day
        report.by_day.forEach(d => {
          if (!byDay[d.date]) byDay[d.date] = { date: d.date, revenue: 0, orders: 0 };
          byDay[d.date].revenue += d.revenue;
          byDay[d.date].orders  += d.orders;
        });

        // Add branch tag to orders for SA view
        report.orders.forEach(o => { o.branch_name = br.branch_name; allOrders.push(o); });

      } catch(brErr) {
        Logger.log('getAllBranchesIncomeReport: branch ' + br.branch_id + ' error: ' + brErr.message);
      }
    }

    allOrders.sort((a,b) => b.order_date.localeCompare(a.order_date));

    const summary = {
      total_revenue:    totalRevenue,
      total_orders:     totalOrders,
      total_discount:   totalDiscount,
      total_philhealth: totalPhilhealth,
      avg_per_order:    totalOrders > 0 ? totalRevenue / totalOrders : 0,
      total_patients:   totalPatients
    };

    const byServiceArr     = Object.values(byService).sort((a,b) => b.net - a.net);
    const byPayMethodArr   = Object.entries(byPayMethod).map(([method, amount]) => ({ method, amount })).sort((a,b) => b.amount - a.amount);
    const byDayArr         = Object.values(byDay).sort((a,b) => a.date.localeCompare(b.date));

    Logger.log('getAllBranchesIncomeReport: ' + branches.length + ' branches, ' + totalOrders + ' orders');
    return { success: true, summary, by_service: byServiceArr,
      by_payment_method: byPayMethodArr, by_day: byDayArr,
      by_branch: byBranch, orders: allOrders.slice(0, 200) };

  } catch(e) {
    Logger.log('getAllBranchesIncomeReport ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── INTERNAL: build report for one branch SS ─────────────────
function _buildReport_(bss, branchId, from, to) {
  const ordSh  = bss.getSheetByName('LAB_ORDER');
  const itemSh = bss.getSheetByName('LAB_ORDER_ITEM');
  const paySh  = bss.getSheetByName('PAYMENT');
  const patSh  = bss.getSheetByName('Patients');

  // Patient count for this branch
  const totalPatients = patSh && patSh.getLastRow() >= 2 ? patSh.getLastRow() - 1 : 0;

  // ── Build order map (filtered by date + only PAID/IN_PROGRESS/FOR_RELEASE/RELEASED) ──
  const validStatuses = new Set(['PAID','IN_PROGRESS','FOR_RELEASE','RELEASED']);
  const orderMap = {};
  const orderedIds = [];

  if (ordSh && ordSh.getLastRow() >= 2) {
    ordSh.getRange(2, 1, ordSh.getLastRow()-1, 19).getValues()
      .filter(r => r[0] && validStatuses.has(String(r[6]).trim()))
      .forEach(r => {
        const orderDate = r[5] ? new Date(r[5]) : null;
        if (!orderDate) return;
        if (from && orderDate < from) return;
        if (to   && orderDate > to)   return;
        const orderId = String(r[0]).trim();
        const dateStr = orderDate.toISOString().split('T')[0];
        orderMap[orderId] = {
          order_id:       orderId,
          order_no:       String(r[1]||'').trim(),
          patient_name:   String(r[11]||'').trim(),
          status:         String(r[6]).trim(),
          net_amount:     Number(r[14])||0,
          philhealth:     Number(r[18])||0,
          order_date:     dateStr,
          branch_id:      branchId
        };
        orderedIds.push(orderId);
      });
  }

  const orderIds = new Set(orderedIds);

  // ── Build service breakdown from ORDER_ITEM ──
  const serviceMap = {};
  if (itemSh && itemSh.getLastRow() >= 2) {
    const itemCols = Math.max(itemSh.getLastColumn(), 13);
    itemSh.getRange(2, 1, itemSh.getLastRow()-1, itemCols).getValues()
      .filter(r => r[0] && orderIds.has(String(r[1]).trim()))
      .forEach(r => {
        const labId   = String(r[2]||'').trim();
        const labName = String(r[4]||'').trim();
        const deptId  = String(r[3]||'').trim();
        const qty     = Number(r[5])||1;
        const gross   = Number(r[7])||0;
        const disc    = Number(r[9])||0;
        const net     = Number(r[10])||0;
        const key     = labId || labName;
        if (!serviceMap[key]) {
          serviceMap[key] = { lab_id: labId, lab_name: labName,
            dept_name: deptId, qty: 0, gross: 0, discount: 0, net: 0 };
        }
        serviceMap[key].qty      += qty;
        serviceMap[key].gross    += gross;
        serviceMap[key].discount += disc;
        serviceMap[key].net      += net;
      });
  }

  // ── Build payment method breakdown ──
  const payMethodMap = {};
  let totalPaid = 0;
  if (paySh && paySh.getLastRow() >= 2) {
    paySh.getRange(2, 1, paySh.getLastRow()-1, 9).getValues()
      .filter(r => r[0] && orderIds.has(String(r[1]).trim()) && String(r[7]).trim() !== 'VOIDED')
      .forEach(r => {
        const method = String(r[4]||'CASH').trim().toUpperCase();
        const amount = Number(r[3])||0;
        payMethodMap[method] = (payMethodMap[method] || 0) + amount;
        totalPaid += amount;
      });
  }

  // ── Compute totals ──
  const totalOrders     = orderedIds.length;
  const totalRevenue    = Object.values(orderMap).reduce((s,o) => s + o.net_amount, 0);
  const totalDiscount   = Object.values(serviceMap).reduce((s,sv) => s + sv.discount, 0);
  const totalPhilhealth = Object.values(orderMap).reduce((s,o) => s + o.philhealth, 0);
  const avgPerOrder     = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // ── By day ──
  const byDay = {};
  Object.values(orderMap).forEach(o => {
    if (!byDay[o.order_date]) byDay[o.order_date] = { date: o.order_date, revenue: 0, orders: 0 };
    byDay[o.order_date].revenue += o.net_amount;
    byDay[o.order_date].orders++;
  });

  const orders = Object.values(orderMap).sort((a,b) => b.order_date.localeCompare(a.order_date));

  return {
    summary: { total_revenue: totalRevenue, total_orders: totalOrders,
      total_discount: totalDiscount, total_philhealth: totalPhilhealth,
      avg_per_order: avgPerOrder, total_paid: totalPaid,
      total_patients: totalPatients },
    by_service:        Object.values(serviceMap).sort((a,b) => b.net - a.net),
    by_payment_method: Object.entries(payMethodMap).map(([method, amount]) => ({ method, amount })).sort((a,b) => b.amount - a.amount),
    by_day:            Object.values(byDay).sort((a,b) => a.date.localeCompare(b.date)),
    orders:            orders.slice(0, 200)
  };
}

// ── GET BRANCH SS ─────────────────────────────────────────────
function _getReportSS_(branchId) {
  const brSh = getSS_().getSheetByName('Branches');
  if (!brSh || brSh.getLastRow() < 2) return null;
  const rows = brSh.getRange(2, 1, brSh.getLastRow()-1, 8).getValues();
  const br   = rows.find(r => String(r[0]).trim() === branchId);
  if (!br || !br[7]) return null;
  return openSS_(String(br[7]).trim());
}