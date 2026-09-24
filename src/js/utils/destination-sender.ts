import { t } from '../i18n/index.js';
import { triggerBrowserDownload } from './browser-download.js';
import {
  DestinationProvider,
  isSupportedUrl,
  type Destination,
} from './destination-provider.js';
import {
  askDestinationSave,
  splitFilename,
} from './destination-save-dialog.js';

const SEND_TIMEOUT_MS = 60000;

function joinUrl(base: string, filename: string): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}${encodeURIComponent(filename)}`;
}

/**
 * Resolves the templates a header or extra field value may contain:
 * `{{filename}}` is the name of the delivered file, `{{basename}}` the same
 * without its extension. It is what lets a generic destination carry the name
 * as metadata, for instance `title: {{basename}}` to title a document in a
 * document manager.
 */
function applyFilenameTemplates(value: string, filename: string): string {
  if (!value.includes('{{')) return value;
  const { base } = splitFilename(filename);
  return value
    .replace(/\{\{\s*filename\s*\}\}/g, filename)
    .replace(/\{\{\s*basename\s*\}\}/g, base);
}

function buildHeaders(destination: Destination, filename: string): Headers {
  const headers = new Headers();
  for (const header of destination.headers) {
    if (!header.name.trim()) continue;
    // The browser sets Content-Type (with the multipart boundary) itself.
    if (
      destination.method === 'POST' &&
      header.name.trim().toLowerCase() === 'content-type'
    ) {
      continue;
    }
    headers.set(
      header.name.trim(),
      applyFilenameTemplates(header.value, filename)
    );
  }
  return headers;
}

function buildRequest(
  blob: Blob,
  filename: string,
  destination: Destination
): { url: string; headers: Headers; body: Blob | FormData } {
  const headers = buildHeaders(destination, filename);

  if (destination.method === 'PUT') {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', blob.type || 'application/octet-stream');
    }
    return {
      url: joinUrl(destination.url, filename),
      headers,
      body: blob,
    };
  }

  const form = new FormData();
  form.append(destination.fieldName, blob, filename);
  for (const field of destination.extraFields) {
    if (!field.name.trim()) continue;
    form.append(
      field.name.trim(),
      applyFilenameTemplates(field.value, filename)
    );
  }

  return { url: destination.url, headers, body: form };
}

/**
 * Uploads a processed file to a user-configured destination.
 *
 * POST sends a multipart body with the file under the configured field name;
 * PUT sends the raw file to `<url>/<filename>` (the WebDAV convention).
 * Rejects with a message carrying the HTTP status or the network failure.
 */
export async function sendToDestination(
  blob: Blob,
  filename: string,
  destination: Destination,
  retried = false
): Promise<void> {
  if (!isSupportedUrl(destination.url)) {
    throw new Error('Destination URL must start with https://');
  }

  const { url, headers, body } = buildRequest(blob, filename, destination);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: destination.method,
      headers,
      body,
      mode: 'cors',
      // Same-origin destinations (a path on this very deployment that the
      // reverse proxy forwards, authenticating the user itself) need the
      // browser's own credentials; cross-origin ones never receive them.
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Timed out after ${SEND_TIMEOUT_MS / 1000}s`, {
        cause: e,
      });
    }
    throw new Error(
      `Network error: ${message}. Check the URL, the CORS response ` +
        'and that the origin is allowed by connect-src in the Content-Security-Policy.',
      { cause: e }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401 && isSameOrigin(destination.url) && !retried) {
    // Same-origin destination guarded by the deployment's own HTTP auth: some
    // mobile browsers do not answer the 401 challenge of a POST with the
    // credentials they already hold for the pages. A GET on the site root
    // primes the browser's credential cache for the whole origin; then retry
    // the upload once.
    try {
      await fetch(new URL('/', destination.url).toString(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      // ignore: the retry below reports the real outcome
    }
    return sendToDestination(blob, filename, destination, true);
  }

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    throw new Error(`HTTP ${response.status}${statusText}`);
  }
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === location.origin;
  } catch {
    return false;
  }
}

const NOTICE_ID = 'destination-notice';
const NOTICE_SUCCESS_MS = 6000;

/**
 * Non-blocking notice for the delivery status. Tools show their own modal right
 * after `downloadFile` ("PDF created successfully"), so a second modal would
 * either be hidden behind it or overwrite it: the delivery gets its own small
 * corner notice instead. Success fades out on its own; a failure stays until
 * tapped so the user can read the reason.
 */
function showDestinationNotice(
  kind: 'pending' | 'success' | 'error',
  message: string
): void {
  if (typeof document === 'undefined') return;
  let notice = document.getElementById(NOTICE_ID);
  if (!notice) {
    notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.addEventListener('click', () => notice?.remove());
    document.body.appendChild(notice);
  }
  const tone =
    kind === 'success'
      ? 'border-green-500 text-green-200'
      : kind === 'error'
        ? 'border-red-500 text-red-200'
        : 'border-gray-600 text-gray-200';
  notice.className =
    'fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-gray-800 px-4 py-3 text-sm shadow-xl cursor-pointer ' +
    tone;
  notice.textContent = message;
  const previous = Number(notice.dataset.timer || '0');
  if (previous) window.clearTimeout(previous);
  if (kind === 'success') {
    notice.dataset.timer = String(
      window.setTimeout(() => notice?.remove(), NOTICE_SUCCESS_MS)
    );
  } else {
    notice.dataset.timer = '';
  }
}

/** Starts the upload and reports its outcome in the corner notice. */
function sendWithNotice(
  blob: Blob,
  filename: string,
  destination: Destination
): void {
  showDestinationNotice(
    'pending',
    t('tools:destinationSettings.sendingMessage', {
      filename,
      name: destination.name,
    })
  );

  void sendToDestination(blob, filename, destination)
    .then(() => {
      showDestinationNotice(
        'success',
        t('tools:destinationSettings.sendSuccessMessage', {
          filename,
          name: destination.name,
        })
      );
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[Destinations] Send failed:', message);
      showDestinationNotice(
        'error',
        t('tools:destinationSettings.sendFailedMessage', {
          name: destination.name,
          message,
        })
      );
    });
}

/**
 * Hook used by `downloadFile`: sends the result to the active destination when
 * there is one. Returns true when the browser download must be skipped.
 *
 * In `ask` mode nothing happens right away: the Save dialog asks for the name
 * and for what to do with the file, and carries out the answer itself, so the
 * browser download is always skipped here.
 */
export function deliverToActiveDestination(
  blob: Blob,
  filename: string
): boolean {
  const destination = DestinationProvider.getActiveDestination();
  if (!destination) return false;

  const mode = DestinationProvider.getEffectiveMode(destination);

  if (mode === 'ask') {
    void askDestinationSave({
      filename,
      destinationName: destination.name,
    }).then((choice) => {
      if (!choice) return;
      if (choice.action !== 'send') {
        triggerBrowserDownload(blob, choice.filename);
      }
      if (choice.action !== 'download') {
        sendWithNotice(blob, choice.filename, destination);
      }
    });
    return true;
  }

  sendWithNotice(blob, filename, destination);

  return mode === 'send';
}
