// ============================================================
//  A-LAB — InitializeDatabase.gs
//
//  Run initializeMainDatabase() ONCE on the MAIN spreadsheet
//  to create all required sheets with correct headers.
//
//  Run initializeBranchDatabase(spreadsheetId) ONCE on a
//  BRANCH spreadsheet to create all required branch sheets.
//
//  Both functions are SAFE to re-run — they skip sheets that
//  already exist and only create missing ones.
// ============================================================

// ── STYLE HELPER ─────────────────────────────────────────────
function styleHeader_(sh, cols, bg) {
  const color = bg || '#0d9090';
  sh.getRange(1, 1, 1, cols.length)
    .setValues([cols])
    .setFontWeight('bold')
    .setBackground(color)
    .setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

// ── SAFE getOrCreate helper ───────────────────────────────────
function ensureSheet_(ss, name, headers, bg) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    styleHeader_(sh, headers, bg);
    Logger.log('initDB: Created sheet → ' + name);
    return { sh, created: true };
  }
  Logger.log('initDB: Sheet already exists → ' + name);
  return { sh, created: false };
}

// ============================================================
//  MAIN SPREADSHEET INITIALIZATION
//  Run this on the Apps Script container spreadsheet.
// ============================================================
function initializeMainDatabase() {
  try {
    const ss   = getSS_();
    const logs = [];

    // ── 1. Super Admins ───────────────────────────────────────
    // A=username  B=email  C=password  D=role  E=status  F=photo_url
    const { created: c1 } = ensureSheet_(ss, 'Super Admins',
      ['username', 'email', 'password', 'role', 'status', 'photo_url'],
      '#1e3a5f');
    logs.push((c1 ? '✅ Created' : '⏭ Skipped') + ': Super Admins');

    // Seed default Super Admin if sheet was just created
    if (c1) {
      const saSh = ss.getSheetByName('Super Admins');
      saSh.appendRow(['admin', 'admin@alab.com', 'Admin@123', 'Super Admin', 'Active', '']);
      logs.push('   → Seeded default Super Admin (username: admin, password: Admin@123)');
    }

    // ── 2. Admins (Branch Admins) ─────────────────────────────
    // A=admin_id  B=name  C=username  D=email  E=password
    // F=role  G=status  H=branch_ids  I=created_at  J=updated_at  K=photo_url
    const { created: c2 } = ensureSheet_(ss, 'Admins',
      ['admin_id', 'name', 'username', 'email', 'password',
       'role', 'status', 'branch_ids', 'created_at', 'updated_at', 'photo_url'],
      '#0d9090');
    logs.push((c2 ? '✅ Created' : '⏭ Skipped') + ': Admins');

    // ── 3. Branches ───────────────────────────────────────────
    // A=branch_id  B=branch_name  C=branch_code  D=address
    // E=contact  F=email  G=status  H=spreadsheet_id  I=spreadsheet_url
    // J=created_at  K=updated_at
    const { created: c3 } = ensureSheet_(ss, 'Branches',
      ['branch_id', 'branch_name', 'branch_code', 'address',
       'contact', 'email', 'status', 'spreadsheet_id', 'spreadsheet_url',
       'created_at', 'updated_at'],
      '#0d9090');
    logs.push((c3 ? '✅ Created' : '⏭ Skipped') + ': Branches');

    // ── 4. Departments ────────────────────────────────────────
    // A=dept_id  B=department_name  C=is_active
    // D=created_at  E=updated_at  F=department_type (lab|xray|consultation)
    const { created: c4 } = ensureSheet_(ss, 'Departments',
      ['dept_id', 'department_name', 'is_active', 'created_at', 'updated_at', 'department_type'],
      '#0060b0');
    logs.push((c4 ? '✅ Created' : '⏭ Skipped') + ': Departments');

    // ── 5. Categories ─────────────────────────────────────────
    // A=cat_id  B=dept_id  C=category_name  D=is_active
    // E=created_at  F=updated_at
    const { created: c5 } = ensureSheet_(ss, 'Categories',
      ['cat_id', 'dept_id', 'category_name', 'is_active', 'created_at', 'updated_at'],
      '#0060b0');
    logs.push((c5 ? '✅ Created' : '⏭ Skipped') + ': Categories');

    // ── 6. Lab_Services ──────────────────────────────────────
    // A=serv_id  B=cat_id  C=serv_name  D=default_fee
    // E=specimen_type  F=is_philhealth_covered  G=is_active
    // H=created_at  I=updated_at  J=service_type  K=is_consultation
    const { created: c6 } = ensureSheet_(ss, 'Lab_Services',
      ['serv_id', 'cat_id', 'serv_name', 'default_fee',
       'specimen_type', 'is_philhealth_covered', 'is_active',
       'created_at', 'updated_at', 'service_type', 'is_consultation'],
      '#0060b0');
    logs.push((c6 ? '✅ Created' : '⏭ Skipped') + ': Lab_Services');

    // ── 7. Branch_Serv_Status ─────────────────────────────────
    // A=branch_id  B=serv_id  C=is_active  D=updated_at
    const { created: c7 } = ensureSheet_(ss, 'Branch_Serv_Status',
      ['branch_id', 'serv_id', 'is_active', 'updated_at'],
      '#0060b0');
    logs.push((c7 ? '✅ Created' : '⏭ Skipped') + ': Branch_Serv_Status');

    // ── 8. Branch_Dept_Status ─────────────────────────────────
    // A=branch_id  B=dept_id  C=is_active  D=updated_at
    const { created: c8 } = ensureSheet_(ss, 'Branch_Dept_Status',
      ['branch_id', 'dept_id', 'is_active', 'updated_at'],
      '#0d9090');
    logs.push((c8 ? '✅ Created' : '⏭ Skipped') + ': Branch_Dept_Status');

    // ── 9. Branch_Cat_Status ──────────────────────────────────
    // A=branch_id  B=cat_id  C=is_active  D=updated_at
    const { created: c9 } = ensureSheet_(ss, 'Branch_Cat_Status',
      ['branch_id', 'cat_id', 'is_active', 'updated_at'],
      '#0d9090');
    logs.push((c9 ? '✅ Created' : '⏭ Skipped') + ': Branch_Cat_Status');

    // ── 10. Packages ──────────────────────────────────────────
    // A=package_id  B=package_name  C=description
    // D=default_fee  E=is_active  F=created_at  G=updated_at
    const { created: c10 } = ensureSheet_(ss, 'Packages',
      ['package_id', 'package_name', 'description',
       'default_fee', 'is_active', 'created_at', 'updated_at'],
      '#6d28d9');
    logs.push((c10 ? '✅ Created' : '⏭ Skipped') + ': Packages');

    // ── 11. Package_Items ─────────────────────────────────────
    // A=item_id  B=package_id  C=serv_id  D=created_at
    const { created: c11 } = ensureSheet_(ss, 'Package_Items',
      ['item_id', 'package_id', 'serv_id', 'created_at'],
      '#6d28d9');
    logs.push((c11 ? '✅ Created' : '⏭ Skipped') + ': Package_Items');

    // ── 12. Branch_Pkg_Status ─────────────────────────────────
    // A=branch_id  B=package_id  C=is_active  D=updated_at
    const { created: c12 } = ensureSheet_(ss, 'Branch_Pkg_Status',
      ['branch_id', 'package_id', 'is_active', 'updated_at'],
      '#6d28d9');
    logs.push((c12 ? '✅ Created' : '⏭ Skipped') + ': Branch_Pkg_Status');

    // ── 13. Branch_Packages (branch-specific packages) ────────
    // A=bp_id  B=branch_id  C=package_name  D=description
    // E=default_fee  F=is_active  G=created_at  H=updated_at
    const { created: c13 } = ensureSheet_(ss, 'Branch_Packages',
      ['bp_id', 'branch_id', 'package_name', 'description',
       'default_fee', 'is_active', 'created_at', 'updated_at'],
      '#6d28d9');
    logs.push((c13 ? '✅ Created' : '⏭ Skipped') + ': Branch_Packages');

    // ── 14. Branch_Pkg_Items ──────────────────────────────────
    // A=item_id  B=bp_id  C=serv_id  D=created_at
    const { created: c14 } = ensureSheet_(ss, 'Branch_Pkg_Items',
      ['item_id', 'bp_id', 'serv_id', 'created_at'],
      '#6d28d9');
    logs.push((c14 ? '✅ Created' : '⏭ Skipped') + ': Branch_Pkg_Items');

    // ── 15. Pkg_BA_Approvals (Branch Admin package approvals) ─
    // A=approval_id  B=bp_id  C=branch_id  D=requested_by
    // E=status  F=requested_at  G=reviewed_by  H=reviewed_at  I=remarks
    const { created: c16 } = ensureSheet_(ss, 'Pkg_BA_Approvals',
      ['approval_id', 'bp_id', 'branch_id', 'requested_by',
       'status', 'requested_at', 'reviewed_by', 'reviewed_at', 'remarks'],
      '#6d28d9');
    logs.push((c16 ? '✅ Created' : '⏭ Skipped') + ': Pkg_BA_Approvals');

    // ── 17. Discounts ─────────────────────────────────────────
    // A=discount_id  B=discount_name  C=description
    // D=type (percentage|fixed)  E=value  F=is_active
    const { created: c17 } = ensureSheet_(ss, 'Discounts',
      ['discount_id', 'discount_name', 'description', 'type', 'value', 'is_active'],
      '#b45309');
    logs.push((c17 ? '✅ Created' : '⏭ Skipped') + ': Discounts');

    // ── 17b. Patient_ID_Types ─────────────────────────────────
    // A=id_type_id  B=name  C=description  D=is_builtin
    // E=is_archived  F=created_at  G=updated_at
    //
    // Catalog of identification cards / numbers tracked per
    // patient.  Three builtins (PhilHealth PIN, Senior Citizen ID,
    // PWD ID) are seeded below; admins can add more via the
    // "ID Types" module.  Discounts can later require an entry
    // here to be present on a patient before the discount can be
    // applied to an order item.
    const { created: c17b } = ensureSheet_(ss, 'Patient_ID_Types',
      ['id_type_id', 'name', 'description', 'is_builtin',
       'is_archived', 'created_at', 'updated_at'],
      '#b45309');
    logs.push((c17b ? '✅ Created' : '⏭ Skipped') + ': Patient_ID_Types');
    if (typeof seedBuiltinIdTypes_ === 'function') {
      const seeded = seedBuiltinIdTypes_();
      if (seeded > 0) logs.push('   → Seeded ' + seeded + ' builtin ID type(s).');
    }

    // ── 18. Doctors ───────────────────────────────────────────
    // A=doctor_id  B=last_name  C=first_name  D=middle_name  E=suffix
    // F=specialization  G=prc_no  H=ptr_no  I=username  J=email
    // K=password  L=branch_ids  M=status  N=created_at  O=photo_url
    const { created: c18 } = ensureSheet_(ss, 'Doctors',
      ['doctor_id', 'last_name', 'first_name', 'middle_name', 'suffix',
       'specialization', 'prc_no', 'ptr_no', 'username', 'email',
       'password', 'branch_ids', 'status', 'created_at', 'photo_url'],
      '#065f46');
    logs.push((c18 ? '✅ Created' : '⏭ Skipped') + ': Doctors');

    // ── 19. Technologists ─────────────────────────────────────
    // A=tech_id  B=last_name  C=first_name  D=middle_name  E=suffix
    // F=branch_ids  G=email  H=username  I=password  J=role
    // K=status  L=created_at  M=photo_url  N=assigned_deps
    const { created: c19 } = ensureSheet_(ss, 'Technologists',
      ['tech_id', 'last_name', 'first_name', 'middle_name', 'suffix',
       'branch_ids', 'email', 'username', 'password', 'role',
       'status', 'created_at', 'photo_url', 'assigned_deps'],
      '#065f46');
    logs.push((c19 ? '✅ Created' : '⏭ Skipped') + ': Technologists');

    // ── 20. Audit Logs ────────────────────────────────────────
    // A=DateTime  B=Action  C=User  D=Role  E=PayloadJSON
    const { created: c21 } = ensureSheet_(ss, 'Audit Logs',
      ['DateTime', 'Action', 'User', 'Role', 'PayloadJSON'],
      '#475569');
    logs.push((c21 ? '✅ Created' : '⏭ Skipped') + ': Audit Logs');

    const summary = logs.join('\n');
    Logger.log('initializeMainDatabase COMPLETE:\n' + summary);
    return { success: true, message: '✅ Main database initialized!\n\n' + summary };

  } catch (e) {
    Logger.log('initializeMainDatabase ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ============================================================
//  BRANCH SPREADSHEET INITIALIZATION
//  Pass a spreadsheet ID, or leave blank to use active SS.
//  Called automatically by createBranch() — but can also be
//  run manually on an existing or new branch spreadsheet.
// ============================================================
function initializeBranchDatabase(spreadsheetId) {
  try {
    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    const logs = [];
    const hdr  = (sh, cols) => {
      sh.getRange(1, 1, 1, cols.length)
        .setValues([cols])
        .setFontWeight('bold')
        .setBackground('#0d9090')
        .setFontColor('#ffffff');
      sh.setFrozenRows(1);
    };

    // ── 1. LAB_ORDER ──────────────────────────────────────────
    // A=order_id  B=order_no  C=branch_id  D=patient_id  E=doctor_id
    // F=order_date  G=status  H=created_by  I=created_at  J=updated_at  K=notes
    // L=patient_name  M=doctor_name  N=created_by_name  O=net_amount
    // P=doctor_id_2  Q=doctor_name_2  R=philhealth_pin  S=philhealth_claim
    // T=transferred_to_branch  U=transfer_status  V=order_types
    let sh1 = ss.getSheetByName('LAB_ORDER');
    if (!sh1) {
      sh1 = ss.getSheets()[0]; // rename first default sheet
      sh1.setName('LAB_ORDER');
      sh1.setTabColor('#0d9090');
    }
    hdr(sh1, ['order_id', 'order_no', 'branch_id', 'patient_id', 'doctor_id',
      'order_date', 'status', 'created_by', 'created_at', 'updated_at', 'notes',
      'patient_name', 'doctor_name', 'created_by_name', 'net_amount',
      'doctor_id_2', 'doctor_name_2', 'philhealth_pin', 'philhealth_claim',
      'transferred_to_branch', 'transfer_status', 'order_types']);
    logs.push('✅ LAB_ORDER');

    // ── 2. LAB_ORDER_ITEM ─────────────────────────────────────
    // A=order_item_id  B=order_id  C=lab_id  D=dept_id  E=lab_name
    // F=qty  G=unit_fee  H=line_gross  I=discount_id  J=discount_amount  K=line_net
    // L=tat_due_at  M=status
    // N=extracted_at  O=processed_at  P=encoded_at  Q=released_at
    // R=collected_at  S=submitted_at
    const { created: ci2 } = ensureSheet_(ss, 'LAB_ORDER_ITEM',
      ['order_item_id', 'order_id', 'lab_id', 'dept_id', 'lab_name',
       'qty', 'unit_fee', 'line_gross', 'discount_id', 'discount_amount', 'line_net',
       'tat_due_at', 'status',
       'extracted_at', 'processed_at', 'encoded_at', 'released_at',
       'collected_at', 'submitted_at']);
    logs.push((ci2 ? '✅ Created' : '⏭ Skipped') + ': LAB_ORDER_ITEM');

    // ── 3. PAYMENT ────────────────────────────────────────────
    // A=payment_id  B=order_id  C=paid_at  D=amount  E=method
    // F=reference_no  G=received_by  H=status  I=remarks  J=acknowledge_no
    const { created: ci3 } = ensureSheet_(ss, 'PAYMENT',
      ['payment_id', 'order_id', 'paid_at', 'amount', 'method',
       'reference_no', 'received_by', 'status', 'remarks', 'acknowledge_no']);
    logs.push((ci3 ? '✅ Created' : '⏭ Skipped') + ': PAYMENT');

    // ── 4. RESULT ─────────────────────────────────────────────
    // A=result_id  B=order_id  C=branch_id  D=patient_id
    // E=result_file_id  F=drive_url  G=uploaded_by  H=uploaded_at  I=notes
    const { created: ci4 } = ensureSheet_(ss, 'RESULT',
      ['result_id', 'order_id', 'branch_id', 'patient_id',
       'result_file_id', 'drive_url', 'uploaded_by', 'uploaded_at', 'notes']);
    logs.push((ci4 ? '✅ Created' : '⏭ Skipped') + ': RESULT');

    // ── 5. Patients ───────────────────────────────────────────
    // A=patient_id  B=last_name  C=first_name  D=middle_name
    // E=sex  F=dob  G=contact  H=email  I=address
    // J=philhealth_pin  K=discount_ids  L=created_at  M=updated_at
    const { created: ci5, sh: patSh } = ensureSheet_(ss, 'Patients',
      ['patient_id', 'last_name', 'first_name', 'middle_name',
       'sex', 'dob', 'contact', 'email', 'address',
       'philhealth_pin', 'discount_ids', 'created_at', 'updated_at']);
    if (ci5) {
      patSh.getRange(2, 6, 1000, 1).setNumberFormat('yyyy-mm-dd');
      patSh.getRange(2, 12, 1000, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    }
    logs.push((ci5 ? '✅ Created' : '⏭ Skipped') + ': Patients');

    // ── 6. Patient_Access_Grants ──────────────────────────────
    // A=patient_id  B=requesting_branch_id  C=home_branch_id
    // D=granted_by  E=granted_at  F=is_active
    const { created: ci6 } = ensureSheet_(ss, 'Patient_Access_Grants',
      ['patient_id', 'requesting_branch_id', 'home_branch_id',
       'granted_by', 'granted_at', 'is_active']);
    logs.push((ci6 ? '✅ Created' : '⏭ Skipped') + ': Patient_Access_Grants');

    // ── 6b. Patient_IDs ───────────────────────────────────────
    // A=record_id  B=patient_id  C=id_type_id  D=id_value
    // E=created_at  F=updated_at  G=is_archived
    //
    // Stores per-patient IDs for non-builtin ID types defined on
    // the global Patient_ID_Types sheet (Solo Parent ID, employee
    // ID, etc.).  The three builtin types — PhilHealth PIN,
    // Senior Citizen ID, PWD ID — keep using the existing fixed
    // Patients columns 10/17/18 so legacy reads stay intact.
    const { created: ci6b } = ensureSheet_(ss, 'Patient_IDs',
      ['record_id', 'patient_id', 'id_type_id', 'id_value',
       'created_at', 'updated_at', 'is_archived']);
    logs.push((ci6b ? '✅ Created' : '⏭ Skipped') + ': Patient_IDs');

    // ── 7. PHILHEALTH_CLAIMS ──────────────────────────────────
    // A=claim_id  B=order_id  C=patient_id  D=philhealth_pin
    // E=amount_claimed  F=year  G=status  H=filed_at  I=remarks
    const { created: ci7 } = ensureSheet_(ss, 'PHILHEALTH_CLAIMS',
      ['claim_id', 'order_id', 'patient_id', 'philhealth_pin',
       'amount_claimed', 'year', 'status', 'filed_at', 'remarks']);
    logs.push((ci7 ? '✅ Created' : '⏭ Skipped') + ': PHILHEALTH_CLAIMS');

    // ── 8. PHILHEALTH_LEDGER ──────────────────────────────────
    // A=ledger_id  B=patient_id  C=philhealth_pin  D=year
    // E=total_claimed  F=last_updated
    const { created: ci8 } = ensureSheet_(ss, 'PHILHEALTH_LEDGER',
      ['ledger_id', 'patient_id', 'philhealth_pin', 'year',
       'total_claimed', 'last_updated']);
    logs.push((ci8 ? '✅ Created' : '⏭ Skipped') + ': PHILHEALTH_LEDGER');

    // ── 9. AUDIT_LOG ──────────────────────────────────────────
    // A=audit_id  B=timestamp  C=actor_id  D=action
    // E=entity_type  F=entity_id  G=before_json  H=after_json
    const { created: ci9 } = ensureSheet_(ss, 'AUDIT_LOG',
      ['audit_id', 'timestamp', 'actor_id', 'action',
       'entity_type', 'entity_id', 'before_json', 'after_json']);
    logs.push((ci9 ? '✅ Created' : '⏭ Skipped') + ': AUDIT_LOG');

    // ── 10. Settings (order sequence counter) ─────────────────
    // A=key  B=value
    let settingsSh = ss.getSheetByName('Settings');
    if (!settingsSh) {
      settingsSh = ss.insertSheet('Settings');
      settingsSh.getRange(1, 1, 2, 2).setValues([['key', 'value'], ['order_seq', '0']]);
      settingsSh.getRange(1, 1, 1, 2)
        .setFontWeight('bold')
        .setBackground('#475569')
        .setFontColor('#ffffff');
      settingsSh.setFrozenRows(1);
      logs.push('✅ Created: Settings');
    } else {
      logs.push('⏭ Skipped: Settings');
    }

    const summary = logs.join('\n');
    Logger.log('initializeBranchDatabase COMPLETE:\n' + summary);
    return { success: true, message: '✅ Branch database initialized!\n\n' + summary };

  } catch (e) {
    Logger.log('initializeBranchDatabase ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ============================================================
//  FULL SYSTEM INIT — Run this for a completely fresh start.
//  1. Initializes the main spreadsheet (runs on active SS)
//  2. Then prompts you to run initializeBranchDatabase('SS_ID')
//     for each branch spreadsheet you create.
// ============================================================
function initializeFullSystem() {
  const result = initializeMainDatabase();
  Logger.log('=== FULL SYSTEM INIT ===');
  Logger.log(result.message);
  Logger.log('');
  Logger.log('NEXT STEPS:');
  Logger.log('1. Go to Branches module and create your first branch.');
  Logger.log('   → Each branch auto-creates its own spreadsheet.');
  Logger.log('   → If you have an EXISTING branch spreadsheet, run:');
  Logger.log('     initializeBranchDatabase("YOUR_SPREADSHEET_ID")');
  Logger.log('2. Go to Departments and create your lab/xray departments.');
  Logger.log('3. Go to Lab Services and add your services.');
  Logger.log('4. Log in as admin / Admin@123 and change your password.');
  return result;
}
