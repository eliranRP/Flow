import { beforeAll } from "vitest";
import { setProjectAnnotations } from "@storybook/react";
import * as projectAnnotations from "./preview";

// The dark pass (FLOW-833): every story renders in dark here, so a story needs no "Dark" copy.
const annotations = setProjectAnnotations([projectAnnotations, { initialGlobals: { theme: "dark" } }]);

beforeAll(annotations.beforeAll);
