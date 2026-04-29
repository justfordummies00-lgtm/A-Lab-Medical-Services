# A-Lab Medical Technologist — Lab Result Template Design

> **Status:** locked (v3). Reference for the companion PR on `lawrenxe17/A-Lab-Medical-Services`.

## 1. One-sentence summary

Keep the existing single Google Doc master template, add a smart renderer that groups all encoded param-mode lab items in an order by category, and flattens services whose layouts match into one table per category — producing a single combined DOCX per order with a page-break between categories. Services that rely on Google Sheets formulas (e.g. Hematology with MCV/MCH/MCHC) continue to use the existing `sheet_template` mode unchanged.

## 2. What changes

| Area | Change | Backwards compatible? |
|---|---|---|
| `ResultTemplatesCode.js` → `saveLabResultAndPdf` | After saving per-item DOCX, additionally cache the raw param values as JSON in `RESULT_ITEMS` col 11. | Yes — additive. |
| New file `LabBundleRendererCode.js` | Introduces `generateLabResultsBundle(branchId, orderId, encodedBy)` and `getLabBundleEligibility`. | Yes — new functions. |
| `TechDashboard.html` | New "Generate Combined Report" button on the release panel, visible when an order reaches `FOR_RELEASE`. Calls the bundle renderer and shows the resulting DOCX link. | Yes — additive button. |
| Master Google Doc template | Only `{{RESULTS_TABLE}}` placeholder required. Patient demographics should live in the page **header** (so they repeat per page) and signatures in the page **footer**. `{{CATEGORY_TITLE}}` is **not** used — the renderer emits the banner text directly into the body, so you don't need to edit the template. | Yes — existing template still works. |

## 3. Bundle algorithm

```
items = LAB_ORDER_ITEM where order_id = X and encoded_at is set
for it in items:
    cat = Lab_Services[it.serv_id].cat_id
    if Lab_Services[it.serv_id].template_url is set:
        skip (sheet_template mode — already handled by generateSheetTemplate)
    else:
        load raw_values_json from RESULT_ITEMS
        groups[cat].append({ service, params, resultsByParam })

for each category in insertion order:
    detect layout from flattened params:
      - tabular  if all data-params have unit OR ref
      - keyvalue if none have unit or ref
      - mixed    otherwise
    emit centered bold banner = category name (uppercase)
    build ONE table:
      - 4 cols (TEST · RESULT · REFERENCE VALUE · UNIT) if tabular
      - 2 cols (LABEL · VALUE) if keyvalue
      - 3 cols (LABEL · VALUE · UNIT) if mixed
    for each service in the category:
      if merging >1 service AND service has no leading `header` param:
        emit bold full-width service row (e.g. FASTING BLOOD SUGAR)
      for each param (sorted by sort_order):
        if field_type = header     → bold uppercase full-width
        if field_type = subheader  → italic full-width (PHYSICAL / DIFFERENTIAL COUNT)
        if field_type = note       → italic spanning cols 0-1
        else                        → data row, formatter picks display from field_type
    if not last category: insert page break
```

### Formatters (same for all layouts)

| `field_type` | empty | filled |
|---|---|---|
| `numeric` | italic `blank` | the number |
| `text` | italic `blank` | the text (line-breaks preserved) |
| `pos_neg` | italic `blank` | **POSITIVE** / **NEGATIVE** |
| `reactive` | italic `blank` | **REACTIVE** / **NON-REACTIVE** |
| `selection` | italic `blank` | chosen option (uppercase) |
| `subheader` | full-width italic divider, no value cell | same |
| `header` | uppercase bold divider, no value cell | same |
| `note` | italic note spanning label+value cells | same |

### Multi-line reference ranges

Params with multi-line `reference_range` (e.g. `FEMALE 12.0 – 16.0\nMALE 14.0 – 18.0`) emit a continuation row with the extra reference line under the REFERENCE VALUE column (tabular layout only).

### Optional sub-labels

If a param has a `sub_label` attribute (added convention, not yet a column — but already referenced by existing code), the renderer emits an italic row with that text immediately below the value. Used for Serology examples — "Antigen Screening Test" / "Screening Test" under HEPATITIS B / HIV etc.

## 4. Why this matches your existing printed templates

- **Clinical Chemistry combined page** (your image with FBS + Total Cholesterol + Triglycerides + HDL + LDL + VLDL + …): reproduced exactly because the renderer flattens all chemistry services into one 4-col TEST/RESULT/REFERENCE/UNIT table.
- **Clinical Microscopy** (Urinalysis with PHYSICAL / CHEMICAL / MICROSCOPIC subheaders): reproduced by keeping `subheader` params as inline full-width dividers inside the 2-col layout.
- **Serology** (Hep B / HIV / Syphilis as separate test rows with italic sub-labels): reproduced by the sub_label handling.
- **Hematology** (with live `=Hct/RBC*10` formulas): **unchanged** — keeps using `sheet_template` mode because Google Docs cannot host live formulas. Any service with a `template_url` stays on the existing flow.

## 5. Output per order

Example — an order with CBC (Hematology) + Urinalysis + FBS + Total Cholesterol + Dengue Rapid:

| File | Source | Contents |
|---|---|---|
| `ALAB-2026-0001 - CBC.xlsx/.gsheet` (existing) | `generateSheetTemplate` | Hematology sheet with live formulas |
| `ALAB-2026-0001 - COMBINED LAB RESULTS.docx` (new) | `generateLabResultsBundle` | Page 1: CLINICAL MICROSCOPY (Urinalysis). Page 2: CLINICAL CHEMISTRY (FBS + Total Cholesterol). Page 3: SEROLOGY (Dengue Rapid). |

Release desk sees the Hematology sheet and one combined DOCX. Simple.

## 6. Migration

No migration required for existing orders. The bundle button only reads forward — for orders encoded BEFORE the raw-values cache existed, the renderer falls back to per-item DOCX links (they're not pulled into the bundle, but nothing breaks). Future orders automatically get the cache.

## 7. Files touched

- `LabBundleRendererCode.js` — **new**, ~460 lines.
- `ResultTemplatesCode.js` — 3-line addition after `saveLabResultAndPdf` writes its RESULT_ITEMS row (caches `raw_values_json`).
- `TechDashboard.html` — two additions: the release-card bundle button (~12 lines of HTML) and a `techdash_generateLabBundle()` client function (~30 lines).

Nothing else is modified.
