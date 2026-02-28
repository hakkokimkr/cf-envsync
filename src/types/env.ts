/** Simple key-value env map */
export type EnvMap = Record<string, string>;

/** An env entry with source tracking */
export interface EnvEntry {
  key: string;
  value: string;
  /** Where this value came from (file path or description) */
  source: string;
}

/** Diff between two env states */
export interface DiffEntry {
  key: string;
  status: "added" | "removed" | "changed" | "unchanged";
  localValue?: string;
  remoteValue?: string;
}

/** Diff between two environments */
export interface EnvDiffEntry {
  key: string;
  status: "match" | "differs" | "missing-left" | "missing-right";
  leftValue?: string;
  rightValue?: string;
}

/** Validation result for a single app in one environment */
export interface ValidationResult {
  app: string;
  environment: string;
  /** Keys present in .env.example but missing from resolved env */
  missingKeys: string[];
  /** Keys present in resolved env but not in .env.example */
  extraKeys: string[];
  /** Per-dev override keys that are missing from .env.local */
  missingOverrides: string[];
  /** Overall pass/fail */
  valid: boolean;
}

/** Result of loading and merging env layers */
export interface ResolvedEnv {
  /** Final merged key-value pairs */
  entries: EnvEntry[];
  /** Map form for easy access */
  map: EnvMap;
  /** Sources that were loaded (in order) */
  layers: string[];
}
