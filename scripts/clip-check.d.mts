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
  log?: (line: string) => void;
  error?: (line: string) => void;
}): Promise<number>;
