import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadFile } from '@/js/utils/helpers';
import {
  DestinationProvider,
  type DestinationDraft,
  type DestinationMode,
} from '@/js/utils/destination-provider';

vi.mock('@/js/ui.js', () => ({
  showAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
  dom: {},
}));

function makeDraft(mode: DestinationMode): DestinationDraft {
  return {
    name: 'Document manager',
    url: 'https://documents.example.com/api/documents/post_document/',
    method: 'POST',
    fieldName: 'document',
    headers: [],
    extraFields: [],
    mode,
  };
}

function activate(mode: DestinationMode): void {
  const saved = DestinationProvider.save(makeDraft(mode));
  DestinationProvider.setActiveId(saved.id);
}

// jsdom implements neither of these, so downloadFile needs them stubbed.
type ObjectUrlApi = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

describe('downloadFile with a destination', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    DestinationProvider.reload();

    fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const objectUrls = URL as unknown as ObjectUrlApi;
    objectUrls.createObjectURL = vi.fn(() => 'blob:destination-test');
    objectUrls.revokeObjectURL = vi.fn();

    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
    const objectUrls = URL as unknown as Partial<ObjectUrlApi>;
    delete objectUrls.createObjectURL;
    delete objectUrls.revokeObjectURL;
  });

  it('should only download when no destination is configured', () => {
    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should only download when the active destination is set to download', () => {
    activate('download');

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should send without downloading in send mode', () => {
    activate('send');

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');

    expect(clickSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('should send and download in both mode', () => {
    activate('both');

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should pass the filename through to the destination', () => {
    activate('send');

    downloadFile(new Blob(['%PDF-1.7']), 'merged.pdf');

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect((body.get('document') as File).name).toBe('merged.pdf');
  });
});

describe('delivery notice', () => {
  it('shows a corner notice while sending and after success, without a modal', async () => {
    vi.stubGlobal('location', { origin: 'https://app.example.com' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('"ok"', { status: 200 }))
    );
    localStorage.setItem(
      'bentopdf:destinations',
      JSON.stringify({
        destinations: [
          {
            id: 'd1',
            name: 'Docs',
            url: 'https://app.example.com/api/depot',
            method: 'POST',
            fieldName: 'document',
            headers: [],
            extraFields: [],
            mode: 'send',
          },
        ],
        activeDestinationId: 'd1',
        defaultAction: 'send',
      })
    );
    DestinationProvider.reload();
    downloadFile(new Blob(['x']), 'a.pdf');
    const notice = document.getElementById('destination-notice');
    expect(notice).not.toBeNull();
    expect(notice?.className).toContain('border-gray-600');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('destination-notice')?.className).toContain(
      'border-green-500'
    );
    vi.unstubAllGlobals();
    localStorage.clear();
    DestinationProvider.reload();
  });
});
