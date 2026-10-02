export type ClipSample = {
  textWidth?: number;
  boxWidth?: number;
  scrollWidth?: number;
  clientWidth?: number;
  textOverflow?: string;
  whiteSpace?: string;
  overflow?: string;
  clipOk?: boolean;
};

export function reportsClip(input: ClipSample): boolean;

export function execute(options?: {
  staticDir?: string;
  widths?: number[];
  themes?: string[];
  launch?: () => Promise<{ newPage: () => Promise<unknown>; close: () => Promise<void> }>;
  log?: (line: string) => void;
  error?: (line: string) => void;
  reportDir?: string;
  readyTimeout?: number;
}): Promise<number>;
