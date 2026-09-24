export type DestinationMethod = 'POST' | 'PUT';
export type DestinationMode = 'download' | 'send' | 'both' | 'ask';

export interface DestinationHeader {
  name: string;
  /** Supports the same `{{filename}}` / `{{basename}}` templates as a field. */
  value: string;
}

export interface DestinationField {
  name: string;
  /**
   * Sent as-is, except for the `{{filename}}` and `{{basename}}` templates,
   * which the sender replaces with the name of the delivered file.
   */
  value: string;
}

export interface Destination {
  id: string;
  name: string;
  url: string;
  method: DestinationMethod;
  /** Multipart field the file is sent under (POST only). */
  fieldName: string;
  headers: DestinationHeader[];
  extraFields: DestinationField[];
  /**
   * What happens when a tool produces a file: download it, send it, both, or
   * ask in the Save dialog which of the two, and under which name.
   */
  mode: DestinationMode;
}

export interface DestinationsConfig {
  destinations: Destination[];
  activeDestinationId: string | null;
  defaultAction: DestinationMode;
}

export type DestinationDraft = Omit<Destination, 'id'> & { id?: string };

const STORAGE_KEY = 'bentopdf:destinations';

export const DEFAULT_FIELD_NAME = 'file';
export const DEFAULT_ACTION: DestinationMode = 'download';

const METHODS: DestinationMethod[] = ['POST', 'PUT'];
const MODES: DestinationMode[] = ['download', 'send', 'both', 'ask'];

function emptyConfig(): DestinationsConfig {
  return {
    destinations: [],
    activeDestinationId: null,
    defaultAction: DEFAULT_ACTION,
  };
}

/**
 * Destinations preset at build time by the operator (`VITE_DESTINATIONS_DEFAULT`,
 * a JSON array of destinations). They are used when the browser has no stored
 * configuration yet, so a self-hosted deployment can work without any per-user
 * setup: the first preset becomes the active destination and its mode becomes
 * the default action. Users can still edit or remove them in Destinations
 * settings; their choice is persisted and takes precedence afterwards.
 */
function presetConfig(): DestinationsConfig {
  const raw = import.meta.env.VITE_DESTINATIONS_DEFAULT;
  if (!raw) return emptyConfig();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const destinations: Destination[] = [];
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      const destination = sanitizeDestination(entry);
      if (destination) destinations.push(destination);
    }
    if (destinations.length === 0) return emptyConfig();
    return {
      destinations,
      activeDestinationId: destinations[0].id,
      defaultAction: destinations[0].mode,
    };
  } catch (e) {
    console.warn(
      '[Destinations] Ignoring VITE_DESTINATIONS_DEFAULT: not a JSON array.',
      e
    );
    return emptyConfig();
  }
}

function newId(): string {
  return crypto.randomUUID();
}

function sanitizePairs(value: unknown): { name: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  const pairs: { name: string; value: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    const raw = (entry as { value?: unknown }).value;
    if (typeof name !== 'string' || !name.trim()) continue;
    pairs.push({
      name: name.trim(),
      value: typeof raw === 'string' ? raw : '',
    });
  }
  return pairs;
}

function sanitizeDestination(value: unknown): Destination | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!isSupportedUrl(url)) return null;

  const method = METHODS.includes(raw.method as DestinationMethod)
    ? (raw.method as DestinationMethod)
    : 'POST';
  const mode = MODES.includes(raw.mode as DestinationMode)
    ? (raw.mode as DestinationMode)
    : DEFAULT_ACTION;
  const fieldName =
    typeof raw.fieldName === 'string' && raw.fieldName.trim()
      ? raw.fieldName.trim()
      : DEFAULT_FIELD_NAME;
  const name =
    typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : url;

  return {
    id,
    name,
    url,
    method,
    fieldName,
    headers: sanitizePairs(raw.headers),
    extraFields: sanitizePairs(raw.extraFields),
    mode,
  };
}

/**
 * Destinations are only reachable over HTTPS: BentoPDF is served over HTTPS,
 * so an http:// destination would be blocked as mixed content anyway.
 */
export function isSupportedUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

class DestinationProviderManager {
  private config: DestinationsConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): DestinationsConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return presetConfig();

      const parsed = JSON.parse(stored) as Partial<DestinationsConfig>;
      const destinations: Destination[] = [];
      let dropped = 0;

      for (const entry of Array.isArray(parsed.destinations)
        ? parsed.destinations
        : []) {
        const destination = sanitizeDestination(entry);
        if (destination) {
          destinations.push(destination);
        } else {
          dropped += 1;
        }
      }

      if (dropped > 0) {
        console.warn(
          `[Destinations] Ignoring ${dropped} stored destination(s) with a ` +
            'missing or non-HTTPS URL. Reconfigure them in Destinations settings.'
        );
      }

      const defaultAction = MODES.includes(
        parsed.defaultAction as DestinationMode
      )
        ? (parsed.defaultAction as DestinationMode)
        : DEFAULT_ACTION;

      const activeDestinationId =
        typeof parsed.activeDestinationId === 'string' &&
        destinations.some((d) => d.id === parsed.activeDestinationId)
          ? parsed.activeDestinationId
          : null;

      const config: DestinationsConfig = {
        destinations,
        activeDestinationId,
        defaultAction,
      };

      if (dropped > 0) this.persist(config);

      return config;
    } catch (e) {
      console.warn(
        '[Destinations] Failed to load config from localStorage:',
        e
      );
    }
    return emptyConfig();
  }

  private persist(config: DestinationsConfig): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.error('[Destinations] Failed to save config to localStorage:', e);
    }
  }

  private saveConfig(): void {
    this.persist(this.config);
  }

  getAll(): Destination[] {
    return this.config.destinations.map((d) => ({ ...d }));
  }

  get(id: string): Destination | undefined {
    const found = this.config.destinations.find((d) => d.id === id);
    return found ? { ...found } : undefined;
  }

  /** Persists a new destination, or updates the one carrying the same id. */
  save(draft: DestinationDraft): Destination {
    const url = draft.url.trim();
    if (!isSupportedUrl(url)) {
      throw new Error('Destination URL must start with https://');
    }

    const destination: Destination = {
      id: draft.id || newId(),
      name: draft.name.trim() || url,
      url,
      method: draft.method,
      fieldName: draft.fieldName.trim() || DEFAULT_FIELD_NAME,
      headers: sanitizePairs(draft.headers),
      extraFields: sanitizePairs(draft.extraFields),
      mode: draft.mode,
    };

    const index = this.config.destinations.findIndex(
      (d) => d.id === destination.id
    );
    if (index >= 0) {
      this.config.destinations[index] = destination;
    } else {
      this.config.destinations.push(destination);
    }

    this.saveConfig();
    return { ...destination };
  }

  remove(id: string): void {
    this.config.destinations = this.config.destinations.filter(
      (d) => d.id !== id
    );
    if (this.config.activeDestinationId === id) {
      this.config.activeDestinationId = null;
    }
    this.saveConfig();
  }

  getActiveId(): string | null {
    return this.config.activeDestinationId;
  }

  setActiveId(id: string | null): void {
    if (id !== null && !this.config.destinations.some((d) => d.id === id)) {
      throw new Error('Unknown destination');
    }
    this.config.activeDestinationId = id;
    this.saveConfig();
  }

  getDefaultAction(): DestinationMode {
    return this.config.defaultAction;
  }

  setDefaultAction(mode: DestinationMode): void {
    this.config.defaultAction = mode;
    this.saveConfig();
  }

  /**
   * The destination results should be sent to, or null when nothing is active
   * or the active destination is set to download only.
   */
  getActiveDestination(): Destination | null {
    const id = this.config.activeDestinationId;
    if (!id) return null;
    const destination = this.config.destinations.find((d) => d.id === id);
    if (!destination) return null;
    return this.getEffectiveMode(destination) === 'download'
      ? null
      : { ...destination };
  }

  /** A destination without an explicit mode falls back to the global default. */
  getEffectiveMode(destination: Destination): DestinationMode {
    return MODES.includes(destination.mode)
      ? destination.mode
      : this.config.defaultAction;
  }

  clearAll(): void {
    this.config = emptyConfig();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('[Destinations] Failed to clear localStorage:', e);
    }
  }

  /** Reloads from localStorage; used by tests and after an external change. */
  reload(): void {
    this.config = this.loadConfig();
  }
}

export const DestinationProvider = new DestinationProviderManager();
