export interface AppConfig {
  disabledTools?: string[];
  editorDisabledCategories?: string[];
  /** Destinations preset for every user (same shape as VITE_DESTINATIONS_DEFAULT). */
  destinations?: unknown[];
}
