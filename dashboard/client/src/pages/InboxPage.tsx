import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BusinessMemory, GtdInbox, GtdProject } from "@shared/schema";
import { formatHashtag } from "@shared/hashtags";
import { queryClient } from "@/lib/queryClient";
import {
  addToInbox,
  fetchBusinessMemory,
  fetchInbox,
  fetchInboxHistory,
  fetchProjects,
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatSourceGlyph, formatSourceLabel } from "@/lib/sourceLabels";
import {
  ClipboardList,
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
const ACTIVITY_QUERY_KEY = ["/api/business-memory", "recent"];
const NO_PROJECT_VALUE = "__no_project__";
const ALL_PROJECTS_VALUE = "__all_projects__";
const UNASSIGNED_PROJECT_FILTER = "__unassigned_project__";
const LIFE_DOMAIN_OPTIONS = ["all", "business", "personal", "unknown"] as const;

const FILED_TO_LABELS: Record<string, string> = {
  trash: "Trash",
  someday: "Someday/Maybe",
  someday_maybe: "Someday/Maybe",
  reference: "Reference",
  action: "Next Action",
  "calendar:appointment": "Calendar: Appointment",
  "calendar:day_action": "Calendar: Day-Specific Action",
  "calendar:day_info": "Calendar: Day-Specific Info",
  "waiting_for:delegated": "Waiting For",
  "next_action:@home": "#home",
  "next_action:@work": "#work",
  "next_action:@computer": "#computer",
  "next_action:@phone": "#phone",
  "next_action:@errands": "#errands",
  "next_action:@agenda": "#agenda",
  "next_action:@email": "#email",
  "next_action:@anywhere": "#anywhere",
  project: "Project",
  manual: "Manually Processed",
  "manual-bulk": "Manually Processed",
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
  queryClient.invalidateQueries({ queryKey: ACTIVITY_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
}

function SourceBadge({ source }: { source: string | null }) {
  const label = formatSourceLabel(source);
  const glyph = formatSourceGlyph(source);

  return (
    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
      {glyph} {label}
    </Badge>
  );
}

function HashtagBadge({ tag }: { tag: string }) {
  return (
    <Badge variant="outline" className="border-primary/20 bg-primary/5 text-[10px] font-medium text-primary">
      {formatHashtag(tag)}
    </Badge>
  );
}

function formatFiledTo(filedTo: string | null | undefined) {
  if (!filedTo) return null;
  return FILED_TO_LABELS[filedTo] || filedTo.replace(/[_:]/g, " ");
}

function formatLifeDomain(value: string | null | undefined) {
  const next = value || "unknown";
  return next.charAt(0).toUpperCase() + next.slice(1);
}

function formatProjectName(item: GtdInbox) {
  return (item as any).gtd_projects?.title || null;
}

function ActivityRow({ entry }: { entry: BusinessMemory }) {
  const createdAt = formatTimestamp(entry.createdAt);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={entry.source} />
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {entry.agentName}
        </Badge>
        {entry.importance && (
          <Badge variant="outline" className="text-[10px] capitalize">
            {entry.importance}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] capitalize">
          {formatLifeDomain((entry as any).lifeDomain)}
        </Badge>
        {createdAt && <span className="text-[11px] text-muted-foreground">{createdAt}</span>}
      </div>
      <p className="mt-2 text-sm leading-relaxed">{entry.summary}</p>
    </div>
  );
}

type InboxRowProps = {
  item: GtdInbox;
  mode: "active" | "processed";
  isEditing: boolean;
  projects: GtdProject[];
  draftText: string;
  draftProjectId: string;
  onStartEdit: (item: GtdInbox) => void;
  onCancelEdit: () => void;
  onDraftChange: (value: string) => void;
  onDraftProjectChange: (value: string) => void;
  onSaveEdit: (item: GtdInbox) => void;
  onProcess?: (id: string) => void;
  onUndo?: (id: string) => void;
};

function InboxRow({
  item,
  mode,
  isEditing,
  projects,
  draftText,
  draftProjectId,
  onStartEdit,
  onCancelEdit,
  onDraftChange,
  onDraftProjectChange,
  onSaveEdit,
  onProcess,
  onUndo,
}: InboxRowProps) {
  const createdAt = formatTimestamp(item.createdAt);
  const processedAt = formatTimestamp(item.processedAt);
  const projectName = formatProjectName(item);
  const tags = item.tags || [];

  return (
    <div
      data-testid={`inbox-item-${item.id}`}
      className="rounded-lg border border-border p-4 transition-colors hover:border-primary/25"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {isEditing ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Textarea
                  value={draftText}
                  onChange={(event) => onDraftChange(event.target.value)}
                  rows={3}
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Add inline hashtags like <span className="font-medium">#phone</span>, <span className="font-medium">#home</span>, or <span className="font-medium">#volunteering</span>.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Project
                  </Label>
                  <Select value={draftProjectId} onValueChange={onDraftProjectChange}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Optional project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROJECT_VALUE}>No project</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
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
            <Badge variant="outline" className="text-[10px] capitalize">
              {formatLifeDomain((item as any).lifeDomain)}
            </Badge>
            {projectName && (
              <Badge variant="outline" className="text-[10px]">
                {projectName}
              </Badge>
            )}
            {item.filedTo && mode === "processed" && (
              <Badge variant="outline" className="text-[10px]">
                {formatFiledTo(item.filedTo)}
              </Badge>
            )}
            {tags.map((tag) => (
              <HashtagBadge key={`${item.id}-${tag}`} tag={tag} />
            ))}
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

function filterAndSortInboxItems(
  items: GtdInbox[],
  filters: { search: string; tag: string; projectFilter: string; sort: string },
) {
  const q = filters.search.trim().toLowerCase();
  const next = items.filter((item) => {
    const projectName = formatProjectName(item)?.toLowerCase() || "";
    const tags = (item.tags || []).map((entry) => entry.toLowerCase());

    if (filters.tag !== "all" && !tags.includes(filters.tag)) return false;

    if (filters.projectFilter === UNASSIGNED_PROJECT_FILTER && item.projectId) return false;
    if (
      filters.projectFilter !== ALL_PROJECTS_VALUE &&
      filters.projectFilter !== UNASSIGNED_PROJECT_FILTER &&
      item.projectId !== filters.projectFilter
    ) {
      return false;
    }

    if (!q) return true;

    const haystack = [
      item.rawText,
      item.aiSummary,
      item.aiCategory,
      projectName,
      ...(item.tags || []).map((entry) => formatHashtag(entry)),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });

  next.sort((a, b) => {
    if (filters.sort === "project") {
      const byProject = (formatProjectName(a) || "").localeCompare(formatProjectName(b) || "");
      if (byProject !== 0) return byProject;
    }

    const aTime = new Date(filters.sort === "processed" ? a.processedAt || a.createdAt || 0 : a.createdAt || 0).getTime();
    const bTime = new Date(filters.sort === "processed" ? b.processedAt || b.createdAt || 0 : b.createdAt || 0).getTime();
    return filters.sort === "oldest" ? aTime - bTime : bTime - aTime;
  });

  return next;
}

export function InboxPage() {
  const [newCapture, setNewCapture] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftProjectId, setDraftProjectId] = useState(NO_PROJECT_VALUE);
  const [inboxSearch, setInboxSearch] = useState("");
  const [selectedInboxTag, setSelectedInboxTag] = useState("all");
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS_VALUE);
  const [inboxSort, setInboxSort] = useState("newest");
  const [activitySearch, setActivitySearch] = useState("");
  const [activitySourceFilter, setActivitySourceFilter] = useState("all");
  const [activityLifeDomainFilter, setActivityLifeDomainFilter] = useState<(typeof LIFE_DOMAIN_OPTIONS)[number]>("all");
  const [activityImportanceFilter, setActivityImportanceFilter] = useState("all");
  const [activitySort, setActivitySort] = useState("newest");

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

  const { data: projects = [] } = useQuery({
    queryKey: ["/api/projects", "active"],
    queryFn: () => fetchProjects("active"),
    refetchInterval: 60_000,
  });

  const { data: activityItems = [], isLoading: activityLoading } = useQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: () => fetchBusinessMemory(100),
    refetchInterval: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: (rawText: string) => addToInbox(rawText),
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
    mutationFn: ({ id, rawText, existingTags }: { id: string; rawText: string; existingTags?: string[] | null }) =>
      updateInboxText(
        id,
        rawText,
        false,
        undefined,
        draftProjectId === NO_PROJECT_VALUE ? null : draftProjectId,
        existingTags,
      ),
    onSuccess: () => {
      setEditingId(null);
      setDraftText("");
      setDraftProjectId(NO_PROJECT_VALUE);
      invalidateInboxQueries();
    },
  });

  const activeIds = useMemo(() => activeItems.map((item) => item.id), [activeItems]);
  const activitySources = useMemo(
    () => Array.from(new Set(activityItems.map((item) => item.source).filter(Boolean))),
    [activityItems],
  );

  const inboxTags = useMemo(
    () =>
      Array.from(new Set([...activeItems, ...processedItems].flatMap((item) => item.tags || []))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [activeItems, processedItems],
  );

  const filteredActiveItems = useMemo(
    () =>
      filterAndSortInboxItems(activeItems, {
        search: inboxSearch,
        tag: selectedInboxTag,
        projectFilter,
        sort: inboxSort,
      }),
    [activeItems, inboxSearch, inboxSort, projectFilter, selectedInboxTag],
  );

  const filteredProcessedItems = useMemo(
    () =>
      filterAndSortInboxItems(processedItems, {
        search: inboxSearch,
        tag: selectedInboxTag,
        projectFilter,
        sort: inboxSort === "newest" ? "processed" : inboxSort,
      }),
    [processedItems, inboxSearch, inboxSort, projectFilter, selectedInboxTag],
  );

  const filteredActivityItems = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    const next = activityItems.filter((item) => {
      if (activitySourceFilter !== "all" && item.source !== activitySourceFilter) return false;
      if (activityLifeDomainFilter !== "all" && ((item as any).lifeDomain || "unknown") !== activityLifeDomainFilter) return false;
      if (activityImportanceFilter !== "all" && (item.importance || "medium") !== activityImportanceFilter) return false;
      if (!q) return true;

      const haystack = [item.summary, item.agentName, item.source, ...(item.topics || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });

    next.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return activitySort === "oldest" ? aTime - bTime : bTime - aTime;
    });

    return next;
  }, [activityImportanceFilter, activityItems, activityLifeDomainFilter, activitySearch, activitySort, activitySourceFilter]);

  function startEdit(item: GtdInbox) {
    setEditingId(item.id);
    setDraftText(item.rawText);
    setDraftProjectId(item.projectId || NO_PROJECT_VALUE);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftText("");
    setDraftProjectId(NO_PROJECT_VALUE);
  }

  function saveEdit(item: GtdInbox) {
    const nextText = draftText.trim();
    if (!nextText) return;
    saveEditMutation.mutate({
      id: item.id,
      rawText: nextText,
      existingTags: item.tags || null,
    });
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">GTD Inbox</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {activeItems.length} active, {processedItems.length} processed, {activityItems.length} conversation notes
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
        <CardContent className="space-y-2 p-3">
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
              placeholder="Add to inbox with hashtags like #phone #home-project..."
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
          <p className="text-[11px] text-muted-foreground">
            Use hashtags for GTD context, ventures, people, and themes. Projects are separate and can be assigned later.
          </p>
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

      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_190px_180px_150px]">
            <Input
              value={inboxSearch}
              onChange={(event) => setInboxSearch(event.target.value)}
              placeholder="Search inbox text, #hashtags, or project"
              className="text-sm"
            />
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROJECTS_VALUE}>All projects</SelectItem>
                <SelectItem value={UNASSIGNED_PROJECT_FILTER}>Unassigned</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedInboxTag} onValueChange={setSelectedInboxTag}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="All hashtags" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All hashtags</SelectItem>
                {inboxTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {formatHashtag(tag)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={inboxSort} onValueChange={setInboxSort}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Sort order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="project">Project</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={selectedInboxTag === "all" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelectedInboxTag("all")}
            >
              All hashtags
            </Button>
            {inboxTags.map((tag) => (
              <Button
                key={tag}
                type="button"
                variant={selectedInboxTag === tag ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelectedInboxTag(tag)}
              >
                {formatHashtag(tag)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Inbox ({filteredActiveItems.length})</TabsTrigger>
          <TabsTrigger value="processed">Processed ({filteredProcessedItems.length})</TabsTrigger>
          <TabsTrigger value="activity">Conversation Log ({activityItems.length})</TabsTrigger>
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
              ) : filteredActiveItems.length === 0 ? (
                <div className="py-10 text-center">
                  <Inbox size={22} className="mx-auto mb-3 text-primary opacity-40" />
                  <p className="text-sm text-muted-foreground">No inbox items match the current tag or project filters.</p>
                </div>
              ) : (
                filteredActiveItems.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    mode="active"
                    isEditing={editingId === item.id}
                    projects={projects}
                    draftText={editingId === item.id ? draftText : item.rawText}
                    draftProjectId={editingId === item.id ? draftProjectId : item.projectId || NO_PROJECT_VALUE}
                    onStartEdit={startEdit}
                    onCancelEdit={cancelEdit}
                    onDraftChange={setDraftText}
                    onDraftProjectChange={setDraftProjectId}
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
              ) : filteredProcessedItems.length === 0 ? (
                <div className="py-10 text-center">
                  <History size={22} className="mx-auto mb-3 text-primary opacity-40" />
                  <p className="text-sm text-muted-foreground">No processed items match the current tag or project filters.</p>
                </div>
              ) : (
                filteredProcessedItems.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    mode="processed"
                    isEditing={editingId === item.id}
                    projects={projects}
                    draftText={editingId === item.id ? draftText : item.rawText}
                    draftProjectId={editingId === item.id ? draftProjectId : item.projectId || NO_PROJECT_VALUE}
                    onStartEdit={startEdit}
                    onCancelEdit={cancelEdit}
                    onDraftChange={setDraftText}
                    onDraftProjectChange={setDraftProjectId}
                    onSaveEdit={saveEdit}
                    onUndo={(id) => undoMutation.mutate(id)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList size={16} />
                Conversation Log
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_150px_150px_140px]">
                <Input
                  value={activitySearch}
                  onChange={(event) => setActivitySearch(event.target.value)}
                  placeholder="Filter conversation log"
                  className="text-sm"
                />
                <Select value={activitySourceFilter} onValueChange={setActivitySourceFilter}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="All sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    {activitySources.map((source) => (
                      <SelectItem key={source} value={source}>
                        {formatSourceLabel(source)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={activityLifeDomainFilter} onValueChange={(value: any) => setActivityLifeDomainFilter(value)}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="All domains" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All domains</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={activityImportanceFilter} onValueChange={setActivityImportanceFilter}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="All priorities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All importance</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={activitySort} onValueChange={setActivitySort}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Sort order" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {activityLoading ? (
                Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20" />)
              ) : filteredActivityItems.length === 0 ? (
                <div className="py-10 text-center">
                  <ClipboardList size={22} className="mx-auto mb-3 text-primary opacity-40" />
                  <p className="text-sm text-muted-foreground">No conversation notes match the current filters.</p>
                </div>
              ) : (
                filteredActivityItems.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
