import { HELP_EMAIL } from "../config";
import { HelpBack, HelpMail } from "../ui/layout";
import { ScreenHeader } from "../ui/screen-header";

export function HelpScreen() {
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title="עזרה" subtitle="לעזרה בכניסה כותבים לנו." />
      <HelpMail email={HELP_EMAIL} />
      <HelpBack />
    </main>
  );
}
