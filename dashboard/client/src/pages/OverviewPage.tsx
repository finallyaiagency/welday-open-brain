import { useQuery } from "@tanstack/react-query";
import { fetchPortfolioStats, fetchVentures, fetchCeoRecs, fetchActions } from "@/lib/supabaseQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { TrendingUp, Users, Zap, Activity, ArrowRight, AlertTriangle } from "lucide-react";
import type { Venture } from "@shared/schema";

const STATUS_COLOR: Record<string, string> = {
  active: "#22c55e", queued: "#3b82f6", paused: "#f59e0b", archived: "#6b7280",
};

function KpiCard({ label, value, icon: Icon, sub }: {
  label: string; value: string | number; icon: any; sub?: string;
}) {
  return (
    <Card data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="p-2 rounded-md bg-primary/10">
            <Icon size={16} className="text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VentureBar({ ventures }: { ventures: Venture[] }) {
  const data = [...ventures]
    .sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0))
    .slice(0, 11)
    .map(v => ({ name: v.name.split(" ")[0], score: v.readinessScore || 0, status: v.status }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barSize={18} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(215 10% 55%)" }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(215 10% 55%)" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: "hsl(222 18% 11%)", border: "1px solid hsl(222 15% 18%)", borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: "hsl(210 15% 88%)" }}
          itemStyle={{ color: "hsl(186 85% 52%)" }}
          formatter={(v: any) => [`${v}% ready`, ""]}
        />
        <Bar dataKey="score" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={STATUS_COLOR[entry.status] || "#3b82f6"} opacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OverviewPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/portfolio/stats"],
    queryFn: fetchPortfolioStats,
    refetchInterval: 60_000,
  });
  const { data: ventures = [], isLoading: venturesLoading } = useQuery({
    queryKey: ["/api/ventures"],
    queryFn: fetchVentures,
  });
  const { data: ceoRecs = [] } = useQuery({
    queryKey: ["/api/ceo/recs", "new"],
    queryFn: () => fetchCeoRecs("new"),
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["/api/actions", "active"],
    queryFn: () => fetchActions("active"),
  });

  const urgentActions = actions.filter((a: any) => a.dueDate && new Date(a.dueDate) <= new Date(Date.now() + 86400000 * 3));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Portfolio Overview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
        ) : (
          <>
            <KpiCard label="Active Ventures" value={stats?.active || 0} icon={Activity} sub={`of ${stats?.total || 11} total`} />
            <KpiCard label="Monthly Revenue" value={`$${(stats?.totalRevenue || 0).toFixed(0)}`} icon={TrendingUp} />
            <KpiCard label="Monthly Visitors" value={(stats?.totalVisitors || 0).toLocaleString()} icon={Users} />
            <KpiCard label="Avg Readiness" value={`${stats?.avgReadiness || 0}%`} icon={Zap} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Venture Readiness</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {venturesLoading ? <Skeleton className="h-40" /> : <VentureBar ventures={ventures} />}
            <div className="flex gap-3 mt-2 justify-end">
              {Object.entries(STATUS_COLOR).map(([k, c]) => (
                <div key={k} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: c }} />
                  <span className="text-[10px] text-muted-foreground capitalize">{k}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">CEO Insights</CardTitle>
              <Badge variant="outline" className="text-[10px]">{ceoRecs.length} new</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pb-3">
            {ceoRecs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No new insights</p>
            ) : (
              ceoRecs.slice(0, 4).map((r: any) => (
                <div key={r.id} data-testid={`ceo-rec-${r.id}`} className="flex gap-2 items-start">
                  <AlertTriangle
                    size={12}
                    className={`mt-0.5 flex-shrink-0 priority-${r.priority}`}
                  />
                  <div>
                    <p className="text-xs font-medium leading-tight">{r.title}</p>
                    <p className={`text-[10px] priority-${r.priority}`}>{r.priority} · {r.type}</p>
                  </div>
                </div>
              ))
            )}
            <Link href="/ceo">
              <a className="flex items-center gap-1 text-xs text-primary hover:underline mt-2">
                View all <ArrowRight size={11} />
              </a>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Due Soon</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pb-3">
            {urgentActions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">Nothing urgent - you're clear</p>
            ) : (
              urgentActions.slice(0, 6).map((a: any) => (
                <div key={a.id} data-testid={`action-${a.id}`} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="text-xs flex-1 truncate">{a.title}</span>
                  <span className="text-[10px] text-muted-foreground tabular">
                    {a.dueDate ? new Date(a.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-"}
                  </span>
                </div>
              ))
            )}
            <Link href="/gtd">
              <a className="flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                Open GTD <ArrowRight size={11} />
              </a>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Ventures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pb-3">
            {ventures.filter((v: Venture) => v.status === "active").map((v: Venture) => (
              <div key={v.id} data-testid={`venture-row-${v.slug}`} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-xs flex-1 truncate font-medium">{v.name}</span>
                <div className="w-16 bg-secondary rounded-sm h-1">
                  <div className="readiness-bar" style={{ width: `${v.readinessScore}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground tabular w-6">{v.readinessScore}%</span>
              </div>
            ))}
            <Link href="/ventures">
              <a className="flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                All ventures <ArrowRight size={11} />
              </a>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
