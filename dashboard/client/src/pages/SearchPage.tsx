import { useCallback, useState } from "react";
import { searchAll } from "@/lib/supabaseQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatSourceLabel } from "@/lib/sourceLabels";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Search,
  Briefcase,
  CheckSquare,
  FolderOpen,
  Brain,
  ClipboardList,
  Inbox,
  Calendar,
} from "lucide-react";

type SearchResult = {
  ventures: any[];
  actions: any[];
  projects: any[];
  recommendations: any[];
  conversationLogs: any[];
  inboxItems: any[];
  calendarEvents: any[];
};

const CHART_COLORS = ["hsl(186 85% 52%)", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7", "#ef4444"];

function VentureRadar({ ventures }: { ventures: any[] }) {
  if (!ventures.length) return null;
  const data = ventures.map((v) => ({
    name: v.name?.split(" ")[0] || v.slug,
    readiness: v.readiness_score || 0,
  }));

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">Readiness comparison</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barSize={20}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(215 10% 55%)" }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(215 10% 55%)" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "hsl(222 18% 11%)", border: "1px solid hsl(222 15% 18%)", borderRadius: 6, fontSize: 12 }}
            formatter={(v: any) => [`${v}%`, "Readiness"]}
          />
          <Bar dataKey="readiness" radius={[3, 3, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActionsPie({ actions }: { actions: any[] }) {
  if (!actions.length) return null;
  const byContext = actions.reduce((acc: Record<string, number>, action: any) => {
    const key = action.context || "none";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const data = Object.entries(byContext).map(([name, value]) => ({ name, value }));

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">Actions by context</p>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={60}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
            style={{ fontSize: 9 }}
          >
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ background: "hsl(222 18% 11%)", border: "1px solid hsl(222 15% 18%)", borderRadius: 6, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResultSection({ title, icon: Icon, items, renderItem }: {
  title: string;
  icon: any;
  items: any[];
  renderItem: (item: any) => React.ReactNode;
}) {
  if (!items.length) return null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={13} className="text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title} ({items.length})
        </h3>
      </div>
      <div className="space-y-1">
        {items.map(renderItem)}
      </div>
    </div>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [lifeDomain, setLifeDomain] = useState("all");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const doSearch = useCallback(async (q: string, nextScope = scope) => {
    if (!q.trim()) return;
    setLoading(true);
    setHasSearched(true);
    try {
      const res = await searchAll(q, nextScope);
      setResults(res);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const filteredResults = results ? {
    ...results,
    actions: results.actions.filter((item: any) => lifeDomain === "all" || (item.life_domain || "unknown") === lifeDomain),
    projects: results.projects.filter((item: any) => lifeDomain === "all" || (item.life_domain || "unknown") === lifeDomain),
    conversationLogs: results.conversationLogs.filter((item: any) => lifeDomain === "all" || (item.life_domain || "unknown") === lifeDomain),
    inboxItems: results.inboxItems.filter((item: any) => lifeDomain === "all" || (item.life_domain || "unknown") === lifeDomain),
    calendarEvents: results.calendarEvents.filter((item: any) => lifeDomain === "all" || (item.life_domain || "unknown") === lifeDomain),
  } : null;

  const totalResults = filteredResults
    ? filteredResults.ventures.length
      + filteredResults.actions.length
      + filteredResults.projects.length
      + filteredResults.recommendations.length
      + filteredResults.conversationLogs.length
      + filteredResults.inboxItems.length
      + filteredResults.calendarEvents.length
    : 0;

  const showCharts = scope === "all" && filteredResults && (filteredResults.ventures.length > 1 || filteredResults.actions.length > 1);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Search & Explore</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Search everything or narrow to conversation logs, inbox items, or calendar events
        </p>
      </div>

      <Card className="search-glow">
        <CardContent className="p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="input-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch(query, scope)}
                placeholder="Search everything, conversation logs, inbox items, or calendar events"
                className="border-0 bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                if (query.trim()) {
                  void doSearch(query, value);
                }
              }}
            >
              <SelectTrigger className="w-[210px] text-sm">
                <SelectValue placeholder="Search scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything</SelectItem>
                <SelectItem value="conversation">Conversation Logs</SelectItem>
                <SelectItem value="inbox">Inbox Items</SelectItem>
                <SelectItem value="calendar">Calendar Events</SelectItem>
              </SelectContent>
            </Select>
            <button
              data-testid="button-search"
              onClick={() => doSearch(query, scope)}
              disabled={loading || !query.trim()}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "..." : "Search"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {[
              "AI ventures synergy",
              "active projects",
              "overdue actions",
              "review this code",
              "tomorrow",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {
                  setQuery(suggestion);
                  void doSearch(suggestion, scope);
                }}
                className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      )}

      {!loading && hasSearched && filteredResults && (
        <>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {totalResults > 0 ? `${totalResults} results for ` : "No results for "}
              <span className="font-medium text-foreground">"{query}"</span>
              <span className="ml-2 text-xs uppercase tracking-wide">{scope}</span>
            </p>
            <Select value={lifeDomain} onValueChange={setLifeDomain}>
              <SelectTrigger className="w-[160px] text-sm">
                <SelectValue placeholder="All domains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showCharts && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredResults.ventures.length > 1 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Venture Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <VentureRadar ventures={filteredResults.ventures} />
                  </CardContent>
                </Card>
              )}
              {filteredResults.actions.length > 1 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Action Distribution</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <ActionsPie actions={filteredResults.actions} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          <div className="space-y-5">
            <ResultSection
              title="Conversation Logs"
              icon={ClipboardList}
              items={filteredResults.conversationLogs}
              renderItem={(entry) => (
                <div key={entry.id} data-testid={`search-conversation-${entry.id}`} className="rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{entry.agent_name || entry.source}</Badge>
                    {entry.importance && <Badge variant="outline" className="text-[10px] capitalize">{entry.importance}</Badge>}
                    <Badge variant="outline" className="text-[10px] capitalize">{entry.life_domain || "unknown"}</Badge>
                    {entry.created_at && <span className="text-[10px] text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</span>}
                  </div>
                  <p className="mt-1 text-sm">{entry.summary}</p>
                </div>
              )}
            />

            <ResultSection
              title="Inbox Items"
              icon={Inbox}
              items={filteredResults.inboxItems}
              renderItem={(item) => (
                <div key={item.id} data-testid={`search-inbox-${item.id}`} className="rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{formatSourceLabel(item.source)}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{item.life_domain || "unknown"}</Badge>
                    {item.filed_to && <Badge variant="outline" className="text-[10px]">{item.filed_to}</Badge>}
                    {item.created_at && <span className="text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString()}</span>}
                  </div>
                  <p className="mt-1 text-sm">{item.raw_text}</p>
                </div>
              )}
            />

            <ResultSection
              title="Calendar Events"
              icon={Calendar}
              items={filteredResults.calendarEvents}
              renderItem={(event) => (
                <div key={event.id} data-testid={`search-calendar-${event.id}`} className="rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {event.source && <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{formatSourceLabel(event.source)}</Badge>}
                    {event.event_type && <Badge variant="outline" className="text-[10px] capitalize">{event.event_type}</Badge>}
                    <Badge variant="outline" className="text-[10px] capitalize">{event.life_domain || "unknown"}</Badge>
                    {event.status && <Badge variant="outline" className="text-[10px] capitalize">{event.status}</Badge>}
                    {event.start_at && <span className="text-[10px] text-muted-foreground">{new Date(event.start_at).toLocaleString()}</span>}
                  </div>
                  <p className="mt-1 text-sm font-medium">{event.title}</p>
                  {event.description && <p className="mt-1 text-xs text-muted-foreground">{event.description}</p>}
                </div>
              )}
            />

            <ResultSection
              title="Ventures"
              icon={Briefcase}
              items={filteredResults.ventures}
              renderItem={(venture) => (
                <div key={venture.id} data-testid={`search-venture-${venture.id}`} className="flex items-center gap-2 rounded-md border border-border p-2.5 transition-colors hover:border-primary/30">
                  <div className={`h-2 w-2 flex-shrink-0 rounded-full ${venture.status === "active" ? "bg-green-400" : "bg-blue-400"}`} />
                  <span className="flex-1 text-sm font-medium">{venture.name}</span>
                  <span className="tabular text-[10px] text-muted-foreground">{venture.readiness_score}%</span>
                  <Badge variant="outline" className={`text-[10px] status-${venture.status}`}>{venture.status}</Badge>
                </div>
              )}
            />

            <ResultSection
              title="Actions"
              icon={CheckSquare}
              items={filteredResults.actions}
              renderItem={(action) => (
                <div key={action.id} data-testid={`search-action-${action.id}`} className="flex items-center gap-2 rounded-md border border-border p-2.5">
                  <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                  <span className="flex-1 text-sm">{action.title}</span>
                  {action.source && <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{formatSourceLabel(action.source)}</Badge>}
                  <span className="text-[10px] text-muted-foreground capitalize">{action.life_domain || "unknown"}</span>
                  {action.context && <span className="text-[10px] text-muted-foreground">{action.context}</span>}
                  {action.due_date && <span className="tabular text-[10px] text-muted-foreground">{action.due_date}</span>}
                </div>
              )}
            />

            <ResultSection
              title="Projects"
              icon={FolderOpen}
              items={filteredResults.projects}
              renderItem={(project) => (
                <div key={project.id} data-testid={`search-project-${project.id}`} className="flex items-center gap-2 rounded-md border border-border p-2.5">
                  <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                  <span className="flex-1 text-sm">{project.title}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">{project.life_domain || "unknown"}</span>
                  {project.area && <span className="text-[10px] text-muted-foreground">{project.area}</span>}
                </div>
              )}
            />

            <ResultSection
              title="CEO Insights"
              icon={Brain}
              items={filteredResults.recommendations}
              renderItem={(recommendation) => (
                <div key={recommendation.id} data-testid={`search-rec-${recommendation.id}`} className="flex items-center gap-2 rounded-md border border-border p-2.5">
                  <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-purple-400" />
                  <span className="flex-1 text-sm">{recommendation.title}</span>
                  <Badge variant="outline" className={`text-[10px] priority-${recommendation.priority}`}>{recommendation.priority}</Badge>
                </div>
              )}
            />
          </div>
        </>
      )}

      {!loading && !hasSearched && (
        <div className="py-16 text-center text-muted-foreground">
          <Search size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Type anything to search across your workspace or narrow to logs, inbox items, or calendar events</p>
          <p className="mt-1 text-xs opacity-60">Charts appear automatically when you search everything</p>
        </div>
      )}
    </div>
  );
}
