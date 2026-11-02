import type { AuthedAccount } from "../../middleware/auth.js";
import { prisma } from "../../prisma.js";
import { describeSource, runReportAll, type ReportResult } from "./engine.js";
import type { RenderedReport } from "./render.js";
import { reportSpecSchema, type ReportSpec } from "./spec.js";

// Memorized report groups: every memorized report with the same group name
// that the account may read, run together for Print group and for the
// scheduled email.

export interface GroupReportRun {
  id: string;
  name: string;
  spec: ReportSpec;
  result: ReportResult | null;
  error?: string;
}

export async function companyName(): Promise<string | undefined> {
  const row = await prisma.setting.findUnique({ where: { key: "company_info" } });
  if (!row) return undefined;
  try {
    return (JSON.parse(row.value) as { name?: string }).name;
  } catch {
    return undefined;
  }
}

export async function runGroup(groupName: string, account: AuthedAccount, tzOffset: number): Promise<GroupReportRun[]> {
  const rows = await prisma.savedReport.findMany({
    where: { groupName, OR: [{ shared: true }, { ownerId: account.id }] },
    orderBy: [{ name: "asc" }],
  });
  const out: GroupReportRun[] = [];
  for (const r of rows) {
    const parsed = reportSpecSchema.safeParse(r.spec);
    if (!parsed.success) {
      out.push({ id: r.id, name: r.name, spec: {} as ReportSpec, result: null, error: "This memorized report has no runnable spec." });
      continue;
    }
    try {
      out.push({ id: r.id, name: r.name, spec: parsed.data, result: await runReportAll(parsed.data, { account, tzOffset }) });
    } catch (err) {
      out.push({ id: r.id, name: r.name, spec: parsed.data, result: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

function rangeText(result: ReportResult, spec: ReportSpec): string {
  if (spec.dateRange.preset === "all") return "All dates";
  const { from, to } = result.range;
  if (from && to) return from === to ? from : `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Through ${to}`;
  return "All dates";
}

// A run as the renderers take it.
export function toRendered(name: string, spec: ReportSpec, result: ReportResult, account: AuthedAccount, company: string | undefined, now = new Date()): RenderedReport {
  const dims = describeSource(account, spec.source).dimensions;
  return {
    title: spec.presentation.title || name,
    subtitle: spec.presentation.subtitle || rangeText(result, spec),
    company: spec.presentation.showCompany === false ? undefined : company,
    preparedAt: now,
    rowDims: spec.rows.map((k) => ({ key: k, label: dims.find((d) => d.key === k)?.label ?? k })),
    result,
    presentation: spec.presentation,
  };
}
