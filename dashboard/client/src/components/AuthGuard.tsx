import { useEffect, useState } from "react";
import { supabase, signInWithGoogle, signOut } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import type { Session } from "@supabase/supabase-js";

const ALLOWED_EMAIL = "weldayenterprises@gmail.com";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm font-medium opacity-50">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-6">
        <div className="max-w-md w-full space-y-8 text-center p-8 rounded-2xl border bg-card border-border shadow-2xl">
          <div className="space-y-3">
             <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
               <span className="text-primary text-2xl font-bold">O</span>
             </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Welday Open Brain</h1>
            <p className="text-muted-foreground text-sm">
              Your executive intelligence dashboard. Please sign in to continue.
            </p>
          </div>

          <div className="space-y-4 pt-4">
            <Button 
              onClick={() => signInWithGoogle()} 
              className="w-full h-11 font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Sign in with Google
            </Button>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
              Access limited to Welday Enterprises personnel
            </p>
          </div>
        </div>
      </div>
    );
  }

  const userEmail = session.user?.email?.toLowerCase() ?? "";
  if (userEmail !== ALLOWED_EMAIL) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-6">
        <div className="max-w-md w-full space-y-8 text-center p-8 rounded-2xl border bg-card border-border shadow-2xl">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-destructive/15 flex items-center justify-center mx-auto mb-4">
              <span className="text-destructive text-2xl">🚫</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Access Denied</h1>
            <p className="text-muted-foreground text-sm">
              You are signed in as <span className="font-semibold text-foreground">{session.user?.email}</span>.
              This dashboard is restricted to authorized Welday Enterprises accounts only.
            </p>
          </div>

          <div className="space-y-4 pt-4">
            <Button
              onClick={() => signOut()}
              variant="destructive"
              className="w-full h-11 font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Sign Out &amp; Try a Different Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
