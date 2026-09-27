import { useNavigate } from "react-router-dom";
import { CloseIcon } from "./icons";

export function Sheet({ title, closeTo }: { title: string; closeTo: string }) {
  const navigate = useNavigate();
  function close() {
    void navigate(closeTo);
  }
  return (
    <div className="sheet-layer">
      <button type="button" className="sheet-scrim" aria-label="סגירה" onClick={close} />
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h1 id="sheet-title" className="t-title-2">
            {title}
          </h1>
          <button type="button" className="icon-btn" aria-label="סגירה" onClick={close}>
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
