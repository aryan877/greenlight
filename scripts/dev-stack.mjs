import { spawn } from "node:child_process";

const children = new Set();

const start = (command, args) => {
  const child = spawn(command, args, {
    env: process.env,
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) shutdown(signal ? 1 : (code ?? 0));
  });
  return child;
};

let shuttingDown = false;
const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
};

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

start(process.execPath, ["node_modules/@truefoundry/trueforge/dist/cli.js"]);
start(process.execPath, [
  "node_modules/turbo/bin/turbo",
  "run",
  "dev",
  "--parallel",
]);
