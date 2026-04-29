// ============================================================
//  A-LAB — DashboardCode.gs
//  Dashboard stats — SA/BA and Tech.
// ============================================================

// ── SA / BA DASHBOARD ────────────────────────────────────────
function getDashboardStats(branchId) {
  try {
    const isSA = !branchId;

    // ── Main SS counts (branches, patients total, lab services) ──
    const ss      = getSS_();
    const brSh    = ss.getSheetByName('Branches');
    const srvSh   = ss.getSheetByName('Lab_Services');
    const pkgSh   = ss.getSheetByName('Packages');
    const discSh  = ss.getSheetByName('Discounts');

    const branchCount = brSh && brSh.getLastRow() >= 2 ? brSh.getLastRow() - 1 : 0;
    const srvCount    = srvSh && srvSh.getLastRow() >= 2
      ? srvSh.getRange(2,1,srvSh.getLastRow()-1,7).getValues().filter(r => r[0] && r[6]==1).length : 0;
    const pkgCount    = pkgSh && pkgSh.getLastRow() >= 2
      ? pkgSh.getRange(2,1,pkgSh.getLastRow()-1,1).getValues().filter(r => r[0]).length : 0;
    const discCount   = discSh && discSh.getLastRow() >= 2
      ? discSh.getRange(2,1,discSh.getLastRow()-1,5).getValues().filter(r => r[0] && String(r[4]).trim() === 'Active').length : 0;


    // ── Branch-level order stats ──
    // Collect all branch SS IDs to query
    const branchIds = [];
    if (brSh && brSh.getLastRow() >= 2) {
      const rows = brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues();
      if (branchId) {
        const row = rows.find(r => String(r[0]).trim() === branchId);
        if (row && row[7]) branchIds.push({ id: String(row[0]).trim(), ssId: String(row[7]).trim(), name: String(row[1]).trim() });
      } else {
        rows.filter(r => r[0] && r[7]).forEach(r => branchIds.push({ id: String(r[0]).trim(), ssId: String(r[7]).trim(), name: String(r[1]).trim() }));
      }
    }

    const today    = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // ── Generate array of Dates for the last 7 days ──
    const weekDates = [];
    const weekLabels = [];
    const weeklyData = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      weekDates.push(d.toISOString().split('T')[0]);
      weekLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    }

    let totalOrders = 0, todayOrders = 0, paidOrders = 0;
    let inProgress = 0, forRelease = 0, released = 0;
    let cancelledOrders = 0, totalRevenue = 0, todayRevenue = 0;
    let totalPatients = 0;
    const recentOrders = [];


    branchIds.forEach(br => {
      try {
        const bss    = openSS_(br.ssId);
        const ordSh  = bss.getSheetByName('LAB_ORDER');
        const paySh  = bss.getSheetByName('PAYMENT');
        const patSh  = bss.getSheetByName('Patients');

        // Patient count
        if (patSh && patSh.getLastRow() >= 2) totalPatients += patSh.getLastRow() - 1;

        if (!ordSh || ordSh.getLastRow() < 2) return;
        const ordRows = ordSh.getRange(2,1,ordSh.getLastRow()-1,15).getValues();

        ordRows.filter(r => r[0]).forEach(r => {
          const status    = String(r[6]||'').trim();
          const orderDate = r[5] ? new Date(r[5]).toISOString().split('T')[0] : '';
          const netAmt    = Number(r[14])||0;
          totalOrders++;
          if (status === 'IN_QUEUE' || status === 'PAID') paidOrders++;
          if (status === 'IN_PROGRESS')  inProgress++;
          if (status === 'FOR_RELEASE')  forRelease++;
          if (status === 'RELEASED')     released++;
          if (status === 'CANCELLED' || status === 'VOID') cancelledOrders++;
          if (orderDate === todayStr)    todayOrders++;
          
          const dayIdx = weekDates.indexOf(orderDate);
          if (dayIdx !== -1) weeklyData[dayIdx]++;

          totalRevenue += netAmt;
          // Recent orders (all, will sort + slice)
          recentOrders.push({
            order_no:     String(r[1]||'').trim(),
            patient_name: String(r[11]||r[3]||'').trim(),
            status:       status,
            net_amount:   netAmt,
            order_date:   orderDate,
            branch_name:  br.name
          });
        });

        // Revenue from PAYMENT sheet (POSTED only)
        if (paySh && paySh.getLastRow() >= 2) {
          paySh.getRange(2,1,paySh.getLastRow()-1,9).getValues()
            .filter(r => r[0] && String(r[7]).trim() === 'POSTED')
            .forEach(r => {
              totalRevenue += 0; // already counted via net_amount
              const paidAt = r[2] ? new Date(r[2]).toISOString().split('T')[0] : '';
              if (paidAt === todayStr) todayRevenue += Number(r[3])||0;
            });
        }
      } catch(e) { Logger.log('getDashboardStats branch error: ' + e.message); }
    });

    // Sort recent orders by date desc, take top 5
    recentOrders.sort((a,b) => b.order_date.localeCompare(a.order_date));
    const recent5 = recentOrders.slice(0, 5);

    // ── Audit Logs (Recent Activity) ──
    const recentActivity = [];
    const auditSh = ss.getSheetByName('Audit Logs');
    if (auditSh && auditSh.getLastRow() >= 2) {
      // Rows are inserted at the top (row 2), so they are naturally descending. Read max 100 to filter.
      const auditRows = auditSh.getRange(2, 1, Math.min(auditSh.getLastRow() - 1, 100), 5).getValues();
      for (const r of auditRows) {
        if (!r[0]) continue;
        let payload = {};
        try { payload = JSON.parse(r[4] || '{}'); } catch(e){}
        
        // Branch Admin sees their branch only + global system events affecting them
        if (branchId && payload.branch_id && payload.branch_id !== branchId) continue;
        
        recentActivity.push({
          date: r[0] ? new Date(r[0]).toISOString() : '',
          action: String(r[1]).trim(),
          user: String(r[2]).trim(),
          payload: payload
        });
        if (recentActivity.length >= 10) break;
      }
    }


    Logger.log('getDashboardStats: ' + totalOrders + ' orders across ' + branchIds.length + ' branches');
    return {
      success: true,
      stats: {
        total_orders:    totalOrders,
        today_orders:    todayOrders,
        paid:            paidOrders,
        in_progress:     inProgress,
        for_release:     forRelease,
        released:        released,
        cancelled:       cancelledOrders,
        today_revenue:   todayRevenue,
        total_patients:  totalPatients,
        branch_count:    branchCount,
        service_count:   srvCount,
        package_count:   pkgCount,
        discount_count:  discCount
      },
      chart: {
        labels: weekLabels,
        data:   weeklyData
      },
      recent_orders: recent5,
      recent_activity: recentActivity
    };
  } catch(e) {
    Logger.log('getDashboardStats ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── TECH DASHBOARD ───────────────────────────────────────────
// techRole: 'Medical Technologist' | 'Radiologic Technologist' | ''
// Filters orders by order_types (lab vs xray) matching the role
function getTechDashboardStats(branchId, techRole) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const ss   = getSS_();
    const brSh = ss.getSheetByName('Branches');
    if (!brSh) return { success: false, message: 'Branches not found.' };

    const rows = brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues();
    const br   = rows.find(r => String(r[0]).trim() === branchId);
    if (!br || !br[7]) return { success: false, message: 'Branch SS not configured.' };

    const bss   = openSS_(String(br[7]).trim());
    const ordSh = bss.getSheetByName('LAB_ORDER');
    const patSh = bss.getSheetByName('Patients');

    const patCount = patSh && patSh.getLastRow() >= 2 ? patSh.getLastRow() - 1 : 0;
    const patMap = {};
    if (patSh && patSh.getLastRow() >= 2) {
      patSh.getRange(2,1,patSh.getLastRow()-1,9).getValues()
        .filter(r => r[0])
        .forEach(r => {
           patMap[String(r[0]).trim()] = { sex: String(r[4]||''), dob: r[5] ? new Date(r[5]).toISOString().split('T')[0] : '', address: String(r[8]||'') };
        });
    }

    if (!ordSh || ordSh.getLastRow() < 2) {
      return { success: true, stats: { open:0, paid:0, in_progress:0, for_release:0, released_today:0, total:0, patients: patCount }, recent_orders: [] };
    }

    // Determine type filter from routing config, falling back to hardcoded role logic
    let typeFilter = null;
    let catFilter  = null;
    try {
      const routingResult = getQueueRoutingConfig();
      if (routingResult.success && techRole) {
        const routingRow = routingResult.data.find(r => r.role === techRole);
        if (routingRow) {
          if (routingRow.filter_type === 'dept_type') {
            typeFilter = routingRow.filter_values || null;
          } else if (routingRow.filter_type === 'category') {
            typeFilter = 'lab';
            catFilter = routingRow.filter_values
              ? routingRow.filter_values.split(',').map(c => c.trim()).filter(Boolean)
              : [];
          }
        } else {
          // Fallback: hardcoded
          const isRad = techRole.toLowerCase().includes('radiolog');
          typeFilter = isRad ? 'xray' : 'lab';
        }
      }
    } catch(e) {
      // Fallback on error
      const isRad = techRole && techRole.toLowerCase().includes('radiolog');
      typeFilter = isRad ? 'xray' : (techRole ? 'lab' : null);
    }

    const today = new Date().toISOString().split('T')[0];
    let open=0, paid=0, inProg=0, forRel=0, relToday=0, total=0;
    const recentOrders = [];

    const oCols = Math.max(ordSh.getLastColumn(), 24);
    ordSh.getRange(2,1,ordSh.getLastRow()-1,oCols).getValues()
      .filter(r => r[0])
      .forEach(r => {
        const orderTypes = String(r[21]||'lab').toLowerCase();
        const types = orderTypes.split(',').map(t => t.trim());
        if (typeFilter && types.indexOf(typeFilter) === -1) return;
        if (catFilter && catFilter.length > 0) {
          const orderCats = String(r[22]||'').split(',').map(c => c.trim()).filter(Boolean);
          if (!catFilter.some(c => orderCats.indexOf(c) !== -1)) return;
        }

        const status    = String(r[6]||'').trim();
        const orderDate = r[5] ? new Date(r[5]).toISOString().split('T')[0] : '';
        total++;
        if (status === 'OPEN')         open++;
        if (status === 'IN_QUEUE' || status === 'PAID') paid++;
        if (status === 'IN_PROGRESS')  inProg++;
        if (status === 'FOR_RELEASE')  forRel++;
        if (status === 'RELEASED' && orderDate === today) relToday++;
        const pId = String(r[3]||'').trim();
        const pInfo = patMap[pId] || { sex:'', dob:'', address:'' };

        recentOrders.push({
          order_id:      String(r[0]||'').trim(),
          order_no:      String(r[1]||'').trim(),
          patient_id:    pId,
          patient_name:  String(r[11]||r[3]||'').trim(),
          patient_sex:   pInfo.sex,
          patient_dob:   pInfo.dob,
          patient_address: pInfo.address,
          status:        status,
          payment_status: String(r[23]||'UNPAID').trim() || 'UNPAID',
          net_amount:    Number(r[14])||0,
          order_date:    orderDate,
          order_types:   orderTypes
        });
      });

    recentOrders.sort((a,b) => b.order_date.localeCompare(a.order_date));

    return {
      success: true,
      stats: { open, paid, in_progress: inProg, for_release: forRel, released_today: relToday, total, patients: patCount },
      recent_orders: recentOrders.slice(0, 8),
      tech_role:   techRole || '',
      type_filter: typeFilter || 'all'
    };
  } catch(e) {
    Logger.log('getTechDashboardStats ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}