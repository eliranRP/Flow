import { HELP_EMAIL } from "../config";
import { HelpMail } from "../ui/layout";
import { ScreenHeader } from "../ui/screen-header";

export function HelpScreen() {
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title="עזרה" subtitle="לעזרה בכניסה כותבים לנו." backTo="/sign-in" />
      <HelpMail email={HELP_EMAIL} />
    </main>
  );
}
