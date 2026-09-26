/** Reference to the actor (user/system) that made a change. */
export interface ActorRef {
  id: string;
  name?: string;
}

/** A choice in a select/multiSelect/creatableSelect column. */
export interface Option {
  id: string;
  label: string;
  color?: string;
  /**
   * Who may SET this option (default `"all"`). A value already holding a
   * restricted option stays readable; only introducing it is refused
   * ("Option “Verified” can only be set by Admin"). See `resolveSettableOptions`.
   */
  settableBy?: RoleRule;
  /**
   * v0.3.1: the message shown when a user may not set this option, in place of
   * the generated "Option “X” can only be set by …" / "can’t be set manually".
   */
  settableMessage?: string;
}

/** `"all"` or an explicit role list (column permissions, `Option.settableBy`). */
export type RoleRule = "all" | { roles: string[] };

/** A reference to a record in another table (link field). */
export interface LinkRef {
  id: string;
  label: string;
}

/** A reference to a user (user field). */
export interface UserRef {
  id: string;
  name?: string;
}

/** Calendar date, "YYYY-MM-DD". */
export type ISODateString = string;

/** UTC instant, ISO 8601 ending in "Z". */
export type ISODateTimeString = string;
