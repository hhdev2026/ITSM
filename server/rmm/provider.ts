import type { AuthedRequest } from "../auth";

export type RmmProviderId = "meshcentral" | "netlock";

export type RmmStatus = {
  provider: RmmProviderId;
  configured: boolean;
  connectivity: { ok: boolean; checkedAt: string; error: string | null } | null;
  details?: Record<string, unknown>;
};

export type RmmEnrollRequest = {
  hours: number;
  deviceName?: string | null;
  architecture?: string | null;
};

export type RmmEnrollResponse = {
  provider: RmmProviderId;
  url: string;
  expiresInSeconds: number;
  hint?: string | null;
  // Provider-specific correlation value (used for verification / assignment).
  correlationKey?: string | null;
};

export type RmmVerifyRequest = {
  correlationKey: string;
  deviceName?: string | null;
};

export type RmmVerifyResponse = {
  ok: boolean;
  assetId: string | null;
  message?: string | null;
};

export interface RmmProvider {
  id: RmmProviderId;
  status(req: AuthedRequest): Promise<RmmStatus>;
  enrollSelf(req: AuthedRequest, body: RmmEnrollRequest): Promise<RmmEnrollResponse>;
  verifySelf(req: AuthedRequest, body: RmmVerifyRequest): Promise<RmmVerifyResponse>;
}

