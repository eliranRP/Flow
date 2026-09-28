import type { ReactNode } from "react";
import type { Decorator } from "@storybook/react";

export const longHebrew =
  "שיפוץ דירת הגג ברחוב הרצל שתים עשרה, כולל הריסה, חשמל, אינסטלציה, ריצוף וצבע";

/** ₪123,456,789, stored as agorot. */
export const largeAgorot = 12_345_678_900n;

export const padded: Decorator = (Story) => (
  <div className="flex w-full flex-col items-stretch gap-4 p-4">
    <Story />
  </div>
);

export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}
