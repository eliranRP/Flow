import { isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { hideRow, isRowHidden, readHidden, restoreAll, type HiddenRows } from "./attention-dismiss";
import type { BannerRow } from "./banner";
import { cx } from "./cx";
import { IconButton } from "./icon-button";
import { CheckIcon, ChevronIcon, CloseIcon, InboxIcon } from "./icons";

/** The slide and fold of a dismissed card (--motion-sheet-out, 220ms), with a frame to spare. */
const FOLD_MS = 240;

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The words of a row's title, for its X's name ("הסתרה: <title>"). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * FLOW-1043 (BUILD-PLAN §3.5): the "דורש טיפול" row-cards. Each row is a 56px card that links to its page,
 * with an X that hides it on this device until what it counts changes (attention-dismiss.ts). The review row
 * (a row with `button`) comes first and has no X. When every row is hidden, the section is one line with ביטול.
 */
export function AttentionCards({ rows, storageKey, title = "דורש טיפול" }: {
  rows: readonly BannerRow[];
  /** The screen's name: the hidden rows are kept under `flow.attention.<storageKey>`. */
  storageKey: string;
  title?: string;
}) {
  const [hidden, setHidden] = useState<HiddenRows>(() => readHidden(storageKey));
  const [readFor, setReadFor] = useState(storageKey);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  if (readFor !== storageKey) {
    setReadFor(storageKey);
    setHidden(readHidden(storageKey));
  }
  // What is kept, cards still folding included, so two quick dismissals both stay hidden.
  const kept = useRef<{ key: string; rows: HiddenRows } | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // The section is a named region ("דורש טיפול"), as the box it replaces was: the e2e specs and screen readers find it by name.
  const titleId = useId();
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  if (rows.length === 0) return null;
  // The review row first; the rest keep their order.
  const ordered = [...rows.filter((row) => row.button != null), ...rows.filter((row) => row.button == null)];
  const hiddenCount = ordered.filter((row) => isRowHidden(hidden, row)).length;
  const shown = ordered.filter((row) => !isRowHidden(hidden, row));

  function dismiss(row: BannerRow) {
    const key = row.dismissKey;
    if (key == null || leaving.has(row.id)) return;
    // Kept at once, so leaving the page mid-fold keeps it hidden; the list drops it once the fold ends.
    const before = kept.current?.key === storageKey ? kept.current.rows : hidden;
    kept.current = { key: storageKey, rows: hideRow(storageKey, row.id, key, before) };
    setLeaving((current) => new Set(current).add(row.id));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setHidden((current) => ({ ...current, [row.id]: key }));
      setLeaving((current) => {
        const rest = new Set(current);
        rest.delete(row.id);
        return rest;
      });
    }, reducedMotion() ? 0 : FOLD_MS);
    timers.current.add(timer);
  }

  function restore() {
    // A fold still running would hide its card again once storage is cleared: end the folds first.
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    setLeaving(new Set());
    restoreAll(storageKey);
    kept.current = null;
    setHidden({});
  }

  if (shown.length === 0) {
    return (
      <section className="ui-attn ui-attn-done m-page-enter" aria-live="polite" aria-label={title}>
        <span className="ui-attn-done-text t-line2">
          <span className="ui-attn-done-check">
            <CheckIcon size={18} />
          </span>
          אין מה לטפל · הכול נסקר
        </span>
        <button type="button" className="ui-attn-undo t-btn m-press" onClick={restore}>
          ביטול
        </button>
      </section>
    );
  }

  return (
    <section className="ui-attn" aria-live="polite" aria-labelledby={titleId}>
      <div className="ui-attn-head">
        <h2 className="ui-attn-title t-section" id={titleId}>{title}</h2>
        {hiddenCount > 0 ? (
          <button type="button" className="ui-attn-restore t-meta m-press" onClick={restore}>
            {`${String(hiddenCount)} הוסתרו · הצגה`}
          </button>
        ) : null}
      </div>
      <ul className="ui-attn-list">
        {shown.map((row) => {
          const out = leaving.has(row.id);
          return (
            <li key={row.id} className="ui-attn-item" data-leaving={out || undefined}>
              <div className={cx("ui-attn-card", row.button == null && row.dismissKey != null && "ui-attn-card-x")}>
                <Link to={row.to} className="ui-attn-link ui-hit m-press" inert={out || undefined}>
                  <span className="ui-attn-icon">{row.icon ?? <InboxIcon size={20} />}</span>
                  <span className="ui-attn-text t-body" dir="rtl" data-clip-ok="">
                    {row.title}
                  </span>
                  <span className="ui-attn-chevron">
                    <ChevronIcon size={18} />
                  </span>
                </Link>
                {row.button == null && row.dismissKey != null ? (
                  <IconButton
                    label={`הסתרה: ${textOf(row.title)}`}
                    className="ui-attn-x"
                    disabled={out}
                    onClick={() => {
                      dismiss(row);
                    }}
                  >
                    <CloseIcon size={18} />
                  </IconButton>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
