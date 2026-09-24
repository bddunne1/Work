// Thrown when a whole-object PUT's client-supplied `version` doesn't match
// the row's current version - someone else saved a change first. Each route
// catches this specifically and responds 409; anything else bubbles up to
// the global error handler as a 500 like normal.
export class ConflictError extends Error {
  constructor(message = "This record was changed by someone else since you loaded it. Reload and try again.") {
    super(message);
    this.name = "ConflictError";
  }
}
