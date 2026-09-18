// Side panel for one line: the original sheet cells, the issues, editable values, include or leave out, and conflict choices.
"use client";

import { useEffect, useState } from "react";
import { fetchSourceRow, type LineView, type SourceRowView } from "@/lib/api/client";
import { formatUsd } from "@/lib/format";

export type LineEditFields = { itemCode?: string; size?: string; quantity?: string; unitCost?: string };

type Props = {
  offerId: string;
  line: LineView;
  conflictRows: LineView[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (changes: LineEditFields) => void;
  onDecision: (decision: "include" | "exclude" | null) => void;
  onKeepOnly: (line: LineView) => void;
  onKeepBoth: () => void;
};

const SEVERITY_STYLES: Record<string, string> = {
  error: "bg-error text-error-ink",
  warning: "bg-review text-review-ink",
  info: "bg-sky-soft text-navy",
};

function OriginalRow({ offerId, line }: { offerId: string; line: LineView }) {
  const [row, setRow] = useState<SourceRowView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSourceRow(offerId, line.sheetRow)
      .then((data) => {
        if (active) setRow(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [offerId, line.sheetRow]);

  const flagged = new Set(line.issues.map((issue) => issue.cell).filter(Boolean));

  if (failed) return <p className="text-sm text-muted">Couldn&apos;t load the original row.</p>;
  if (!row) return <p className="text-sm text-muted">Loading the original row…</p>;

  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {Object.entries(row.headers).map(([column, header]) => {
          const cell = row.cells[column];
          const reference = `${column}${row.sheetRow}`;
          return (
            <tr key={column} className={`border-b border-rule last:border-0 ${flagged.has(reference) ? "bg-review" : ""}`}>
              <th scope="row" className="py-1 pr-2 font-normal text-muted">
                {header}
              </th>
              <td className="py-1 pr-2 font-mono text-muted">{reference}</td>
              <td className="py-1 font-mono">{cell === undefined || cell.v === null ? <span className="text-muted">empty</span> : String(cell.w ?? cell.v)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function LinePanel({ offerId, line, conflictRows, busy, error, onClose, onApply, onDecision, onKeepOnly, onKeepBoth }: Props) {
  const [fields, setFields] = useState<LineEditFields>({});

  const value = (key: keyof LineEditFields, fallback: string) => fields[key] ?? fallback;
  const changed = Object.keys(fields).length > 0;

  return (
    <aside aria-label={`Line on sheet row ${line.sheetRow}`} className="rounded-2xl border border-rule bg-sheet p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-navy">
            Sheet row {line.sheetRow}
            {line.sourceCol ? ` · size column ${line.sourceCol}` : ""}
          </h2>
          <p className="text-sm text-muted">{line.description ?? "No description"}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-[10px] border border-rule px-2 py-1 text-xs font-semibold hover:bg-paper">
          Close
        </button>
      </div>

      {line.issues.length > 0 && (
        <ul className="mt-3 space-y-1">
          {line.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`rounded-[10px] px-3 py-2 text-sm ${SEVERITY_STYLES[issue.severity]}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {conflictRows.length > 0 && (
        <div className="mt-3 rounded-[10px] border border-rule p-3">
          <p className="text-sm font-semibold">Same item and size listed more than once</p>
          <ul className="mt-2 space-y-1 text-sm">
            {[line, ...conflictRows].map((candidate) => (
              <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono">
                  row {candidate.sheetRow}: {candidate.quantity ?? "?"} × {formatUsd(candidate.unitCost)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onKeepOnly(candidate)}
                  className="rounded-[10px] border border-navy px-2 py-1 text-xs font-semibold text-navy hover:bg-paper disabled:opacity-50"
                >
                  Keep only row {candidate.sheetRow}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={onKeepBoth}
            className="mt-2 rounded-[10px] border border-rule px-2 py-1 text-xs font-semibold hover:bg-paper disabled:opacity-50"
          >
            Keep all of them
          </button>
        </div>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) onApply(fields);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-muted">Item code</span>
            <input
              value={value("itemCode", line.itemCode ?? "")}
              onChange={(event) => setFields((f) => ({ ...f, itemCode: event.target.value }))}
              className="mt-1 w-full rounded-[10px] border border-rule px-2 py-1.5 font-mono"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Size</span>
            <input
              value={value("size", line.size ?? "")}
              onChange={(event) => setFields((f) => ({ ...f, size: event.target.value }))}
              className="mt-1 w-full rounded-[10px] border border-rule px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Pieces available</span>
            <input
              inputMode="numeric"
              value={value("quantity", line.quantity === null ? "" : String(line.quantity))}
              onChange={(event) => setFields((f) => ({ ...f, quantity: event.target.value }))}
              className="mt-1 w-full rounded-[10px] border border-rule px-2 py-1.5 font-mono"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Supplier unit cost (USD)</span>
            <input
              inputMode="decimal"
              value={value("unitCost", line.unitCost ?? "")}
              onChange={(event) => setFields((f) => ({ ...f, unitCost: event.target.value }))}
              className="mt-1 w-full rounded-[10px] border border-rule px-2 py-1.5 font-mono"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-[10px] bg-error px-3 py-2 text-sm text-error-ink">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || !changed}
            className="rounded-[10px] bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          {line.status !== "excluded" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision("exclude")}
              className="rounded-[10px] border border-navy px-3 py-1.5 text-sm font-semibold text-navy hover:bg-paper disabled:opacity-50"
            >
              Leave this line out
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision(line.decision === "exclude" ? null : "include")}
              className="rounded-[10px] border border-navy px-3 py-1.5 text-sm font-semibold text-navy hover:bg-paper disabled:opacity-50"
            >
              Put this line back
            </button>
          )}
          {line.status === "needs_review" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision("include")}
              className="rounded-[10px] border border-rule px-3 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-50"
            >
              Include as is
            </button>
          )}
        </div>
      </form>

      <div className="mt-4 border-t border-rule pt-3">
        <h3 className="text-sm font-semibold">Original sheet row</h3>
        <p className="text-xs text-muted">Exactly as the supplier sent it. Flagged cells are highlighted.</p>
        <div className="mt-2">
          <OriginalRow key={`${offerId}-${line.sheetRow}`} offerId={offerId} line={line} />
        </div>
      </div>
    </aside>
  );
}
