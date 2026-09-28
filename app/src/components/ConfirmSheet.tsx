export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="period-sheet" role="dialog" aria-label={title}>
      <div className="sheet-head">
        <h2 className="t-title-2">{title}</h2>
        <button type="button" className="icon-btn" aria-label="סגירה" onClick={onClose}>
          סגירה
        </button>
      </div>
      <p className="t-label">{body}</p>
      <div className="choice-col">
        <button type="button" className="btn-bad" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className="btn-sec" onClick={onClose}>ביטול</button>
      </div>
    </div>
  );
}

export function UndoToast({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <p className="undo-toast" role="status">
      {label}
      <button type="button" className="btn-sec" onClick={onUndo}>ביטול</button>
    </p>
  );
}
