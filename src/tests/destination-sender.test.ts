import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendToDestination } from '@/js/utils/destination-sender';
import type { Destination } from '@/js/utils/destination-provider';

vi.mock('@/js/ui.js', () => ({
  showAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
}));

function makeDestination(overrides: Partial<Destination> = {}): Destination {
  return {
    id: 'destination-1',
    name: 'Document manager',
    url: 'https://documents.example.com/api/documents/post_document/',
    method: 'POST',
    fieldName: 'document',
    headers: [{ name: 'Authorization', value: 'Token secret' }],
    extraFields: [{ name: 'title', value: 'Invoice' }],
    mode: 'send',
    ...overrides,
  };
}

function pdfBlob(): Blob {
  return new Blob(['%PDF-1.7'], { type: 'application/pdf' });
}

function okResponse(): Response {
  return new Response('', { status: 201, statusText: 'Created' });
}

describe('sendToDestination', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('POST', () => {
    it('should post a multipart body with the file under the configured field', async () => {
      await sendToDestination(pdfBlob(), 'result.pdf', makeDestination());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://documents.example.com/api/documents/post_document/'
      );
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);

      const body = init.body as FormData;
      const file = body.get('document') as File;
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe('result.pdf');
      expect(body.get('title')).toBe('Invoice');
    });

    it('should send the configured headers', async () => {
      await sendToDestination(pdfBlob(), 'result.pdf', makeDestination());

      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      expect(headers.get('Authorization')).toBe('Token secret');
    });

    it('should leave Content-Type to the browser so the boundary is kept', async () => {
      await sendToDestination(
        pdfBlob(),
        'result.pdf',
        makeDestination({
          headers: [{ name: 'content-type', value: 'application/pdf' }],
        })
      );

      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      expect(headers.has('Content-Type')).toBe(false);
    });

    it('should skip an extra field without a name', async () => {
      await sendToDestination(
        pdfBlob(),
        'result.pdf',
        makeDestination({ extraFields: [{ name: '', value: 'orphan' }] })
      );

      const body = fetchMock.mock.calls[0][1].body as FormData;
      expect([...body.keys()]).toEqual(['document']);
    });

    it('should not send cookies', async () => {
      await sendToDestination(pdfBlob(), 'result.pdf', makeDestination());

      expect(fetchMock.mock.calls[0][1].credentials).toBe('same-origin');
    });
  });

  describe('PUT', () => {
    const webdav = makeDestination({
      method: 'PUT',
      url: 'https://files.example.com/webdav/inbox',
      headers: [{ name: 'Authorization', value: 'Basic dXNlcjpwYXNz' }],
    });

    it('should put the raw file at url/<filename>', async () => {
      const blob = pdfBlob();

      await sendToDestination(blob, 'result.pdf', webdav);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://files.example.com/webdav/inbox/result.pdf');
      expect(init.method).toBe('PUT');
      expect(init.body).toBe(blob);
    });

    it('should percent-encode the filename', async () => {
      await sendToDestination(pdfBlob(), 'my report #1.pdf', webdav);

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://files.example.com/webdav/inbox/my%20report%20%231.pdf'
      );
    });

    it('should derive Content-Type from the blob', async () => {
      await sendToDestination(pdfBlob(), 'result.pdf', webdav);

      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      expect(headers.get('Content-Type')).toBe('application/pdf');
      expect(headers.get('Authorization')).toBe('Basic dXNlcjpwYXNz');
    });

    it('should fall back to an octet stream for a typeless blob', async () => {
      await sendToDestination(new Blob(['x']), 'result.bin', webdav);

      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      expect(headers.get('Content-Type')).toBe('application/octet-stream');
    });
  });

  describe('failures', () => {
    it('should report the HTTP status and reason', async () => {
      fetchMock.mockResolvedValue(
        new Response('', { status: 401, statusText: 'Unauthorized' })
      );

      await expect(
        sendToDestination(pdfBlob(), 'result.pdf', makeDestination())
      ).rejects.toThrow('HTTP 401 Unauthorized');
    });

    it('should report a status without a reason phrase', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 500 }));

      await expect(
        sendToDestination(pdfBlob(), 'result.pdf', makeDestination())
      ).rejects.toThrow('HTTP 500');
    });

    it('should report a network error and point at the CSP', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        sendToDestination(pdfBlob(), 'result.pdf', makeDestination())
      ).rejects.toThrow(/Network error: Failed to fetch[\s\S]*connect-src/);
    });

    it('should refuse a non-https destination without calling fetch', async () => {
      await expect(
        sendToDestination(
          pdfBlob(),
          'result.pdf',
          makeDestination({ url: 'http://documents.example.com/api/' })
        )
      ).rejects.toThrow(/https/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('filename templates', () => {
    it('should resolve {{filename}} and {{basename}} in extra fields', async () => {
      await sendToDestination(
        pdfBlob(),
        'invoice-2026-03.pdf',
        makeDestination({
          extraFields: [
            { name: 'title', value: '{{basename}}' },
            { name: 'original', value: '{{filename}}' },
            { name: 'note', value: 'Scan of {{ basename }}' },
          ],
        })
      );

      const body = fetchMock.mock.calls[0][1].body as FormData;
      expect(body.get('title')).toBe('invoice-2026-03');
      expect(body.get('original')).toBe('invoice-2026-03.pdf');
      expect(body.get('note')).toBe('Scan of invoice-2026-03');
    });

    it('should resolve the same templates in headers', async () => {
      await sendToDestination(
        pdfBlob(),
        'invoice-2026-03.pdf',
        makeDestination({
          headers: [
            { name: 'Authorization', value: 'Token secret' },
            { name: 'X-Document-Title', value: '{{basename}}' },
          ],
        })
      );

      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      expect(headers.get('X-Document-Title')).toBe('invoice-2026-03');
      expect(headers.get('Authorization')).toBe('Token secret');
    });

    it('should resolve templates for a PUT destination too', async () => {
      await sendToDestination(
        pdfBlob(),
        'invoice-2026-03.pdf',
        makeDestination({
          method: 'PUT',
          url: 'https://files.example.com/webdav/inbox',
          headers: [{ name: 'Slug', value: '{{filename}}' }],
        })
      );

      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      expect(headers.get('Slug')).toBe('invoice-2026-03.pdf');
    });

    it('should leave a value without a template untouched', async () => {
      await sendToDestination(
        pdfBlob(),
        'result.pdf',
        makeDestination({
          extraFields: [
            { name: 'title', value: 'Scanned invoice' },
            { name: 'other', value: '{{unknown}}' },
          ],
        })
      );

      const body = fetchMock.mock.calls[0][1].body as FormData;
      expect(body.get('title')).toBe('Scanned invoice');
      expect(body.get('other')).toBe('{{unknown}}');
    });
  });
});

describe('same-origin 401 recovery', () => {
  // jsdom serves the tests from http://localhost; the sender only accepts
  // https destinations, so pretend the app itself is served over https.
  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://app.example.com' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('primes the credential cache with a GET on the root and retries once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('"task-id"', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const destination: Destination = {
      id: 'd1',
      name: 'Same origin',
      url: `${location.origin}/api/depot`,
      method: 'POST',
      fieldName: 'document',
      headers: [],
      extraFields: [],
      mode: 'send',
    };
    await expect(
      sendToDestination(new Blob(['x']), 'a.pdf', destination)
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(`${location.origin}/`);
    expect(fetchMock.mock.calls[1][1].method).toBe('GET');
    expect(fetchMock.mock.calls[2][1].method).toBe('POST');
  });

  it('gives up after one retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const destination: Destination = {
      id: 'd1',
      name: 'Same origin',
      url: `${location.origin}/api/depot`,
      method: 'POST',
      fieldName: 'document',
      headers: [],
      extraFields: [],
      mode: 'send',
    };
    await expect(
      sendToDestination(new Blob(['x']), 'a.pdf', destination)
    ).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
