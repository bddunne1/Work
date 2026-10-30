import { Link } from "react-router-dom";

// A page whose body is being rebuilt. The route, sidebar entry, page key
// and permissions stay in place so nothing that links here breaks.
export default function UnderConstruction({ page, detail, backTo }: { page: string; detail?: string; backTo?: { to: string; label: string } }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1>{page}</h1>
      </div>
      <div className="under-construction" role="status">
        <div className="under-construction-title">Under construction</div>
        <p>
          {page} is being rebuilt and will return in a later release.
          {detail ? ` ${detail}` : ""}
        </p>
        {backTo && (
          <Link to={backTo.to} className="secondary-btn">
            {backTo.label}
          </Link>
        )}
      </div>
    </div>
  );
}
