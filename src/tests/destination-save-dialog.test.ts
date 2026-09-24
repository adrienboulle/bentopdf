import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadFile } from '@/js/utils/helpers';
import {
  DestinationProvider,
  type Destination,
  type DestinationDraft,
} from '@/js/utils/destination-provider';

vi.mock('@/js/ui.js', () => ({
  showAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
  dom: {},
}));

const CHOICE_KEY = 'bentopdf:destination-save-choice';

function activate(overrides: Partial<Destination> = {}): void {
  const draft: DestinationDraft = {
    name: 'Document manager',
    url: 'https://documents.example.com/api/documents/post_document/',
    method: 'POST',
    fieldName: 'document',
    headers: [],
    extraFields: [],
    mode: 'ask',
    ...overrides,
  };
  const saved = DestinationProvider.save(draft);
  DestinationProvider.setActiveId(saved.id);
}

function dialog(): HTMLElement | null {
  return document.getElementById('destination-save-dialog');
}

function filenameField(): HTMLInputElement {
  return document.getElementById(
    'destination-save-dialog-filename'
  ) as HTMLInputElement;
}

function radio(action: string): HTMLInputElement {
  return dialog()?.querySelector(
    `input[value="${action}"]`
  ) as HTMLInputElement;
}

function confirmDialog(): void {
  (
    document.getElementById('destination-save-dialog-confirm') as HTMLElement
  ).click();
}

function cancelDialog(): void {
  (
    document.getElementById('destination-save-dialog-cancel') as HTMLElement
  ).click();
}

/** Lets the dialog promise and the delivery it triggers settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// jsdom implements neither of these, so downloadFile needs them stubbed.
type ObjectUrlApi = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

describe('save dialog in ask mode', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let downloaded: string[];

  beforeEach(() => {
    localStorage.clear();
    DestinationProvider.reload();

    fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const objectUrls = URL as unknown as ObjectUrlApi;
    objectUrls.createObjectURL = vi.fn(() => 'blob:destination-test');
    objectUrls.revokeObjectURL = vi.fn();

    downloaded = [];
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded.push(this.download);
      });
  });

  afterEach(async () => {
    // A dialog left open would keep the queue busy for the next test.
    while (dialog()) {
      cancelDialog();
      await flush();
    }
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
    const objectUrls = URL as unknown as Partial<ObjectUrlApi>;
    delete objectUrls.createObjectURL;
    delete objectUrls.revokeObjectURL;
    localStorage.clear();
    DestinationProvider.reload();
  });

  it('should ask instead of downloading or sending right away', () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');

    expect(dialog()).not.toBeNull();
    expect(filenameField().value).toBe('result.pdf');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should default to both, and download and send once confirmed', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    expect(radio('both').checked).toBe(true);
    confirmDialog();
    await flush();

    expect(dialog()).toBeNull();
    expect(downloaded).toEqual(['result.pdf']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect((body.get('document') as File).name).toBe('result.pdf');
  });

  it('should only send when send is picked', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    radio('send').click();
    confirmDialog();
    await flush();

    expect(clickSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should only download when download is picked', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    radio('download').click();
    confirmDialog();
    await flush();

    expect(downloaded).toEqual(['result.pdf']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should neither download nor send when cancelled', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    cancelDialog();
    await flush();

    expect(dialog()).toBeNull();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should use the name typed by the user for both the download and the upload', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    filenameField().value = 'invoice-2026-03';
    confirmDialog();
    await flush();

    expect(downloaded).toEqual(['invoice-2026-03.pdf']);
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect((body.get('document') as File).name).toBe('invoice-2026-03.pdf');
  });

  it('should keep the extension when the user removes it', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    filenameField().value = 'facture';
    confirmDialog();
    await flush();

    expect(downloaded).toEqual(['facture.pdf']);
  });

  it('should keep the produced name when the field is emptied', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    filenameField().value = '   ';
    confirmDialog();
    await flush();

    expect(downloaded).toEqual(['result.pdf']);
  });

  it('should resolve the filename templates with the typed name', async () => {
    activate({
      extraFields: [
        { name: 'title', value: '{{basename}}' },
        { name: 'original', value: '{{filename}}' },
      ],
      headers: [{ name: 'X-Document-Title', value: '{{basename}}' }],
    });

    downloadFile(new Blob(['%PDF-1.7']), 'result.pdf');
    filenameField().value = 'facture';
    radio('send').click();
    confirmDialog();
    await flush();

    const [, init] = fetchMock.mock.calls[0];
    const body = init.body as FormData;
    expect(body.get('title')).toBe('facture');
    expect(body.get('original')).toBe('facture.pdf');
    expect((init.headers as Headers).get('X-Document-Title')).toBe('facture');
  });

  it('should remember the last choice and preselect it next time', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'first.pdf');
    radio('send').click();
    confirmDialog();
    await flush();

    expect(localStorage.getItem(CHOICE_KEY)).toBe('send');

    downloadFile(new Blob(['%PDF-1.7']), 'second.pdf');

    expect(radio('send').checked).toBe(true);
    expect(radio('both').checked).toBe(false);
  });

  it('should ask one file at a time when a tool produces several', async () => {
    activate();

    downloadFile(new Blob(['%PDF-1.7']), 'first.pdf');
    downloadFile(new Blob(['%PDF-1.7']), 'second.pdf');

    expect(document.querySelectorAll('#destination-save-dialog').length).toBe(
      1
    );
    expect(filenameField().value).toBe('first.pdf');

    radio('download').click();
    confirmDialog();
    await flush();

    expect(filenameField().value).toBe('second.pdf');
    confirmDialog();
    await flush();

    expect(downloaded).toEqual(['first.pdf', 'second.pdf']);
  });
});
