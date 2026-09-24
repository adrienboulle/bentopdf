/**
 * Saves a blob to the user's disk through a temporary anchor.
 *
 * `downloadFile` in `helpers.ts` is the entry point every tool uses; this is
 * only the browser download part of it, split out so the Destinations Save
 * dialog can trigger the very same download under the name the user typed,
 * without going through the delivery logic a second time.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
