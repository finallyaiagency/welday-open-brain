import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { completeAction, createProject, fetchActions, fetchProjects, fetchCalendarEvents, fetchAllHashtags, fetchInbox, fetchInboxHistory, updateInboxText, fetchWaitingActions, fetchReferences, fetchSomeday, deleteCalendarEvent } from "@/lib/supabaseQueries";
import { supabase } from "@/lib/supabase";
import { contextToHashtag, extractHashtags, formatHashtag, mergeHashtags } from "@shared/hashtags";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Check, Plus, Calendar, Clock, FolderPlus, Hash, LayoutDashboard, List, Kanban, ArrowRight, Edit2, RotateCcw, ChevronRight, Inbox, History, Search, ExternalLink, Folder, Tag, Bookmark, Sparkles, Phone, Monitor, ShoppingBag, Mail, Home, Briefcase, Globe } from "lucide-react";
import type { GtdAction, GtdProject, GtdInbox, GtdReference, GtdSomeday } from "@shared/schema";
import { formatSourceLabel } from "@/lib/sourceLabels";
import { motion, AnimatePresence } from "framer-motion";
import { format, isToday, isTomorrow, isSameDay, parseISO, startOfDay, addDays, formatDistanceToNow } from "date-fns";
import { CalendarView } from "@/components/CalendarView";
import { CalendarEventRow } from "@/components/CalendarEventRow";

const LIFE_DOMAIN_OPTIONS = [
  { value: "all", label: "All" },
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "unknown", label: "Unknown" },
];

const CONTEXT_OPTIONS = [
  { value: "all", label: "All", icon: LayoutDashboard },
  { value: "phone", label: "Phone", icon: Phone },
  { value: "computer", label: "Comp", icon: Monitor },
  { value: "errands", label: "Errands", icon: ShoppingBag },
  { value: "waiting", label: "Wait", icon: Clock },
  { value: "email", label: "Email", icon: Mail },
  { value: "home", label: "Home", icon: Home },
  { value: "work", label: "Work", icon: Briefcase },
  { value: "anywhere", label: "Any", icon: Globe },
];

const FILED_TO_LABELS: Record<string, { label: string; color: string }> = {
  action:    { label: "Action",    color: "bg-green-500/15 text-green-600 border-green-500/20" },
  project:   { label: "Project",   color: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  someday:   { label: "Someday",   color: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  reference: { label: "Reference", color: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  trash:     { label: "Trash",     color: "bg-red-500/15 text-red-500 border-red-500/20" },
  manual:    { label: "Manual",    color: "bg-secondary text-muted-foreground border-transparent" },
};

function formatLifeDomain(value: string | null | undefined) {
  const next = value || "unknown";
  return next.charAt(0).toUpperCase() + next.slice(1);
}

function HashtagChip({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: () => void }) {
  return (
    <Badge 
      variant={active ? "default" : "outline"} 
      className={`h-5 cursor-pointer transition-all ${active ? "bg-primary text-primary-foreground" : "border-primary/20 bg-primary/5 text-[10px] text-primary hover:bg-primary/20"}`}
      onClick={onClick}
    >
      {formatHashtag(tag)}
    </Badge>
  );
}

function ActionRow({ action, onComplete, showProject = true }: { action: GtdAction; onComplete: () => void; showProject?: boolean }) {
  const isOverdue = action.dueDate && new Date(action.dueDate) < new Date();
  const source = (action as any).source as string | null | undefined;
  const projectTitle = (action as any).gtd_projects?.title as string | undefined;
  const hashtags = Array.from(new Set([...(action.tags || [])].filter(Boolean) as string[]));
  const contextTag = contextToHashtag(action.context);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      data-testid={`action-row-${action.id}`}
      className="flex items-start gap-3 py-2.5 border-b border-border last:border-0 group"
    >
      <button
        onClick={onComplete}
        className="mt-0.5 w-4 h-4 rounded border border-border flex-shrink-0 flex items-center justify-center hover:border-primary hover:bg-primary/10 transition-colors"
        title="Mark complete"
      >
        <Check size={10} className="opacity-0 group-hover:opacity-100 text-primary" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight">{action.title}</p>
        <div className="flex gap-2 mt-1 flex-wrap">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium uppercase tracking-tighter">
            {formatLifeDomain((action as any).lifeDomain)}
          </span>
          {showProject && projectTitle && <Badge variant="secondary" className="h-4 text-[9px] px-1">{projectTitle}</Badge>}
          {action.delegatedTo && (
            <Badge variant="outline" className="h-4 text-[9px] px-1 border-purple-500/30 text-purple-600 bg-purple-500/5">
              @{action.delegatedTo}
            </Badge>
          )}
          {contextTag && (
            <Badge variant="outline" className="h-4 text-[9px] px-1.5 border-primary/20 bg-primary/5 text-primary">
              @{contextTag}
            </Badge>
          )}
          {action.status !== "active" && action.status !== "completed" && (
            <Badge variant="outline" className="h-4 text-[9px] px-1.5 border-purple-500/30 bg-purple-500/10 text-purple-600">
              {action.status.toUpperCase()}
            </Badge>
          )}
          {hashtags.slice(0, 3).map((tag) => <HashtagChip key={`${action.id}-${tag}`} tag={tag} />)}
          {action.timeEstimateMin && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock size={9} />{action.timeEstimateMin}m
            </span>
          )}
          {source && (
            <Badge variant="outline" className="h-4 text-[9px] px-1 border-dashed">
              {formatSourceLabel(source)}
            </Badge>
          )}
        </div>
      </div>
      {action.dueDate && (
        <span className={`text-[10px] tabular flex-shrink-0 flex items-center gap-0.5 mt-0.5 ${isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
          <Calendar size={9} />
          {format(parseISO(action.dueDate), "MMM d")}
        </span>
      )}
    </motion.div>
  );
}

// Remove CalendarEventRow local definition (moved to components)

// ── Edit / Clarify Dialog ─────────────────────────────────────────────────────

function EditInboxDialog({ item, open, onClose }: { item: GtdInbox | null; open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [lifeDomain, setLifeDomain] = useState("unknown");
  const [reopen, setReopen] = useState(false);

  // Reset when dialog opens with a new item
  const prevItemId = useMemo(() => item?.id, [item]);
  useMemo(() => {
    if (item) {
      setText(item.rawText || "");
      setExtraTags([]);
      setTagInput("");
      setLifeDomain(item.lifeDomain || "unknown");
      setReopen(false);
    }
  }, [item?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const mergedTags = mergeHashtags(item.tags, [...extraTags, ...extractHashtags(text)]);
      await updateInboxText(item.id, text, reopen, reopen ? null : item.filedTo, item.projectId, mergedTags);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/history"] });
      onClose();
    },
  });

  function addTag() {
    const trimmed = tagInput.trim().replace(/^#/, "");
    if (trimmed && !extraTags.includes(trimmed)) {
      setExtraTags(prev => [...prev, trimmed]);
    }
    setTagInput("");
  }

  function removeExtraTag(tag: string) {
    setExtraTags(prev => prev.filter(t => t !== tag));
  }

  const allTags = mergeHashtags(item?.tags, [...extraTags, ...extractHashtags(text)]) || [];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Edit / Clarify Inbox Item</DialogTitle>
        </DialogHeader>

        {item && (
          <div className="space-y-4 py-1">
            {/* Status badge */}
            {item.processed && item.filedTo && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Filed as</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${(FILED_TO_LABELS[item.filedTo] || FILED_TO_LABELS.manual).color}`}>
                  {(FILED_TO_LABELS[item.filedTo] || FILED_TO_LABELS.manual).label}
                </span>
                {item.aiCategory && (
                  <span className="text-[10px] text-muted-foreground">category: <strong>{item.aiCategory}</strong></span>
                )}
                {item.aiConfidence != null && (
                  <span className="text-[10px] text-muted-foreground">confidence: <strong>{Math.round(Number(item.aiConfidence) * 100)}%</strong></span>
                )}
              </div>
            )}

            {/* Raw text */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Raw Text</Label>
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={3}
                className="text-sm resize-none"
                placeholder="Captured text..."
              />
            </div>

            {/* Life domain */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Life Domain</Label>
              <Select value={lifeDomain} onValueChange={setLifeDomain}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="business" className="text-xs">Business</SelectItem>
                  <SelectItem value="personal" className="text-xs">Personal</SelectItem>
                  <SelectItem value="unknown" className="text-xs">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tags</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {allTags.map(tag => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="h-5 text-[10px] cursor-pointer hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    onClick={() => removeExtraTag(tag)}
                    title="Click to remove"
                  >
                    #{tag}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  placeholder="#add-tag"
                  className="h-8 text-xs"
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())}
                />
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={addTag}>Add</Button>
              </div>
            </div>

            {/* Re-process toggle */}
            {item.processed && (
              <div
                onClick={() => setReopen(v => !v)}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${reopen ? "border-amber-500/30 bg-amber-500/10" : "border-border hover:border-amber-500/20 hover:bg-amber-500/5"}`}
              >
                <RotateCcw size={14} className={reopen ? "text-amber-500" : "text-muted-foreground"} />
                <div>
                  <p className="text-xs font-semibold">Re-open for reprocessing</p>
                  <p className="text-[10px] text-muted-foreground">Returns this item to the inbox for the AI to re-file</p>
                </div>
                <div className={`ml-auto w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${reopen ? "border-amber-500 bg-amber-500" : "border-border"}`}>
                  {reopen && <Check size={10} className="text-white" />}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {reopen ? "Save & Re-open" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Inbox History Row ─────────────────────────────────────────────────────────

function InboxHistoryRow({ item, onEdit }: { item: GtdInbox; onEdit: (item: GtdInbox) => void }) {
  const filed = item.filedTo ? (FILED_TO_LABELS[item.filedTo] || FILED_TO_LABELS.manual) : null;
  const confidence = item.aiConfidence != null ? Math.round(Number(item.aiConfidence) * 100) : null;

  return (
    <div className="group flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] leading-snug text-foreground/80 line-clamp-2">{item.rawText}</p>
        {item.aiSummary && (
          <p className="text-[10px] text-muted-foreground mt-0.5 italic line-clamp-1">{item.aiSummary}</p>
        )}
        <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
          {filed && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${filed.color}`}>
              {filed.label}
            </span>
          )}
          {item.aiCategory && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium uppercase tracking-tighter">
              {item.aiCategory}
            </span>
          )}
          {confidence != null && (
            <span className="text-[9px] text-muted-foreground" title="AI confidence">{confidence}% conf.</span>
          )}
          {(item.tags || []).slice(0, 2).map(tag => (
            <span key={tag} className="text-[9px] text-primary/60">#{tag}</span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {item.processedAt && (
          <span className="text-[9px] text-muted-foreground/60 hidden group-hover:block">
            {formatDistanceToNow(parseISO(item.processedAt as unknown as string), { addSuffix: true })}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onEdit(item)}
          title="Edit / Clarify"
        >
          <Edit2 size={11} />
        </Button>
      </div>
    </div>
  );
}

// ── Inbox Panel ───────────────────────────────────────────────────────────────

function QuickCapture() {
  const [text, setText] = useState("");
  const mutation = useMutation({
    mutationFn: async (title: string) => {
      const { error } = await supabase.from("gtd_inbox").insert({
        raw_text: title,
        source: "web",
        tags: extractHashtags(title),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  return (
    <div className="flex gap-2">
      <Input
        data-testid="input-quick-capture"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Capture a thought… hit Enter to inbox it"
        className="text-sm bg-background/50 border-primary/20"
        onKeyDown={e => e.key === "Enter" && text.trim() && mutation.mutate(text.trim())}
      />
      <Button
        data-testid="button-capture-submit"
        onClick={() => text.trim() && mutation.mutate(text.trim())}
        disabled={!text.trim() || mutation.isPending}
        size="sm"
        className="shadow-sm"
      >
        <Plus size={14} />
      </Button>
    </div>
  );
}

function InboxPanel() {
  const [editItem, setEditItem] = useState<GtdInbox | null>(null);

  const { data: inbox = [], isLoading: inboxLoading } = useQuery({
    queryKey: ["/api/inbox"],
    queryFn: () => fetchInbox(20),
    refetchInterval: 30_000,
  });

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ["/api/inbox/history"],
    queryFn: () => fetchInboxHistory(30),
    refetchInterval: 60_000,
  });
  
  const processMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/gtd/process?force=true");
      if (!response.ok) throw new Error("Failed to process inbox");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
    },
  });

  return (
    <>
      <EditInboxDialog
        item={editItem}
        open={!!editItem}
        onClose={() => setEditItem(null)}
      />
      <Card className="border-primary/5 bg-primary/5">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Inbox size={12} /> Inbox
            </CardTitle>
            <Button 
              data-testid="button-process-inbox"
              variant="ghost" 
              size="sm" 
              className="h-6 text-[9px] gap-1 hover:bg-primary/10 hover:text-primary transition-all px-2 border border-primary/10"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isPending || inbox.length === 0}
            >
              {processMutation.isPending ? (
                <>Processing...</>
              ) : (
                <><Sparkles size={10} /> Process Now</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-3">
          <QuickCapture />

          <Tabs defaultValue="pending">
            <TabsList className="h-7 w-full">
              <TabsTrigger value="pending" className="flex-1 text-[10px] h-5 gap-1">
                <Inbox size={9} /> Pending
                {inbox.length > 0 && (
                  <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[9px] font-bold">{inbox.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1 text-[10px] h-5 gap-1">
                <History size={9} /> History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="mt-2 space-y-0">
              {inboxLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : inbox.length === 0 ? (
                <p className="text-[10px] text-center text-muted-foreground italic py-4">
                  Inbox clear ✓
                </p>
              ) : (
                <div className="space-y-0">
                  {inbox.slice(0, 5).map(item => (
                    <div key={item.id} className="group flex items-start gap-2 py-2 border-b border-border/60 last:border-0">
                      <span className="text-primary/40 mt-0.5 flex-shrink-0">○</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] leading-tight">{item.rawText}</p>
                        {(item.tags || []).length > 0 && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {(item.tags || []).slice(0, 3).map(tag => (
                              <span key={tag} className="text-[9px] text-primary/50">#{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        onClick={() => setEditItem(item)}
                        title="Edit"
                      >
                        <Edit2 size={9} />
                      </Button>
                    </div>
                  ))}
                  {inbox.length > 5 && (
                    <p className="text-[9px] text-center text-muted-foreground pt-1.5">
                      +{inbox.length - 5} more pending
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-2 space-y-0">
              {historyLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : history.length === 0 ? (
                <p className="text-[10px] text-center text-muted-foreground italic py-4">
                  No processed items yet
                </p>
              ) : (
                <div className="space-y-0 max-h-72 overflow-y-auto scrollbar-thin">
                  {history.map(item => (
                    <InboxHistoryRow key={item.id} item={item} onEdit={setEditItem} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}

function TimelineDay({ date, actions, events, onCompleteAction, onDeleteEvent }: { date: Date; actions: GtdAction[]; events: any[]; onCompleteAction: (id: string) => void; onDeleteEvent?: (id: string) => void }) {
  const isTodayDate = isToday(date);
  const isTomorrowDate = isTomorrow(date);
  const label = isTodayDate ? "Today" : isTomorrowDate ? "Tomorrow" : format(date, "EEEE, MMM d");

  if (actions.length === 0 && events.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className={`text-xs font-bold uppercase tracking-widest ${isTodayDate ? "text-primary" : "text-muted-foreground opacity-60"}`}>
        {label}
      </h3>
      <Card className={`${isTodayDate ? "border-primary/20 bg-primary/5 shadow-sm" : "border-border bg-card/50"}`}>
        <CardContent className="p-4 space-y-0">
          <AnimatePresence>
            {events.map(event => (
              <CalendarEventRow 
                key={event.id} 
                event={event} 
                onDelete={onDeleteEvent} 
              />
            ))}
            {actions.map(action => (
              <ActionRow 
                key={action.id} 
                action={action} 
                onComplete={() => onCompleteAction(action.id)} 
              />
            ))}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}

function KanbanColumn({ title, actions, onCompleteAction }: { title: string; actions: GtdAction[]; onCompleteAction: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3 min-w-[280px] flex-1">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
        <Badge variant="secondary" className="h-4 text-[9px] px-1.5">{actions.length}</Badge>
      </div>
      <div className="flex-1 space-y-3 bg-muted/30 rounded-lg p-3 border border-dashed border-border/50">
        {actions.length === 0 ? (
          <div className="h-20 flex items-center justify-center text-[10px] text-muted-foreground italic">No items</div>
        ) : (
          actions.map(action => (
            <Card key={action.id} className="shadow-sm border-primary/10">
              <CardContent className="p-3">
                <ActionRow action={action} onComplete={() => onCompleteAction(action.id)} />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function ReferenceView({ references }: { references: GtdReference[] }) {
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"area" | "category">("area");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return references.filter(r => 
      r.title.toLowerCase().includes(q) || 
      (r.content || "").toLowerCase().includes(q) ||
      (r.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }, [references, search]);

  const grouped = useMemo(() => {
    return filtered.reduce((acc: Record<string, GtdReference[]>, r) => {
      const key = (groupBy === "area" ? r.area : r.category) || "Uncategorized";
      if (!acc[key]) acc[key] = [];
      acc[key].push(r);
      return acc;
    }, {});
  }, [filtered, groupBy]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search references, URLs, tags..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Group by:</span>
          <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
            <SelectTrigger className="w-[120px] h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="area" className="text-xs">Domain Area</SelectItem>
              <SelectItem value="category" className="text-xs">Category</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Folder size={14} className="text-primary/60" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{group}</h3>
              <Badge variant="secondary" className="h-4 text-[9px] px-1.5 ml-auto">{items.length}</Badge>
            </div>
            <div className="space-y-3">
              {items.map(item => (
                <Card key={item.id} className="group hover:border-primary/30 transition-all hover:shadow-sm">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold leading-tight group-hover:text-primary transition-colors">{item.title}</h4>
                      {item.url && (
                        <a 
                          href={item.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary mt-0.5"
                          title={item.url}
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                    {item.content && (
                      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                        {item.content}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {item.tags?.map(tag => (
                        <span key={tag} className="text-[10px] text-primary/60 flex items-center gap-0.5">
                          <Tag size={10} className="opacity-50" /> {tag}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-20 text-center space-y-3 bg-muted/20 rounded-xl border border-dashed">
            <Bookmark size={32} className="mx-auto text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground italic">No references found matching "{search}"</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Create Project Dialog ─────────────────────────────────────────────────────

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [lifeDomain, setLifeDomain] = useState("unknown");
  
  const mutation = useMutation({
    mutationFn: async () => {
      await createProject({ title, lifeDomain });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "active"] });
      setTitle("");
      setLifeDomain("unknown");
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Project Title</Label>
            <Input 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              placeholder="e.g. Plan Summer Vacation #personal"
              onKeyDown={e => { if (e.key === "Enter" && title.trim()) mutation.mutate(); }}
            />
          </div>
          <div className="space-y-2">
            <Label>Life Domain</Label>
            <Select value={lifeDomain} onValueChange={setLifeDomain}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!title.trim() || mutation.isPending}>
            {mutation.isPending ? "Creating..." : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GTDPage() {
  const [view, setView] = useState<"dashboard" | "kanban" | "list" | "calendar" | "waiting" | "reference" | "someday">("dashboard");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [lifeDomain, setLifeDomain] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [contextFilter, setContextFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  
  const { data: actions = [], isLoading: actionsLoading } = useQuery({
    queryKey: ["/api/actions", "active"],
    queryFn: () => fetchActions("active"),
  });
  const { data: waiting = [] } = useQuery({
    queryKey: ["/api/actions", "waiting-list"],
    queryFn: fetchWaitingActions,
  });
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["/api/projects", "active"],
    queryFn: () => fetchProjects("active"),
  });
  const { data: calendarEvents = [] } = useQuery({
    queryKey: ["/api/calendar/events"],
    queryFn: fetchCalendarEvents,
  });
  const { data: allTags = [] } = useQuery({
    queryKey: ["/api/hashtags"],
    queryFn: fetchAllHashtags,
  });
  const { data: references = [], isLoading: referencesLoading } = useQuery({
    queryKey: ["/api/reference"],
    queryFn: fetchReferences,
  });
  const { data: someday = [], isLoading: somedayLoading } = useQuery({
    queryKey: ["/api/someday"],
    queryFn: fetchSomeday,
  });

  const completeMutation = useMutation({
    mutationFn: completeAction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/actions"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCalendarEvent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] }),
  });

  const filterItem = (item: any) => {
    if (lifeDomain !== "all" && (item.lifeDomain || "unknown") !== lifeDomain) return false;
    if (projectFilter !== "all" && (item.projectId || "__none__") !== projectFilter) return false;
    if (contextFilter !== "all") {
      const itemCtx = contextToHashtag(item.context) || "anywhere";
      if (itemCtx !== contextFilter) return false;
    }
    if (tagFilter.length > 0) {
      const itemTags = item.tags || [];
      if (!tagFilter.every(tag => itemTags.includes(tag))) return false;
    }
    return true;
  };

  const filteredActions = actions.filter(filterItem).filter(a => contextFilter === "waiting" ? true : a.context !== "@waiting");
  const filteredWaiting = waiting.filter(filterItem);
  const filteredProjects = projects.filter(filterItem);

  // Group actions by context for List view
  const byContext = filteredActions.reduce((acc: Record<string, GtdAction[]>, a: GtdAction) => {
    const ctxRaw = contextToHashtag(a.context) || "anywhere";
    const ctx = `@${ctxRaw}`;
    if (!acc[ctx]) acc[ctx] = [];
    acc[ctx].push(a);
    return acc;
  }, {});

  // For Timeline
  const timelineDays = useMemo(() => {
    const start = subDays(startOfDay(new Date()), 1);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    
    return days.map(day => ({
      date: day,
      actions: filteredActions.filter(a => a.dueDate && isSameDay(parseISO(a.dueDate), day)),
      events: calendarEvents.filter((e: any) => isSameDay(parseISO(e.start_at), day))
    }));
  }, [filteredActions, calendarEvents]);

  const toggleTag = (tag: string) => {
    setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <CreateProjectDialog open={createProjectOpen} onClose={() => setCreateProjectOpen(false)} />
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">GTD Dashboard</h1>
            <Badge variant="outline" className="text-primary border-primary/30 uppercase tracking-widest text-[9px] px-2 font-bold">Zen Flow</Badge>
            <Button size="sm" variant="outline" onClick={() => setCreateProjectOpen(true)} className="ml-4 h-7 gap-1.5 px-3 text-[10px] hidden md:flex">
              <FolderPlus size={12} /> New Project
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Focus on what matters. {filteredActions.length} next actions queued across {filteredProjects.length} active projects.
            </p>
            <Button size="sm" variant="outline" onClick={() => setCreateProjectOpen(true)} className="h-6 gap-1 px-2 text-[9px] md:hidden">
              <FolderPlus size={10} /> New
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-muted/30 p-1 rounded-lg border border-border/50">
          <Button 
            variant={view === "dashboard" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("dashboard")}
            className="h-8 gap-1.5 px-3"
          >
            <LayoutDashboard size={14} /> Dashboard
          </Button>
          <Button 
            variant={view === "kanban" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("kanban")}
            className="h-8 gap-1.5 px-3"
          >
            <Kanban size={14} /> Kanban
          </Button>
          <Button 
            variant={view === "list" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("list")}
            className="h-8 gap-1.5 px-3"
          >
            <List size={14} /> List
          </Button>
          <Button 
            variant={view === "calendar" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("calendar")}
            className="h-8 gap-1.5 px-3"
          >
            <Calendar size={14} /> Calendar
          </Button>
          <Button 
            variant={view === "waiting" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("waiting")}
            className="h-8 gap-1.5 px-3"
          >
            <Clock size={14} /> Waiting
          </Button>
          <Button 
            variant={view === "reference" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("reference")}
            className="h-8 gap-1.5 px-3"
          >
            <Bookmark size={14} /> References
          </Button>
          <Button 
            variant={view === "someday" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("someday")}
            className="h-8 gap-1.5 px-3"
          >
            <Sparkles size={14} /> Someday
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Sidebar Filters */}
        <aside className="lg:col-span-1 space-y-6">
          <InboxPanel />

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Filters</label>
              <div className="space-y-3">
                <Select value={lifeDomain} onValueChange={setLifeDomain}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="All Domains" />
                  </SelectTrigger>
                  <SelectContent>
                    {LIFE_DOMAIN_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All projects</SelectItem>
                    <SelectItem value="__none__" className="text-xs">No project</SelectItem>
                    {(projects as any[]).map((project) => (
                      <SelectItem key={project.id} value={String(project.id)} className="text-xs">
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={contextFilter} onValueChange={setContextFilter}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="All Contexts" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTEXT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Hashtags</label>
                {tagFilter.length > 0 && <Button variant="ghost" size="sm" className="h-auto p-0 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setTagFilter([])}>Clear</Button>}
              </div>
              <div className="flex flex-wrap gap-1.5 p-1">
                {allTags.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground italic px-1">No tags found</span>
                ) : (
                  allTags.map(tag => (
                    <HashtagChip 
                      key={tag} 
                      tag={tag} 
                      active={tagFilter.includes(tag)} 
                      onClick={() => toggleTag(tag)} 
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="lg:col-span-3 space-y-6">
          {/* Quick Context Filters */}
          <div className="flex items-center gap-2 overflow-x-auto pb-4 -mx-1 px-1 no-scrollbar select-none">
            {CONTEXT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={contextFilter === opt.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setContextFilter(opt.value)}
                className={`h-9 px-4 text-[10px] uppercase tracking-widest font-bold rounded-full transition-all border shrink-0 flex items-center gap-2 ${
                  contextFilter === opt.value 
                    ? "bg-primary/15 text-primary border-primary/30 shadow-[0_0_12px_rgba(var(--primary),0.1)] ring-1 ring-primary/20 scale-[1.02]" 
                    : "border-border/60 text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground hover:border-border"
                }`}
              >
                {opt.icon && <opt.icon size={12} className={contextFilter === opt.value ? "text-primary text-glow-sm" : "opacity-60"} />}
                {opt.label}
              </Button>
            ))}
          </div>

          {actionsLoading || projectsLoading || referencesLoading ? (
            <div className="space-y-6">
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {view === "reference" && (
                <ReferenceView key="reference-view" references={references} />
              )}
              {view === "calendar" && (
                <div key="calendar-view-container" className="grid grid-cols-1 xl:grid-cols-4 gap-6">
                  <div className="xl:col-span-3">
                    <CalendarView
                      events={calendarEvents}
                      actions={filteredActions}
                      onCompleteAction={(id) => completeMutation.mutate(id)}
                      onDeleteEvent={(id) => {
                        if (confirm("Are you sure you want to delete this event?")) {
                          deleteMutation.mutate(id);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-1">
                      <Clock size={12} /> Upcoming
                    </h3>
                    <div className="space-y-3">
                      {calendarEvents
                        .filter((e: any) => new Date(e.start_at) >= new Date())
                        .sort((a: any, b: any) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
                        .slice(0, 8)
                        .map((e: any) => (
                          <Card key={e.id} className="bg-card/50 border-border/50 hover:border-primary/20 transition-all">
                            <CardContent className="p-3">
                              <CalendarEventRow 
                                event={e} 
                                showDate={true} 
                                onDelete={(id) => {
                                  if (confirm("Are you sure you want to delete this event?")) {
                                    deleteMutation.mutate(id);
                                  }
                                }}
                              />
                            </CardContent>
                          </Card>
                        ))}
                      {calendarEvents.filter((e: any) => new Date(e.start_at) >= new Date()).length === 0 && (
                        <p className="text-[10px] text-muted-foreground italic p-4 text-center">No upcoming events</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {view === "dashboard" && (
                <motion.div 
                  key="dashboard"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: Timeline */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar size={16} className="text-primary" />
                        <h2 className="text-sm font-bold uppercase tracking-widest">Timeline</h2>
                      </div>
                      <div className="space-y-6 relative border-l-2 border-border/50 ml-1 pl-6">
                        {timelineDays.every(d => d.actions.length === 0 && d.events.length === 0) ? (
                          <div className="text-center py-10">
                            <Check size={24} className="mx-auto text-muted-foreground/30 mb-2" />
                            <p className="text-sm text-muted-foreground">Your schedule is wide open</p>
                          </div>
                        ) : (
                          timelineDays.map((day, idx) => (
                            <div key={idx} className="relative">
                              <div className="absolute -left-[31px] top-0 w-4 h-4 rounded-full bg-background border-2 border-primary ring-4 ring-background" />
                              <TimelineDay 
                                date={day.date} 
                                actions={day.actions} 
                                events={day.events}
                                onCompleteAction={(id) => completeMutation.mutate(id)}
                                onDeleteEvent={(id) => {
                                  if (confirm("Are you sure you want to delete this event?")) {
                                    deleteMutation.mutate(id);
                                  }
                                }}
                              />
                            </div>
                          ))
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full text-xs text-muted-foreground gap-1 mt-4 hover:text-primary transition-colors"
                          onClick={() => setView("calendar")}
                        >
                          View Full Calendar <ArrowRight size={12} />
                        </Button>
                      </div>
                    </div>

                    {/* Right: Focused Widgets */}
                    <div className="space-y-8">
                      {/* Upcoming Events Widget */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Calendar size={16} className="text-amber-500" />
                          <h2 className="text-sm font-bold uppercase tracking-widest text-amber-600/70">Upcoming Events</h2>
                        </div>
                        <Card className="bg-amber-50/20 border-amber-500/10">
                          <CardContent className="p-4 space-y-3">
                            {calendarEvents.filter((e: any) => new Date(e.start_at) >= new Date()).length === 0 ? (
                              <p className="text-xs text-muted-foreground py-2 italic">No upcoming events</p>
                            ) : (
                              calendarEvents
                                .filter((e: any) => new Date(e.start_at) >= new Date())
                                .sort((a: any, b: any) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
                                .slice(0, 5)
                                .map((e: any) => (
                                  <div key={e.id} className="py-1 border-b border-border/40 last:border-0 last:pb-0">
                                    <CalendarEventRow 
                                      event={e} 
                                      showDate={true} 
                                      onDelete={(id) => {
                                        if (confirm("Are you sure you want to delete this event?")) {
                                          deleteMutation.mutate(id);
                                        }
                                      }}
                                    />
                                  </div>
                                ))
                            )}
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full h-7 text-[10px] text-amber-700/60 hover:text-amber-700 hover:bg-amber-500/5 gap-1 mt-1"
                              onClick={() => setView("calendar")}
                            >
                              Open Full Calendar <ArrowRight size={10} />
                            </Button>
                          </CardContent>
                        </Card>
                      </div>
                       {/* Waiting For Widget */}
                       <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Clock size={16} className="text-purple-500" />
                          <h2 className="text-sm font-bold uppercase tracking-widest text-purple-600/70">Waiting For</h2>
                        </div>
                        <Card className="bg-purple-50/20 border-purple-500/10">
                          <CardContent className="p-4 space-y-1">
                            {filteredWaiting.length === 0 ? (
                              <p className="text-xs text-muted-foreground py-2 italic">Nothing you're waiting on</p>
                            ) : (
                              <>
                                {filteredWaiting.slice(0, 5).map(a => (
                                  <div key={a.id} className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0 last:pb-0">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] font-semibold leading-tight line-clamp-1">{a.title}</p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        {a.delegatedTo && (
                                          <Badge variant="outline" className="text-[8px] px-1 h-3.5 bg-purple-500/5 text-purple-600 border-purple-500/20">
                                            @{a.delegatedTo}
                                          </Badge>
                                        )}
                                        {a.dueDate && (
                                          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                                            <Calendar size={8} /> {format(parseISO(a.dueDate), "MMM d")}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="w-full h-7 text-[10px] text-purple-700/60 hover:text-purple-700 hover:bg-purple-500/5 gap-1 mt-1"
                                  onClick={() => setView("waiting")}
                                >
                                  Open Waiting For List <ArrowRight size={10} />
                                </Button>
                              </>
                            )}
                          </CardContent>
                        </Card>
                      </div>

                      {/* Active Projects Widget */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <FolderPlus size={16} className="text-blue-500" />
                          <h2 className="text-sm font-bold uppercase tracking-widest text-blue-600/70">Top Projects</h2>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {filteredProjects.slice(0, 4).map(p => (
                            <Card key={p.id} className="hover:border-primary/20 transition-colors">
                              <CardContent className="p-3 flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold truncate">{p.title}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <div className="w-16 bg-muted rounded-full h-1 overflow-hidden">
                                      <div className="bg-primary h-full rounded-full" style={{ width: '40%' }} />
                                    </div>
                                    <span className="text-[9px] text-muted-foreground">4 tasks left</span>
                                  </div>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full">
                                  <ArrowRight size={12} />
                                </Button>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {view === "kanban" && (
                <motion.div 
                  key="kanban"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="flex gap-6 overflow-x-auto pb-6 scrollbar-thin"
                >
                  <KanbanColumn 
                    title="Next Actions" 
                    actions={filteredActions.filter(a => !a.dueDate || isToday(parseISO(a.dueDate)))} 
                    onCompleteAction={(id) => completeMutation.mutate(id)} 
                  />
                  <KanbanColumn 
                    title="Planned" 
                    actions={filteredActions.filter(a => a.dueDate && !isToday(parseISO(a.dueDate)))} 
                    onCompleteAction={(id) => completeMutation.mutate(id)} 
                  />
                  <KanbanColumn 
                    title="Waiting" 
                    actions={filteredWaiting} 
                    onCompleteAction={(id) => completeMutation.mutate(id)} 
                  />
                </motion.div>
              )}

              {view === "list" && (
                <motion.div 
                  key="list"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="space-y-4"
                >
                  {filteredActions.length === 0 && filteredWaiting.length === 0 ? (
                    <Card className="border-dashed border-2">
                      <CardContent className="p-12 text-center text-muted-foreground">
                        <Check size={40} className="mx-auto mb-4 opacity-20" />
                        <p>No actions found with current filters</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      {Object.entries(byContext).map(([ctx, ctxActions]) => (
                        <Card key={ctx} className="overflow-hidden">
                          <CardHeader className="py-2 px-4 bg-muted/30 border-b">
                            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                              {ctx}
                              <Badge variant="secondary" className="h-4 text-[9px]">{ctxActions.length}</Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 py-0">
                            {ctxActions.map((a: GtdAction) => (
                              <ActionRow
                                key={a.id}
                                action={a}
                                onComplete={() => completeMutation.mutate(a.id)}
                              />
                            ))}
                          </CardContent>
                        </Card>
                      ))}

                      {filteredWaiting.length > 0 && (
                        <Card key="waiting-list-section" className="overflow-hidden border-purple-500/10 shadow-sm shadow-purple-500/5">
                          <CardHeader className="py-2 px-4 bg-purple-500/5 border-b border-purple-500/10">
                            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-purple-600/70 flex items-center justify-between">
                              @waiting / Pending
                              <Badge variant="secondary" className="h-4 text-[9px] bg-purple-100/50 text-purple-600">{filteredWaiting.length}</Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 py-0">
                            {filteredWaiting.map((a: GtdAction) => (
                              <ActionRow
                                key={a.id}
                                action={a}
                                onComplete={() => completeMutation.mutate(a.id)}
                              />
                            ))}
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </motion.div>
              )}
              {view === "someday" && (
                <motion.div 
                  key="someday"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                >
                  {someday.length === 0 ? (
                    <div className="col-span-full py-20 text-center space-y-3 bg-muted/20 rounded-xl border border-dashed">
                      <Sparkles size={32} className="mx-auto text-muted-foreground/20" />
                      <p className="text-sm text-muted-foreground italic">No someday/maybe items yet</p>
                    </div>
                  ) : (
                    someday.map(item => (
                      <Card key={item.id} className="group hover:border-primary/30 transition-all hover:shadow-sm">
                        <CardContent className="p-4 space-y-2">
                          <h4 className="text-sm font-semibold leading-tight group-hover:text-primary transition-colors">{item.title}</h4>
                          {item.description && (
                            <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                              {item.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {item.tags?.map(tag => (
                              <span key={tag} className="text-[10px] text-primary/60 flex items-center gap-0.5">
                                <Tag size={10} className="opacity-50" /> {tag}
                              </span>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </motion.div>
              )}
              {view === "waiting" && (
                <motion.div 
                  key="waiting"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Clock className="text-purple-500" size={20} />
                      <h2 className="text-lg font-bold">Waiting For List</h2>
                    </div>
                    <Badge variant="secondary" className="bg-purple-100 text-purple-700 h-6 px-3">{filteredWaiting.length} Items</Badge>
                  </div>

                  {filteredWaiting.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="p-12 text-center text-muted-foreground italic">
                        Nothing you're currently waiting on. Time to follow up?
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {Object.entries(
                        filteredWaiting.reduce((acc: Record<string, GtdAction[]>, a) => {
                          const key = a.delegatedTo || "general";
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(a);
                          return acc;
                        }, {})
                      ).map(([group, items]) => (
                        <Card key={group} className="overflow-hidden border-purple-500/20 shadow-sm shadow-purple-500/5">
                          <CardHeader className="py-2.5 px-4 bg-purple-500/5 border-b border-purple-500/10">
                            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-purple-600/80 flex items-center justify-between">
                              {group === "general" ? "@waiting (Self/Process)" : `@delegated to: ${group}`}
                              <Badge variant="secondary" className="h-4 text-[9px] bg-purple-100/50 text-purple-600">{items.length}</Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 py-0">
                            {items.map((a: GtdAction) => (
                              <ActionRow
                                key={a.id}
                                action={a}
                                onComplete={() => completeMutation.mutate(a.id)}
                              />
                            ))}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </main>
      </div>
    </div>
  );
}
