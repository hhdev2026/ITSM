import "./dotenv";

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { z } from "zod";

const require = createRequire(import.meta.url);

const MeshCtrlEnvSchema = z.object({
  MESHCENTRAL_URL: z.string().min(1).default("wss://localhost:4430"),
  MESHCENTRAL_USER: z.string().min(1).default("admin"),
  MESHCENTRAL_PASS: z.string().min(1),
  MESHCENTRAL_TOKEN: z.string().trim().min(1).optional(),
  MESHCENTRAL_INSECURE_TLS: z.coerce.boolean().default(false),
});

export type MeshCtrlEnv = z.infer<typeof MeshCtrlEnvSchema>;

export type MeshDeviceNode = {
  _id: string;
  name?: string;
  meshid?: string;
  groupname?: string;
  osdesc?: string;
  ip?: string;
  host?: string;
  conn?: number;
  pwr?: number;
  icon?: number;
  [k: string]: unknown;
};

function getMeshCtrlPath() {
  return require.resolve("meshcentral/meshctrl.js");
}

export function loadMeshCtrlEnv(): MeshCtrlEnv {
  return MeshCtrlEnvSchema.parse(process.env);
}

export async function runMeshCtrl(action: string, args: string[], opts?: { timeoutMs?: number; env?: MeshCtrlEnv }) {
  const env = opts?.env ?? loadMeshCtrlEnv();
  const meshctrlPath = getMeshCtrlPath();

  const argv: string[] = [
    meshctrlPath,
    action,
    ...args,
    "--url",
    env.MESHCENTRAL_URL,
    "--loginuser",
    env.MESHCENTRAL_USER,
    "--loginpass",
    env.MESHCENTRAL_PASS,
  ];
  if (env.MESHCENTRAL_TOKEN) argv.push("--token", env.MESHCENTRAL_TOKEN);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env.MESHCENTRAL_INSECURE_TLS) {
    childEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    childEnv.NODE_NO_WARNINGS = "1";
  }

  return await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(process.execPath, argv, { env: childEnv });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`meshctrl_timeout action=${action}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

export async function runMeshCtrlJson<T>(action: string, args: string[], opts?: { timeoutMs?: number; env?: MeshCtrlEnv }) {
  const { stdout, stderr, exitCode } = await runMeshCtrl(action, args, opts);
  if (exitCode !== 0) throw new Error(`meshctrl_failed action=${action} code=${exitCode} stderr=${stderr.trim()}`);
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`meshctrl_json_parse_failed action=${action} stdout=${trimmed.slice(0, 2000)}`);
  }
}

export async function listDevices(opts?: { groupName?: string; filterIds?: string[]; env?: MeshCtrlEnv }) {
  const args = ["--json", "--details"];
  if (opts?.groupName) args.push("--group", opts.groupName);
  if (opts?.filterIds?.length) args.push("--filterid", opts.filterIds.join(","));
  const nodes = await runMeshCtrlJson<MeshDeviceNode[]>("listdevices", args, { env: opts?.env, timeoutMs: 60_000 });
  return nodes.filter((n) => typeof n?._id === "string" && n._id.includes("/"));
}

export function normalizeNodeId(id: string) {
  const parts = id.split("/");
  return parts[parts.length - 1] ?? id;
}

export async function runCommand(
  nodeId: string,
  command: string,
  opts?: { powershell?: boolean; reply?: boolean; timeoutMs?: number; env?: MeshCtrlEnv }
) {
  const args: string[] = ["--id", nodeId, "--run", command];
  if (opts?.powershell) args.push("--powershell");
  if (opts?.reply) args.push("--reply");

  const res = await runMeshCtrl("runcommand", args, { env: opts?.env, timeoutMs: opts?.timeoutMs ?? 90_000 });
  if (res.exitCode !== 0) throw new Error(`meshctrl_runcommand_failed node=${nodeId} stderr=${res.stderr.trim()}`);
  return res.stdout.trim();
}
