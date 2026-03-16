import { useEffect, useState } from "react";
import { supabase, signInWithGoogle } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import type { Session } from "@supabase/supabase-js";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background gap-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <svg viewBox="0 0 40 40" width="48" height="48" aria-label="Welday Open Brain">
            <circle cx="20" cy="20" r="18" fill="none" stroke="hsl(186 85% 52%)" strokeWidth="1.5"/>
            <circle cx="20" cy="20" r="8" fill="none" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.5"/>
            <circle cx="20" cy="20" r="3" fill="hsl(186 85% 52%)"/>
            <line x1="20" y1="2" x2="20" y2="10" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
            <line x1="20" y1="30" x2="20" y2="38" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
            <line x1="2" y1="20" x2="10" y2="20" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
            <line x1="30" y1="20" x2="38" y2="20" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
          </svg>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Welday Open Brain</h1>
            <p className="text-sm text-muted-foreground mt-1">11 ventures. One intelligence.</p>
          </div>
        </div>

        <Button
          data-testid="button-google-signin"
          onClick={() => signInWithGoogle({ includeGoogleWorkspace: true })}
          className="gap-2 px-6"
          size="lg"
        >
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </Button>

        <p className="text-xs text-muted-foreground">
          Restricted to authorized Welday accounts
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
