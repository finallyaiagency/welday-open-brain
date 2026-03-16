import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const googleWorkspaceSyncFlag = (import.meta.env.VITE_ENABLE_GOOGLE_WORKSPACE_SYNC as string | undefined) || "false";

const memStore: Record<string, string> = {};
const inMemoryStorage = {
  getItem: (key: string) => memStore[key] ?? null,
  setItem: (key: string, value: string) => { memStore[key] = value; },
  removeItem: (key: string) => { delete memStore[key]; },
};

const GOOGLE_PROVIDER_TOKEN_KEY = "welday.google.provider-token";

function getBrowserStorage() {
  if (typeof window === "undefined") return inMemoryStorage;

  try {
    const probe = "__welday_storage_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return inMemoryStorage;
  }
}

const authStorage = getBrowserStorage();

export const GOOGLE_WORKSPACE_SYNC_ENABLED = googleWorkspaceSyncFlag.toLowerCase() === "true";

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder",
  {
    auth: {
      storage: authStorage as any,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

function cacheGoogleProviderToken(session: Session | null) {
  if (session?.provider_token) {
    authStorage.setItem(GOOGLE_PROVIDER_TOKEN_KEY, session.provider_token);
    return;
  }

  if (session === null) {
    authStorage.removeItem(GOOGLE_PROVIDER_TOKEN_KEY);
  }
}

supabase.auth.getSession().then(({ data }) => cacheGoogleProviderToken(data.session)).catch(() => {});
supabase.auth.onAuthStateChange((_event, session) => {
  cacheGoogleProviderToken(session);
});

export async function signInWithGoogle(options?: { includeGoogleWorkspace?: boolean }) {
  if (options?.includeGoogleWorkspace && !GOOGLE_WORKSPACE_SYNC_ENABLED) {
    throw new Error("Google Calendar and Tasks connection is temporarily disabled until the Google OAuth app is verified or test-user access is configured.");
  }

  const scopes = [
    "openid",
    "email",
    "profile",
    options?.includeGoogleWorkspace ? "https://www.googleapis.com/auth/calendar" : null,
    options?.includeGoogleWorkspace ? "https://www.googleapis.com/auth/tasks" : null,
  ].filter(Boolean).join(" ");

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/`,
      scopes,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
    },
  });
  if (error) throw error;
}

export async function signOut() {
  authStorage.removeItem(GOOGLE_PROVIDER_TOKEN_KEY);
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function getCachedGoogleProviderToken() {
  return authStorage.getItem(GOOGLE_PROVIDER_TOKEN_KEY);
}

export function clearCachedGoogleProviderToken() {
  authStorage.removeItem(GOOGLE_PROVIDER_TOKEN_KEY);
}
