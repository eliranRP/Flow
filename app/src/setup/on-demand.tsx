import "../ui/lazy.css";

/**
 * FLOW-1342. The one module entry.tsx loads with import(): the resume redirect and Home's slot together, so
 * they, and what they share with each other, build into one chunk instead of one apiece.
 */
export { SetupResume } from "./route";
export { SetupHomeSlot } from "./home";
