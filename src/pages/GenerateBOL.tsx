import UnderConstruction from "../components/UnderConstruction";

// The set-bol command and the BOL defaults in Settings are untouched; the
// page that drives them is being rebuilt.
export default function GenerateBOL() {
  return <UnderConstruction page="Generate BOL" detail="Carrier details still go on at the pack check (Mark Shipped)." backTo={{ to: "/open-picks", label: "Open Picks" }} />;
}
