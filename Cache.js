// ============================================================
//  A-LAB — Cache.gs
//  Lightweight performance helpers shared across all backend
//  modules.  No business logic lives here.
//
//  What this provides:
//   • withCache_(ns, key, ttl, fn)  — namespaced CacheService
//     wrapper for read endpoints.  Safe for catalog data only.
//   • cacheBust_(ns)                — invalidates every entry in
//     a namespace (used by writes).
//   • openSS_(ssId)                 — per-execution memoized
//     SpreadsheetApp.openById(), so dashboards/orders that touch
//     the same branch spreadsheet several times per request open
//     it exactly once.  Pure within-request: zero staleness risk.
//
//  IMPORTANT — what is and isn't cached:
//
//   CACHED  (catalog / config — admin-controlled, rare writes):
//     branches, departments, categories, lab_services, packages,
//     discounts, doctors, technologists, admins, queue_routing,
//     system_settings, template_settings, patient_id_types.
//
//   NEVER CACHED  (real-time operational data):
//     orders, patients, lab results, payments, dashboard stats,
//     receptionist / liaison / tech dashboards, lab results
//     preview, my-referrals, my-patients, consultations.
//
//  The cache is automatically busted on every create/update/
//  delete in the cached modules, so the next read is always
//  fresh after a write.
// ============================================================

// ── NAMESPACE VERSIONING ─────────────────────────────────────
// CacheService doesn't support pattern-based delete, so each
// namespace maintains a monotonically increasing "version".  All
// real cache keys embed that version; bumping the version
// effectively invalidates every entry in the namespace at once.
function _cacheNsVersion_(ns) {
  try {
    const cache = CacheService.getScriptCache();
    let v = cache.get('nsv:' + ns);
    if (!v) {
      v = '1';
      cache.put('nsv:' + ns, v, 21600); // 6h
    }
    return v;
  } catch (e) {
    return '0'; // CacheService unavailable — fall through to no-cache
  }
}

function _cacheBumpNs_(ns) {
  try {
    const cache = CacheService.getScriptCache();
    const cur = parseInt(cache.get('nsv:' + ns) || '1', 10);
    cache.put('nsv:' + ns, String(cur + 1), 21600);
  } catch (e) {
    // No-op — caching unavailable
  }
}

// ── PUBLIC: cached read wrapper ──────────────────────────────
// Use for endpoints that read mostly-static catalog data.
//   ns   — short namespace tag, e.g. 'branches', 'departments'.
//   key  — variant key (filters, branch_id, etc.).  Pass '' if none.
//   ttl  — seconds.  Recommended 30–120 for hot reads.
//   fn   — the original (uncached) computation.
function withCache_(ns, key, ttl, fn) {
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }

  if (!cache) return fn(); // CacheService unavailable

  const v = _cacheNsVersion_(ns);
  const fullKey = 'c:' + ns + ':v' + v + ':' + (key || '_');

  try {
    const hit = cache.get(fullKey);
    if (hit) {
      const parsed = JSON.parse(hit);
      if (parsed && parsed.__v === 1) return parsed.payload;
    }
  } catch (e) {
    // Corrupt cache entry — recompute
  }

  const result = fn();

  // Only cache successful responses.  CacheService entries are
  // capped at 100KB; we leave a small headroom.
  try {
    if (result && (result.success === undefined || result.success === true)) {
      const json = JSON.stringify({ __v: 1, payload: result });
      if (json.length < 95000) cache.put(fullKey, json, ttl);
    }
  } catch (e) {
    // Skip caching on serialization failure
  }

  return result;
}

// ── PUBLIC: invalidate a namespace ───────────────────────────
// Call from every create/update/delete in modules whose reads
// are cached.  Cheap (one CacheService write).
function cacheBust_(ns) {
  _cacheBumpNs_(ns);
}

// Convenience — bust several namespaces at once.
function cacheBustMany_(nsList) {
  if (!nsList || !nsList.length) return;
  for (let i = 0; i < nsList.length; i++) _cacheBumpNs_(nsList[i]);
}

// ── PUBLIC: per-execution SpreadsheetApp.openById memo ──────
// Every google.script.run invocation runs in a fresh V8
// context, so this map is reset on every request.  No staleness
// across requests; we only avoid re-opening the same SS within
// one request (a known Apps Script bottleneck — each openById
// can take 0.5–1.5s).
var __SS_OPEN_CACHE_ = {};

function openSS_(ssId) {
  if (!ssId) return null;
  const id = String(ssId).trim();
  if (!id) return null;
  if (!__SS_OPEN_CACHE_[id]) {
    __SS_OPEN_CACHE_[id] = SpreadsheetApp.openById(id);
  }
  return __SS_OPEN_CACHE_[id];
}

// ── DEBUG / OPS HELPERS ─────────────────────────────────────
// Manually clear every cache namespace.  Useful for support.
function cacheBustAll_() {
  const all = [
    'branches', 'departments', 'categories',
    'lab_services', 'packages', 'discounts',
    'doctors', 'technologists', 'admins',
    'queue_routing', 'system_settings', 'template_settings',
    'patient_id_types'
  ];
  for (let i = 0; i < all.length; i++) _cacheBumpNs_(all[i]);
}
