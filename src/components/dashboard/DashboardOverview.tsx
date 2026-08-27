import Link from "next/link";
import { card } from "@/components/ui/classnames";
import { SectionTitle } from "@/components/ui/Typography";
import type { DashboardOverview as Overview, FatRow, JobTypeBreakdown } from "@/lib/dashboard-overview";
import { CustomerCards } from "@/components/dashboard/CustomerCards";

// ── The Dashboard's Overview panel (2026-08-27 redesign) ────────────────────
//
// Purely presentational: every figure arrives already computed from
// lib/dashboard-overview.ts's single query pass, so there is no business rule in
// this file and no card fetches anything of its own.
//
// The density rule the redesign is about: a section is ONE bordered frame with
// hairline (`gap-px`) dividers between its cells, never N individually bordered,
// shadowed, padded cards — the same trick the KPI strip and the Monthly ETC
// summary strip already use, which is what lets five KPIs, five type rows and a
// FAT list fit in the space four cards used to occupy.

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 1)));
}

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return DAY_LABEL.format(new Date(Date.UTC(y, m - 1, d)));
}

function countdown(days: number): { text: string; tone: string } {
  if (days === 0) return { text: "Today", tone: "bg-sdc-red-bg text-sdc-red-text" };
  if (days === 1) return { text: "Tomorrow", tone: "bg-sdc-red-bg text-sdc-red-text" };
  if (days <= 14) return { text: `${days} days`, tone: "bg-sdc-yellow-bg text-sdc-yellow-text" };
  return { text: `${days} days`, tone: "bg-sdc-gray-100 text-sdc-gray-600" };
}

// One number, its label, and an optional second line. `href` makes it drillable;
// a KPI with nothing meaningful to drill into stays a plain cell rather than a
// link to somewhere that doesn't answer the question it raises.
function Kpi({
  label,
  value,
  sub,
  href,
  tone = "navy",
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  href?: string;
  tone?: "navy" | "blue" | "yellow" | "muted";
}) {
  const valueClass =
    tone === "blue"
      ? "text-sdc-blue"
      : tone === "yellow"
        ? "text-sdc-yellow-text"
        : tone === "muted"
          ? "text-sdc-gray-400"
          : "text-sdc-navy";
  const body = (
    <div className={`flex h-full flex-col justify-center gap-0.5 bg-white px-4 py-3.5 ${href ? "motion-interactive hover:bg-sdc-blue-light/25" : ""}`}>
      <p className="truncate text-xs font-semibold text-sdc-gray-600">{label}</p>
      <p className={`font-heading text-3xl leading-none font-bold tracking-tight tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="truncate text-label text-sdc-gray-400">{sub}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    <div className="h-full">{body}</div>
  );
}

// A single horizontal proportion bar. Used for the type mix, where the question
// is "how much of the active book is this" — a number alone answers it far more
// slowly than a number beside a bar.
function TypeRow({ row, total, href }: { row: JobTypeBreakdown; total: number; href: string }) {
  const empty = row.count === 0;
  return (
    <Link
      href={href}
      aria-disabled={empty}
      className={`flex items-center gap-3 bg-white px-4 py-2.5 ${empty ? "pointer-events-none opacity-45" : "motion-interactive hover:bg-sdc-blue-light/25"}`}
    >
      <span className="w-20 shrink-0 text-sm font-semibold text-sdc-navy">{row.type}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-sdc-gray-100">
        <span
          className="block h-full rounded-full bg-sdc-blue"
          style={{ width: `${total === 0 ? 0 : (row.count / total) * 100}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right font-heading text-base font-bold tabular-nums text-sdc-navy">{row.count}</span>
      <span className="w-12 shrink-0 text-right text-label tabular-nums text-sdc-gray-400">{row.pct}%</span>
    </Link>
  );
}

function OwnerChips({ label, names, tone }: { label: string; names: string[]; tone: string }) {
  if (names.length === 0) return null;
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-label font-medium ${tone}`}>
      <span className="font-bold">{label}</span>
      <span className="truncate">{names.join(", ")}</span>
    </span>
  );
}

function FatListRow({ row, schedulerHref }: { row: FatRow; schedulerHref: string | null }) {
  const c = countdown(row.daysUntil);
  const inner = (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <span className="font-mono text-label tabular-nums text-sdc-muted">{row.jobNumber}</span>
          <span className="truncate text-sm font-semibold text-sdc-navy" title={row.jobName ?? row.project}>
            {row.jobName ?? row.project}
          </span>
          {row.kind === "pre" && (
            <span className="shrink-0 rounded-full bg-sdc-gray-100 px-1.5 py-0.5 text-label font-semibold text-sdc-gray-600">
              Pre-FAT
            </span>
          )}
        </span>
        <span className="truncate text-label text-sdc-gray-400" title={row.customer ?? undefined}>
          {row.customer ?? "No customer set"}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {/* The FAT task's own assignee wins when the scheduler set one — it is a
            statement about THIS event. The ME/CE names are the fallback: they
            come from the job's schedule, so they answer "who is on this job",
            which is the closest available answer to "who owns this FAT". */}
        {row.assignee && (
          <span className="truncate rounded-md bg-sdc-blue-light px-1.5 py-0.5 text-label font-semibold text-sdc-blue-dark">
            {row.assignee}
          </span>
        )}
        <OwnerChips label="ME" names={row.meOwners} tone="bg-sdc-gray-100 text-sdc-navy" />
        <OwnerChips label="CE" names={row.ceOwners} tone="bg-sdc-green-bg text-sdc-green-text" />
        {!row.assignee && row.meOwners.length === 0 && row.ceOwners.length === 0 && (
          <span className="text-label text-sdc-gray-400">No named owner in Scheduler</span>
        )}
      </span>
      <span className="shrink-0 text-right text-label font-medium whitespace-nowrap text-sdc-gray-600">{dayLabel(row.date)}</span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-center text-label font-semibold whitespace-nowrap tabular-nums ${c.tone}`}>
        {c.text}
      </span>
    </>
  );
  const cls =
    "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_auto_auto] items-center gap-3 bg-white px-4 py-2.5 motion-interactive hover:bg-sdc-blue-light/25";
  return schedulerHref ? (
    <a href={schedulerHref} target="_blank" rel="noopener noreferrer" className={cls} title="Open this schedule in SDC Scheduler">
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

// The outer frame every section shares: one border, one shadow, hairline
// dividers between rows.
function Frame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-px overflow-hidden rounded-xl border border-sdc-border bg-sdc-border-soft shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionHead({ title, note, action }: { title: string; note?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <SectionTitle>{title}</SectionTitle>
        {note && <p className="mt-0.5 text-label text-sdc-gray-400">{note}</p>}
      </div>
      {action}
    </div>
  );
}

export function DashboardOverviewPanel({
  data,
  schedulerBaseUrl,
  schedulerJobNumbers,
}: {
  data: Overview;
  schedulerBaseUrl: string;
  /** Job numbers that actually have a Scheduler project, so a FAT row never links nowhere. */
  schedulerJobNumbers: Set<string>;
}) {
  const label = monthLabel(data.month);
  const eng = data.workforce.find((w) => w.key === "engineering")!;
  const shop = data.workforce.find((w) => w.key === "shop")!;
  const fatHref = (r: FatRow) =>
    schedulerJobNumbers.has(r.jobNumber) ? `${schedulerBaseUrl}/?job=${encodeURIComponent(r.jobNumber)}&view=schedule` : null;

  // ── What these two cards lead with (2026-08-27) ───────────────────────────
  //
  // The headline is HOURS ACTUALLY BOOKED. It used to be `capacityHours`, and
  // that was the whole of the "Engineering and Shop both say 4,056h" bug:
  // capacity is headcount x a policy figure, Engineering and Shop happen to
  // have 26 people each, and 26 x 156h is 4,056 for both. Nothing was shared or
  // cached between the cards — they were each correctly reporting a number
  // nobody wanted, and the real hours (2,269 and 3,011 for 2026-08) were in the
  // small print underneath.
  //
  // Capacity is still here, as the denominator it always was. A planned figure
  // must never be the number a manager reads as hours worked.
  const capacityYear = data.month.slice(0, 4);

  const hoursValue = (w: (typeof data.workforce)[number]) =>
    w.bookedHours == null ? "—" : `${w.bookedHours.toLocaleString()}h`;

  // Where the number can be traced to its punch rows. The Hours tab has no
  // "month" or "standardDepartment" FILTER param — its `departments` filter is
  // the employee's raw HR department string, a different field that has been
  // confused with standardDepartment here once already (2026-08-17). So this
  // scopes the month with from/to and preselects the Standard Department
  // grouping, which lands on a page whose Engineering and Shop rows are the two
  // figures these cards show.
  const [hoursYear, hoursMonth] = data.month.split("-").map(Number);
  const lastDay = new Date(hoursYear, hoursMonth, 0).getDate();
  const hoursHref =
    `/hours?from=${data.month}-01&to=${data.month}-${String(lastDay).padStart(2, "0")}` +
    `&groupBy=standardDepartment`;

  const hoursSub = (w: (typeof data.workforce)[number]) => {
    const people = `${w.headcount} employees`;
    if (w.bookedHours == null) {
      // No punch rows exist for this month at all. Saying "0 hrs booked" here
      // would be a fake zero — the figure is unknown, not nil.
      return `${people} · ${data.monthInFuture ? "no hours booked yet — future month" : "no hours data for this month"}`;
    }
    // Capacity comes from a published, hand-entered holiday calendar, and only
    // the years actually in workforce-capacity-policy.ts have one. Selecting a
    // month outside those years must say WHY the figure is missing rather than
    // silently dropping the comparison.
    if (w.capacityHours == null || w.capacityHours === 0) {
      return `${people} · no holiday calendar for ${capacityYear} yet`;
    }
    const capacity = `${w.capacityHours.toLocaleString()}h capacity`;
    // A percentage of a month still being worked reads as under-utilisation
    // when it only means the month is half over, so a live month states that
    // instead of computing one.
    if (data.isCurrentMonth) return `${people} · month in progress · ${capacity}`;
    return `${people} · ${Math.round((w.bookedHours / w.capacityHours) * 100)}% of ${capacity}`;
  };

  return (
    <div className="flex flex-col gap-7">
      {/* ── Top KPI strip ─────────────────────────────────────────────────── */}
      <Frame className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Active Jobs"
          value={String(data.activeTotal)}
          sub={`${data.byType.filter((t) => t.count > 0).length} project types`}
          href="/jobs?status=Active"
          tone="blue"
        />
        <Kpi
          label={`FATs · ${label}`}
          value={data.fats.available ? String(data.fats.monthTotal) : "—"}
          sub={
            data.fats.available
              ? data.fats.monthPreFats > 0
                ? `+ ${data.fats.monthPreFats} pre-FAT${data.fats.monthPreFats === 1 ? "" : "s"}`
                : "pre-FATs excluded"
              : "Scheduler unavailable"
          }
          tone={data.fats.available ? "navy" : "muted"}
        />
        {/* "Hours" in the label, because the number is hours worked and the card
            used to show capacity under the same wording. The link goes to the
            Hours explorer rather than /employees now: that is where this figure
            can be traced to its punch rows, and the headcount in the sub-line
            still reaches the roster from the Employees tab itself. */}
        <Kpi
          label={`Engineering Hours · ${label}`}
          value={hoursValue(eng)}
          sub={hoursSub(eng)}
          href={hoursHref}
        />
        <Kpi
          label={`Shop Hours · ${label}`}
          value={hoursValue(shop)}
          sub={hoursSub(shop)}
          href={hoursHref}
        />
        <Kpi
          label="Head Start Projects"
          value={String(data.headStartTotal)}
          sub="intent to start, no PO yet"
          href="/jobs?status=HeadStart"
          tone={data.headStartTotal > 0 ? "yellow" : "navy"}
        />
      </Frame>

      {/* ── Active jobs: by type, and by customer ─────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.6fr)]">
        <section>
          <SectionHead
            title="Active Jobs by Project Type"
            note={
              <>
                {data.activeTotal} active job{data.activeTotal === 1 ? "" : "s"} · current status, not month-scoped
              </>
            }
          />
          <Frame className="grid-cols-1">
            {data.byType.map((row) => (
              <TypeRow
                key={row.type}
                row={row}
                total={data.activeTotal}
                href={`/jobs?status=Active&type=${encodeURIComponent(row.type)}`}
              />
            ))}
            {/* Head Start is a STATUS, not a type — a Head Start job is also a
                Custom or a Duplicate. It sits below the bars rather than among
                them so the five rows above still sum to exactly the Active Jobs
                KPI, which is what makes the two reconcile. */}
            <Link
              href="/jobs?status=HeadStart"
              className="flex items-center justify-between gap-3 bg-sdc-yellow-bg/40 px-4 py-2.5 motion-interactive hover:bg-sdc-yellow-bg/70"
            >
              <span className="text-sm font-semibold text-sdc-yellow-text">Head Start (status, separate from Active)</span>
              <span className="font-heading text-base font-bold tabular-nums text-sdc-yellow-text">{data.headStartTotal}</span>
            </Link>
          </Frame>
        </section>

        <section className="min-w-0">
          <SectionHead
            title="Active Jobs by Customer"
            note={`${data.customers.length} customers with active work · grouped on the customer exactly as stored`}
          />
          <CustomerCards customers={data.customers} activeTotal={data.activeTotal} />
        </section>
      </div>

      {/* ── Execution: upcoming FATs + the month's ME/CE breakdown ────────── */}
      <section>
        <SectionHead
          title="Execution — FATs"
          note="Factory Acceptance Tests, live from the SDC Scheduler. Rows open that job's schedule."
        />
        {!data.fats.available ? (
          <div className={`${card("p-5")} text-sm text-sdc-gray-600`}>
            The SDC Scheduler is not reachable from this host, so FAT dates cannot be shown. This is deliberately blank rather
            than zero — the Scheduler is the only source for FAT dates, and an unreachable source is not the same answer as “no
            FATs scheduled”.
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)]">
            <Frame className="min-w-0 grid-cols-1">
              <div className="flex items-center justify-between gap-3 bg-sdc-gray-50/70 px-4 py-2">
                <span className="text-label font-semibold tracking-wider text-sdc-gray-400 uppercase">Next up</span>
                <span className="text-label text-sdc-gray-400">{data.fats.upcoming.length} scheduled from today</span>
              </div>
              {data.fats.upcoming.length === 0 ? (
                <p className="bg-white px-4 py-5 text-sm text-sdc-gray-400">
                  No FATs are scheduled on any active job from today onward.
                </p>
              ) : (
                data.fats.upcoming.slice(0, 12).map((r) => <FatListRow key={r.taskId} row={r} schedulerHref={fatHref(r)} />)
              )}
              {data.fats.upcoming.length > 12 && (
                <p className="bg-white px-4 py-2 text-label text-sdc-gray-400">
                  Showing the 12 nearest of {data.fats.upcoming.length}. The rest are further out than the last row above.
                </p>
              )}
            </Frame>

            <div className="min-w-0">
              <Frame className="grid-cols-2">
                <Kpi label={`FATs in ${label}`} value={String(data.fats.monthTotal)} tone="blue" />
                <Kpi
                  label="Pre-FATs"
                  value={String(data.fats.monthPreFats)}
                  sub="readiness runs, not the FAT"
                />
                <Kpi
                  label="Involving ME"
                  value={String(data.fats.monthWithMe)}
                  sub="named mechanical engineer"
                />
                <Kpi
                  label="Involving CE"
                  value={String(data.fats.monthWithCe)}
                  sub="named controls engineer"
                />
              </Frame>
              {/* ME + CE deliberately do NOT sum to the FAT total: most FATs
                  involve both disciplines, and some have neither named yet.
                  Saying so beats letting someone read the three numbers as a
                  partition and conclude the data is broken. */}
              <p className="mt-2 text-label leading-relaxed text-sdc-gray-400">
                A FAT counts under ME or CE when its job&apos;s Scheduler schedule names a real engineer of that discipline
                (placeholder seats excluded). Most FATs involve both, so these do not sum to the total.
                {data.fats.monthUnstaffed > 0 && (
                  <>
                    {" "}
                    <span className="font-semibold text-sdc-yellow-text">
                      {data.fats.monthUnstaffed} FAT{data.fats.monthUnstaffed === 1 ? " has" : "s have"} no named ME or CE.
                    </span>
                  </>
                )}
              </p>
              {data.fats.monthRows.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-label font-semibold text-sdc-blue">
                    Show the {data.fats.monthRows.length} event{data.fats.monthRows.length === 1 ? "" : "s"} in {label}
                  </summary>
                  <Frame className="mt-2 grid-cols-1">
                    {data.fats.monthRows.map((r) => (
                      <FatListRow key={`m-${r.taskId}`} row={r} schedulerHref={fatHref(r)} />
                    ))}
                  </Frame>
                </details>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Planning: customer visits ─────────────────────────────────────── */}
      <section>
        <SectionHead title="Planning — Customer Visits" note={`Planned visits in ${label}`} />
        {data.visits.configured ? (
          <Frame className="grid-cols-1">
            {data.visits.visits.length === 0 ? (
              <p className="bg-white px-4 py-5 text-sm text-sdc-gray-400">No customer visits are planned in {label}.</p>
            ) : (
              data.visits.visits.map((v) => (
                <div key={`${v.date}-${v.customer}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-white px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-sdc-navy">{v.customer}</span>
                    <span className="block truncate text-label text-sdc-gray-400">
                      {[v.jobNumber, v.jobName, v.owner].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <span className="text-label font-medium whitespace-nowrap text-sdc-gray-600">{dayLabel(v.date)}</span>
                </div>
              ))
            )}
          </Frame>
        ) : (
          <div className={`${card("p-5")} border-dashed`}>
            <p className="text-sm font-semibold text-sdc-navy">No data source yet — this section is intentionally empty.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-sdc-gray-600">
              Customer Visits are not recorded anywhere today. The Scheduler has no visit table and no visit field on{" "}
              <span className="font-mono text-label">projects</span> or <span className="font-mono text-label">tasks</span>;
              this app&apos;s own schema has no visit model; and the parsed Project Release document does not carry a visit
              date. The only visit-shaped rows anywhere are two ad-hoc task names somebody happened to type, which is not a
              source a count can be built on.
            </p>
            <p className="mt-2.5 text-sm leading-relaxed text-sdc-gray-600">
              <span className="font-semibold text-sdc-navy">Open with Mike:</span> where should a Customer Visit be entered in
              the Scheduler — as a first-class visit milestone on a project&apos;s timeline (so it inherits the date cascade and
              can recur), or as one visit date per project? Once that is decided, this section fills in from{" "}
              <span className="font-mono text-label">lib/customer-visits.ts</span> alone; the layout, the month filter and this
              panel are already wired to it.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
