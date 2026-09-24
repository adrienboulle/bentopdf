---
title: Destinations
description: Send the result of a BentoPDF tool to your own HTTP endpoint instead of, or in addition to, downloading it.
---

# Destinations

A **destination** is an HTTP endpoint you own. When one is active, the file a
tool produces is uploaded to it instead of, or in addition to, being
downloaded. Processing still happens entirely in your browser: only the
finished result leaves the device, and only to the endpoint you configured.

Open **Destinations** from the settings modal or the footer
(`destination-settings.html`). Destinations are stored in the browser's local
storage, like the [Advanced Settings](/self-hosting/) WASM overrides.

## Options

- **Name** -- how the destination is labelled in the list.
- **URL** -- must start with `https://`. BentoPDF is served over HTTPS, so a
  plain `http://` endpoint would be blocked as mixed content anyway.
- **Method** -- `POST` sends a multipart form; `PUT` sends the raw file.
- **File field name** -- the multipart field the file is sent under (`POST`
  only, `file` by default).
- **Headers** -- sent with the request, typically an authorization header.
- **Extra form fields** -- additional multipart fields (`POST` only).
- **When a tool produces a file** -- `Download only`, `Send only`,
  `Download and send`, or `Ask every time`.

Only one destination is active at a time. Set **Active destination** to
_None_ to go back to plain downloads.

**Test** uploads a real one-page PDF named `bentopdf-destination-test.pdf`.
An empty or zero-byte payload would be refused by most endpoints, so the test
would prove nothing; expect a test document to appear at the destination and
delete it afterwards.

## Asking at save time

With **Ask every time**, nothing leaves the browser until you say so. The tool
produces its file as usual, and a **Save the result** dialog opens on top of
the tool's own confirmation:

- The **file name** is prefilled with the name the tool produced. Rename it
  freely: the extension is kept, so `invoice` is saved and sent as
  `invoice.pdf`, and an emptied field falls back to the produced name.
- **Download**, **Send to _your destination_** or **Both** decides what
  happens to the file. The last choice is remembered for the next one.
- **Cancel** drops the result: nothing is downloaded, nothing is sent.

A tool that produces several files asks once per file, one dialog after the
other.

## File name templates

A header value and an extra form field value may contain two templates,
replaced at the moment the file is sent:

| Template                        | Replaced with                                 |
| ------------------------------- | --------------------------------------------- |
| <code v-pre>{{filename}}</code> | the name of the sent file, extension included |
| <code v-pre>{{basename}}</code> | the same name without its extension           |

This is how the name reaches the destination as metadata rather than only as
the name of the uploaded part. A document manager that titles documents from a
`title` field receives the name typed in the Save dialog:

```json
{ "name": "title", "value": "{{basename}}" }
```

A value that contains no template is sent unchanged.

## Example: document manager (POST, multipart)

| Field           | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| URL             | `https://documents.example.com/api/documents/post_document/` |
| Method          | `POST`                                                       |
| File field name | `document`                                                   |
| Header          | `Authorization: Token 0123456789abcdef`                      |
| Extra field     | <code v-pre>title: {{basename}}</code>                       |

The request is a `multipart/form-data` body with the processed file under
`document` and `title` as an extra field. BentoPDF does not set
`Content-Type` itself for `POST`: the browser writes it with the multipart
boundary.

## Example: WebDAV (PUT, raw file)

| Field  | Value                                    |
| ------ | ---------------------------------------- |
| URL    | `https://files.example.com/webdav/inbox` |
| Method | `PUT`                                    |
| Header | `Authorization: Basic dXNlcjpwYXNz`      |

The file is sent as the raw request body to
`https://files.example.com/webdav/inbox/<filename>`, with the filename
percent-encoded. `Content-Type` is taken from the produced file.

## Content-Security-Policy

BentoPDF ships a strict CSP. A destination origin that is not in the `connect-src` directive is blocked
by the browser, and the upload fails with a network error. Three ways to allow yours, from the simplest:

**Docker, no rebuild** — list the origins in `DESTINATION_HOSTS` (comma-separated); the container patches
its CSP at start:

```bash
docker run -d -p 3000:8080 -e DESTINATION_HOSTS=https://documents.example.com ghcr.io/alam00000/bentopdf:latest
```

**Same origin, no CSP change at all** — put the destination under the BentoPDF origin behind your reverse
proxy (for example `/api/upload` proxied to the document manager). This also removes the CORS
requirement below, and lets the proxy add the user's identity or a token so nothing reaches the browser.

**Build time** — `VITE_DESTINATION_HOSTS=https://documents.example.com npm run build`, or the same as a
Docker `--build-arg`, when you build your own image anyway.

The destination also has to accept the request from the browser (cross-origin): it must answer the CORS
preflight for the method and the headers you configured, and return an `Access-Control-Allow-Origin`
covering your BentoPDF origin. A same-origin path through your proxy needs none of this.

## Privacy and credentials

> [!WARNING]
> Header values, including API tokens and Basic authorization headers, are
> stored unencrypted in the browser's local storage. Anyone with access to
> that browser profile can read them. Use a token scoped to uploads only, and
> remove the destination on a shared computer.

Sending a result to a destination is an explicit, opt-in upload to a server
you chose. Nothing is sent anywhere as long as no destination is active,
which is the default.

## Presetting destinations for all users

Self-hosted deployments can ship a default configuration so users have nothing to set up: a JSON array of
destinations, the first one becomes the active destination and its `mode` (`download`, `send`, `both` or
`ask`) the default action. The preset only applies while the browser has no saved Destinations
configuration: as soon as a user saves their own settings, those take precedence.

**Runtime, `config.json`** (the same file that carries `disabledTools`), mounted or served next to
`index.html` on any static host:

```json
{
  "destinations": [
    {
      "name": "Documents",
      "url": "https://documents.example.com/api/upload",
      "method": "POST",
      "fieldName": "document",
      "mode": "both"
    }
  ]
}
```

**Runtime, Docker** — `DESTINATIONS_DEFAULT` holds the same array; the container writes `config.json` at
start when none is mounted:

```bash
docker run -d -p 3000:8080 \
  -e DESTINATION_HOSTS=https://documents.example.com \
  -e DESTINATIONS_DEFAULT='[{"name":"Documents","url":"https://documents.example.com/api/upload","method":"POST","fieldName":"document","mode":"both"}]' \
  ghcr.io/alam00000/bentopdf:latest
```

**Build time** — `VITE_DESTINATIONS_DEFAULT` with the same array (`npm run build` or `--build-arg`). A
runtime preset wins over a build-time one.

A common pattern is to point the preset at a path on the BentoPDF origin itself and let the reverse proxy
forward it to the document manager with the authenticated user's identity (for example Caddy `basic_auth`
plus a `Remote-User` header): no token ever reaches the browser, no CSP or CORS to configure.
