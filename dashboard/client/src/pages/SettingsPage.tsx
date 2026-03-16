import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, CheckCircle2, ExternalLink, Link2, ListTodo, RefreshCw } from "lucide-react";
import { fetchRecentLogs } from "@/lib/supabaseQueries";
import { getSession, signInWithGoogle } from "@/lib/supabase";
import { hasGoogleWorkspaceConnection, syncGoogleWorkspace, type GoogleSyncSummary } from "@/lib/googleSync";

function SetupItem({ done, label, detail, link }: {
  done: boolean; label: string; detail: string; link?: { text: string; url: string };
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <div className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${done ? "bg-green-500/20" : "bg-secondary"}`}>
        {done ? <CheckCircle2 size={12} className="text-green-400" /> : <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {link.text} <ExternalLink size={10} />
          </a>
        )}
      </div>
      <Badge variant="outline" className={`text-[10px] ${done ? "border-green-500/30 text-green-400" : "text-muted-foreground"}`}>
        {done ? "done" : "pending"}
      </Badge>
    </div>
  );
}

function formatSyncTimestamp(value: string | Date | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SettingsPage() {
  const [connected, setConnected] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [lastManualSummary, setLastManualSummary] = useState<GoogleSyncSummary | null>(null);

  useEffect(() => {
    getSession().then((session) => {
      setAccountEmail(session?.user?.email || null);
    }).catch(() => {});

    hasGoogleWorkspaceConnection().then(setConnected).catch(() => setConnected(false));
  }, []);

  const { data: logs = [] } = useQuery({
    queryKey: ["/api/logs", "google-sync"],
    queryFn: () => fetchRecentLogs(50),
    refetchInterval: 60_000,
  });

  const latestGoogleSync = useMemo(
    () => logs.find((entry) => entry.agentName === "google_sync") || null,
    [logs],
  );

  const connectMutation = useMutation({
    mutationFn: async () => signInWithGoogle({ includeGoogleWorkspace: true }),
  });

  const syncMutation = useMutation({
    mutationFn: syncGoogleWorkspace,
    onSuccess: (summary) => {
      setConnected(true);
      setLastManualSummary(summary);
    },
  });

  return (
    <div className="max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings & Setup</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Google Calendar and Google Tasks now serve as the mobile notification and data-entry layer for Open Brain.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 size={16} />
                Google Calendar + Tasks
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Entries that arrive through Google from your iPhone are labeled <strong>Google</strong> inside the app instead of looking manual or bot-created.
              </p>
            </div>
            <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${connected ? "border-green-500/30 text-green-400" : ""}`}>
              {connected ? "connected" : "needs reconnect"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-background/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CalendarDays size={15} className="text-primary" />
                Calendar sync
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Imports Google Calendar events into `calendar_events` and pushes local event edits back to Google.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ListTodo size={15} className="text-primary" />
                Task sync
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Imports Google Tasks into `gtd_actions` and syncs completion and edits in both directions.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
              {connected ? "Reconnect Google" : "Connect Google Calendar + Tasks"}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => syncMutation.mutate()}
              disabled={!connected || syncMutation.isPending}
            >
              <RefreshCw size={14} className={syncMutation.isPending ? "animate-spin" : ""} />
              Sync now
            </Button>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">Signed in as:</span>{" "}
              {accountEmail || "Unknown account"}
            </div>
            <div>
              <span className="font-medium text-foreground">Last sync:</span>{" "}
              {formatSyncTimestamp(lastManualSummary?.syncedAt || latestGoogleSync?.createdAt)}
            </div>
          </div>

          {(syncMutation.error || latestGoogleSync?.success === false) && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
              {(syncMutation.error as Error | null)?.message || latestGoogleSync?.errorMessage || "Google sync failed. Reconnect Google and try again."}
            </div>
          )}

          {(lastManualSummary || latestGoogleSync?.success) && (
            <div className="rounded-lg border border-border bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest sync summary</p>
              {lastManualSummary ? (
                <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
                  <span>{lastManualSummary.eventsImported} events imported</span>
                  <span>{lastManualSummary.eventsExported} events exported</span>
                  <span>{lastManualSummary.eventUpdatesPushed} event updates pushed</span>
                  <span>{lastManualSummary.tasksImported} tasks imported</span>
                  <span>{lastManualSummary.tasksExported} tasks exported</span>
                  <span>{lastManualSummary.taskUpdatesPushed} task updates pushed</span>
                </div>
              ) : (
                <p className="mt-2 text-sm">{latestGoogleSync?.outputSummary}</p>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Automatic sync runs when the app opens, when the window regains focus, and every 5 minutes while you stay signed in.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Setup Checklist</CardTitle>
        </CardHeader>
        <CardContent className="pb-2">
          <SetupItem
            done={true}
            label="Supabase project created"
            detail="lqtamdgtbokewphcgwzy · East US"
            link={{ text: "Open Supabase dashboard", url: "https://supabase.com/dashboard/project/lqtamdgtbokewphcgwzy" }}
          />
          <SetupItem
            done={false}
            label="Run the Google sync migration in Supabase"
            detail="Apply the migration so `gtd_actions` and `calendar_events` can store Google source and sync timestamps."
            link={{ text: "Open SQL editor", url: "https://supabase.com/dashboard/project/lqtamdgtbokewphcgwzy/sql/new" }}
          />
          <SetupItem
            done={false}
            label="Enable Google OAuth scopes in Supabase"
            detail="The Google provider needs Calendar and Tasks scopes so Supabase returns a provider token with both permissions."
            link={{ text: "Supabase auth settings", url: "https://supabase.com/dashboard/project/lqtamdgtbokewphcgwzy/auth/providers" }}
          />
          <SetupItem
            done={connected}
            label="Google Calendar + Tasks connected"
            detail={connected ? "Google provider token detected. The app can sync mobile changes now." : "Reconnect Google from the card above to grant Calendar and Tasks access."}
          />
          <SetupItem
            done={true}
            label="Telegram bot (@Moneypenny_Welday_Ent_bot) configured"
            detail="Bot capture remains active for inbox-driven entry."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Your Stack</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-3">
          {[
            { label: "Supabase", value: "lqtamdgtbokewphcgwzy · East US · Free tier" },
            { label: "Vercel", value: "Free tier · Static deploy + Serverless functions" },
            { label: "Telegram Bot", value: "@Moneypenny_Welday_Ent_bot · GTD inbox capture" },
            { label: "Google", value: "Calendar + Tasks sync for iPhone notifications and entry" },
            { label: "Codex", value: "Desktop-driven implementation and maintenance" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-start gap-2 py-1">
              <span className="w-28 flex-shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
              <span className="text-xs">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
