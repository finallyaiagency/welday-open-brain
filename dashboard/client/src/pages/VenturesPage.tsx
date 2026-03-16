import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fetchVentures, updateVenture } from "@/lib/supabaseQueries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, Globe, TrendingUp } from "lucide-react";
import type { Venture } from "@shared/schema";

function RiskBadge({ level }: { level: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium risk-${level}`}>
      {level} risk
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium status-${status}`}>
      {status}
    </span>
  );
}

function VentureCard({ venture }: { venture: Venture }) {
  const mutation = useMutation({
    mutationFn: (patch: Partial<Venture>) => updateVenture(venture.id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ventures"] }),
  });

  return (
    <Card data-testid={`venture-card-${venture.slug}`} className="venture-card border border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate">{venture.name}</h3>
            {venture.domain && (
              <a
                href={`https://${venture.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5 w-fit"
              >
                <Globe size={10} />
                {venture.domain}
              </a>
            )}
          </div>
          <div className="flex flex-col gap-1 items-end flex-shrink-0">
            <StatusBadge status={venture.status} />
            <RiskBadge level={venture.riskLevel || "medium"} />
          </div>
        </div>

        {/* Readiness bar */}
        <div className="mb-3">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Readiness</span>
            <span className="tabular">{venture.readinessScore}%</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-1.5">
            <div
              className="readiness-bar h-1.5 rounded-full"
              style={{ width: `${venture.readinessScore}%` }}
            />
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center">
            <p className="text-sm font-semibold tabular">${parseFloat(venture.monthlyRevenueUsd as any || "0").toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">Rev/mo</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold tabular">{(venture.monthlyVisitors || 0).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Visitors</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold tabular">
              {venture.synergyTags?.length || 0}
            </p>
            <p className="text-[10px] text-muted-foreground">Synergies</p>
          </div>
        </div>

        {/* CEO notes */}
        {venture.ceoNotes && (
          <p className="text-[11px] text-muted-foreground border-t border-border pt-2 line-clamp-2">
            {venture.ceoNotes}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-3">
          {venture.lovableUrl && (
            <Button asChild variant="outline" size="sm" className="text-[11px] h-7 flex-1">
              <a href={venture.lovableUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={10} className="mr-1" />
                Open App
              </a>
            </Button>
          )}
          {venture.status === "queued" && (
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] h-7 flex-1"
              onClick={() => mutation.mutate({ status: "active" })}
              disabled={mutation.isPending}
            >
              Activate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function VenturesPage() {
  const { data: ventures = [], isLoading } = useQuery({
    queryKey: ["/api/ventures"],
    queryFn: fetchVentures,
  });

  const byStatus = {
    active: ventures.filter((v: Venture) => v.status === "active"),
    queued: ventures.filter((v: Venture) => v.status === "queued"),
    paused: ventures.filter((v: Venture) => v.status === "paused"),
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Ventures</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {ventures.length} ventures · {byStatus.active.length} active
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TrendingUp size={13} />
          Total MRR: <span className="font-semibold text-foreground tabular">
            ${ventures.reduce((s: number, v: Venture) => s + parseFloat(v.monthlyRevenueUsd as any || "0"), 0).toFixed(0)}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {byStatus.active.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Active ({byStatus.active.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {byStatus.active.map((v: Venture) => <VentureCard key={v.id} venture={v} />)}
              </div>
            </section>
          )}
          {byStatus.queued.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Queued ({byStatus.queued.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {byStatus.queued.map((v: Venture) => <VentureCard key={v.id} venture={v} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
