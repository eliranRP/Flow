// FLOW-815: vaul and the Radix dialog under it load in their own chunk, after Home first paints.
// ui/sheet.tsx loads this when any sheet mounts, so it is there before a tap opens one.
export { Drawer } from "vaul";
