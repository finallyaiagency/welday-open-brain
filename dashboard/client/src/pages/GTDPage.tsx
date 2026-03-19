import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { completeAction, createProject, fetchActions, fetchProjects, fetchCalendarEvents, fetchAllHashtags, fetchInbox, fetchInboxHistory, updateInboxText } from "@/lib/supabaseQueries";
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
import { Check, Plus, Calendar, Clock, FolderPlus, Hash, LayoutDashboard, List, Kanban, ArrowRight, Edit2, RotateCcw, ChevronRight, Inbox, History } from "lucide-react";
import type { GtdAction, GtdProject, GtdInbox } from "@shared/schema";
import { formatSourceLabel } from "@/lib/sourceLabels";
import { motion, AnimatePresence } from "framer-motion";
import { format, isToday, isTomorrow, isSameDay, parseISO, startOfDay, addDays, formatDistanceToNow } from "date-fns";
import { CalendarView } from "@/components/CalendarView";

const LIFE_DOMAIN_OPTIONS = [
  { value: "all", label: "All" },
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "unknown", label: "Unknown" },
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
  const hashtags = Array.from(new Set([...(action.tags || []), contextToHashtag(action.context)].filter(Boolean) as string[]));

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

function CalendarEventRow({ event }: { event: any }) {
  const isBusiness = event.life_domain === "business";
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0 opacity-80">
      <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${isBusiness ? "bg-blue-500" : "bg-green-500"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/90 font-medium leading-tight italic">{event.title}</p>
        <div className="flex gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <Clock size={9} />
            {format(parseISO(event.start_at), "h:mm a")} - {event.end_at ? format(parseISO(event.end_at), "h:mm a") : "..."}
          </span>
          {event.location && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[150px]">
              @{event.location}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

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

  return (
    <>
      <EditInboxDialog
        item={editItem}
        open={!!editItem}
        onClose={() => setEditItem(null)}
      />
      <Card className="border-primary/5 bg-primary/5">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Inbox size={12} /> Inbox
          </CardTitle>
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

function TimelineDay({ date, actions, events, onCompleteAction }: { date: Date; actions: GtdAction[]; events: any[]; onCompleteAction: (id: string) => void }) {
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
            {events.map(event => <CalendarEventRow key={event.id} event={event} />)}
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

export function GTDPage() {
  const [view, setView] = useState<"dashboard" | "kanban" | "list" | "calendar">("dashboard");
  const [lifeDomain, setLifeDomain] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  
  const { data: actions = [], isLoading: actionsLoading } = useQuery({
    queryKey: ["/api/actions", "active"],
    queryFn: () => fetchActions("active"),
  });
  const { data: waiting = [] } = useQuery({
    queryKey: ["/api/actions", "waiting"],
    queryFn: () => fetchActions("waiting"),
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

  const completeMutation = useMutation({
    mutationFn: completeAction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/actions"] }),
  });

  const filterItem = (item: any) => {
    if (lifeDomain !== "all" && (item.lifeDomain || "unknown") !== lifeDomain) return false;
    if (projectFilter !== "all" && (item.projectId || "__none__") !== projectFilter) return false;
    if (tagFilter.length > 0) {
      const itemTags = item.tags || [];
      if (!tagFilter.every(tag => itemTags.includes(tag))) return false;
    }
    return true;
  };

  const filteredActions = actions.filter(filterItem);
  const filteredWaiting = waiting.filter(filterItem);
  const filteredProjects = projects.filter(filterItem);

  // Group actions by context for List view
  const byContext = filteredActions.reduce((acc: Record<string, GtdAction[]>, a: GtdAction) => {
    const ctx = contextToHashtag(a.context) ? formatHashtag(contextToHashtag(a.context)) : "other";
    if (!acc[ctx]) acc[ctx] = [];
    acc[ctx].push(a);
    return acc;
  }, {});

  // For Timeline
  const timelineDays = useMemo(() => {
    const start = startOfDay(new Date());
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
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">GTD Dashboard</h1>
            <Badge variant="outline" className="text-primary border-primary/30 uppercase tracking-widest text-[9px] px-2 font-bold">Zen Flow</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Focus on what matters. {filteredActions.length} next actions queued across {filteredProjects.length} active projects.
          </p>
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
        <main className="lg:col-span-3">
          {actionsLoading || projectsLoading ? (
            <div className="space-y-6">
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {view === "calendar" && (
                <CalendarView
                  key="calendar-view"
                  events={calendarEvents}
                  actions={filteredActions}
                  onCompleteAction={(id) => completeMutation.mutate(id)}
                />
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
                              />
                            </div>
                          ))
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full text-xs text-muted-foreground gap-1 mt-4"
                          onClick={() => window.open("https://calendar.google.com", "_blank")}
                        >
                          View full calendar <ArrowRight size={12} />
                        </Button>
                      </div>
                    </div>

                    {/* Right: Focused Widgets */}
                    <div className="space-y-8">
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
                              filteredWaiting.slice(0, 5).map(a => (
                                <div key={a.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                                  <div className="w-1 h-3 rounded-full bg-purple-400" />
                                  <span className="text-xs flex-1 truncate">{a.title}</span>
                                  {a.delegatedTo && <Badge variant="outline" className="text-[9px] px-1 h-4">{a.delegatedTo}</Badge>}
                                </div>
                              ))
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
                  {filteredActions.length === 0 ? (
                    <Card className="border-dashed border-2">
                      <CardContent className="p-12 text-center text-muted-foreground">
                        <Check size={40} className="mx-auto mb-4 opacity-20" />
                        <p>No next actions found with current filters</p>
                      </CardContent>
                    </Card>
                  ) : (
                    Object.entries(byContext).map(([ctx, ctxActions]) => (
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
                    ))
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
