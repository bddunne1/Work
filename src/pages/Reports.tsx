import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listCatalog, REPORT_AREAS, type ReportArea, type StandardReport } from "../lib/reports/engineClient";
import { getReportPreferences, savedRef, setFavorite, type ReportPreferences } from "../lib/reports/preferenceStore";
import { DATE_PRESET_LABELS, DATE_PRESETS, encodeSpec, type DatePreset } from "../lib/reports/spec";
import { useAuth } from "../lib/authContext";
import { canEdit } from "../lib/permissions";
import { deleteSavedReport, listSavedReports, type SavedReport } from "../lib/reportStore";
import ReportSchedules from "../components/ReportSchedules";

type SubTab = "standard" | "memorized" | "favorites" | "recent";
const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "standard", label: "Standard" },
  { key: "memorized", label: "Memorized" },
  { key: "favorites", label: "Favorites" },
  { key: "recent", label: "Recent" },
];

interface Card {
  ref: string;
  name: string;
  description: string;
  area: ReportArea | "Memorized";
  defaultPreset: DatePreset;
  open: (preset: DatePreset) => void;
  standard?: StandardReport;
  saved?: SavedReport;
}

// The Report Center: areas across the top, then Standard, Memorized,
// Favorites and Recent, a card per report with its date range and Run.
// Favorites and Recent are the signed-in person's, kept on the server.
export default function Reports() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const manageSchedules = account ? canEdit("/settings", account) : false;
  const [catalog, setCatalog] = useState<StandardReport[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [prefs, setPrefs] = useState<ReportPreferences>({ favorites: [], recent: [] });
  const [area, setArea] = useState<ReportArea | null>(null);
  const [sub, setSub] = useState<SubTab>("standard");
  const [presets, setPresets] = useState<Record<string, DatePreset>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listCatalog()
      .then((c) => {
        setCatalog(c);
        setArea((a) => a ?? REPORT_AREAS.find((x) => c.some((r) => r.area === x)) ?? null);
      })
      .catch(() => setFailed(true));
    listSavedReports().then(setSaved).catch(() => {});
    getReportPreferences().then(setPrefs).catch(() => {});
  }, []);

  const areas = useMemo(() => REPORT_AREAS.filter((a) => catalog.some((r) => r.area === a)), [catalog]);

  const cards: Card[] = useMemo(() => {
    const standard: Card[] = catalog.map((r) => ({
      ref: r.key,
      name: r.name,
      description: r.description,
      area: r.area,
      defaultPreset: r.defaultPreset,
      standard: r,
      open: (preset) => navigate(`/reports/preset/${r.key}?spec=${encodeSpec({ ...r.spec, dateRange: { preset } })}`),
    }));
    const memorized: Card[] = saved.map((s) => ({
      ref: savedRef(s.id),
      name: s.name,
      description: [s.groupName ? `Group: ${s.groupName}` : "", s.shared ? (s.ownerName ? `Shared by ${s.ownerName}` : "Shared") : "Private", s.spec?.kind === "detail" ? "Detail" : "Summary"].filter(Boolean).join(" · "),
      area: "Memorized",
      defaultPreset: s.spec?.dateRange.preset ?? "all",
      saved: s,
      open: (preset) => navigate(`/reports/saved/${s.id}?spec=${encodeSpec({ ...s.spec, dateRange: preset === s.spec.dateRange.preset ? s.spec.dateRange : { preset } })}`),
    }));
    return [...standard, ...memorized];
  }, [catalog, saved, navigate]);

  const shown: Card[] = (() => {
    switch (sub) {
      case "standard":
        return cards.filter((c) => c.area === area);
      case "memorized":
        return cards.filter((c) => c.saved);
      case "favorites":
        return prefs.favorites.map((ref) => cards.find((c) => c.ref === ref)).filter((c): c is Card => Boolean(c));
      case "recent":
        return prefs.recent.map((r) => cards.find((c) => c.ref === r.ref)).filter((c): c is Card => Boolean(c));
    }
  })();

  async function toggleFavorite(card: Card) {
    const on = !prefs.favorites.includes(card.ref);
    setPrefs((p) => ({ ...p, favorites: on ? [...p.favorites, card.ref] : p.favorites.filter((r) => r !== card.ref) }));
    setPrefs(await setFavorite(card.ref, on));
  }

  const groups = [...new Set(saved.map((s) => s.groupName).filter((g): g is string => Boolean(g)))].sort();

  async function handleDelete(r: SavedReport) {
    if (!confirm(`Delete the memorized report "${r.name}"?`)) return;
    await deleteSavedReport(r.id);
    setSaved(await listSavedReports());
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Report Center</h1>
        <p className="muted">Standard reports by area, run on the server over the period you pick. Memorize a report to keep its setup; star one to find it under Favorites.</p>
      </div>

      {failed && (
        <div className="form-error" role="alert">
          The report catalog did not load. Reload to try again.
        </div>
      )}

      <div className="release-tabs report-center-areas" role="tablist" aria-label="Report areas">
        {areas.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={sub === "standard" && area === a}
            className={`release-tab${sub === "standard" && area === a ? " is-active" : ""}`}
            onClick={() => {
              setArea(a);
              setSub("standard");
            }}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="report-center-subtabs" role="tablist" aria-label="Report lists">
        {SUB_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={sub === t.key} className={sub === t.key ? "primary-btn" : "secondary-btn"} onClick={() => setSub(t.key)}>
            {t.label}
            {t.key === "favorites" && prefs.favorites.length > 0 ? ` (${prefs.favorites.length})` : ""}
            {t.key === "memorized" && saved.length > 0 ? ` (${saved.length})` : ""}
          </button>
        ))}
      </div>

      {sub === "memorized" && groups.length > 0 && (
        <div className="report-groups no-print" aria-label="Report groups">
          <span className="muted">Groups:</span>
          {groups.map((g) => (
            <button key={g} type="button" className="row-action-outline" onClick={() => navigate(`/reports/group/${encodeURIComponent(g)}`)}>
              Print group · {g} ({saved.filter((s) => s.groupName === g).length})
            </button>
          ))}
        </div>
      )}

      <section className="lane-section">
        {shown.length === 0 ? (
          <p className="muted">
            {sub === "favorites" ? "No favorites yet: star a report card to keep it here." : sub === "recent" ? "Nothing run yet." : sub === "memorized" ? "No memorized reports yet: open a report, customize it and choose Memorize." : "Nothing in this area yet."}
          </p>
        ) : (
          <div className="module-grid">
            {shown.map((c) => (
              <div key={c.ref} className="module-card active" data-testid={`report-card-${c.ref}`}>
                <button type="button" className={`report-card-star${prefs.favorites.includes(c.ref) ? " is-on" : ""}`} aria-label={prefs.favorites.includes(c.ref) ? `Remove ${c.name} from favorites` : `Add ${c.name} to favorites`} aria-pressed={prefs.favorites.includes(c.ref)} onClick={() => toggleFavorite(c)}>
                  {prefs.favorites.includes(c.ref) ? "★" : "☆"}
                </button>
                <div className="module-name">{c.name}</div>
                <div className="module-desc">{c.description}</div>
                <div className="report-card-actions">
                  <select aria-label={`${c.name} date range`} value={presets[c.ref] ?? c.defaultPreset} onChange={(e) => setPresets((p) => ({ ...p, [c.ref]: e.target.value as DatePreset }))}>
                    {DATE_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {DATE_PRESET_LABELS[p]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="primary-btn" onClick={() => c.open(presets[c.ref] ?? c.defaultPreset)}>
                    Run
                  </button>
                  {c.saved?.canEdit && (
                    <button type="button" className="row-action-outline danger-link" onClick={() => handleDelete(c.saved!)} aria-label={`Delete ${c.name}`}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {sub === "memorized" && manageSchedules && <ReportSchedules groups={groups} />}
    </div>
  );
}
