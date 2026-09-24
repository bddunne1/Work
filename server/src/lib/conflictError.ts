// An expected, user-facing failure raised from inside a route (often deep
// inside a transaction, where throwing is the only way to roll back). The
// global error handler in index.ts turns it into `status` + `{ error }`
// instead of a generic 500.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Thrown when a whole-object PUT's client-supplied `version` doesn't match
// the row's current version - someone else saved a change first. Each route
// catches this specifically and responds 409; anything else bubbles up to
// the global error handler as a 500 like normal.
export class ConflictError extends HttpError {
  constructor(message = "This record was changed by someone else since you loaded it. Reload and try again.") {
    super(409, message, { conflict: true });
    this.name = "ConflictError";
  }
}
