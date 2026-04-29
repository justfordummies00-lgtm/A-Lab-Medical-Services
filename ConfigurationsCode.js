// ============================================================
//  A-LAB — ConfigurationsCode.gs
//  Global system settings — Super Admin only.
//
//  Main SS "System_Settings" sheet:
//    A=key  B=value  C=label  D=description  E=type
//    F=updated_at  G=updated_by
// ============================================================

function getSystemSettingsSheet_() {
  const ss = getSS_();
  let sh   = ss.getSheetByName('System_Settings');
  if (!sh) {
    sh = ss.insertSheet('System_Settings');
    sh.getRange(1,1,1,7).setValues([['key','value','label','description','type','updated_at','updated_by']]);
    sh.getRange(1,1,1,7).setFontWeight('bold').setBackground('#0d9090').setFontColor('#fff');
    sh.setFrozenRows(1);
    // Seed default settings
    const defaults = [
      ['philhealth_annual_limit', '1200',
       'PhilHealth Annual Benefit Limit',
       'Maximum PhilHealth benefit per member per year (₱)',
       'number', new Date(), 'system'],
      ['philhealth_enabled', '1',
       'Enable PhilHealth Billing',
       'Allow PhilHealth billing on orders',
       'boolean', new Date(), 'system'],
    ];
    sh.getRange(2, 1, defaults.length, 7).setValues(defaults);
    sh.setColumnWidth(1, 220);
    sh.setColumnWidth(3, 240);
    sh.setColumnWidth(4, 340);
    Logger.log('getSystemSettingsSheet_: seeded defaults');
  }
  return sh;
}

// ── READ ALL SETTINGS ────────────────────────────────────────
function getSystemSettings() {
  return withCache_('system_settings', 'all', 120, _getSystemSettings_);
}

function _getSystemSettings_() {
  try {
    const sh = getSystemSettingsSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return { success: true, data: [] };
    const data = sh.getRange(2,1,lr-1,7).getValues()
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({
        key:         String(r[0]).trim(),
        value:       String(r[1]).trim(),
        label:       String(r[2]||'').trim(),
        description: String(r[3]||'').trim(),
        type:        String(r[4]||'text').trim(),
        updated_at:  r[5] ? new Date(r[5]).toISOString() : '',
        updated_by:  String(r[6]||'').trim()
      }));
    return { success: true, data };
  } catch(e) {
    Logger.log('getSystemSettings ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SAVE SINGLE SETTING ──────────────────────────────────────
function saveSystemSetting(key, value, updatedBy) {
  try {
    if (!key) return { success: false, message: 'Key is required.' };
    const sh  = getSystemSettingsSheet_();
    const lr  = sh.getLastRow();
    const now = new Date();
    if (lr >= 2) {
      const keys = sh.getRange(2,1,lr-1,1).getValues().flat().map(String);
      const idx  = keys.findIndex(k => k.trim() === key.trim());
      if (idx !== -1) {
        sh.getRange(idx+2, 2).setValue(value);
        sh.getRange(idx+2, 6, 1, 2).setValues([[now, updatedBy||'']]);
        cacheBust_('system_settings');
        writeAuditLog_('SETTING_UPDATE', { key, value, updated_by: updatedBy });
        return { success: true };
      }
    }
    // Not found — shouldn't happen but handle gracefully
    sh.appendRow([key, value, key, '', 'text', now, updatedBy||'']);
    cacheBust_('system_settings');
    return { success: true };
  } catch(e) {
    Logger.log('saveSystemSetting ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── SAVE MULTIPLE SETTINGS (batch) ──────────────────────────
function saveSystemSettings(settings, updatedBy) {
  try {
    if (!settings || !settings.length) return { success: false, message: 'No settings provided.' };
    const sh  = getSystemSettingsSheet_();
    const lr  = sh.getLastRow();
    const now = new Date();
    const keys = lr >= 2 ? sh.getRange(2,1,lr-1,1).getValues().flat().map(String) : [];
    settings.forEach(s => {
      const idx = keys.findIndex(k => k.trim() === s.key.trim());
      if (idx !== -1) {
        sh.getRange(idx+2, 2).setValue(s.value);
        sh.getRange(idx+2, 6, 1, 2).setValues([[now, updatedBy||'']]);
      }
    });
    cacheBust_('system_settings');
    writeAuditLog_('SETTINGS_BATCH_UPDATE', { count: settings.length, updated_by: updatedBy });
    Logger.log('saveSystemSettings: saved ' + settings.length + ' settings');
    return { success: true };
  } catch(e) {
    Logger.log('saveSystemSettings ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── GET SINGLE SETTING (public, returns {success, value}) ───
function getSystemSetting(key) {
  try {
    const val = getSettingValue_(key, '');
    return { success: true, value: val };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── GET SINGLE SETTING VALUE (helper for other modules) ─────
function getSettingValue_(key, defaultValue) {
  try {
    const sh = getSystemSettingsSheet_();
    const lr = sh.getLastRow();
    if (lr < 2) return defaultValue;
    const rows = sh.getRange(2,1,lr-1,2).getValues();
    const row  = rows.find(r => String(r[0]).trim() === key);
    return row ? String(row[1]).trim() : defaultValue;
  } catch(e) { return defaultValue; }
}

// ── SETUP A-LAB ROOT FOLDER ──────────────────────────────────
function config_setupRootFolder(linkOrId) {
  try {
    if (!linkOrId) throw new Error("No link or ID provided.");
    linkOrId = linkOrId.trim();
    
    // Extract ID if it's a link
    let folderId = linkOrId;
    let match = linkOrId.match(/[-\w]{25,}/);
    if (match) {
      folderId = match[0];
    }
    
    // Verify it's a folder
    let rootFolder;
    try {
      rootFolder = DriveApp.getFolderById(folderId);
    } catch (e) {
      throw new Error("Could not access the folder. Please ensure the link is correct and the system account has Editor access.");
    }
    
    // Structure:
    // Root/
    // └── Database/
    //     ├── Branches Database/
    //     └── Global Database/
    
    let dbFolder = getOrCreateSubfolder(rootFolder, "Database");
    let branchDbFolder = getOrCreateSubfolder(dbFolder, "Branches Database");
    let globalDbFolder = getOrCreateSubfolder(dbFolder, "Global Database");
    
    // Save to System_Settings
    saveSystemSetting('alab_root_folder_id', folderId, 'System');
    saveSystemSetting('alab_branch_db_id', branchDbFolder.getId(), 'System');
    saveSystemSetting('alab_global_db_id', globalDbFolder.getId(), 'System');
    
    return { success: true, root_id: folderId };
  } catch (e) {
    Logger.log("config_setupRootFolder ERROR: " + e.message);
    return { success: false, message: e.message };
  }
}

function getOrCreateSubfolder(parent, name) {
  let folders = parent.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(name);
}