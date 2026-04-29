// ============================================================
//  A-LAB LABORATORY SYSTEM — Code.gs
//  Entry point + shared helpers only.
//  Module-specific backend logic lives in separate .gs files:
//    BranchesCode.gs, AdminsCode.gs, DepartmentsCode.gs,
//    LabServicesCode.gs, PackagesCode.gs, DiscountsCode.gs,
//    DoctorsCode.gs
// ============================================================

// ── INCLUDE HELPER ──────────────────────────────────────────
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── ACTIVE SPREADSHEET ──────────────────────────────────────
function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ── WEB APP ENTRY POINT ─────────────────────────────────────
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('A-Lab — Laboratory System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// ── AUTHENTICATION ───────────────────────────────────────────
function loginAdmin(usernameOrEmail, password) {
  const staffResult = loginStaff_(usernameOrEmail, password);
  if (staffResult.success) return staffResult;
  const doctorResult = loginDoctor_(usernameOrEmail, password);
  if (doctorResult.success) return doctorResult;
  return loginTechnologist_(usernameOrEmail, password);
}

// Backward-compat alias
function loginSuperAdmin(usernameOrEmail, password) {
  return loginAdmin(usernameOrEmail, password);
}

// ── DOCTOR LOGIN ─────────────────────────────────────────────
// Doctors sheet columns:
//   A=doctor_id  B=last_name  C=first_name  I=username
//   J=email  K=password  L=branch_ids
function loginDoctor_(usernameOrEmail, password) {
  try {
    const input = (usernameOrEmail || '').toString().trim().toLowerCase();
    const pass  = (password || '').toString().trim();

    const sh = getSS_().getSheetByName('Doctors');
    if (!sh) return { success: false, message: 'Invalid username/email or password.' };

    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Invalid username/email or password.' };

    const rows = sh.getRange(2, 1, lr-1, 15).getValues();
    for (const row of rows) {
      const doctorId  = String(row[0]  || '').trim();
      const lastName  = String(row[1]  || '').trim();
      const firstName = String(row[2]  || '').trim();
      const username  = String(row[8]  || '').trim();
      const email     = String(row[9]  || '').trim().toLowerCase();
      const rowPass   = String(row[10] || '').trim();
      const branchIds = String(row[11] || '').trim();
      const photoUrl  = String(row[14] || '').trim();

      if (!doctorId) continue;
      if ((username.toLowerCase() === input || email === input) && rowPass === pass) {
        Logger.log('loginDoctor_: match — ' + username);
        return {
          success:    true,
          admin_id:   doctorId,
          name:       'Dr. ' + lastName + ', ' + firstName,
          username:   username,
          email:      email,
          role:       'Doctor',
          branch_ids: branchIds,
          photo_url:  photoUrl
        };
      }
    }

    return { success: false, message: 'Invalid username/email or password.' };
  } catch(e) {
    Logger.log('loginDoctor_ ERROR: ' + e.message);
    return { success: false, message: 'Invalid username/email or password.' };
  }
}

// ── TECHNOLOGIST LOGIN ───────────────────────────────────────
// Technologists sheet:
//   A=tech_id  E=suffix  F=branch_ids  G=email  H=username  I=password  J=role  M=photo_url
function loginTechnologist_(usernameOrEmail, password) {
  try {
    const input = (usernameOrEmail || '').toString().trim().toLowerCase();
    const pass  = (password || '').toString().trim();

    const sh = getSS_().getSheetByName('Technologists');
    if (!sh) return { success: false, message: 'Invalid username/email or password.' };

    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Invalid username/email or password.' };

    const rows = sh.getRange(2, 1, lr-1, 13).getValues();
    for (const row of rows) {
      const techId    = String(row[0]  || '').trim();
      const lastName  = String(row[1]  || '').trim();
      const firstName = String(row[2]  || '').trim();
      const branchIds = String(row[5]  || '').trim();
      const email     = String(row[6]  || '').trim().toLowerCase();
      const username  = String(row[7]  || '').trim();
      const rowPass   = String(row[8]  || '').trim();
      const techRole  = String(row[9]  || 'Medical Technologist').trim();
      const photoUrl  = String(row[12] || '').trim();

      if (!techId) continue;
      if ((username.toLowerCase() === input || email === input) && rowPass === pass) {
        Logger.log('loginTechnologist_: match — ' + username + ' role=' + techRole);
        // role col J stores actual sub-role:
        //   'Medical Technologist' | 'Receptionist' | 'Radiologic Technologist' | 'Liaison Officer'
        // We return APP role as:
        //   'Receptionist'     for Receptionist
        //   'Liaison Officer'  for Liaison Officer
        //   'Technologist'     for all others (MedTech, Senior, Supervisor, RadTech, etc.)
        const isReceptionist = techRole === 'Receptionist';
        const isLiaison      = techRole === 'Liaison Officer';
        const appRole = isReceptionist ? 'Receptionist'
                      : isLiaison      ? 'Liaison Officer'
                      : 'Technologist';
        return {
          success:    true,
          admin_id:   techId,
          name:       lastName + ', ' + firstName,
          username:   username,
          email:      email,
          role:       appRole,
          tech_role:  techRole,
          branch_ids: branchIds,
          photo_url:  photoUrl
        };
      }
    }
    return { success: false, message: 'Invalid username/email or password.' };
  } catch(e) {
    Logger.log('loginTechnologist_ ERROR: ' + e.message);
    return { success: false, message: 'Invalid username/email or password.' };
  }
}

// ── UPLOAD PROFILE PHOTO ─────────────────────────────────────
function uploadProfilePhoto(base64Data, mimeType, userId, role) {
  try {
    if (!base64Data) return { success: false, message: 'No image data.' };

    const folderName = 'A-Lab Profile Photos';
    const rootFolder = DriveApp.getRootFolder();
    let folder;
    const folders = rootFolder.getFoldersByName(folderName);
    if (folders.hasNext()) { folder = folders.next(); }
    else                   { folder = rootFolder.createFolder(folderName); }

    // Delete old photo for this user
    const ext  = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const name = 'avatar_' + userId + ext;
    const old  = folder.getFilesByName(name);
    while (old.hasNext()) { old.next().setTrashed(true); }

    // Save new file
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, name);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w200';

    // Write URL back to the user's sheet row
    savePhotoUrlToSheet_(userId, role, url);

    Logger.log('uploadProfilePhoto: ' + userId + ' → ' + url);
    return { success: true, url };
  } catch(e) {
    Logger.log('uploadProfilePhoto ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

function savePhotoUrlToSheet_(userId, role, url) {
  try {
    const ss = getSS_(); // single call
    const sheetMap = {
      'Super Admin':  { name: 'Super Admins', col: 6 },
      'Branch Admin': { name: 'Admins',       col: 11 },
      'Doctor':       { name: 'Doctors',      col: 15 },
      'Technologist': { name: 'Technologists',col: 13 },
      'Receptionist':    { name: 'Technologists',col: 13 },  // same sheet as Tech
      'Liaison Officer': { name: 'Technologists',col: 13 }   // same sheet as Tech
    };
    const cfg = sheetMap[role];
    if (!cfg) return;
    const sh = ss.getSheetByName(cfg.name);
    if (!sh || sh.getLastRow() < 2) return;
    const lr  = sh.getLastRow();
    const ids = sh.getRange(2,1,lr-1,1).getValues().flat().map(String);
    const lookupId = role === 'Super Admin'
      ? userId.replace(/^SA-/,'').toLowerCase()
      : userId;
    const idx = ids.findIndex(u =>
      role === 'Super Admin'
        ? u.trim().replace(/\W/g,'').toUpperCase() === lookupId.replace(/\W/g,'').toUpperCase()
        : u.trim() === lookupId
    );
    if (idx !== -1) sh.getRange(idx+2, cfg.col).setValue(url);
  } catch(e) { Logger.log('savePhotoUrlToSheet_ ERROR: ' + e.message); }
}

// ── TECH SIGNATURE / CREDENTIALS ────────────────────────────

// Returns name, credentials (col N), and signature_url (col O) for a technologist
function getTechInfo(techId) {
  try {
    if (!techId) return { success: false, message: 'No tech ID.' };
    const sh = getSS_().getSheetByName('Technologists');
    if (!sh || sh.getLastRow() < 2) return { success: false, message: 'Sheet not found.' };
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 15).getValues();
    const row = rows.find(r => String(r[0]).trim() === techId);
    if (!row) return { success: false, message: 'Technologist not found.' };
    return {
      success:       true,
      tech_id:       String(row[0]).trim(),
      name:          (String(row[1]).trim() + ', ' + String(row[2]).trim()).replace(/^,\s*|,\s*$/g, ''),
      tech_role:     String(row[9] || '').trim(),
      credentials:   String(row[13] || '').trim(),
      signature_url: String(row[14] || '').trim(),
      license_no:    String(row[15] || '').trim()
    };
  } catch(e) {
    Logger.log('getTechInfo ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Saves the technologist's own credentials text (col N = index 14)
function saveTechCredentials(techId, credentials) {
  try {
    if (!techId) return { success: false, message: 'Tech ID required.' };
    const sh = getSS_().getSheetByName('Technologists');
    if (!sh || sh.getLastRow() < 2) return { success: false, message: 'Sheet not found.' };
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat().map(String);
    const idx = ids.findIndex(id => id.trim() === techId);
    if (idx === -1) return { success: false, message: 'Technologist not found.' };
    sh.getRange(idx + 2, 14).setValue(credentials || '');
    return { success: true };
  } catch(e) {
    Logger.log('saveTechCredentials ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Saves the technologist's own license number (col P = column 16)
function saveTechLicenseNo(techId, licenseNo) {
  try {
    if (!techId) return { success: false, message: 'Tech ID required.' };
    const sh = getSS_().getSheetByName('Technologists');
    if (!sh || sh.getLastRow() < 2) return { success: false, message: 'Sheet not found.' };
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat().map(String);
    const idx = ids.findIndex(id => id.trim() === techId);
    if (idx === -1) return { success: false, message: 'Technologist not found.' };
    sh.getRange(idx + 2, 16).setValue(licenseNo || '');
    return { success: true };
  } catch(e) {
    Logger.log('saveTechLicenseNo ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Uploads a technologist's own signature image to Drive (branch folder / Signatures subfolder)
// and saves the URL to Technologists sheet col O (15)
function uploadTechSignatureImage(branchId, techId, base64Data, mimeType) {
  try {
    if (!base64Data || !techId) return { success: false, message: 'Missing data.' };
    const sigFolder = _getSignaturesFolder_(branchId);
    const ext  = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const name = 'sig_tech_' + techId + ext;
    const old  = sigFolder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, name);
    const file = sigFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
    // Save URL to Technologists sheet col O (15)
    const sh = getSS_().getSheetByName('Technologists');
    if (sh && sh.getLastRow() >= 2) {
      const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat().map(String);
      const idx = ids.findIndex(id => id.trim() === techId);
      if (idx !== -1) sh.getRange(idx + 2, 15).setValue(url);
    }
    return { success: true, url };
  } catch(e) {
    Logger.log('uploadTechSignatureImage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Uploads a pathologist or radiologist signature image to Drive (branch folder / Signatures subfolder)
// and updates the signature_url inside the existing System_Settings JSON entry
function uploadBranchSignatureImage(branchId, role, base64Data, mimeType) {
  try {
    if (!base64Data || !branchId || !role) return { success: false, message: 'Missing data.' };
    const sigFolder = _getSignaturesFolder_(branchId);
    const ext  = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const name = 'sig_' + role + '_' + branchId + ext;
    const old  = sigFolder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, name);
    const file = sigFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
    // Patch signature_url into the System_Settings JSON for this role
    const settingKey = (role === 'pathologist' ? 'lab_pathologist_' : 'xray_radiologist_') + branchId;
    const ss = getSS_();
    const sh = ss.getSheetByName('System_Settings');
    if (sh && sh.getLastRow() >= 2) {
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      const idx  = rows.findIndex(r => String(r[0]).trim() === settingKey);
      if (idx !== -1) {
        let existing = {};
        try { existing = JSON.parse(String(rows[idx][1] || '{}')); } catch(e) {}
        existing.signature_url = url;
        sh.getRange(idx + 2, 2).setValue(JSON.stringify(existing));
      }
    }
    return { success: true, url };
  } catch(e) {
    Logger.log('uploadBranchSignatureImage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Returns (or creates) the Signatures subfolder inside the branch root Drive folder
function _getSignaturesFolder_(branchId) {
  try {
    const drvCfg = getDriveFolderConfig(branchId);
    const rootId = drvCfg && drvCfg.root_folder_id ? drvCfg.root_folder_id.trim() : '';
    if (rootId) {
      const root = DriveApp.getFolderById(rootId);
      const sf   = root.getFoldersByName('Signatures');
      return sf.hasNext() ? sf.next() : root.createFolder('Signatures');
    }
  } catch(e) { Logger.log('_getSignaturesFolder_ fallback: ' + e.message); }
  // Fallback to root Drive
  const fb = DriveApp.getRootFolder().getFoldersByName('A-Lab Signatures');
  return fb.hasNext() ? fb.next() : DriveApp.getRootFolder().createFolder('A-Lab Signatures');
}

// ── TEMPLATE SETTINGS (per branch) ───────────────────────────
// Stored in System_Settings as lab_template_settings_{branchId} → JSON
function getTemplateSettings(branchId) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const key = 'lab_template_settings_' + branchId;
    const raw = getSettingValue_(key, '{}');
    let data = {};
    try { data = JSON.parse(raw); } catch(e) {}
    return { success: true, data: data };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function saveTemplateSettings(branchId, settings) {
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const key = 'lab_template_settings_' + branchId;
    const ss = getSS_();
    let sh = ss.getSheetByName('System_Settings');
    if (!sh) {
      sh = ss.insertSheet('System_Settings');
      sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
      sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      sh.setFrozenRows(1);
    }
    // Merge with existing (preserve header_image_url if not provided)
    const lr = sh.getLastRow();
    let existing = {};
    let idx = -1;
    if (lr >= 2) {
      const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
      idx = rows.findIndex(function(r) { return String(r[0]).trim() === key; });
      if (idx !== -1) {
        try { existing = JSON.parse(String(rows[idx][1] || '{}')); } catch(e) {}
      }
    }
    const merged = Object.assign({}, existing, settings || {});
    if (idx !== -1) {
      sh.getRange(idx + 2, 2).setValue(JSON.stringify(merged));
    } else {
      sh.appendRow([key, JSON.stringify(merged)]);
    }
    writeAuditLog_('TEMPLATE_SETTINGS_SAVE', { branch_id: branchId });
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function uploadTemplateHeaderImage(branchId, base64Data, mimeType) {
  try {
    if (!base64Data || !branchId) return { success: false, message: 'Missing data.' };
    const sigFolder = _getSignaturesFolder_(branchId);
    const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const name = 'template_header_' + branchId + ext;
    const old = sigFolder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, name);
    const file = sigFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
    // Save URL into template settings
    const key = 'lab_template_settings_' + branchId;
    const ss = getSS_();
    let sh = ss.getSheetByName('System_Settings');
    if (!sh) {
      sh = ss.insertSheet('System_Settings');
      sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
      sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#0060b0').setFontColor('#fff');
      sh.setFrozenRows(1);
    }
    const lr = sh.getLastRow();
    let existing = {};
    let idx = -1;
    if (lr >= 2) {
      const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
      idx = rows.findIndex(function(r) { return String(r[0]).trim() === key; });
      if (idx !== -1) {
        try { existing = JSON.parse(String(rows[idx][1] || '{}')); } catch(e) {}
      }
    }
    existing.header_image_url = url;
    if (idx !== -1) {
      sh.getRange(idx + 2, 2).setValue(JSON.stringify(existing));
    } else {
      sh.appendRow([key, JSON.stringify(existing)]);
    }
    return { success: true, url: url };
  } catch(e) {
    Logger.log('uploadTemplateHeaderImage ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── UPDATE MY PASSWORD ───────────────────────────────────────
function updateMyPassword(payload) {
  try {
    const role    = (payload.role    || '').trim();
    const id      = (payload.admin_id|| '').trim();
    const curPass = (payload.cur_pass|| '').trim();
    const newPass = (payload.new_pass|| '').trim();

    if (!newPass || newPass.length < 6)
      return { success: false, message: 'Password must be at least 6 characters.' };

    const ss = getSS_(); // single call

    const cfgMap = {
      'Super Admin':  { name: 'Super Admins',  cols: 3,  passIdx: 2,  colNo: 3  },
      'Branch Admin': { name: 'Admins',         cols: 5,  passIdx: 4,  colNo: 5  },
      'Doctor':       { name: 'Doctors',        cols: 11, passIdx: 10, colNo: 11 },
      'Technologist': { name: 'Technologists',  cols: 9,  passIdx: 8,  colNo: 9  },
      'Receptionist':    { name: 'Technologists',  cols: 9,  passIdx: 8,  colNo: 9  },
      'Liaison Officer': { name: 'Technologists',  cols: 9,  passIdx: 8,  colNo: 9  }
    };
    const cfg = cfgMap[role];
    if (!cfg) return { success: false, message: 'Unsupported role.' };

    const sh = ss.getSheetByName(cfg.name);
    if (!sh) return { success: false, message: 'Sheet not found.' };
    const lr = sh.getLastRow();
    if (lr < 2) return { success: false, message: 'Account not found.' };

    const rows = sh.getRange(2,1,lr-1,cfg.cols).getValues();
    for (let i = 0; i < rows.length; i++) {
      const rowId = role === 'Super Admin'
        ? String(rows[i][0]).trim().toLowerCase()
        : String(rows[i][0]).trim();
      const lookupId = role === 'Super Admin'
        ? id.replace(/^SA-/,'').toLowerCase()
        : id;
      if (rowId === lookupId) {
        if (String(rows[i][cfg.passIdx]).trim() !== curPass)
          return { success: false, message: 'Current password is incorrect.' };
        sh.getRange(i+2, cfg.colNo).setValue(newPass);
        return { success: true };
      }
    }
    return { success: false, message: 'Account not found.' };
  } catch(e) {
    Logger.log('updateMyPassword ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── AUDIT LOG ────────────────────────────────────────────────
function writeAuditLog_(action, payloadData) {
  try {
    const sheet = getSS_().getSheetByName('Audit Logs');
    if (!sheet) return;
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1,1,1,5).setValues([['DateTime','Action','User','Role','PayloadJSON']]);
    }
    // Batch write — single setValues instead of 5 separate setValue calls
    sheet.insertRowBefore(2);
    sheet.getRange(2,1,1,5).setValues([[
      new Date(), action,
      Session.getActiveUser().getEmail(),
      'System',
      JSON.stringify(payloadData)
    ]]);
  } catch (err) {
    Logger.log('writeAuditLog_ ERROR: ' + err.message);
  }
}

// ── ORDERS (stub — move to OrdersCode.gs when ready) ────────
function getOrders()     { return { success: true, data: [] }; }
function createOrder(p)  { return { success: false, message: 'Not yet implemented.' }; }
function updateOrder(p)  { return { success: false, message: 'Not yet implemented.' }; }

// ── RECEPTIONIST DASHBOARD STATS ─────────────────────────────
// Proxy to getTechDashboardStats (defined in DashboardCode.gs)
// Ensures availability even if DashboardCode.gs loads order differs
function getReceptionistDashboardStats(branchId) {
  if (typeof getTechDashboardStats === 'function') {
    return getTechDashboardStats(branchId);
  }
  // Inline fallback in case DashboardCode.gs not yet deployed
  try {
    if (!branchId) return { success: false, message: 'Branch ID required.' };
    const ss   = getSS_();
    const brSh = ss.getSheetByName('Branches');
    if (!brSh) return { success: false, message: 'Branches not found.' };
    const rows = brSh.getRange(2,1,brSh.getLastRow()-1,8).getValues();
    const br   = rows.find(r => String(r[0]).trim() === branchId);
    if (!br || !br[7]) return { success: false, message: 'Branch SS not configured.' };
    const bss   = SpreadsheetApp.openById(String(br[7]).trim());
    const ordSh = bss.getSheetByName('LAB_ORDER');
    const patSh = bss.getSheetByName('Patients');
    const patCount = patSh && patSh.getLastRow() >= 2 ? patSh.getLastRow() - 1 : 0;
    if (!ordSh || ordSh.getLastRow() < 2) {
      return { success: true, stats: { open:0, paid:0, in_progress:0, for_release:0, total:0, patients: patCount }, recent_orders: [] };
    }
    let open=0, paid=0, inProg=0, forRel=0, total=0;
    const recent = [];
    ordSh.getRange(2,1,ordSh.getLastRow()-1,15).getValues()
      .filter(r => r[0])
      .forEach(r => {
        const status = String(r[6]||'').trim();
        total++;
        if (status==='OPEN') open++;
        if (status==='PAID') paid++;
        if (status==='IN_PROGRESS') inProg++;
        if (status==='FOR_RELEASE') forRel++;
        recent.push({ order_no: String(r[1]||'').trim(), patient_name: String(r[11]||r[3]||'').trim(),
          status, net_amount: Number(r[14])||0, order_date: r[5] ? new Date(r[5]).toISOString().split('T')[0] : '' });
      });
    recent.sort((a,b) => b.order_date.localeCompare(a.order_date));
    return { success: true, stats: { open, paid, in_progress: inProg, for_release: forRel, total, patients: patCount }, recent_orders: recent.slice(0,5) };
  } catch(e) {
    return { success: false, message: e.message };
  }
}
function deleteOrder(id) { return { success: false, message: 'Not yet implemented.' }; }