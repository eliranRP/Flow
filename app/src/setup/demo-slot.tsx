import { setupHost } from "./copy";

/** Empty stage for the demo player. The phone outline peeks from the bottom. שוב is not ours. */
export function DemoSlot({ alt }: { alt: string }) {
  return (
    <div className="ui-setup-stage-host">
      <p className="sr-only">{alt}</p>
      <div
        className="ui-setup-stage"
        data-demo-slot=""
        data-setup-demo=""
        data-setup-host={setupHost()}
        aria-hidden="true"
      >
        <div className="ui-setup-phone" />
      </div>
    </div>
  );
}
