import { HelpBack } from "../ui/layout";
import { ScreenHeader } from "../ui/screen-header";

export function LegalScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title={title} subtitle={body} />
      <HelpBack />
    </main>
  );
}
