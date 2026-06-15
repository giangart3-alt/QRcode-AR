# QRcode AR

MVP for uploading GLB files, generating a QR code, and opening the model from a phone with MindAR image tracking.

Production: https://q-rcode-ar.vercel.app

## Setup

```bash
npm install
npm run build:mind
npm run typecheck
npm run build
```

Run locally:

```bash
npm run dev
```

## Image Target

The app tracks one static MindAR image target:

- `public/targets/Masteplan_PROMENADE_004.png`
- `public/targets/masterplan.mind`
- `public/targets/masterplan-preview.jpg`

Regenerate the MindAR target after replacing the source image:

```bash
npm run build:mind
```

Print or display the masterplan image flat. Keep the whole image visible, avoid glare, and move the phone until the image fills a useful part of the camera view.

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
