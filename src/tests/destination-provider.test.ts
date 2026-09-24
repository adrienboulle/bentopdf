import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DestinationProvider,
  isSupportedUrl,
  DEFAULT_FIELD_NAME,
  type Destination,
  type DestinationDraft,
  type DestinationsConfig,
} from '@/js/utils/destination-provider';

const STORAGE_KEY = 'bentopdf:destinations';

function makeDraft(
  overrides: Partial<DestinationDraft> = {}
): DestinationDraft {
  return {
    name: 'Document manager',
    url: 'https://documents.example.com/api/documents/post_document/',
    method: 'POST',
    fieldName: 'document',
    headers: [{ name: 'Authorization', value: 'Token secret' }],
    extraFields: [{ name: 'title', value: 'Invoice' }],
    mode: 'both',
    ...overrides,
  };
}

function storedConfig(): DestinationsConfig {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
}

describe('destination provider', () => {
  beforeEach(() => {
    localStorage.clear();
    DestinationProvider.reload();
  });

  describe('isSupportedUrl', () => {
    it('should accept an https URL', () => {
      expect(isSupportedUrl('https://documents.example.com/api/')).toBe(true);
    });

    it('should reject an http URL', () => {
      expect(isSupportedUrl('http://documents.example.com/api/')).toBe(false);
    });

    it('should reject a non-HTTP scheme', () => {
      expect(isSupportedUrl('file:///tmp/out.pdf')).toBe(false);
      expect(isSupportedUrl('javascript:alert(1)')).toBe(false);
    });

    it('should reject a malformed URL', () => {
      expect(isSupportedUrl('documents.example.com')).toBe(false);
      expect(isSupportedUrl('')).toBe(false);
    });
  });

  describe('with no stored configuration', () => {
    it('should start empty instead of failing', () => {
      expect(DestinationProvider.getAll()).toEqual([]);
      expect(DestinationProvider.getActiveId()).toBeNull();
      expect(DestinationProvider.getActiveDestination()).toBeNull();
    });

    it('should default the global action to download', () => {
      expect(DestinationProvider.getDefaultAction()).toBe('download');
    });

    it('should not write to localStorage before a change', () => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('save', () => {
    it('should persist a destination and give it an id', () => {
      const saved = DestinationProvider.save(makeDraft());

      expect(saved.id).toBeTruthy();
      expect(storedConfig().destinations).toHaveLength(1);
      expect(storedConfig().destinations[0]).toEqual(saved);
    });

    it('should read back what was written after a reload', () => {
      const saved = DestinationProvider.save(makeDraft());

      DestinationProvider.reload();

      expect(DestinationProvider.get(saved.id)).toEqual(saved);
    });

    it('should update the destination carrying the same id', () => {
      const saved = DestinationProvider.save(makeDraft());
      const updated = DestinationProvider.save(
        makeDraft({ id: saved.id, name: 'Renamed' })
      );

      expect(updated.id).toBe(saved.id);
      expect(DestinationProvider.getAll()).toHaveLength(1);
      expect(DestinationProvider.getAll()[0].name).toBe('Renamed');
    });

    it('should reject a non-https URL', () => {
      expect(() =>
        DestinationProvider.save(makeDraft({ url: 'http://documents.test/' }))
      ).toThrow(/https/);
      expect(DestinationProvider.getAll()).toEqual([]);
    });

    it('should fall back to the default field name when left blank', () => {
      const saved = DestinationProvider.save(makeDraft({ fieldName: '  ' }));

      expect(saved.fieldName).toBe(DEFAULT_FIELD_NAME);
    });

    it('should fall back to the URL when the name is blank', () => {
      const draft = makeDraft({ name: '   ' });
      const saved = DestinationProvider.save(draft);

      expect(saved.name).toBe(draft.url);
    });

    it('should drop header and field rows without a name', () => {
      const saved = DestinationProvider.save(
        makeDraft({
          headers: [
            { name: '', value: 'orphan' },
            { name: 'Authorization', value: 'Token secret' },
          ],
          extraFields: [{ name: '  ', value: 'orphan' }],
        })
      );

      expect(saved.headers).toEqual([
        { name: 'Authorization', value: 'Token secret' },
      ]);
      expect(saved.extraFields).toEqual([]);
    });
  });

  describe('active destination', () => {
    it('should reject an unknown id', () => {
      expect(() => DestinationProvider.setActiveId('nope')).toThrow();
    });

    it('should return the active destination when it sends', () => {
      const saved = DestinationProvider.save(makeDraft({ mode: 'send' }));
      DestinationProvider.setActiveId(saved.id);

      expect(DestinationProvider.getActiveDestination()).toEqual(saved);
    });

    it('should return nothing when the active destination only downloads', () => {
      const saved = DestinationProvider.save(makeDraft({ mode: 'download' }));
      DestinationProvider.setActiveId(saved.id);

      expect(DestinationProvider.getActiveDestination()).toBeNull();
    });

    it('should clear the active id when that destination is removed', () => {
      const saved = DestinationProvider.save(makeDraft());
      DestinationProvider.setActiveId(saved.id);

      DestinationProvider.remove(saved.id);

      expect(DestinationProvider.getActiveId()).toBeNull();
      expect(DestinationProvider.getAll()).toEqual([]);
    });
  });

  describe('default action', () => {
    it('should be persisted', () => {
      DestinationProvider.setDefaultAction('both');
      DestinationProvider.reload();

      expect(DestinationProvider.getDefaultAction()).toBe('both');
    });

    it('should cover a destination with an unusable mode', () => {
      DestinationProvider.setDefaultAction('send');
      const saved = DestinationProvider.save(makeDraft());
      const broken = {
        ...saved,
        mode: 'whatever',
      } as unknown as Destination;

      expect(DestinationProvider.getEffectiveMode(broken)).toBe('send');
    });
  });

  describe('loading a stored configuration', () => {
    it('should keep a valid stored destination', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          destinations: [
            {
              id: 'abc',
              name: 'WebDAV',
              url: 'https://files.example.com/webdav/inbox/',
              method: 'PUT',
              fieldName: 'file',
              headers: [],
              extraFields: [],
              mode: 'send',
            },
          ],
          activeDestinationId: 'abc',
          defaultAction: 'send',
        })
      );

      DestinationProvider.reload();

      expect(DestinationProvider.getAll()).toHaveLength(1);
      expect(DestinationProvider.getActiveId()).toBe('abc');
      expect(DestinationProvider.getDefaultAction()).toBe('send');
    });

    it('should drop a stored destination whose URL is not https and scrub it', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          destinations: [
            { id: 'bad', name: 'Plain HTTP', url: 'http://files.test/' },
            {
              id: 'good',
              name: 'WebDAV',
              url: 'https://files.example.com/webdav/',
              method: 'PUT',
              fieldName: 'file',
              headers: [],
              extraFields: [],
              mode: 'send',
            },
          ],
          activeDestinationId: 'bad',
          defaultAction: 'send',
        })
      );

      DestinationProvider.reload();

      expect(DestinationProvider.getAll().map((d) => d.id)).toEqual(['good']);
      expect(DestinationProvider.getActiveId()).toBeNull();
      expect(storedConfig().destinations).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('should fill in the missing fields of a partial destination', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          destinations: [{ url: 'https://files.example.com/inbox/' }],
        })
      );

      DestinationProvider.reload();

      const [destination] = DestinationProvider.getAll();
      expect(destination.id).toBeTruthy();
      expect(destination.name).toBe('https://files.example.com/inbox/');
      expect(destination.method).toBe('POST');
      expect(destination.fieldName).toBe(DEFAULT_FIELD_NAME);
      expect(destination.mode).toBe('download');
      expect(destination.headers).toEqual([]);
    });

    it('should ignore an unusable stored payload', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(STORAGE_KEY, 'not json');

      DestinationProvider.reload();

      expect(DestinationProvider.getAll()).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('clearAll', () => {
    it('should remove every destination and the stored key', () => {
      DestinationProvider.save(makeDraft());

      DestinationProvider.clearAll();

      expect(DestinationProvider.getAll()).toEqual([]);
      expect(DestinationProvider.getActiveId()).toBeNull();
      expect(DestinationProvider.getDefaultAction()).toBe('download');
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});

describe('build-time preset (VITE_DESTINATIONS_DEFAULT)', () => {
  const preset = JSON.stringify([
    {
      name: 'Documents',
      url: 'https://docs.example.com/api/upload',
      method: 'POST',
      fieldName: 'document',
      mode: 'both',
    },
    { name: 'broken', url: 'http://insecure.example.com/' },
  ]);

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    DestinationProvider.reload();
  });

  it('uses the preset when nothing is stored, first entry active, its mode as default', () => {
    vi.stubEnv('VITE_DESTINATIONS_DEFAULT', preset);
    localStorage.clear();
    DestinationProvider.reload();
    const all = DestinationProvider.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].url).toBe('https://docs.example.com/api/upload');
    expect(DestinationProvider.getActiveId()).toBe(all[0].id);
    expect(DestinationProvider.getDefaultAction()).toBe('both');
  });

  it('is ignored once the user has saved their own configuration', () => {
    vi.stubEnv('VITE_DESTINATIONS_DEFAULT', preset);
    localStorage.setItem(
      'bentopdf:destinations',
      JSON.stringify({
        destinations: [],
        activeDestinationId: null,
        defaultAction: 'download',
      })
    );
    DestinationProvider.reload();
    expect(DestinationProvider.getAll()).toHaveLength(0);
  });

  it('falls back to an empty configuration when the preset is not a JSON array', () => {
    vi.stubEnv('VITE_DESTINATIONS_DEFAULT', '{not json');
    localStorage.clear();
    DestinationProvider.reload();
    expect(DestinationProvider.getAll()).toHaveLength(0);
  });

  describe('runtime preset (config.json destinations)', () => {
    const preset = [
      {
        name: 'Documents',
        url: 'https://docs.example.com/api/upload',
        method: 'POST',
        fieldName: 'document',
        mode: 'send',
      },
      { name: 'broken', url: 'http://insecure.example.com/' },
    ];

    afterEach(() => {
      vi.unstubAllEnvs();
      localStorage.clear();
      DestinationProvider.reload();
    });

    it('applies the preset when nothing is stored, without persisting it', () => {
      localStorage.clear();
      DestinationProvider.reload();
      expect(DestinationProvider.applyRuntimePreset(preset)).toBe(true);
      const all = DestinationProvider.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].url).toBe('https://docs.example.com/api/upload');
      expect(DestinationProvider.getActiveId()).toBe(all[0].id);
      expect(DestinationProvider.getDefaultAction()).toBe('send');
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('wins over the build-time preset', () => {
      vi.stubEnv(
        'VITE_DESTINATIONS_DEFAULT',
        JSON.stringify([{ name: 'Build', url: 'https://build.example.com/' }])
      );
      localStorage.clear();
      DestinationProvider.reload();
      expect(DestinationProvider.getAll()[0].url).toBe(
        'https://build.example.com/'
      );
      expect(DestinationProvider.applyRuntimePreset(preset)).toBe(true);
      expect(DestinationProvider.getAll()[0].url).toBe(
        'https://docs.example.com/api/upload'
      );
    });

    it('is ignored once the user has saved their own configuration', () => {
      DestinationProvider.save(makeDraft({ name: 'Mine' }));
      expect(DestinationProvider.applyRuntimePreset(preset)).toBe(false);
      expect(DestinationProvider.getAll().map((d) => d.name)).toEqual(['Mine']);
    });

    it('is ignored when no entry is valid', () => {
      localStorage.clear();
      DestinationProvider.reload();
      expect(
        DestinationProvider.applyRuntimePreset([{ url: 'http://nope/' }, 42])
      ).toBe(false);
      expect(DestinationProvider.getAll()).toHaveLength(0);
    });
  });
});
