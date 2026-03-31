/**
 * Profilo utente raccolto nell'onboarding NEUMA v2 — allegato a `biometryPayload.user_profile_v2`.
 */
import type { NeumaBiometryExportPayload } from "./biometry/types";

export const ONBOARDING_V2_DONE_KEY = "neuma.onboarding_v2_done";
export const USER_PROFILE_V2_STORAGE_KEY = "neuma.user_profile_v2";

export type UserProfileV2Sex = "male" | "female" | "prefer_not_say";

export type UserProfileV2Usage = "daily" | "sport" | "comfort";

export type UserProfileV2 = {
  version: 2;
  /** Step 1 — requisiti ambiente */
  requirements: {
    printerA4: boolean;
    sheetOnRigidSurface: boolean;
    smartphoneChargedCleanLens: boolean;
  };
  /** Step 2 — profilo */
  sex: UserProfileV2Sex;
  /** anni (opzionale per profili salvati prima dell’introduzione del campo) */
  ageYears?: number;
  /** cm */
  heightCm: number;
  /** EU 35–48 */
  shoeSizeEu: number;
  usage: UserProfileV2Usage;
  /** Step 3 */
  privacy: {
    biometricProcessingAccepted: boolean;
    acceptedAtIso: string;
  };
  /** ISO timestamp completamento onboarding */
  completedAtIso: string;
};

export type NeumaBiometryPayloadWithUserProfile = NeumaBiometryExportPayload & {
  user_profile_v2: UserProfileV2;
};

export function isOnboardingV2Complete(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ONBOARDING_V2_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function loadUserProfileV2(): UserProfileV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_PROFILE_V2_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfileV2;
    if (parsed?.version !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOnboardingV2Profile(profile: UserProfileV2): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USER_PROFILE_V2_STORAGE_KEY, JSON.stringify(profile));
    window.localStorage.setItem(ONBOARDING_V2_DONE_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}

/** Merge sicuro per POST ordini / export */
export function mergeBiometryPayloadWithUserProfile(
  exportPayload: NeumaBiometryExportPayload
): NeumaBiometryExportPayload | NeumaBiometryPayloadWithUserProfile {
  const profile = loadUserProfileV2();
  if (!profile) return exportPayload;
  return {
    ...exportPayload,
    user_profile_v2: profile,
  };
}
