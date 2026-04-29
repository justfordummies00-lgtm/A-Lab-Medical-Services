// ============================================================
//  A-LAB — Locks.gs
//
//  Concurrency primitive shared across all backend modules.
//
//  withLock_(fn, opts?)  → serialise critical sections that
//  do read-modify-write on a sheet (counters, row-index lookups,
//  status toggles).  Without this, two concurrent google.script.run
//  calls can both read the same row index, both write to it, and
//  silently corrupt data.
//
//  Backed by LockService.getScriptLock() — single project-wide
//  lock.  At current user counts this is fine; if throughput ever
//  becomes a problem we can shard by branch using a soft lock in
//  PropertiesService.
//
//  Behaviour:
//    • Default timeout 10 s.
//    • If the lock can't be obtained, throws a plain Error
//      ("System busy. Please retry in a moment.") that propagates
//      back to the caller as a normal red toast on the UI.
//    • Lock is always released, even if fn() throws.
//
//  Usage:
//    function createOrder(branchId, payload) {
//      return withLock_(function(){
//        // read-modify-write on LAB_ORDER and Settings.order_seq
//      });
//    }
// ============================================================

// Per-execution flag so nested withLock_ calls don't deadlock.
// (LockService.getScriptLock() does NOT support reentrant locks: a
// second tryLock from inside the same execution would block for the
// whole timeout and then fail.)  We only acquire the script lock at
// the OUTERMOST withLock_ call; inner calls just run fn() inline.
var __lockHeld_ = false;

function withLock_(fn, opts) {
  const o = opts || {};
  const timeoutMs = typeof o.timeoutMs === 'number' ? o.timeoutMs : 10000;

  if (__lockHeld_) {
    return fn();
  }

  let lock;
  try {
    lock = LockService.getScriptLock();
  } catch (e) {
    // LockService unavailable (rare) — fall through unlocked rather
    // than 500ing the whole request.  Logged so we can spot it.
    Logger.log('withLock_: LockService unavailable — running without lock: ' + e.message);
    return fn();
  }

  const got = lock.tryLock(timeoutMs);
  if (!got) {
    throw new Error('System busy. Please try again in a moment.');
  }

  __lockHeld_ = true;
  try {
    return fn();
  } finally {
    __lockHeld_ = false;
    try { lock.releaseLock(); } catch (e) {
      // Releasing a lock that's already auto-released throws — ignore.
    }
  }
}
