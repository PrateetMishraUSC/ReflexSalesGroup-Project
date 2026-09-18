// Upload box: accepts a line sheet by drop or file picker, sends it with a retry key, and explains every outcome.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LocalTime } from "./local-time";

const MAX_BYTES = 4 * 1024 * 1024;

type EarlierUpload = { id: string; name: string; createdAt: string };

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "error"; filename: string; message: string; canRetry: boolean }
  | { kind: "duplicate"; offerId: string; earlier: EarlierUpload[] };

function LayoutGlyph({ variant }: { variant: "northstar" | "harbor" }) {
  const columns = variant === "northstar" ? ["Item", "Size", "Qty", "Cost"] : ["Style", "Cost", "S", "M", "L"];
  const highlight = variant === "northstar" ? [1, 2] : [2, 3, 4];
  return (
    <div
      aria-hidden="true"
      className="grid gap-px overflow-hidden rounded-sm border border-rule bg-rule"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((label, i) => (
        <span
          key={label}
          className={`px-1 py-0.5 text-center font-mono text-[10px] leading-4 ${highlight.includes(i) ? "bg-sky-soft text-navy" : "bg-sheet text-muted"}`}
        >
          {label}
        </span>
      ))}
      {Array.from({ length: columns.length * 2 }, (_, i) => (
        <span key={i} className={`h-2.5 ${highlight.includes(i % columns.length) ? "bg-sky-soft" : "bg-sheet"}`} />
      ))}
    </div>
  );
}

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ file: File; key: string } | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function send() {
    if (!attempt.current) return;
    const { file, key } = attempt.current;
    setState({ kind: "uploading", filename: file.name });

    const form = new FormData();
    form.append("file", file);

    let response: Response;
    try {
      response = await fetch("/api/offers", { method: "POST", headers: { "Idempotency-Key": key }, body: form });
    } catch {
      setState({
        kind: "error",
        filename: file.name,
        message: "Couldn't reach the server, so we can't tell whether the offer was created.",
        canRetry: true,
      });
      return;
    }

    const body = await response.json().catch(() => null);
    if (response.ok && body?.offerId) {
      if (body.earlierUploads?.length) {
        setState({ kind: "duplicate", offerId: body.offerId, earlier: body.earlierUploads });
        router.refresh();
      } else {
        router.push(`/offers/${body.offerId}`);
      }
      return;
    }

    setState({
      kind: "error",
      filename: file.name,
      message: body?.error?.message ?? `The upload failed (HTTP ${response.status}).`,
      canRetry: response.status >= 500,
    });
  }

  function start(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setState({ kind: "error", filename: file.name, message: "Only .xlsx line sheets are supported. Save the file as .xlsx and upload it again.", canRetry: false });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ kind: "error", filename: file.name, message: "The file is larger than 4 MB. Please upload a smaller line sheet.", canRetry: false });
      return;
    }
    attempt.current = { file, key: crypto.randomUUID() };
    void send();
  }

  const busy = state.kind === "uploading";

  return (
    <section aria-labelledby="upload-heading" className="rounded-2xl border border-rule bg-sheet">
      <h2 id="upload-heading" className="sr-only">
        Upload a line sheet
      </h2>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) start(event.dataTransfer.files[0]);
        }}
        className={`m-3 rounded-[10px] border-2 border-dashed px-6 py-10 text-center transition-colors ${dragging ? "border-brand bg-accent-soft" : "border-rule"}`}
      >
        <p className="font-display text-2xl font-semibold tracking-tight text-navy">{busy ? `Reading ${state.filename}…` : "Drop a line sheet here"}</p>
        <p className="mt-1 text-sm text-muted">
          {busy ? "Checking every row. A 5,000-row sheet takes a few seconds." : ".xlsx files up to 4 MB, as the supplier sent them"}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            start(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-5 rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Choose a file"}
        </button>
      </div>

      <div className="grid gap-4 border-t border-rule px-6 py-4 sm:grid-cols-2">
        <div>
          <LayoutGlyph variant="northstar" />
          <p className="mt-2 text-sm">
            <span className="font-semibold">Northstar</span> <span className="text-muted">one item and size per row</span>
          </p>
        </div>
        <div>
          <LayoutGlyph variant="harbor" />
          <p className="mt-2 text-sm">
            <span className="font-semibold">Harbor</span> <span className="text-muted">sizes across columns</span>
          </p>
        </div>
      </div>

      <div aria-live="polite">
        {state.kind === "error" && (
          <div role="alert" className="border-t border-rule bg-error px-6 py-4 text-error-ink">
            <p className="font-semibold">{state.filename} wasn&apos;t uploaded</p>
            <p className="mt-1 text-sm">{state.message}</p>
            {state.canRetry ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void send()}
                  className="rounded-[10px] bg-error-ink px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                >
                  Retry upload
                </button>
                <span className="text-sm">Retrying is safe: the same offer is never created twice.</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-3 rounded-[10px] border border-error-ink px-3 py-1.5 text-sm font-semibold hover:bg-white/50"
              >
                Choose another file
              </button>
            )}
          </div>
        )}

        {state.kind === "duplicate" && (
          <div className="border-t border-rule bg-review px-6 py-4 text-review-ink">
            <p className="font-semibold">This file was uploaded before</p>
            <p className="mt-1 text-sm">
              A new, separate offer was created. The earlier {state.earlier.length === 1 ? "offer is" : "offers are"} unchanged.
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link href={`/offers/${state.offerId}`} className="rounded-[10px] bg-accent px-3 py-1.5 font-semibold text-white hover:bg-accent-deep">
                Open new offer
              </Link>
              {state.earlier.slice(0, 3).map((earlier) => (
                <Link key={earlier.id} href={`/offers/${earlier.id}`} className="rounded-[10px] border border-review-ink px-3 py-1.5 font-semibold hover:bg-white/50">
                  Open earlier offer · <LocalTime iso={earlier.createdAt} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
