import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fetchInbox, addToInbox } from "@/lib/supabaseQueries";
import { supabase } from "@/lib/supabase";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Inbox, MessageSquare, Plus, CheckCheck } from "lucide-react";
import type { GtdInbox } from "@shared/schema";

const SOURCE_ICONS: Record<string, any> = {
  telegram: "✈️", web: "🌐", api: "⚙️", ceo_agent: "🧠", email: "📧",
};

function InboxItem({ item, onProcess }: { item: GtdInbox; onProcess: () => void }) {
  return (
    <div
      data-testid={`inbox-item-${item.id}`}
      className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/20 transition-colors"
    >
      <span className="text-base flex-shrink-0 mt-0.5">{SOURCE_ICONS[item.source] || "📥"}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed">{item.rawText}</p>
        {item.aiSummary && (
          <p className="text-[11px] text-muted-foreground mt-1 flex items-start gap-1">
            <span className="text-primary opacity-70">→</span>
            {item.aiSummary}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">
            {new Date(item.createdAt!).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
            })}
          </span>
          <Badge variant="outline" className="text-[10px]">{item.source}</Badge>
          {item.aiCategory && (
            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
              {item.aiCategory}
            </Badge>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-[11px] flex-shrink-0"
        onClick={onProcess}
        title="Mark as processed"
      >
        <CheckCheck size={12} />
      </Button>
    </div>
  );
}

export function InboxPage() {
  const [newCapture, setNewCapture] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["/api/inbox"],
    queryFn: () => fetchInbox(50),
    refetchInterval: 30_000, // poll every 30s for new Telegram messages
  });

  const addMutation = useMutation({
    mutationFn: addToInbox,
    onSuccess: () => {
      setNewCapture("");
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  const processMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("gtd_inbox")
        .update({ processed: true, processed_at: new Date().toISOString(), filed_to: "manual" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/inbox"] }),
  });

  const processAll = useMutation({
    mutationFn: async () => {
      const ids = items.map((i: GtdInbox) => i.id);
      if (!ids.length) return;
      const { error } = await supabase
        .from("gtd_inbox")
        .update({ processed: true, processed_at: new Date().toISOString(), filed_to: "manual-bulk" })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/inbox"] }),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">GTD Inbox</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} unprocessed · refreshes every 30s
          </p>
        </div>
        {items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => processAll.mutate()}
            disabled={processAll.isPending}
          >
            <CheckCheck size={12} />
            Clear all
          </Button>
        )}
      </div>

      {/* Quick add */}
      <Card>
        <CardContent className="p-3">
          <div className="flex gap-2">
            <Input
              data-testid="input-inbox-capture"
              value={newCapture}
              onChange={e => setNewCapture(e.target.value)}
              onKeyDown={e => e.key === "Enter" && newCapture.trim() && addMutation.mutate(newCapture.trim())}
              placeholder="Add to inbox…"
              className="text-sm"
            />
            <Button
              data-testid="button-inbox-add"
              size="sm"
              onClick={() => newCapture.trim() && addMutation.mutate(newCapture.trim())}
              disabled={!newCapture.trim() || addMutation.isPending}
            >
              <Plus size={14} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Telegram notice */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-3 flex items-start gap-2">
          <MessageSquare size={14} className="text-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-primary">Telegram connected</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Message <strong>@Radar_Welday_Ent_bot</strong> any thought, idea, or task. It lands here instantly.
              The GTD filer agent processes this inbox every hour.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Inbox list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Inbox size={24} className="mx-auto text-primary mb-3 opacity-40" />
          <p className="text-sm text-muted-foreground">Inbox zero — you're clear</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item: GtdInbox) => (
            <InboxItem
              key={item.id}
              item={item}
              onProcess={() => processMutation.mutate(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
