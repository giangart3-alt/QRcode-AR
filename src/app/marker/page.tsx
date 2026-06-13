import Link from "next/link";
import { PrintButton } from "./PrintButton";

export default function MarkerPage() {
  return (
    <main className="min-h-screen bg-white px-5 py-6 text-black">
      <div className="no-print mx-auto mb-8 flex max-w-5xl items-center justify-between border-b border-neutral-200 pb-5">
        <Link className="focus-ring rounded-md px-3 py-2 text-sm font-semibold hover:bg-neutral-100" href="/">
          Home
        </Link>
        <PrintButton />
      </div>

      <section className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_340px] lg:items-center">
        <div className="mx-auto aspect-square w-full max-w-[680px] border-[18px] border-black p-[7%]">
          <div className="grid h-full w-full place-items-center border-[10px] border-black">
            <div className="grid h-[74%] w-[74%] place-items-center border-[8px] border-black">
              <div className="select-none text-[clamp(4rem,18vw,9rem)] font-black leading-none tracking-normal">
                HIRO
              </div>
            </div>
          </div>
        </div>

        <aside>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-neutral-500">Printable marker</p>
          <h1 className="mt-3 text-4xl font-black">AR playground marker</h1>
          <div className="mt-5 space-y-4 text-lg leading-8 text-neutral-700">
            <p>Print this marker at 12-15 cm wide on matte paper.</p>
            <p>Upload a GLB in admin, scan the generated QR code on your phone, then point the camera at this marker.</p>
            <p>Keep the page flat, well lit, and fully visible in the camera frame.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
