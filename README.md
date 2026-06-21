# QRcode AR

MVP for uploading GLB files, generating a QR code, and opening the model from a phone with MindAR image tracking.

Production: https://q-rcode-ar.vercel.app

## Setup

```bash
npm install
npm run typecheck
npm run build
```

Run locally:

```bash
npm run dev
```

## Single image target

The app uses one active MindAR image target:

- `public/targets/masterplan-marker-frame.png`
- `public/targets/masterplan-marker-frame.mind`
- `public/targets/masterplan-target-manifest.json`
- `public/vendor/mind-ar/` browser runtime files

The `.mind` file is compiled from the same `masterplan-marker-frame.png` image that the app displays and downloads. Do not generate it during Vercel builds.

Print or display the masterplan image flat. The public AR viewer opens directly into single-target MindAR tracking.

## Vercel environment variables

Required:

- `ADMIN_PASSWORD`: password used by `/admin` and the upload token endpoint.
- `NEXT_PUBLIC_SITE_URL`: `https://q-rcode-ar.vercel.app`
- `BLOB_READ_WRITE_TOKEN`: required by `@vercel/blob` for uploads, metadata writes, and metadata reads.

Existing variables that may be present from the Blob integration:

- `BLOB_STORE_ID`
- `BLOB_WEBHOOK_PUBLIC_KEY`

If uploads fail with a Blob configuration message, open the existing `q-rcode-ar-blob` store in Vercel, connect it to the existing `q-rcode-ar` project, and make sure Vercel injects `BLOB_READ_WRITE_TOKEN` into Production, Preview, and Development. Do not create another Blob store.

## Blob notes

Large GLB files are uploaded with `@vercel/blob/client`, so the browser sends the file directly to Vercel Blob using a short-lived upload token from `/api/blob/upload`. The GLB does not pass through a normal Next.js route body.

Project metadata is saved as public JSON in Blob at `projects/[id].json`. Public AR and viewer pages read that metadata through `/api/projects/[id]`.

## Test from a phone

1. Open the project workspace and save the project.
2. Open the QR button.
3. Scan the QR code from the phone.
4. Allow camera permission.
5. Point the camera at the printed/displayed masterplan image.
6. Use `?debug=1` on the AR URL and tap `Copy debug` if alignment needs diagnosis.

Do not commit GLB files to GitHub. Runtime uploads belong in Vercel Blob.
