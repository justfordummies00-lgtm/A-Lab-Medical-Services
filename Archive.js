// ============================================================
//  A-LAB — Archive.gs
//
//  Soft-delete primitives shared across modules.  Hard `deleteRow`
//  loses history (e.g. orders pointing to a deleted patient become
//  orphans), and for medical records hard delete is also a regulatory
//  concern.  Instead we mark records with `is_archived = 1`; reads
//  filter archived rows out by default and show them in an opt-in
//  "Archived" view.
//
//  Each archivable sheet gets a final column called `is_archived`
//  (header autocreated by `ensureArchiveCol_` on first archive).
//  Existing rows have an empty cell, which is treated the same as
//  `is_archived = 0` (i.e. active).
// ============================================================

// Returns the 1-based column index of `is_archived` on the given sheet,
// adding the header column at the end if it doesn't already exist.
function ensureArchiveCol_(sh) {
  const lc = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lc).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === 'is_archived') return i + 1;
  }
  const newCol = lc + 1;
  sh.getRange(1, newCol).setValue('is_archived')
    .setFontWeight('bold').setBackground('#475569').setFontColor('#ffffff');
  return newCol;
}

// Set is_archived flag on a single row by primary key (col A == id).
// Returns { ok: bool, row: int }.  Acquires withLock_ at the call site.
function setArchiveFlag_(sh, id, archived) {
  const lr = sh.getLastRow();
  if (lr < 2) return { ok: false, row: -1 };
  const ids = sh.getRange(2, 1, lr - 1, 1).getValues().flat().map(String);
  const idx = ids.findIndex(v => v.trim() === String(id).trim());
  if (idx === -1) return { ok: false, row: -1 };
  const col = ensureArchiveCol_(sh);
  sh.getRange(idx + 2, col).setValue(archived ? 1 : 0);
  return { ok: true, row: idx + 2 };
}

// True if a row's `is_archived` cell is set to 1.  `row` is the raw
// values array from getValues; `archCol` is 1-based column index.
function isArchivedRow_(row, archCol) {
  if (!archCol || archCol < 1) return false;
  const v = row[archCol - 1];
  if (v === 1 || v === '1' || v === true) return true;
  return false;
}

// Convenience: read header row and return the 1-based index of
// `is_archived`, or 0 if not present (so callers can treat 0 as
// "no archived col yet, all rows active").
function findArchiveCol_(sh) {
  const lc = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lc).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === 'is_archived') return i + 1;
  }
  return 0;
}
