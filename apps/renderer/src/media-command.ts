import { spawn } from "node:child_process";

// Reject only after the child and its pipes close. Callers can then safely
// remove temporary files and start another render without overlapping work.
export async function runMediaCommand(command: string, args: readonly string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true });
    let stdout = ""; let stderr = ""; let failure: Error | null = null; let escalation: NodeJS.Timeout | undefined;
    const abort = () => { failure = signal?.reason instanceof Error ? signal.reason : new Error("MEDIA_OPERATION_CANCELLED"); child.kill("SIGTERM"); escalation = setTimeout(() => child.kill("SIGKILL"), 2000); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-2_000_000); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2_000_000); });
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort); if (escalation) clearTimeout(escalation);
      if (failure) reject(failure); else if (code !== 0) reject(new Error(`MEDIA_COMMAND_FAILED_${command}_${code ?? "SIGNAL"}`)); else resolve({ stdout, stderr });
    });
    if (signal?.aborted) abort();
  });
}
