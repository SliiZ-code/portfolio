export function intervalMsFrom(env?: Record<string, string | undefined>): number;
export function runAutodeploy(options?: {
  env?: Record<string, string | undefined>;
  check?: (options: { env: Record<string, string | undefined>; log: (line: string) => void }) =>
    | { exitCode?: number }
    | Promise<{ exitCode?: number }>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
  signal?: AbortSignal;
}): Promise<{ runs: number }>;
