// DataTable — desktop table + purpose-built mobile cards from ONE column spec.
// Below `tableFrom` (default md) each row renders as a card (primary column as the heading, the
// rest as label/value pairs), so nothing depends on horizontal scrolling.
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface DataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Column shown as the card heading on mobile (exactly one). */
  primary?: boolean;
  /** Hide on mobile cards (desktop table only). */
  hideOnMobile?: boolean;
  /** Only from this breakpoint up in the desktop table. */
  desktopFrom?: "lg" | "xl";
  className?: string;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  tableFrom = "md",
  renderCard,
}: {
  columns: ReadonlyArray<DataColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  /** Screen-reader caption for the table. */
  caption: string;
  /** Breakpoint where the table replaces the cards (wide tables use "xl"). */
  tableFrom?: "md" | "lg" | "xl";
  /** Purpose-built mobile card; defaults to label/value pairs from `columns`. */
  renderCard?: (row: T) => ReactNode;
}) {
  const TABLE_SHOW = { md: "md:block", lg: "lg:block", xl: "xl:block" }[tableFrom];
  const CARDS_HIDE = { md: "md:hidden", lg: "lg:hidden", xl: "xl:hidden" }[tableFrom];
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
  const from = (c: DataColumn<T>) =>
    c.desktopFrom === "xl" ? "hidden xl:table-cell" : c.desktopFrom === "lg" ? "hidden lg:table-cell" : "";

  return (
    <>
      {/* Desktop / tablet-landscape table */}
      <div className={cx("hidden overflow-hidden rounded-xl border border-white/[0.06]", TABLE_SHOW)}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-white/[0.03] text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-sp-textSecondary">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cx("px-3 py-2.5 font-semibold", c.align === "right" && "text-right", from(c), c.className)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {rows.map((r) => (
              <tr key={rowKey(r)} className="transition-colors hover:bg-white/[0.03]">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      "px-3 py-3 align-middle text-sp-textSecondary",
                      c.align === "right" && "text-right tabular-nums",
                      c.primary && "font-medium text-sp-textPrimary",
                      from(c),
                      c.className,
                    )}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className={cx("grid gap-2 sm:grid-cols-2", CARDS_HIDE)} aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            {renderCard ? renderCard(r) : (
            <>
            <div className="text-sm font-semibold text-sp-textPrimary">{primary.cell(r)}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
              {rest.map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-sp-textSecondary">
                    {c.header}
                  </dt>
                  <dd className="mt-0.5 break-words text-sm text-sp-textPrimary">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
            </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
