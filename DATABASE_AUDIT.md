# A-Lab Medical Services — Database & Backend Audit

**Scope:** `InitializeDatabase.js`, all 17 backend `.js` modules, and the schema of the Global SS plus per-Branch SS that they manage.
**Goal:** answer your three questions —
1. Is the database properly created and organized?
2. Is the CRUD code already good, or can it be more optimized for the long run?
3. Is everything in proper sequence?

This is a **read-only review** — no code changes yet. Findings are grouped by severity. Every finding includes a concrete recommendation. After you read this, tell me which ones to fix and in what order.

---

## TL;DR

Overall the system is in **good shape for its current size** (a few branches, a few hundred patients/orders per branch). The schema is reasonable, the CRUD code is consistent, and `InitializeDatabase.js` is idempotent and re-runnable.

But there are **three production-grade issues** that should be fixed regardless of scale, and **roughly a dozen design issues** that will start hurting once the system grows past a few thousand patients per branch or a handful of branches.

The single most important takeaway: **passwords are stored in plain text and there is zero locking on writes**. Both are real risks today, not "later" problems.

---

## 🔴 CRITICAL — Fix as soon as possible

### C1. Passwords are stored in plain text everywhere
- `Super Admins`, `Admins`, `Doctors`, `Technologists` sheets all store the password as a literal string.
- `loginAdmin / loginDoctor_ / loginTechnologist_` compare them with `rowPass === pass`.
- `InitializeDatabase.js` even seeds the default Super Admin as `password = 'Admin@123'` in plain text.
- Anyone with read access to the Global Spreadsheet can see every account's password.

**Recommendation**
- Hash with `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, …)`, store `hash` and a per-user `salt` (or use PBKDF2 via repeated rounds — Apps Script has no native bcrypt but can do many SHA-256 rounds).
- Migrate existing plain-text passwords on login: if the stored value isn't a hash format, accept the legacy compare once, then re-write it as a hash.
- Add a one-time admin "force password reset" tool to invalidate any leaked passwords once hashing is in.

### C2. No `LockService` anywhere → race conditions on writes
- 0 occurrences of `LockService` in the codebase.
- `nextOrderNo_(ss, branchCode, year)` is the highest-risk spot: two receptionists clicking "Create Order" at the same second can both read `order_seq_2025 = 42`, both write `43`, and you get **duplicate order numbers**.
- Every "find row by id then `setValues` / `deleteRow`" pattern is also racy: if user A is mid-update and user B deletes a row above, A writes to the wrong row. This affects almost every `update*` and `delete*` function in the codebase (Patients, Orders, Doctors, Technologists, Discounts, Lab Services, Packages, etc.).
- `cacheBust_` itself is racy vs. cache writes (a read can land between a write's `appendRow` and its `cacheBust_`, caching pre-write data for 60 s).

**Recommendation**
- Add a small `withLock_(scope, fn)` helper using `LockService.getDocumentLock()` (per-spreadsheet lock).
- Wrap **every write path that does read-modify-write or sequence allocation** with it. Specifically:
  - `nextOrderNo_`, `createOrder`, `updateOrder*`, `saveOrderItems`, `postPayment`
  - `updatePatient`, `deletePatient`
  - `updateAdmin`, `deleteAdmin`, `updateDoctor`, `deleteDoctor`, `updateTechnologist`, `deleteTechnologist`, `updateBranch`, `deleteBranch`
  - `setBranchServStatus`, `setBranchPkgStatus` (these read-then-write the same row)
- Use a 5–10 s `tryLock` timeout — fail the write with a clean error message if a lock can't be obtained, rather than silently corrupting data.
- Bonus: for `cacheBust_`, do the bust **before** the write commits (so racing readers don't repopulate stale data into the next cache cycle).

### C3. Audit log uses `insertRowBefore(2)` — O(n) and gets slower forever
- `writeAuditLog_` in `Code.js` line 541 calls `sheet.insertRowBefore(2)` every time.
- `insertRowBefore` shifts every row below by one — it's roughly O(n) on the size of the sheet.
- This means every CRUD operation in the system gets slower as the audit log grows.
- At 50,000 audit entries, every single write incurs ~hundreds of ms overhead just for the audit log.

**Recommendation**
- Switch to `appendRow(...)` (O(1)). Newest entries at the bottom is the standard for append-only logs.
- The UI can still display "newest first" by reading and reversing in JS.
- Even better: roll the audit log into a separate spreadsheet so it never touches the main DB's read paths. Audit logs grow forever; mixing them into the operational SS is a long-term performance bomb.

---

## 🟡 IMPORTANT — Fix soon, but not on fire

### I1. `InitializeDatabase.js` schema drifts from runtime writes
- The `Patients` sheet is initialized with **13 columns** (`A`–`M`), but the running code writes **17 columns** including `home_branch_id` (col 14), `is_4ps` (col 15), `senior_citizen_id` (col 16), `pwd_id` (col 17). These extra columns are added at runtime by `ensurePatientCols_` / on first write.
- The `Departments` sheet is missing `department_type` for old DBs — patched at runtime by `MigrationCode.js / upgradeDatabaseSchema()`.
- The `Technologists` sheet is missing `assigned_deps` — also patched by `MigrationCode.js`.
- Net effect: a fresh DB has a different schema than an upgraded DB unless you remember to run the migration.

**Recommendation**
- Make `InitializeDatabase.js` declare the **full current schema** (all 17 cols on Patients, all 14 on Technologists, all 6 on Departments).
- Move every `ensure*Cols_` style runtime-patch into a single `migrateSchema()` that you run once after deploys.
- Add a "schema_version" entry in the `Settings` sheet so the migration is idempotent and tells you which version a DB is on.

### I2. `nextOrderNo_` sequence has a dead row
- `InitializeDatabase.js` seeds `Settings: order_seq → 0`, but the real code looks for `order_seq_<year>` (`order_seq_2025`, `order_seq_2026`, …).
- That seeded `order_seq` row is therefore never used and just clutters the sheet.
- Also, every January 1st a new `order_seq_<year>` row gets appended, but old years are kept forever. Over 10 years that's 10 useless rows.

**Recommendation**
- Either drop the seeded `order_seq` row from init, or rename it `order_seq_2025` (current year) so it's actually used.
- Optional: keep a single `order_seq` row and prefix the order number with the year separately.

### I3. Duplicate / shadowed function definitions in `Code.js`
- `Code.js` lines 555–557 define stub `createOrder`, `updateOrder` returning `"Not yet implemented."`.
- The real implementations are in `OrdersCode.js`.
- In Apps Script V8, all `.js` files share one global scope, and the **last-loaded** function declaration wins. This is fragile — if file load order ever changes (e.g. new file alphabetizes before `OrdersCode.js`), the stubs could shadow the real functions silently.

**Recommendation**
- Delete the stubs in `Code.js` once the real ones in `OrdersCode.js` are confirmed working.
- Same hygiene check: `getOrders` is also stubbed in `Code.js` (line 554, returns `{ success: true, data: [] }`) — verify it's been superseded, then remove.

### I4. ID generation uses 32 bits of entropy
- 48 places generate IDs as `'PREFIX-' + Math.random().toString(16).substr(2, 8).toUpperCase()`.
- `substr(2, 8)` of a hex Math.random gives **8 hex characters = 32 bits = ~4.3 billion possibilities**.
- Birthday paradox: roughly 50% chance of a collision after **65 k IDs**. For a single-branch system that's many years out, but PHI data deserves better.
- `Math.random()` is not cryptographically random — fine for IDs but worth knowing.

**Recommendation**
- Replace with `Utilities.getUuid()` (returns a 128-bit RFC 4122 UUID). Either use the full UUID or take its first 12 chars for human-friendly IDs.
- Alternative if you want shorter IDs: increment a per-sheet counter (like `nextOrderNo_`) so every ID is unique and sequential, but this requires `LockService` (see C2).

### I5. Hard deletes everywhere — no soft-delete / archive
- `deletePatient`, `deleteOrder`-equivalent paths, `deleteDoctor`, `deleteTechnologist`, `deleteAdmin`, `deleteDepartment`, `deleteBranch`, `deleteLabService`, `deletePackage`, `deleteBranchPackage`, `deleteDiscount` — all use `sh.deleteRow(...)`.
- Once a patient row is deleted, all historical orders/results/payments referencing that patient are now **orphaned** (foreign key dangling).
- For a medical records system, this is a regulatory concern — you usually need to keep records for N years even after "deletion".

**Recommendation**
- Add an `is_deleted` (or `status='ARCHIVED'`) column to each sheet and have delete functions set the flag instead of removing the row.
- Read paths filter out `is_deleted=1`. Audit logs already show who deleted what.
- If you really do want hard-delete, make it a separate "purge after X days" job that runs offline.

### I6. No referential integrity on cascading deletes
- `deleteDepartment` does cascade to its `Categories` (good!), but does **not** cascade to:
  - `Lab_Services` (services pointing to those categories now have an invalid `cat_id`)
  - `Branch_Cat_Status` / `Branch_Dept_Status` (orphan rows)
- `deleteDoctor` doesn't update orders that reference that doctor (orders keep showing a doctor name but the doctor record is gone — actually OK because orders snapshot `doctor_name`, but the link is dead).
- `deleteBranch` doesn't touch the branch's spreadsheet, doesn't remove `Branch_*_Status` rows for that branch, and doesn't reassign or block users still tied to that `branch_ids`.

**Recommendation**
- Either implement proper cascade in each delete path, or — cleaner — switch to soft-delete (I5) and let the UI hide deleted records. Cascading hard-deletes in a sheet-based DB is brittle.

### I7. Cross-branch queries scan every branch SS
- `searchPatientsAcrossBranches`, `getDoctorReferrals`, `getDashboardStats` (when called as Super Admin), `getReceptionistDashboardStats` for SA, and similar — open every branch SS and scan their full sheets.
- With 5 branches and 5,000 orders each, this is already a 5–8 s request even after `openSS_` memoization.
- At 20 branches × 50,000 orders, this hits the 6-minute Apps Script limit.

**Recommendation (short-term)**
- Add a **denormalized "global index" sheet** in the main SS that mirrors essential search fields from each branch (e.g. `patient_global_index`: branch_id, patient_id, last_name, first_name, contact). Each branch CRUD updates the index. Cross-branch search becomes a single sheet read.
- Or limit cross-branch search to BA-level operations (one branch at a time) — push the user to choose a branch first.

**Recommendation (long-term)**
- For genuinely cross-branch reporting, move to a real DB (Cloud SQL, Firestore, BigQuery for analytics). Sheets are not designed for SUM/JOIN across millions of rows.

### I8. `LAB_ORDER` / `LAB_ORDER_ITEM` headers can be silently overwritten
- `initializeBranchDatabase` calls `hdr(sh1, [...])` on `LAB_ORDER` even if the sheet already exists, which **overwrites row 1 unconditionally**. If a branch's headers ever drift (e.g. you added a column manually), running init again silently replaces them.
- Other sheets correctly use `ensureSheet_` which only sets headers when creating the sheet. Inconsistent.

**Recommendation**
- Use `ensureSheet_` for `LAB_ORDER` too. If you need to upgrade headers, do it inside `migrateSchema()` after a version check.

### I9. Header/styling is inconsistent across sheets
- Five different background colors are used for headers (`#0d9090`, `#0060b0`, `#6d28d9`, `#1e3a5f`, `#065f46`, `#b45309`, `#475569`). The branch SS uses none of them — `getOrCreateSheet_` in `OrdersCode.js` uses its own color scheme.
- Cosmetic, but it makes spreadsheet inspection visually noisy.

**Recommendation**
- Pick one or two colors (e.g. teal for Global, blue for Branch, dark grey for Audit).

---

## 🟢 NICE-TO-HAVE — Optimizations for long-term scaling

### N1. Every read does a full sheet scan
- The pattern `getRange(2, 1, lr-1, N).getValues()` then `.filter()` in JS is everywhere.
- For ≤1,000 rows it's fine. For 50,000+ rows it costs ~1–3 s of `getValues` plus tens of MB of memory.

**Recommendations** (in increasing order of effort)
- **Snapshot frequently-read indexes** — keep a single-column `id` lookup map cached per execution (similar to how `openSS_` caches the SS object).
- **Pagination at the API layer** — `getOrders(branchId, { offset, limit, status })` instead of returning the whole table, and have the frontend paginate.
- **Date-partitioned sheets** — split `LAB_ORDER` into `LAB_ORDER_2024`, `LAB_ORDER_2025`. Reads only touch the active year. Used by other GAS-based POS systems.
- **Move to Sheets API v4 with structured queries (`?fields=...&q=...`)** — much faster than `SpreadsheetApp` for filter-heavy reads.
- **Long-term**: migrate orders/patients to Firestore or Cloud SQL with the spreadsheets as a read-only mirror for human-friendly viewing.

### N2. Audit logs grow unboundedly
- Every CRUD action writes to both `Audit Logs` (Global SS) and `AUDIT_LOG` (Branch SS).
- Combined with C3 above, this gets expensive forever.

**Recommendation**
- Move audit logs to dedicated audit spreadsheets per year (`AUDIT_2025.xlsx`).
- Keep only the last 90 days in the live `Audit Logs` sheet.
- Consider Stackdriver / Cloud Logging via the `Logger.log` API for true append-only audit, then surface entries on-demand in the UI.

### N3. Two completely different audit log schemas
- Global SS `Audit Logs`: 5 columns (`DateTime`, `Action`, `User`, `Role`, `PayloadJSON`).
- Branch SS `AUDIT_LOG`: 8 columns (`audit_id`, `timestamp`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`).
- Branch one is much better — has `before_json` for restoring deletes and `entity_type/entity_id` for filtering.

**Recommendation**
- Consolidate on the branch schema. Update `writeAuditLog_` to write the same shape everywhere.

### N4. Patient sheet has dead/legacy columns
- Col 16 in `Patients` is `discount_id_no` and is **always written as `''`** with a comment `// (legacy, kept for compat)`.
- Carrying dead columns forever clutters reads and slows `setValues` by a couple of ms per write.

**Recommendation**
- Add a one-time migration to drop the column. Update `createPatient` and `updatePatient` to write 16 cols instead of 17.

### N5. Branch lookup repeats in every operational module
- `getOrderSS_`, `getBranchSS_` (Patients), `getBranchCode_`, `loginX`, etc. each independently scan the `Branches` sheet of the Global SS.
- Could be a shared helper `getBranchRecord_(branchId)` that hits the cache.

**Recommendation**
- Single `getBranchRecord_(branchId)` helper backed by `withCache_('branches', ...)` — and now that we cache `branches` already, pull the metadata from there instead of re-reading the Branches sheet.

### N6. Receptionist/Tech/Liaison dashboards re-compute aggregations on every poll
- Now that we auto-refresh every 30 s, dashboards run their full aggregation pipeline 120×/hour per active user.
- Not a problem at small scale, but at 20 receptionists × 30 polls/hour × O(n) sheet reads, this can sting.

**Recommendation**
- Cache dashboard stats with a very short TTL (15 s). It's basically free once `withCache_` is in place — just opt these endpoints in. The freshness loss is bounded by the TTL and the auto-refresh interval.
- Or: maintain rolling counters in a `Branch_Stats` sheet that's incremented on each order create/update/release, and dashboards just read that single row.

### N7. `getOrCreateSheet_` is duplicated across files
- `OrdersCode.js`, `BranchesCode.js`, `PackagesCode.js`, `LabServicesCode.js`, `DepartmentsCode.js` each redefine their own `getXxxSheet_` helpers.
- Code duplication. Easy to fix once we identify the canonical helper.

**Recommendation**
- Move all "get-or-create + ensure headers" helpers to a single `Sheets.js` file, keyed by sheet name.

---

## File / Sequence organization

### `appsscript.json` / file load order
- Apps Script loads files in the order declared in the manifest, falling back to alphabetical. The current order doesn't have anything load-order-sensitive (no top-level side effects), so it's fine — but please verify no file is depending on another being loaded first. (Both `Cache.js` helpers and `_runLoader` in `Utils.html` are designed to be defensive about load order.)

### Filename → role
The naming is mostly self-explanatory, but a few things could be tighter:
- `Code.js` is doing **3 unrelated jobs** (login, profile photo upload, password update, audit log helper, plus stub orders + receptionist dashboard fallback). It's the largest catch-all in the repo.
- **Recommendation**: split into `Auth.js` (logins), `Photos.js` (uploads), `Audit.js` (writeAuditLog_).
- `MigrationCode.js` is fine but should be expanded into a proper version-aware migrator (see I1).

### Sheet creation sequence in `initializeMainDatabase()`
- The numbering in the comments is `1, 2, 3, ..., 14, 16, 17, 18, 19, 21` — **15 and 20 are missing**. Cosmetic only (the sheets are still all created), but it indicates someone removed sheets without renumbering.
- **Recommendation**: renumber 1..N for clarity.

---

## Suggested fix order (if you want a roadmap)

1. **C1 + C2 + C3** — security and correctness, do these first.
2. **I3 + I8 + I9** — quick wins, ~1 hour total.
3. **I1 + I2** — schema drift cleanup, prevents future bugs.
4. **I5 + I6** — soft-delete refactor. Bigger lift, but eliminates a whole class of bugs.
5. **I4** — UUID migration. Low-risk, can ride along with I1.
6. **N1 + N6 + N7** — long-term scaling. Don't bother until you actually feel slowness with real data.
7. **I7 / N5** — denormalized indexes for cross-branch. Do this when you cross ~10 branches or ~5 k patients per branch.
8. **N2 / N3** — audit log consolidation. Whenever audit becomes the slowest part of a write.

---

## What I'd recommend doing **right now**

If you only want to do one PR after this audit, do **C1 (passwords) + C2 (LockService) + C3 (audit log appendRow) + I3 (delete stubs)**. That's a small, targeted, low-risk change that fixes the only "this could bite us in production" issues. Everything else is improvement, not damage control.

Tell me which findings you want me to implement and I'll batch them into focused PRs.
