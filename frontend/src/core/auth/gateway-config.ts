import { z } from "zod";

const gatewayConfigSchema = z.object({
  internalGatewayUrl: z.string().url(),
  trustedOrigins: z.array(z.string()).min(1),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

let _cached: GatewayConfig | null = null;

export function getGatewayConfig(): GatewayConfig {
  if (_cached) return _cached;

  const internalGatewayUrl =
    process.env.KKOCLAW_INTERNAL_GATEWAY_BASE_URL?.trim()?.replace(/\/+$/, "") ??
    "http://localhost:9987";

  const trustedOrigins = process.env.KKOCLAW_TRUSTED_ORIGINS?.trim()
    ? process.env.KKOCLAW_TRUSTED_ORIGINS?.trim()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["http://localhost:3333"];

  _cached = gatewayConfigSchema.parse({ internalGatewayUrl, trustedOrigins });
  return _cached;
}
