import "../dotenv";

import * as crypto from "crypto";
import { z } from "zod";

const EnvSchema = z.object({
  REMOTE_CREDENTIALS_KEY: z.string().min(32),
});

const PlainSchema = z.discriminatedUnion("protocol", [
  z.object({
    protocol: z.literal("rdp"),
    hostname: z.string().min(1),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    domain: z.string().min(1).optional(),
  }),
  z.object({
    protocol: z.literal("vnc"),
    hostname: z.string().min(1),
    port: z.number().int().min(1).max(65535).optional(),
    password: z.string().min(1),
  }),
]);

function parseAes256KeyBase64(base64: string) {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("REMOTE_CREDENTIALS_KEY must be base64 for 32 bytes (AES-256)");
  return key;
}

function encryptJson(keyBase64: string, payload: unknown) {
  const key = parseAes256KeyBase64(keyBase64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1 as const,
    alg: "aes-256-gcm" as const,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

async function main() {
  const env = EnvSchema.parse(process.env);
  const jsonArg = process.argv.slice(2).join(" ").trim();
  if (!jsonArg) {
    console.error('Usage: tsx server/scripts/encrypt-remote-credentials.ts \'{"protocol":"rdp","hostname":"10.0.0.5","username":"ADMIN","password":"..."}\'');
    process.exit(2);
  }

  const parsed = PlainSchema.parse(JSON.parse(jsonArg));
  const encrypted = encryptJson(env.REMOTE_CREDENTIALS_KEY, parsed);
  process.stdout.write(JSON.stringify(encrypted, null, 2) + "\n");
}

main().catch((e) => {
  console.error("[encrypt-remote-credentials] FAILED");
  console.error(e);
  process.exit(1);
});

