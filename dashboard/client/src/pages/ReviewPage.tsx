import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { SchemaChangelog } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { fetchSchemaReviewQueue, reviewSchemaProposal } from "@/lib/supabaseQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, Clock3, CheckCircle2, XCircle } from "lucide-react";

const PENDING_QUERY_KEY = ["/api/schema-reviews", "proposed"];
const HISTORY_QUERY_KEY = ["/api/schema-reviews", "history"];
const COUNT_QUERY_KEY = ["/api/schema-reviews", "count", "proposed"];

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function invalidateReviewQueries() {
  queryClient.invalidateQueries({ queryKey: PENDING_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: COUNT_QUERY_KEY });
}

function ReviewCard({
  item,
  onDecision,
  pending,
}: {
  item: SchemaChangelog;
  onDecision?: (id: string, decision: "approve" | "reject") => void;
  pending?: boolean;
}) {
  const createdAt = formatTimestamp(item.createdAt);
  const appliedAt = formatTimestamp(item.appliedAt);
  const rationaleParts = useMemo(
    () => (item.rationale || "").split(/\n\s*\n/).map((entry) => entry.trim()).filter(Boolean),
    [item.rationale],
  );

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {item.changeType}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {item.tableName}
            </Badge>
            {item.columnName && (
              <Badge variant="outline" className="text-[10px]">
                {item.columnName}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] capitalize">
              {item.status || "proposed"}
            </Badge>
            {createdAt && <span className="text-[11px] text-muted-foreground">Proposed {createdAt}</span>}
            {appliedAt && <span className="text-[11px] text-muted-foreground">Applied {appliedAt}</span>}
          </div>
          <div>
            <h3 className="text-sm font-semibold">{item.description}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Proposed by {item.proposedBy}</p>
          </div>
        </div>

        {onDecision && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => onDecision(item.id, "reject")}
              disabled={pending}
            >
              <XCircle size={12} />
              Reject
            </Button>
            <Button
              size="sm"
              className="gap-1 text-xs"
              onClick={() => onDecision(item.id, "approve")}
              disabled={pending}
            >
              <CheckCircle2 size={12} />
              Approve
            </Button>
          </div>
        )}
      </div>

      {rationaleParts.length > 0 && (
        <div className="mt-4 space-y-2">
          {rationaleParts.map((part, index) => (
            <p key={`${item.id}-${index}`} className="text-sm leading-relaxed">
              {part}
            </p>
          ))}
        </div>
      )}

      {item.sqlStatement && (
        <pre className="mt-4 overflow-x-auto rounded-md bg-secondary/40 p-3 text-xs text-muted-foreground">
          {item.sqlStatement}
        </pre>
      )}
    </div>
  );
}

export function ReviewPage() {
  const { data: pendingItems = [], isLoading: pendingLoading } = useQuery({
    queryKey: PENDING_QUERY_KEY,
    queryFn: () => fetchSchemaReviewQueue("proposed", 100),
    refetchInterval: 30_000,
  });

  const { data: appliedItems = [], isLoading: historyLoading } = useQuery({
    queryKey: HISTORY_QUERY_KEY,
    queryFn: async () => {
      const [applied, rejected] = await Promise.all([
        fetchSchemaReviewQueue("applied", 50),
        fetchSchemaReviewQueue("rejected", 50),
      ]);
      return [...applied, ...rejected].sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      });
    },
    refetchInterval: 60_000,
  });

  const decisionMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      reviewSchemaProposal(id, decision),
    onSuccess: () => invalidateReviewQueries(),
  });

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Review Queue</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Kevin reviews schema proposals here before any database changes are applied.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-2 p-3">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-medium text-primary">Schema changes are held for approval</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Radar can propose a change when an inbox item exposes a real recurring structure gap, but the proposal stays pending until an admin approves it here.
            </p>
          </div>
        </CardContent>
      </Card>

      {decisionMutation.isError && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-3 text-sm text-destructive">
            {(decisionMutation.error as Error).message}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pendingItems.length})</TabsTrigger>
          <TabsTrigger value="history">History ({appliedItems.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock3 size={16} />
                Pending Review
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingLoading ? (
                Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-36" />)
              ) : pendingItems.length === 0 ? (
                <div className="py-10 text-center">
                  <ShieldCheck size={22} className="mx-auto mb-3 text-primary opacity-40" />
                  <p className="text-sm text-muted-foreground">No schema proposals are waiting for review.</p>
                </div>
              ) : (
                pendingItems.map((item) => (
                  <ReviewCard
                    key={item.id}
                    item={item}
                    pending={decisionMutation.isPending}
                    onDecision={(id, decision) => decisionMutation.mutate({ id, decision })}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck size={16} />
                Recent Decisions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {historyLoading ? (
                Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-32" />)
              ) : appliedItems.length === 0 ? (
                <div className="py-10 text-center">
                  <ShieldCheck size={22} className="mx-auto mb-3 text-primary opacity-40" />
                  <p className="text-sm text-muted-foreground">No schema review decisions have been recorded yet.</p>
                </div>
              ) : (
                appliedItems.map((item) => <ReviewCard key={item.id} item={item} />)
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
