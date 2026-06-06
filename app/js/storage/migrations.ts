/*
Versioned migrations for the single persisted RootState blob stored in
IndexedDB. These migrations run before model normalization, so they can reshape
old records while fields that newer factories do not yet know about are still
available.
*/

import { DATA_MODEL_VERSION } from "../models/data-model.js";

type PersistedState = Record<string, unknown>;

interface AppStateMigration {
  version: number;
  migrate: (state: PersistedState) => PersistedState;
}

export interface AppStateMigrationResult {
  state: unknown;
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
}

const toStoredVersion = (state: unknown): number => {
  if (!state || typeof state !== "object") return 0;
  const version = (state as { model_version?: unknown }).model_version;
  return Number.isSafeInteger(version) && (version as number) >= 0
    ? (version as number)
    : 0;
};

const cloneState = (state: PersistedState): PersistedState => {
  if (typeof structuredClone === "function") {
    return structuredClone(state) as PersistedState;
  }
  return JSON.parse(JSON.stringify(state)) as PersistedState;
};

// Add future migrations here. Each migration's `version` is the DATA_MODEL_VERSION
// it upgrades *to* and must be larger than the stored state's model_version.
const APP_STATE_MIGRATIONS: AppStateMigration[] = [];

export const migrateAppState = (state: unknown): AppStateMigrationResult => {
  const fromVersion = toStoredVersion(state);
  if (!state || typeof state !== "object") {
    return {
      state,
      migrated: false,
      fromVersion,
      toVersion: DATA_MODEL_VERSION,
    };
  }

  const migrationsToRun = APP_STATE_MIGRATIONS
    .filter((migration) => migration.version > fromVersion)
    .filter((migration) => migration.version <= DATA_MODEL_VERSION)
    .sort((left, right) => left.version - right.version);

  if (migrationsToRun.length === 0) {
    return {
      state,
      migrated: false,
      fromVersion,
      toVersion: DATA_MODEL_VERSION,
    };
  }

  let workingState = cloneState(state as PersistedState);
  for (const migration of migrationsToRun) {
    workingState = migration.migrate(workingState);
    workingState.model_version = migration.version;
  }

  return {
    state: workingState,
    migrated: true,
    fromVersion,
    toVersion: DATA_MODEL_VERSION,
  };
};
