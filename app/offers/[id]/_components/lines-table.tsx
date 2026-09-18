// Lines table built with TanStack Table in server-driven mode: Postgres filters, orders and pages; the table holds column and page state.
"use client";

import { createColumnHelper, FlexRender, rowPaginationFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LineView } from "@/lib/api/client";
import { formatCount, formatUsd } from "@/lib/format";

const features = tableFeatures({ rowPaginationFeature });

const helper = createColumnHelper<typeof features, LineView>();

const STATUS_STYLES: Record<string, string> = {
  included: "bg-ok text-ok-ink",
  needs_review: "bg-review text-review-ink",
  excluded: "bg-excluded text-excluded-ink",
};

const STATUS_LABELS: Record<string, string> = {
  included: "Included",
  needs_review: "Needs review",
  excluded: "Left out",
};

type Props = {
  lines: LineView[];
  page: number;
  pageSize: number;
  totalLines: number;
  selectedId: string | null;
  onSelect: (line: LineView) => void;
  onPageChange: (page: number) => void;
};

export function LinesTable({ lines, page, pageSize, totalLines, selectedId, onSelect, onPageChange }: Props) {
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((line) => `${line.sheetRow}${line.sourceCol}`, {
          id: "sheetRow",
          header: "Row",
          cell: ({ row }) => (
            <button
              type="button"
              onClick={() => onSelect(row.original)}
              aria-label={`Open sheet row ${row.original.sheetRow}${row.original.sourceCol ? ` size column ${row.original.sourceCol}` : ""}`}
              className="font-mono text-navy-mid underline-offset-2 hover:underline"
            >
              {row.original.sheetRow}
              {row.original.sourceCol ? <span className="text-muted">·{row.original.sourceCol}</span> : null}
            </button>
          ),
        }),
        helper.accessor("itemCode", {
          header: "Item code",
          cell: ({ getValue }) => <span className="font-mono">{getValue() ?? <span className="text-error-ink">missing</span>}</span>,
        }),
        helper.accessor("description", { header: "Description", cell: ({ getValue }) => getValue() ?? "—" }),
        helper.accessor("size", { header: "Size", cell: ({ getValue }) => getValue() ?? "—" }),
        helper.accessor("quantity", {
          header: "Pieces",
          cell: ({ getValue }) => <span className="tabular font-mono">{formatCount(getValue())}</span>,
        }),
        helper.accessor("unitCost", {
          header: "Unit cost",
          cell: ({ getValue }) => <span className="tabular font-mono">{formatUsd(getValue())}</span>,
        }),
        helper.accessor("lineValue", {
          header: "Line value",
          cell: ({ getValue }) => <span className="tabular font-mono">{formatUsd(getValue())}</span>,
        }),
        helper.display({
          id: "status",
          header: "Status",
          cell: ({ row }) => {
            const line = row.original;
            const note = line.excludeReason ?? line.issues[0]?.message ?? null;
            return (
              <div>
                <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[line.status]}`}>{STATUS_LABELS[line.status]}</span>
                {note ? <p className="mt-1 max-w-sm text-xs text-muted">{note}</p> : null}
              </div>
            );
          },
        }),
      ]),
    [onSelect],
  );

  const table = useTable({
    features,
    columns,
    data: lines,
    getRowId: (line) => line.id,
    manualPagination: true,
    rowCount: totalLines,
    state: { pagination: { pageIndex: page - 1, pageSize } },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex: page - 1, pageSize }) : updater;
      onPageChange(next.pageIndex + 1);
    },
  });

  const firstRow = totalLines === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalLines);
  const lastPage = Math.max(1, Math.ceil(totalLines / pageSize));

  return (
    <div className="mt-4 rounded-2xl border border-rule bg-sheet">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-rule text-xs uppercase tracking-wide text-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} scope="col" className="px-3 py-2 font-semibold">
                    <FlexRender header={header} />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onSelect(row.original)}
                aria-current={row.original.id === selectedId ? "true" : undefined}
                className={`cursor-pointer border-b border-rule last:border-0 ${row.original.id === selectedId ? "bg-sky-soft" : "hover:bg-paper"}`}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 align-top">
                    <FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-muted">
                  No lines in this tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-3 py-2 text-sm">
        <p className="text-muted">
          Showing <span className="tabular font-mono">{formatCount(firstRow)}</span>–<span className="tabular font-mono">{formatCount(lastRow)}</span> of{" "}
          <span className="tabular font-mono">{formatCount(totalLines)}</span> lines, in sheet order
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={page <= 1}
            className="rounded-[10px] border border-rule px-3 py-1.5 font-semibold hover:bg-paper disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted">
            Page {formatCount(page)} of {formatCount(lastPage)}
          </span>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={page >= lastPage}
            className="rounded-[10px] border border-rule px-3 py-1.5 font-semibold hover:bg-paper disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
