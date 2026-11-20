import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMediaCommand } from "./media-command.js";
describe("media process lifecycle", () => {
  it("awaits process exit after abort before releasing its caller", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbot-child-test-"));
    const pidFile = join(directory, "pid.txt"); const controller = new AbortController();
    const running = runMediaCommand(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", pidFile], controller.signal);
    const outcome = running.catch((error: unknown) => error);
    try {
      let pid = 0;
      for (let attempt = 0; attempt < 100 && !pid; attempt++) { try { pid = Number(await readFile(pidFile, "utf8")); } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } }
      expect(pid).toBeGreaterThan(0); controller.abort(new Error("TEST_CANCELLED"));
      expect(await outcome).toMatchObject({ message: "TEST_CANCELLED" });
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { controller.abort(); await outcome; await rm(directory, { recursive: true, force: true }); }
  });
});
