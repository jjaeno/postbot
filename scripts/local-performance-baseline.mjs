import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const compose = ["compose", "-f", "docker-compose.acceptance.yml"];

const run = (executable, args, { capture = false } = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(executable, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    if (!capture) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    if (!capture) process.stderr.write(chunk);
  });
  child.once("error", reject);
  child.once("close", (code) => code === 0
    ? resolveRun({ stdout, stderr })
    : reject(new Error(`${executable} ${args.join(" ")} failed with exit ${code}: ${stderr.slice(-2_000)}`)));
});

const healthProbe = `
const samples=[];
const started=performance.now();
for(let offset=0;offset<100;offset+=10){
  await Promise.all(Array.from({length:10},async()=>{
    const at=performance.now();
    const response=await fetch('http://127.0.0.1:3000/health');
    if(!response.ok)throw new Error('health '+response.status);
    await response.arrayBuffer();
    samples.push(performance.now()-at);
  }));
}
samples.sort((a,b)=>a-b);
const elapsed=performance.now()-started;
console.log(JSON.stringify({requests:samples.length,concurrency:10,throughputPerSecond:samples.length/(elapsed/1000),latencyMs:{p50:samples[49],p95:samples[94],max:samples[99]},elapsedMs:elapsed}));
`;

const outputPath = resolve(process.env.BASELINE_OUTPUT ?? ".artifacts/local-performance-baseline.json");
const startedAt = new Date();
let e2eElapsedMs = 0;

try {
  if (process.env.BASELINE_SKIP_BUILD !== "1") await run("docker", [...compose, "build", "api", "worker", "acceptance"]);
  await run("docker", [...compose, "up", "-d", "--force-recreate", "--wait", "api", "worker"]);
  const healthResult = await run("docker", [...compose, "exec", "-T", "api", "node", "--input-type=module", "-e", healthProbe], { capture: true });
  const health = JSON.parse(healthResult.stdout.trim().split(/\r?\n/u).at(-1));

  const e2eStartedAt = performance.now();
  await run("docker", [...compose, "run", "--rm", "acceptance"]);
  e2eElapsedMs = performance.now() - e2eStartedAt;

  const ids = (await run("docker", [...compose, "ps", "-q", "api", "worker"], { capture: true })).stdout.trim().split(/\s+/u).filter(Boolean);
  const stats = ids.length === 0 ? [] : (await run("docker", ["stats", "--no-stream", "--format", "{{json .}}", ...ids], { capture: true })).stdout
    .trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const report = {
    classification: "LOCAL_BASELINE",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    environment: "Docker Desktop acceptance compose; one API worker, MySQL 8.4, Redis 7.4, MinIO",
    restHealth: health,
    fullFakeE2eElapsedMs: Math.round(e2eElapsedMs),
    containerStats: stats,
    notes: [
      "Per-stage scheduler, queue, SSE, analytics, worker and renderer timings are emitted as LOCAL_BASELINE lines by the acceptance suite.",
      "These measurements are a local reference, not a production SLO or capacity guarantee."
    ]
  };
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`LOCAL_BASELINE_REPORT ${outputPath}\n`);
} finally {
  if (process.env.BASELINE_KEEP_STACK !== "1") await run("docker", [...compose, "down"]).catch((error) => process.stderr.write(`${error.message}\n`));
}
