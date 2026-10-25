import { spawn } from "node:child_process";

// 一键拉起前后端：并排跑 `npm run server` 与 web 的 vite dev，输出加 [server]/[web] 前缀；
// 任一进程退出或 Ctrl+C 时，连带清理整个子进程树（Windows 用 taskkill /T）
const isWin = process.platform === "win32";

const jobs = [
  { name: "server", args: ["run", "server"] },
  { name: "web", args: ["--prefix", "web", "run", "dev"] },
];

const children = [];
let shuttingDown = false;

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    if (isWin) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
};

const pipeLines = (stream, prefix) => {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      process.stdout.write(`${prefix} ${buf.slice(0, i + 1)}`);
      buf = buf.slice(i + 1);
    }
  });
};

for (const job of jobs) {
  const child = spawn("npm", job.args, {
    shell: isWin, // Windows 下 npm 是 .cmd，需 shell 解析
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const prefix = `[${job.name}]`;
  pipeLines(child.stdout, prefix);
  pipeLines(child.stderr, prefix);
  child.on("exit", (code) => {
    console.log(`${prefix} 进程退出 (code=${code})，一并结束其余进程`);
    shutdown();
    process.exit(code ?? 0);
  });
}

console.log("[dev:all] 启动中——后端 http://localhost:3000 ，前端 http://localhost:5173 ，Ctrl+C 全部停止");

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
