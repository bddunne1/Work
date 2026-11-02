import type { AuthedAccount } from "../middleware/auth.js";
import { sendMail } from "../lib/mail.js";
import { cronMatches, lastDue, parseCron } from "../lib/reports/cron.js";
import { companyName, runGroup, toRendered } from "../lib/reports/groups.js";
import { CONTENT_TYPES, fileName, render, type ExportFormat, type RenderedReport } from "../lib/reports/render.js";
import { prisma } from "../prisma.js";

// Scheduled report groups (sprint 6): every minute the worker looks for
// active schedules whose cron fired since their last run, runs the group as
// the person who made the schedule (so it sees what they may see), renders
// it in the chosen format and mails it. With SMTP_URL unset the mail is
// logged instead and the run still counts.

let running = false;

async function accountFor(id: string | null): Promise<AuthedAccount> {
  const row = id ? await prisma.account.findUnique({ where: { id } }) : null;
  if (!row || !row.active) throw new Error("The account that made this schedule is gone or inactive - edit the schedule to take it over.");
  return { id: row.id, username: row.username, role: row.role, permissions: row.permissions as AuthedAccount["permissions"], initials: row.initials, color: row.color, mustChangePassword: false };
}

export interface ScheduleRunOutcome {
  sent: boolean;
  detail: string;
  reports: number;
  bytes: number;
}

// Runs one schedule now, whatever its cron says (also the Run now button).
export async function runSchedule(id: string, now = new Date()): Promise<ScheduleRunOutcome> {
  const schedule = await prisma.reportSchedule.findUnique({ where: { id } });
  if (!schedule) throw new Error("Schedule not found");
  try {
    const account = await accountFor(schedule.createdById);
    const tzOffset = Number(process.env.REPORT_TZ_OFFSET ?? new Date().getTimezoneOffset());
    const runs = await runGroup(schedule.groupName, account, tzOffset);
    if (runs.length === 0) throw new Error(`No memorized report is in the group "${schedule.groupName}" (or none is readable by ${account.username}).`);
    const company = await companyName();
    const rendered: RenderedReport[] = runs.filter((r) => r.result).map((r) => toRendered(r.name, r.spec, r.result!, account, company, now));
    const failed = runs.filter((r) => !r.result);
    const format = schedule.format as ExportFormat;
    const content = await render(format, rendered);
    const day = now.toISOString().slice(0, 10);
    const outcome = await sendMail({
      to: schedule.recipients as string[],
      subject: `${schedule.groupName} - ${day}`,
      text: [`${schedule.groupName}, prepared ${now.toLocaleString("en-US")}.`, ...rendered.map((r) => `- ${r.title} (${r.subtitle})`), ...failed.map((r) => `- ${r.name}: did not run - ${r.error}`)].join("\n"),
      attachments: [{ filename: fileName(schedule.groupName, format), content, contentType: CONTENT_TYPES[format] }],
    });
    await prisma.reportSchedule.update({ where: { id }, data: { lastRunAt: now, lastError: failed.length ? `${failed.length} report(s) did not run: ${failed.map((r) => r.name).join(", ")}` : null } });
    return { ...outcome, reports: rendered.length, bytes: content.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.reportSchedule.update({ where: { id }, data: { lastRunAt: now, lastError: message.slice(0, 2000) } });
    throw err;
  }
}

// Every active schedule whose cron fired since it last ran.
export async function runDueSchedules(now = new Date()): Promise<string[]> {
  if (running) return [];
  running = true;
  try {
    const schedules = await prisma.reportSchedule.findMany({ where: { active: true } });
    const ran: string[] = [];
    for (const s of schedules) {
      let due: Date | null;
      try {
        const cron = parseCron(s.cron);
        due = cronMatches(cron, now) ? new Date(new Date(now).setSeconds(0, 0)) : lastDue(cron, now);
      } catch {
        continue;
      }
      if (!due || (s.lastRunAt && s.lastRunAt >= due)) continue;
      try {
        await runSchedule(s.id, now);
        console.log(`report schedule "${s.groupName}" ran`);
      } catch (err) {
        console.error(`report schedule "${s.groupName}" failed:`, err instanceof Error ? err.message : err);
      }
      ran.push(s.id);
    }
    return ran;
  } finally {
    running = false;
  }
}

// REPORT_SCHEDULE_INTERVAL_MS (default 60000; 0 disables).
export function startReportScheduler(): (() => void) | null {
  const interval = Number(process.env.REPORT_SCHEDULE_INTERVAL_MS ?? 60_000);
  if (!Number.isFinite(interval) || interval <= 0) return null;
  const timer = setInterval(() => {
    runDueSchedules().catch((err) => console.error("report schedules failed:", err));
  }, interval);
  timer.unref();
  return () => clearInterval(timer);
}
