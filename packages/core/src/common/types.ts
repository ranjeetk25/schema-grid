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
}

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
