import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { GtdInbox } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import {
  addToInbox,
  fetchInbox,
  fetchInboxHistory,
  processInboxItem,
  processInboxItems,
  undoInboxProcessing,
  updateInboxText,
} from "@/lib/supabaseQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCheck,
  History,
  Inbox,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";

const INBOX_QUERY_KEY = ["/api/inbox", "active"];
const HISTORY_QUERY_KEY = ["/api/inbox", "processed"];

const SOURCE_LABELS: Record<string, string> = {
  telegram: "Telegram",
  telegram_moneypenny: "Moneypenny",
  telegram_smithers: "Smithers",
  telegram_burns: "Burns",
  web: "Web",
  api: "API",
  ceo_agent: "CEO Agent",
  email: "Email",
};

const SOURCE_GLYPHS: Record<string, string> = {
  telegram: "TG",
  telegram_moneypenny: "MP",
  telegram_smithers: "SM",
  telegram_burns: "BR",
  web: "WB",
  api: "AP",
  ceo_agent: "EA",
  email: "EM",
};

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function invalidateInboxQueries() {
  queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
}

function SourceBadge({ source }: { source: string | null }) {
  const label = source ? (SOURCE_LABELS[source] || source) : "Unknown";
  const glyph = source ? (SOURCE_GLYPHS[source] || source.slice(0, 2).toUpperCase()) : "??";

  return (
    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
      {glyph} {label}
    </Badge>
  );
}

type InboxRowProps = {
  item: GtdInbox;
  mode: "active" | "processed";
  isEditing: boolean;
  draftText: string;
  onStartEdit: (item: GtdInbox) => void;
  onCancelEdit: () => void;
  onDraftChange: (value: string) => void;
  onSaveEdit: (item: GtdInbox) => void;
  onProcess?: (id: string) => void;
  onUndo?: (id: string) => void;
};

function InboxRow({
  item,
  mode,
  isEditing,
  draftText,
  onStartEdit,
  onCancelEdit,
  onDraftChange,
  onSaveEdit,
  onProcess,
  onUndo,
}: InboxRowProps) {
  const createdAt = formatTimestamp(item.createdAt);
  const processedAt = formatTimestamp(item.processedAt);

  return (
    <div
      data-testid={`inbox-item-${item.id}`}
      className="rounded-lg border border-border p-4 transition-colors hover:border-primary/25"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {isEditing ? (
            <Textarea
              value={draftText}
              onChange={(event) => onDraftChange(event.target.value)}
              rows={3}
              className="text-sm"
            />
          ) : (
            <p className="text-sm leading-relaxed">{item.rawText}</p>
          )}

          {item.aiSummary && !isEditing && (
            <p className="text-xs text-muted-foreground">{item.aiSummary}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={item.source} />
            {item.aiCategory && (
              <Badge variant="outline" className="text-[10px]">
                {item.aiCategory}
              </Badge>
            )}
            {item.filedTo && mode === "processed" && (
              <Badge variant="outline" className="text-[10px]">
                {item.filedTo}
              </Badge>
            )}
            {createdAt && (
              <span className="text-[11px] text-muted-foreground">Captured {createdAt}</span>
            )}
            {processedAt && mode === "processed" && (
              <span className="text-[11px] text-muted-foreground">Processed {processedAt}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {isEditing ? (
            <>
              <Button
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => onSaveEdit(item)}
                disabled={!draftText.trim()}
              >
                <Save size={12} />
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-xs"
                onClick={onCancelEdit}
              >
                <X size={12} />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-xs"
                onClick={() => onStartEdit(item)}
              >
                <Pencil size={12} />
                {mode === "processed" ? "Clarify" : "Edit"}
              </Button>
              {mode === "active" && onProcess && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 text-xs"
                  onClick={() => onProcess(item.id)}
                >
                  <CheckCheck size={12} />
                  Processed
                </Button>
              )}
              {mode === "processed" && onUndo && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 text-xs"
                  onClick={() => onUndo(item.id)}
                >
                  <RotateCcw size={12} />
                  Undo
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function InboxPage() {
  const [newCapture, setNewCapture] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");

  const { data: activeItems = [], isLoading: activeLoading } = useQuery({
    queryKey: INBOX_QUERY_KEY,
    queryFn: () => fetchInbox(50),
    refetchInterval: 30_000,
  });

  const { data: processedItems = [], isLoading: processedLoading } = useQuery({
    queryKey: HISTORY_QUERY_KEY,
    queryFn: () => fetchInboxHistory(100),
    refetchInterval: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: addToInbox,
    onSuccess: () => {
      setNewCapture("");
      invalidateInboxQueries();
    },
  });

  const processMutation = useMutation({
    mutationFn: (id: string) => processInboxItem(id),
    onSuccess: () => invalidateInboxQueries(),
  });

  const processAllMutation = useMutation({
    mutationFn: (ids: string[]) => processInboxItems(ids),
    onSuccess: () => invalidateInboxQueries(),
  });

  const undoMutation = useMutation({
    mutationFn: (id: string) => undoInboxProcessing(id),
    onSuccess: () => invalidateInboxQueries(),
  });

  const saveEditMutation = useMutation({
    mutationFn: ({ id, rawText, reopen }: { id: string; rawText: string; reopen: boolean }) =>
      updateInboxText(id, rawText, reopen),
    onSuccess: () => {
      setEditingId(null);
      setDraftText("");
      invalidateInboxQueries();
    },
  });

  const activeIds = useMemo(() => activeItems.map((item) => item.id), [activeItems]);

  function startEdit(item: GtdInbox) {
    setEditingId(item.id);
    setDraftText(item.rawText);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftText("");
  }

  function saveEdit(item: GtdInbox) {
    const nextText = draftText.trim();
    if (!nextText) return;
    saveEditMutation.mutate({
      id: item.id,
      rawText: nextText,
      reopen: item.processed === true,
    });
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">GTD Inbox</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {activeItems.length} active and {processedItems.length} in recent history
          </p>
        </div>
        {activeItems.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => processAllMutation.mutate(activeIds)}
            disabled={processAllMutation.isPending}
          >
            <CheckCheck size={12} />
            Process all now
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex gap-2">
            <Input
              data-testid="input-inbox-capture"
              value={newCapture}
              onChange={(event) => setNewCapture(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newCapture.trim()) {
                  addMutation.mutate(newCapture.trim());
                }
              }}
              placeholder="Add to inbox..."
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

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-2 p-3">
          <MessageSquare size={14} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="text-xs font-medium text-primary">Telegram connected</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Message <strong>@Radar_Welday_Ent_bot</strong> any task, thought, or appointment. If an item
              was filed incorrectly, open the processed tab, clarify it, and it will return to the live inbox.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Inbox ({activeItems.length})</TabsTrigger>
          <TabsTrigger value="processed">Processed ({processedItems.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox size={16} />
                Active Inbox
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeLoading ? (
                Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20" />)
              ) : activeItems.length === 0 ? (
                <div className="py-10 text-center">
                  <Inbox size={22} className="mx-auto mb-3 text-primary opacity-40" />
                  <p className="text-sm text-muted-foreground">Inbox zero. Nothing waiting.</p>
                </div>
              ) : (
                activeItems.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    mode="active"
                    isEditing={editingId === item.id}
                    draftText={editingId === item.id ? draftText : item.rawText}
                    onStartEdit={startEdit}
                    onCancelEdit={cancelEdit}
                    onDraftChange={setDraftText}
                    onSaveEdit={saveEdit}
                    onProcess={(id) => processMutation.mutate(id)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="processed" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History size={16} />
                Processed History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {processedLoading ? (
                Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20" />)
              ) : processedItems.length === 0 ? (
                <div className="py-10 text-center">
                  <History size={22} className="mx-auto mb-3 text-primary opacity-40" />
                  <p className="text-sm text-muted-foreground">No processed history yet.</p>
                </div>
              ) : (
                processedItems.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    mode="processed"
                    isEditing={editingId === item.id}
                    draftText={editingId === item.id ? draftText : item.rawText}
                    onStartEdit={startEdit}
                    onCancelEdit={cancelEdit}
                    onDraftChange={setDraftText}
                    onSaveEdit={saveEdit}
                    onUndo={(id) => undoMutation.mutate(id)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
