# QRcode AR

First MVP for uploading GLB files, generating a QR code, and opening the model from a phone in marker-based AR.

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

The upload token endpoint:

- checks `ADMIN_PASSWORD`
- allows `.glb` only
- targets up to 500 MB
- stores uploaded GLB files publicly in Blob

Project metadata is saved as public JSON in Blob at `projects/[id].json`. Public AR and viewer pages read that metadata through `/api/projects/[id]`.

## How to upload a GLB

1. Open `/admin`.
2. Enter `ADMIN_PASSWORD`.
3. Choose a `.glb` file from your desktop.
4. Enter the model name, scale, and vertical offset.
5. Create the project.
6. Copy the AR URL, fallback viewer URL, or scan the generated QR code.

Do not commit GLB files to GitHub. Runtime uploads belong in Vercel Blob.

## How to print the marker

Open `/marker` and print the page. Recommended print size is 12-15 cm wide on matte paper. Keep the marker flat, high contrast, and well lit.

## How to test from a phone

1. Upload a GLB in `/admin`.
2. Scan the generated QR code from the phone.
3. Allow camera permission.
4. Point the camera at the printed marker.
5. If marker AR is unstable, use the fallback viewer link on the AR page.

## iOS and browser limitations

Browser marker tracking is most reliable on Chrome for Android. iOS browser camera support and WebGL camera pipelines can be stricter, especially inside in-app browsers. The `/view/[id]` page uses `<model-viewer>` with `ar-modes="webxr scene-viewer quick-look"` so supported phones can still use their native AR viewer.

## Troubleshooting

- `Vercel Blob is not configured`: connect the existing Blob store to the existing Vercel project and confirm `BLOB_READ_WRITE_TOKEN` exists.
- `Incorrect admin password`: update `ADMIN_PASSWORD` in Vercel or enter the current value.
- Upload fails immediately: confirm the selected file ends in `.glb`.
- Upload stalls on a large file: test on a strong network and keep the admin tab open until progress reaches 100%.
- AR page says camera permission denied: allow camera access in the browser settings and reload.
- Marker not found: use `/marker`, print at 12-15 cm wide, improve lighting, and keep the full black square in frame.
- Model loading error: open the fallback viewer; if it also fails, re-upload the GLB.
