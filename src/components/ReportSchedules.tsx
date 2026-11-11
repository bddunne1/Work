import { useEffect, useState } from "react";
import { createSchedule, deleteSchedule, listSchedules, runScheduleNow, updateSchedule, type ExportFormat, type ReportSchedule, type ScheduleInput } from "../lib/reportStore";
import { showToast } from "../lib/toast";
import { useDismissable } from "../lib/useDismissable";

interface Props {
  groups: string[];
}

const EMPTY: ScheduleInput = { groupName: "", cron: "0 7 * * 1-5", format: "pdf", recipients: [], active: true };

// Scheduled report groups (admins and Settings editors): each sends a group
// by email on a cron schedule in PDF, CSV or XLSX. Run now sends it today.
export default function ReportSchedules({ groups }: Props) {
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [draft, setDraft] = useState<ScheduleInput>(EMPTY);
  const [recipientsText, setRecipientsText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The form sits inline: focus moves in, Escape closes it and returns focus.
  const formRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  const reload = () => listSchedules().then(setSchedules).catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  function startNew() {
    setEditing(null);
    setDraft({ ...EMPTY, groupName: groups[0] ?? "" });
    setRecipientsText("");
    setOpen(true);
  }
  function startEdit(s: ReportSchedule) {
    setEditing(s);
    setDraft({ groupName: s.groupName, cron: s.cron, format: s.format, recipients: s.recipients, active: s.active });
    setRecipientsText(s.recipients.join(", "));
    setOpen(true);
  }
  async function save() {
    const input: ScheduleInput = { ...draft, recipients: recipientsText.split(/[,\s;]+/).map((r) => r.trim()).filter(Boolean) };
    try {
      if (editing) await updateSchedule(editing.id, input);
      else await createSchedule(input);
      setOpen(false);
      await reload();
      showToast(editing ? "Schedule saved." : "Schedule added.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }
  async function runNow(s: ReportSchedule) {
    setBusy(s.id);
    try {
      const r = await runScheduleNow(s.id);
      showToast(r.sent ? `Sent ${s.groupName} to ${s.recipients.length} recipient${s.recipients.length === 1 ? "" : "s"}.` : `Ran ${s.groupName} (${r.reports} report${r.reports === 1 ? "" : "s"}); mail is not configured, so it was logged on the server.`, r.sent ? "success" : "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
      await reload();
    }
  }
  async function remove(s: ReportSchedule) {
    if (!confirm(`Delete the schedule for "${s.groupName}"?`)) return;
    await deleteSchedule(s.id);
    await reload();
  }

  return (
    <section className="lane-section no-print" aria-label="Report schedules">
      <div className="toolbar" style={{ alignItems: "center" }}>
        <h3 className="item-profile-heading" style={{ margin: 0 }}>
          Scheduled groups
        </h3>
        <button type="button" className="secondary-btn" onClick={startNew} disabled={groups.length === 0}>
          + Schedule a group
        </button>
      </div>
      {groups.length === 0 && <p className="muted">Put memorized reports in a group to schedule them.</p>}
      {schedules.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Schedule (cron)</th>
              <th>Format</th>
              <th>Recipients</th>
              <th>Last run</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <td>{s.groupName}</td>
                <td>
                  <code>{s.cron}</code>
                </td>
                <td>{s.format.toUpperCase()}</td>
                <td>{s.recipients.join(", ")}</td>
                <td>
                  {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "Never"}
                  {s.lastError ? <div className="form-error">{s.lastError}</div> : null}
                </td>
                <td>{s.active ? "Yes" : "Paused"}</td>
                <td>
                  <div className="inline-actions">
                    <button type="button" className="row-action-outline" onClick={() => runNow(s)} disabled={busy === s.id}>
                      {busy === s.id ? "Running…" : "Run now"}
                    </button>
                    <button type="button" className="row-action-outline" onClick={() => startEdit(s)}>
                      Edit
                    </button>
                    <button type="button" className="row-action-outline danger-link" onClick={() => remove(s)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <div className="report-memorize" role="dialog" aria-label={editing ? "Edit schedule" : "New schedule"} ref={formRef}>
          <label className="form-field">
            Group
            <select value={draft.groupName} onChange={(e) => setDraft({ ...draft, groupName: e.target.value })}>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Schedule (cron: minute hour day month weekday)
            <input value={draft.cron} onChange={(e) => setDraft({ ...draft, cron: e.target.value })} placeholder="0 7 * * 1-5" />
          </label>
          <label className="form-field">
            Format
            <select value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value as ExportFormat })}>
              <option value="pdf">PDF</option>
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="form-field">
            Recipients (comma separated)
            <input value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)} placeholder="cfo@example.com, ops@example.com" />
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active
          </label>
          <div className="inline-actions">
            <button type="button" className="primary-btn" onClick={save} disabled={!draft.groupName || !draft.cron.trim() || !recipientsText.trim()}>
              {editing ? "Save schedule" : "Add schedule"}
            </button>
            <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
