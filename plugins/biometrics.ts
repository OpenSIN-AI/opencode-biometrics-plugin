import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { BunShell } from "@opencode-ai/plugin/dist/shell";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import os from "node:os";

type ToolResult = { ok: true; data?: unknown } | { ok: false; error: string; data?: unknown };
type StartResult = ToolResult & {
  data?: {
    repo_dir: string;
    pid_file?: string;
    pid?: number;
    log_file?: string;
    base_url?: string;
    already_running?: boolean;
    stdout?: string;
  };
};

async function shCmd(
  $: BunShell,
  cwd: string,
  cmd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const out = await $.cwd(cwd).nothrow()`bash -lc ${cmd}`;
  return { exitCode: out.exitCode, stdout: out.text(), stderr: out.stderr.toString() };
}

async function writeJsonAtomic(filePath: string, obj: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  await rename(tmp, filePath);
}

function homePath(...parts: string[]): string {
  return join(os.homedir(), ...parts);
}

function resolveRepoDir(repoDir?: string): string {
  const trimmed = (repoDir || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~")) return join(os.homedir(), trimmed.slice(1));
  return resolve(trimmed);
}

function shellEscapeDoubleQuotes(input: string): string {
  return input.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await import("node:fs/promises").then((m) => m.stat(path));
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

async function writeText(path: string, content: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "http://127.0.0.1:59013";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed.replace(/\/+$/, "");
  return `http://${trimmed.replace(/\/+$/, "")}`;
}

async function isPidRunning($: BunShell, pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  const res = await shCmd($, os.homedir(), `kill -0 ${pid} >/dev/null 2>&1; echo $?`);
  return res.stdout.trim() === "0";
}

const plugin: Plugin = async (input) => {
  const $ = input.shell;

  return {
    name: "biometrics",
    tools: [
      tool({
        id: "biometrics.bootstrap_plans",
        description:
          "Creates ~/.sisyphus/plans/<project_id>/boulder.json scaffolding (repo-independent).",
        schema: {
          type: "object",
          properties: {
            project_id: { type: "string", minLength: 1, default: "biometrics" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", minLength: 1 },
                  description: { type: "string", minLength: 1 },
                },
                required: ["id", "description"],
                additionalProperties: false,
              },
              default: [],
            },
          },
          required: ["project_id"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const projectID = String(args.project_id || "biometrics").trim() || "biometrics";
          const base = homePath(".sisyphus", "plans", projectID);
          const boulderPath = join(base, "boulder.json");
          const now = new Date().toISOString();
          const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
          const tasks = rawTasks.map((t: any, idx: number) => ({
            id: String(t?.id || `task-${idx + 1}`).trim() || `task-${idx + 1}`,
            description: String(t?.description || "").trim() || "TODO",
            status: "pending",
          }));
          const boulder = {
            project_id: projectID,
            generated_at: now,
            tasks,
            completed_tasks: [],
          };
          await writeJsonAtomic(boulderPath, boulder);
          return { ok: true, data: { project_id: projectID, boulder_path: boulderPath, task_count: tasks.length } };
        },
      }),

      tool({
        id: "biometrics.clone_repo",
        description:
          "Clones the BIOMETRICS repo into a target directory. Defaults to ~/BIOMETRICS if no target is provided.",
        schema: {
          type: "object",
          properties: {
            repo_url: {
              type: "string",
              minLength: 1,
              default: "https://github.com/Delqhi/BIOMETRICS.git",
            },
            target_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
            ref: { type: "string", minLength: 1, default: "main" },
          },
          required: ["repo_url", "target_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const repoURL = String(args.repo_url || "").trim();
          const ref = String(args.ref || "main").trim() || "main";
          const targetDir = resolveRepoDir(String(args.target_dir || "~/BIOMETRICS"));
          if (!repoURL) return { ok: false, error: "missing_repo_url" };
          if (!targetDir) return { ok: false, error: "missing_target_dir" };

          await mkdir(dirname(targetDir), { recursive: true });
          const cmd = `git clone --depth 1 --branch ${$.escape(ref)} ${$.escape(repoURL)} ${$.escape(targetDir)}`;
          const res = await shCmd($, os.homedir(), cmd);
          if (res.exitCode !== 0) {
            return { ok: false, error: res.stderr.trim() || res.stdout.trim() || "git clone failed" };
          }
          return { ok: true, data: { repo_url: repoURL, ref, target_dir: targetDir } };
        },
      }),

      tool({
        id: "biometrics.repo.ensure",
        description:
          "Ensures a BIOMETRICS repo directory exists. If missing, clones it. If present, can optionally git pull.",
        schema: {
          type: "object",
          properties: {
            repo_url: {
              type: "string",
              minLength: 1,
              default: "https://github.com/Delqhi/BIOMETRICS.git",
            },
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
            ref: { type: "string", minLength: 1, default: "main" },
            mode: { type: "string", enum: ["clone_if_missing", "pull_if_present", "clone_or_pull"], default: "clone_or_pull" },
          },
          required: ["repo_url", "repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const repoURL = String(args.repo_url || "").trim();
          const ref = String(args.ref || "main").trim() || "main";
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          const mode = String(args.mode || "clone_or_pull");
          if (!repoURL) return { ok: false, error: "missing_repo_url" };
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };

          const gitDir = join(repoDir, ".git");
          const exists = await fileExists(gitDir);
          if (!exists) {
            const clone = await shCmd(
              $,
              os.homedir(),
              `git clone --depth 1 --branch ${$.escape(ref)} ${$.escape(repoURL)} ${$.escape(repoDir)}`,
            );
            if (clone.exitCode !== 0) {
              return { ok: false, error: clone.stderr.trim() || clone.stdout.trim() || "git clone failed" };
            }
            return { ok: true, data: { repo_dir: repoDir, action: "cloned", ref } };
          }

          if (mode === "clone_if_missing") {
            return { ok: true, data: { repo_dir: repoDir, action: "present" } };
          }

          if (mode === "pull_if_present" || mode === "clone_or_pull") {
            const pull = await shCmd($, repoDir, `git pull --ff-only origin ${$.escape(ref)}`);
            if (pull.exitCode !== 0) {
              return { ok: false, error: pull.stderr.trim() || pull.stdout.trim() || "git pull failed" };
            }
            return { ok: true, data: { repo_dir: repoDir, action: "pulled", ref } };
          }

          return { ok: true, data: { repo_dir: repoDir, action: "present" } };
        },
      }),

      tool({
        id: "biometrics.env.init",
        description:
          "Bootstraps BIOMETRICS `.env` from `.env.example` by running `./scripts/init-env.sh` inside the repo.",
        schema: {
          type: "object",
          properties: {
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
          },
          required: ["repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };
          const res = await shCmd($, repoDir, "./scripts/init-env.sh");
          if (res.exitCode !== 0) {
            return { ok: false, error: res.stderr.trim() || res.stdout.trim() || "init-env failed" };
          }
          return { ok: true, data: { repo_dir: repoDir } };
        },
      }),

      tool({
        id: "biometrics.build",
        description: "Builds BIOMETRICS artifacts via `make build` inside the repo.",
        schema: {
          type: "object",
          properties: {
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
          },
          required: ["repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };
          const res = await shCmd($, repoDir, "make build");
          if (res.exitCode !== 0) {
            return { ok: false, error: res.stderr.trim() || res.stdout.trim() || "build failed" };
          }
          return { ok: true, data: { repo_dir: repoDir } };
        },
      }),

      tool({
        id: "biometrics.onboard",
        description:
          "Runs BIOMETRICS clone-to-run onboarding in the specified repo directory (interactive by default).",
        schema: {
          type: "object",
          properties: {
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
            args: { type: "array", items: { type: "string" }, default: [] },
          },
          required: ["repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          const extra = Array.isArray(args.args) ? args.args.map((v: any) => String(v)) : [];
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };

          const cmd = `./biometrics-onboard ${extra.map((x) => $.escape(x)).join(" ")}`.trim();
          const res = await shCmd($, repoDir, cmd);
          if (res.exitCode !== 0) {
            return { ok: false, error: res.stderr.trim() || res.stdout.trim() || "onboarding failed" };
          }
          return { ok: true, data: { repo_dir: repoDir, stdout: res.stdout.trim() } };
        },
      }),

      tool({
        id: "biometrics.controlplane.start",
        description:
          "Starts the BIOMETRICS V3 controlplane (`./bin/biometrics-cli`) in the background and records a PID file under `.biometrics/`.",
        schema: {
          type: "object",
          properties: {
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
            base_url: { type: "string", minLength: 1, default: "http://127.0.0.1:59013" },
            env: {
              type: "object",
              additionalProperties: { type: "string" },
              default: {},
            },
            force_restart: { type: "boolean", default: false },
            confirm: { type: "boolean", default: false },
          },
          required: ["repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<StartResult> {
          if (!args.confirm) return { ok: false, error: "confirm_required" };
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          const baseUrl = normalizeBaseUrl(String(args.base_url || "http://127.0.0.1:59013"));
          const forceRestart = Boolean(args.force_restart);
          const extraEnv = (args.env && typeof args.env === "object" ? (args.env as Record<string, string>) : {}) || {};
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };

          const pidFile = join(repoDir, ".biometrics", "controlplane.pid");
          const logFile = join(repoDir, "logs", `controlplane-${Date.now()}.log`);

          if (await fileExists(pidFile)) {
            const pidRaw = (await readText(pidFile)).trim();
            const pid = Number.parseInt(pidRaw, 10);
            if (!forceRestart && Number.isFinite(pid) && (await isPidRunning($, pid))) {
              return { ok: true, data: { repo_dir: repoDir, pid_file: pidFile, pid, log_file: logFile, base_url: baseUrl, already_running: true } };
            }
            if (forceRestart && Number.isFinite(pid) && pid > 1) {
              await shCmd($, os.homedir(), `kill ${pid} >/dev/null 2>&1 || true`);
              await shCmd($, os.homedir(), `kill -9 ${pid} >/dev/null 2>&1 || true`);
            }
          }

          await mkdir(dirname(pidFile), { recursive: true });
          await mkdir(dirname(logFile), { recursive: true });

          const envPairs: string[] = [];
          for (const [key, value] of Object.entries(extraEnv)) {
            if (!key.trim()) continue;
            envPairs.push(`${key.trim()}=${shellEscapeDoubleQuotes(String(value ?? ""))}`);
          }
          const envPrefix = envPairs.length ? `export ${envPairs.map((p) => `"${p}"`).join(" ")}; ` : "";
          const cmd = `${envPrefix}nohup ./bin/biometrics-cli > ${$.escape(logFile)} 2>&1 & echo $! > ${$.escape(pidFile)}`;
          const res = await shCmd($, repoDir, cmd);
          if (res.exitCode !== 0) {
            return { ok: false, error: res.stderr.trim() || res.stdout.trim() || "start failed", data: { repo_dir: repoDir, pid_file: pidFile, log_file: logFile } };
          }
          const pid = Number.parseInt((await readText(pidFile)).trim(), 10);
          return { ok: true, data: { repo_dir: repoDir, pid_file: pidFile, pid: Number.isFinite(pid) ? pid : undefined, log_file: logFile, base_url: baseUrl } };
        },
      }),

      tool({
        id: "biometrics.controlplane.stop",
        description: "Stops the BIOMETRICS V3 controlplane using the PID file under `.biometrics/`.",
        schema: {
          type: "object",
          properties: {
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
            force: { type: "boolean", default: false },
            confirm: { type: "boolean", default: false },
          },
          required: ["repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          if (!args.confirm) return { ok: false, error: "confirm_required" };
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          const force = Boolean(args.force);
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };
          const pidFile = join(repoDir, ".biometrics", "controlplane.pid");
          if (!(await fileExists(pidFile))) return { ok: false, error: "pid_file_missing" };
          const pidRaw = (await readText(pidFile)).trim();
          const pid = Number.parseInt(pidRaw, 10);
          if (!Number.isFinite(pid) || pid <= 1) return { ok: false, error: "invalid_pid" };

          await shCmd($, os.homedir(), `kill ${pid} >/dev/null 2>&1 || true`);
          if (force) {
            await shCmd($, os.homedir(), `kill -9 ${pid} >/dev/null 2>&1 || true`);
          }
          await writeText(pidFile, "");
          return { ok: true, data: { repo_dir: repoDir, pid } };
        },
      }),

      tool({
        id: "biometrics.health.ready",
        description: "Fetches BIOMETRICS controlplane readiness (`/health/ready`).",
        schema: {
          type: "object",
          properties: {
            base_url: { type: "string", minLength: 1, default: "http://127.0.0.1:59013" },
          },
          required: ["base_url"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const baseUrl = normalizeBaseUrl(String(args.base_url || "http://127.0.0.1:59013"));
          const res = await shCmd($, os.homedir(), `curl -fsS ${$.escape(`${baseUrl}/health/ready`)}`);
          if (res.exitCode !== 0) return { ok: false, error: res.stderr.trim() || res.stdout.trim() || "health check failed" };
          return { ok: true, data: { base_url: baseUrl, body: res.stdout.trim() } };
        },
      }),

      tool({
        id: "biometrics.check_gates",
        description:
          "Runs BIOMETRICS release gate checks (Go + web + website + secret scan) in the specified repo directory.",
        schema: {
          type: "object",
          properties: {
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
          },
          required: ["repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };
          const res = await shCmd($, repoDir, "./scripts/release/check-gates.sh");
          if (res.exitCode !== 0) {
            return { ok: false, error: res.stderr.trim() || res.stdout.trim() || "gate checks failed" };
          }
          return { ok: true, data: { repo_dir: repoDir, stdout: res.stdout.trim() } };
        },
      }),

      tool({
        id: "biometrics.bootstrap_all",
        description:
          "End-to-end bootstrap: ensure repo, init env, run onboarding, build, start controlplane, and run gate checks.",
        schema: {
          type: "object",
          properties: {
            repo_url: { type: "string", minLength: 1, default: "https://github.com/Delqhi/BIOMETRICS.git" },
            repo_dir: { type: "string", minLength: 1, default: "~/BIOMETRICS" },
            ref: { type: "string", minLength: 1, default: "main" },
            onboard_args: { type: "array", items: { type: "string" }, default: [] },
            base_url: { type: "string", minLength: 1, default: "http://127.0.0.1:59013" },
            run_gates: { type: "boolean", default: true },
            confirm: { type: "boolean", default: false },
          },
          required: ["repo_url", "repo_dir"],
          additionalProperties: false,
        },
        async run(args): Promise<ToolResult> {
          if (!args.confirm) return { ok: false, error: "confirm_required" };
          const repoURL = String(args.repo_url || "").trim();
          const ref = String(args.ref || "main").trim() || "main";
          const repoDir = resolveRepoDir(String(args.repo_dir || "~/BIOMETRICS"));
          const onboardArgs = Array.isArray(args.onboard_args) ? args.onboard_args.map((v: any) => String(v)) : [];
          const baseUrl = normalizeBaseUrl(String(args.base_url || "http://127.0.0.1:59013"));
          const runGates = Boolean(args.run_gates);
          if (!repoURL) return { ok: false, error: "missing_repo_url" };
          if (!repoDir) return { ok: false, error: "missing_repo_dir" };

          const steps: any[] = [];

          const ensure = await (async () => {
            const r = await shCmd(
              $,
              os.homedir(),
              `test -d ${$.escape(join(repoDir, ".git"))} || git clone --depth 1 --branch ${$.escape(ref)} ${$.escape(repoURL)} ${$.escape(repoDir)}`,
            );
            return r.exitCode === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || r.stdout.trim() };
          })();
          steps.push({ step: "repo.ensure", ...ensure });
          if (!ensure.ok) return { ok: false, error: `repo.ensure failed: ${ensure.error}`, data: { steps } };

          const envInit = await shCmd($, repoDir, "./scripts/init-env.sh");
          steps.push({ step: "env.init", ok: envInit.exitCode === 0, error: envInit.exitCode ? (envInit.stderr.trim() || envInit.stdout.trim()) : undefined });
          if (envInit.exitCode !== 0) return { ok: false, error: "env.init failed", data: { steps } };

          const onboard = await shCmd($, repoDir, `./biometrics-onboard ${onboardArgs.map((x) => $.escape(x)).join(" ")}`.trim());
          steps.push({ step: "onboard", ok: onboard.exitCode === 0, error: onboard.exitCode ? (onboard.stderr.trim() || onboard.stdout.trim()) : undefined });
          if (onboard.exitCode !== 0) return { ok: false, error: "onboard failed", data: { steps } };

          const build = await shCmd($, repoDir, "make build");
          steps.push({ step: "build", ok: build.exitCode === 0, error: build.exitCode ? (build.stderr.trim() || build.stdout.trim()) : undefined });
          if (build.exitCode !== 0) return { ok: false, error: "build failed", data: { steps } };

          const start = await (async () => {
            const pidFile = join(repoDir, ".biometrics", "controlplane.pid");
            const logFile = join(repoDir, "logs", `controlplane-${Date.now()}.log`);
            await mkdir(dirname(pidFile), { recursive: true });
            await mkdir(dirname(logFile), { recursive: true });
            const res = await shCmd($, repoDir, `nohup ./bin/biometrics-cli > ${$.escape(logFile)} 2>&1 & echo $! > ${$.escape(pidFile)}`);
            if (res.exitCode !== 0) return { ok: false, error: res.stderr.trim() || res.stdout.trim(), pid_file: pidFile, log_file: logFile };
            const pid = Number.parseInt((await readText(pidFile)).trim(), 10);
            return { ok: true, pid: Number.isFinite(pid) ? pid : undefined, pid_file: pidFile, log_file: logFile };
          })();
          steps.push({ step: "controlplane.start", ...start, base_url: baseUrl });
          if (!start.ok) return { ok: false, error: "controlplane.start failed", data: { steps } };

          const ready = await shCmd($, os.homedir(), `curl -fsS ${$.escape(`${baseUrl}/health/ready`)} || true`);
          steps.push({ step: "health.ready", ok: ready.exitCode === 0, body: ready.stdout.trim() });

          if (runGates) {
            const gates = await shCmd($, repoDir, "./scripts/release/check-gates.sh");
            steps.push({ step: "check_gates", ok: gates.exitCode === 0, error: gates.exitCode ? (gates.stderr.trim() || gates.stdout.trim()) : undefined });
            if (gates.exitCode !== 0) return { ok: false, error: "check_gates failed", data: { steps } };
          }

          return { ok: true, data: { repo_dir: repoDir, base_url: baseUrl, steps } };
        },
      }),
    ],
  };
};

export default plugin;
