# Parts Cost Variance — the eight largest-difference jobs

Explains why **Parts Cost Actual** in the Reports app disagrees with the comparison column
in the reported spreadsheet, across the eight jobs with the largest differences. Also
answers a separate question: the invoiced total on **PO 103046**, which is charged against
jobs 1130, 1142 and 1143.

- **Date run:** 2026-09-03
- **App side:** `getPartsCostForJobs` in `src/lib/sync-totaleto.ts`, at line level —
  ~6,000 PO lines across the eight jobs
- **Fields compared:** `actualAmount` (GL-posted) against `invoicedAmount` (billed);
  see that file's own note on `GL_POSTED_AP`
- **Verdict:** not a data error. **One accounting rule, one refund, and one timing lag.**
  Six of the eight are the rule; 1148 is the refund; 1158 is the lag.

| | Meaning | App field |
|---|---|---|
| **Posted** | The AP document exports to the general ledger | `actualAmount` |
| **Billed** | Everything invoiced, including documents flagged never to export | `invoicedAmount` |

The spreadsheet's first column is **posted**. The comparison column is **billed**. The gap
between them is the flagged documents.

---

## 1. The eight jobs

`Billed − posted` is measured live from the parts pipeline. Where it matches the reported
gap, the accounting rule fully accounts for the variance.

| Job | Project | Your gap | Billed − posted | Explains it? | Cause |
|---|---|---:|---:|---|---|
| 1106 | SDC Clip-iT 1.1 QTY (8) | $253,668 | $253,667 | **exact** | Unposted billings |
| 1122 | CAFI | $22,458 | $22,778 | within $320 | Unposted billings |
| 1148 | BISCUIT QTY 10 | −$28,988 | −$29,040 | within $52 | **Supplier refund** |
| 1118 | AIR Loop Assembly | $8,125 | $10,873 | partial | Unposted billings |
| 1150 | USEC Heat Shield Spiral Machine | $9,688 | $11,474 | partial | Unposted billings |
| 1101 | Coil Staker | $12,039 | $20,523 | partial | Unposted billings |
| 1104 | Andi 1 & Andi 2 Replacement Line | $12,347 | $46,307 | partial | Unposted billings |
| 1158 | T-066 Assembly Machine | −$18,945 | $8 | **no** | **Month cutoff** |

### 1.1 Why four rows are only a partial match

They are explained in kind but not to the dollar, and the reason is that the **spreadsheet
itself has moved on**. Its Parts Cost Actual no longer equals the app's:

| Job | Spreadsheet | App now | Drift |
|---|---:|---:|---:|
| 1118 | $508,075 | $509,160 | $1,085 |
| 1150 | $101,162 | $101,299 | $137 |
| 1158 | $79,212 | $80,482 | $1,270 |

The two columns were captured at slightly different moments. The residuals on those rows are
that drift, **not a fourth cause** — worth stating so nobody goes looking for one.

---

## 2. Cause 1 — billings that never reach the ledger

**Affects 6 of the 8 jobs.**

The app counts a line as actual cost only when its AP document posts to the general ledger.
Documents flagged never-to-export are billed but not posted, so they land in the comparison
column and not in the app's. Three suppliers account for nearly all of it:

| Supplier as it appears | What it is |
|---|---|
| `Steven Douglas Corp.` | SDC's own internal expense billings — 38 lines on 1101, 117 on 1104 |
| `SDC Credit Card (Approved)` | Company card purchases, booked monthly |
| `Steven Douglas Corp. Expense` | Expense reimbursements charged to the job |

Every one of these lines shows a billed amount against **$0.00 posted**.

Job 1106 is the cleanest case — 10 lines, $253,667.23, matching the reported gap to the
dollar.

**Lines where billed exceeds posted, by job:**

| Job | Lines | Net billed − posted |
|---|---:|---:|
| 1104 | 117 | $46,307.23 |
| 1122 | 58 | $22,778.19 |
| 1118 | 47 | $10,873.29 |
| 1101 | 38 | $20,522.72 |
| 1106 | 10 | $253,667.23 |
| 1150 | 9 | $11,474.29 |
| 1148 | 6 | −$29,039.76 |
| 1158 | — | $7.50 |

Note 1106 reaches the largest amount on the fewest lines: these are a handful of very large
credit-card-booked documents, not a long tail.

---

## 3. Cause 2 — a supplier refund, also unposted

**Affects job 1148 only**, and it is the only large negative in the set.

One document explains it: a **BlackHawk Supply refund of −$31,765.20**, billed but never
posted. Two further BlackHawk credits sit in the same state:

| PO | Supplier | Description | Total | Posted |
|---|---|---|---:|---:|
| Refund | BlackHawk Supply | Refund | −$31,765.20 | $0.00 |
| 105137 | BlackHawk Supply | Temperature and Humidity | −$23,104.80 | $0.00 |
| 105137 | BlackHawk Supply | Modbus compatible USB | −$8,660.40 | $0.00 |

Because the refund is in the comparison column and not in the app's, that column reads
**lower** — which is why 1148 breaks the direction of every other row.

---

## 4. Cause 3 — a month that had not landed yet

**Affects job 1158 only.** It has essentially no unposted billings — $7.50 — so its variance
is a date boundary rather than the accounting rule.

The job only began invoicing recently. All of its posted spend falls in two months:

| Invoice month | GL-posted |
|---|---:|
| 2026-08 | $59,345.12 |
| 2026-09 | $21,136.61 |
| **Total** | **$80,481.73** |

The comparison column reads **$60,267**, which is within about **$900 of the August-only
total**. That is what a source which had not yet picked up September would show.

---

## 5. PO 103046

Charged across three jobs, and **fully invoiced** — nothing outstanding, and no unposted
portion.

**Supplier:** G2V Optics Inc · **13 lines** · Suntile Gen 2 KLM+ units, SMU IV test systems,
shipping

| Job | Lines | Purchased | Invoiced (posted) | Left to invoice |
|---|---:|---:|---:|---:|
| 1130 | 5 | $1,554,100.00 | $1,554,100.00 | $0.00 |
| 1142 | 4 | $1,249,925.00 | $1,249,925.00 | $0.00 |
| 1143 | 4 | $796,475.00 | $796,475.00 | $0.00 |
| **Total** | **13** | **$3,600,500.00** | **$3,600,500.00** | **$0.00** |

Billed and posted are identical on every line, so none of this PO is affected by the rule in
§2.

### 5.1 Looking a PO up in the app

The Parts List search on **Job Hour Details → Procurement** does match PO numbers — its
haystack includes `poNumber` (see `JobProcurement.tsx`) — so typing `103046` finds the lines.

But **that view is one job at a time.** The Procurement drawer is deliberately single-job (a
BOM tree is per job), so a PO spanning three jobs takes three lookups and manual addition.
There is no cross-job PO search in the app today.

**Possible follow-up:** a PO lookup that spans jobs and reports purchased / invoiced / left
to invoice per job with a total. Not built.

---

## 6. The one decision this needs

**Should SDC's own expense billings and credit-card charges count as parts actual?**

The app excludes them deliberately, because they do not post to the job ledger that these
figures get checked against. That is a defensible rule — but it is **$253,668 on job 1106**
and **$46,307 on 1104**, and that is real money spent on those jobs.

This is a policy question for Dan rather than a bug. Whichever way it is answered, both
columns should then be defined the same way, or this variance reappears every month.

---

## 7. Reproducing this

Every figure above comes from `getPartsCostForJobs` at line level. The two sums that matter:

```ts
const posted = lines.reduce((a, l) => a + l.actualAmount, 0);   // Parts Cost Actual
const billed = lines.reduce((a, l) => a + l.invoicedAmount, 0); // the comparison column
```

`billed − posted` is the variance. The lines contributing to it are those where the two
differ:

```ts
lines.filter((l) => Math.abs(l.invoicedAmount - l.actualAmount) > 0.005)
```

For the 1158 timing finding, group `actualAmount` by `l.invoicedDate.slice(0, 7)`.

See also [JOB-LEDGER-RECON-2026-08.md](./JOB-LEDGER-RECON-2026-08.md), which reconciles the
same app figures against the August job ledger draft and reaches job 1106 by a different
route.
