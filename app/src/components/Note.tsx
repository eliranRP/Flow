import type { ReactNode } from "react";
import { InfoIcon } from "./icons";

type NoteProps = {
  title: string;
  body: string;
  tone?: "neutral" | "bad";
  extra?: ReactNode;
};

export function Note({ title, body, tone = "neutral", extra }: NoteProps) {
  return (
    <div className="note" role="status">
      <span className={tone === "bad" ? "note-icon note-icon-bad" : "note-icon"}>
        <InfoIcon />
      </span>
      <div>
        <p className="note-title">{title}</p>
        <p className="note-body">{body}</p>
        {extra}
      </div>
    </div>
  );
}
