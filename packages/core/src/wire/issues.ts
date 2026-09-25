/** A zod issue reduced to a JSON-safe shape (zod 3 and 4 agree on `path` + `message`). */
export interface WireIssue {
  path: (string | number)[];
  message: string;
}

export function toWireIssues(error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }): WireIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => (typeof p === "number" ? p : String(p))),
    message: issue.message,
  }));
}
