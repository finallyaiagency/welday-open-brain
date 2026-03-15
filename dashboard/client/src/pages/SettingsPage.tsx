import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ExternalLink } from "lucide-react";

function SetupItem({ done, label, detail, link }: {
  done: boolean; label: string; detail: string; link?: { text: string; url: string };
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className={`w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center ${done ? "bg-green-500/20" : "bg-secondary"}`}>
        {done ? <CheckCircle2 size={12} className="text-green-400" /> : <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
        {link && (
          <a href={link.url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary flex items-center gap-1 mt-1 hover:underline">
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

export function SettingsPage() {
  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Settings & Setup</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configuration checklist for your Open Brain system
        </p>
      </div>

      {/* Setup checklist */}
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
            label="Run schema SQL in Supabase"
            detail="Paste schema.sql into the Supabase SQL editor to create all tables"
            link={{ text: "Open SQL editor", url: "https://supabase.com/dashboard/project/lqtamdgtbokewphcgwzy/sql/new" }}
          />
          <SetupItem
            done={false}
            label="Add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY to Vercel"
            detail="Settings → Environment Variables in your Vercel project"
            link={{ text: "Vercel dashboard", url: "https://vercel.com/dashboard" }}
          />
          <SetupItem
            done={false}
            label="Enable Google OAuth in Supabase"
            detail="Authentication → Providers → Google. Set redirect URL to your Vercel domain."
            link={{ text: "Supabase auth settings", url: "https://supabase.com/dashboard/project/lqtamdgtbokewphcgwzy/auth/providers" }}
          />
          <SetupItem
            done={true}
            label="Telegram bot (@Moneypenny_Welday_Ent_bot) configured"
            detail="Bot is active — messages routed to gtd_inbox table via webhook"
          />
          <SetupItem
            done={false}
            label="Set up Telegram webhook"
            detail="Deploy telegram-bot/webhook.js to a Vercel serverless function and register it with BotFather"
          />
          <SetupItem
            done={false}
            label="Virtual CEO agent — schedule hourly run"
            detail="ceo-agent/run.js calls Gemini 1.5 Flash, analyzes ventures, writes to ceo_recommendations"
          />
          <SetupItem
            done={false}
            label="Google Calendar sync"
            detail="google-sync/calendar.js uses OAuth2 to read/write calendar events ↔ calendar_events table"
          />
        </CardContent>
      </Card>

      {/* Stack overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Your Stack</CardTitle>
        </CardHeader>
        <CardContent className="pb-3 space-y-2">
          {[
            { label: "Supabase", value: "lqtamdgtbokewphcgwzy · East US · Free tier" },
            { label: "Vercel", value: "Free tier · Static deploy + Serverless functions" },
            { label: "Telegram Bot", value: "@Moneypenny_Welday_Ent_bot (Moneypenny) · GTD inbox capture" },
            { label: "ChatGPT Plus", value: "Via Coadex Desktop · GTD filer + CEO agent" },
            { label: "Google One", value: "Via Antigravity · Calendar + Tasks sync" },
            { label: "Lovable", value: "11 venture sub-apps (one per venture, free plan)" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-start gap-2 py-1">
              <span className="text-xs font-medium w-28 flex-shrink-0 text-muted-foreground">{label}</span>
              <span className="text-xs">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* MCP config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Supabase MCP Config (for Coadex / Claude)</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <p className="text-xs text-muted-foreground mb-2">
            Paste this into your MCP client config to give Claude/ChatGPT direct access to your database:
          </p>
          <pre className="text-[11px] bg-secondary rounded-md p-3 overflow-x-auto leading-relaxed text-foreground">
{`{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=lqtamdgtbokewphcgwzy",
      "headers": {
        "Authorization": "Bearer YOUR_SUPABASE_PAT"
      }
    }
  }
}`}
          </pre>
          <p className="text-[10px] text-muted-foreground mt-2">
            Get your PAT at{" "}
            <a href="https://supabase.com/dashboard/account/tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              supabase.com/dashboard/account/tokens
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
