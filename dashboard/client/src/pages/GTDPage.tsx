import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { completeAction, createProject, fetchActions, fetchProjects } from "@/lib/supabaseQueries";
import { supabase } from "@/lib/supabase";
import { contextToHashtag, extractHashtags, formatHashtag } from "@shared/hashtags";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Plus, Calendar, Clock, FolderPlus } from "lucide-react";
import type { GtdAction, GtdProject } from "@shared/schema";
import { formatSourceLabel } from "@/lib/sourceLabels";

const LIFE_DOMAIN_OPTIONS = [
  { value: "all", label: "All" },
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "unknown", label: "Unknown" },
];

function formatLifeDomain(value: string | null | undefined) {
  const next = value || "unknown";
  return next.charAt(0).toUpperCase() + next.slice(1);
}

function HashtagChip({ tag }: { tag: string }) {
  return (
    <Badge variant="outline" className="h-5 border-primary/20 bg-primary/5 text-[10px] text-primary">
      {formatHashtag(tag)}
    </Badge>
  );
}

function ActionRow({ action, onComplete }: { action: GtdAction; onComplete: () => void }) {
  const isOverdue = action.dueDate && new Date(action.dueDate) < new Date();
  const source = (action as any).source as string | null | undefined;
  const projectTitle = (action as any).gtd_projects?.title as string | undefined;
  const hashtags = Array.from(new Set([...(action.tags || []), contextToHashtag(action.context)].filter(Boolean) as string[]));

  return (
    <div
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
        <p className="text-sm">{action.title}</p>
        <div className="flex gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
            {formatLifeDomain((action as any).lifeDomain)}
          </span>
          {projectTitle && <Badge variant="outline" className="h-5 text-[10px]">{projectTitle}</Badge>}
          {hashtags.map((tag) => <HashtagChip key={`${action.id}-${tag}`} tag={tag} />)}
          {action.timeEstimateMin && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock size={9} />{action.timeEstimateMin}m
            </span>
          )}
          {(action as any).ventures?.name && (
            <span className="text-[10px] text-muted-foreground">{(action as any).ventures.name}</span>
          )}
          {source && (
            <Badge variant="outline" className="h-5 text-[10px]">
              {formatSourceLabel(source)}
            </Badge>
          )}
        </div>
      </div>
      {action.dueDate && (
        <span className={`text-[10px] tabular flex-shrink-0 flex items-center gap-0.5 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
          <Calendar size={9} />
          {new Date(action.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}

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
        className="text-sm"
        onKeyDown={e => e.key === "Enter" && text.trim() && mutation.mutate(text.trim())}
      />
      <Button
        data-testid="button-capture-submit"
        onClick={() => text.trim() && mutation.mutate(text.trim())}
        disabled={!text.trim() || mutation.isPending}
        size="sm"
      >
        <Plus size={14} />
      </Button>
    </div>
  );
}

function QuickProject() {
  const [title, setTitle] = useState("");
  const [lifeDomain, setLifeDomain] = useState("unknown");
  const mutation = useMutation({
    mutationFn: () => createProject({ title, lifeDomain, tags: extractHashtags(title) }),
    onSuccess: () => {
      setTitle("");
      setLifeDomain("unknown");
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_auto]">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a project like Home office refresh or Volunteer gala prep"
        className="text-sm"
        onKeyDown={(event) => event.key === "Enter" && title.trim() && mutation.mutate()}
      />
      <Select value={lifeDomain} onValueChange={setLifeDomain}>
        <SelectTrigger className="text-sm">
          <SelectValue placeholder="Domain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="business">Business</SelectItem>
          <SelectItem value="personal">Personal</SelectItem>
          <SelectItem value="unknown">Unknown</SelectItem>
        </SelectContent>
      </Select>
      <Button
        onClick={() => title.trim() && mutation.mutate()}
        disabled={!title.trim() || mutation.isPending}
        size="sm"
        className="gap-1.5"
      >
        <FolderPlus size={14} />
        Add project
      </Button>
    </div>
  );
}

export function GTDPage() {
  const [lifeDomain, setLifeDomain] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
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

  const completeMutation = useMutation({
    mutationFn: completeAction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/actions"] }),
  });

  const filteredActions = actions.filter((action: any) => {
    if (lifeDomain !== "all" && (action.lifeDomain || "unknown") !== lifeDomain) return false;
    if (projectFilter !== "all" && (action.projectId || "__none__") !== projectFilter) return false;
    return true;
  });
  const filteredWaiting = waiting.filter((action: any) => {
    if (lifeDomain !== "all" && (action.lifeDomain || "unknown") !== lifeDomain) return false;
    if (projectFilter !== "all" && (action.projectId || "__none__") !== projectFilter) return false;
    return true;
  });
  const filteredProjects = projects.filter((project: any) => {
    if (lifeDomain !== "all" && (project.lifeDomain || "unknown") !== lifeDomain) return false;
    if (projectFilter !== "all" && project.id !== projectFilter) return false;
    return true;
  });

  // Group actions by context
  const byContext = filteredActions.reduce((acc: Record<string, GtdAction[]>, a: GtdAction) => {
    const ctx = contextToHashtag(a.context) ? formatHashtag(contextToHashtag(a.context)) : "other";
    if (!acc[ctx]) acc[ctx] = [];
    acc[ctx].push(a);
    return acc;
  }, {});
  const activeProjectCount = useMemo(() => projects.length, [projects]);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">GTD</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {filteredActions.length} next actions · {filteredProjects.length} active projects
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={lifeDomain} onValueChange={setLifeDomain} className="w-auto">
          <TabsList>
            {LIFE_DOMAIN_OPTIONS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-full text-sm md:w-[240px]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            <SelectItem value="__none__">No project</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Quick capture */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Quick Capture → Inbox</p>
          <QuickCapture />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Add Project</p>
          <QuickProject />
        </CardContent>
      </Card>

      <Tabs defaultValue="actions">
        <TabsList>
          <TabsTrigger value="actions">Next Actions ({filteredActions.length})</TabsTrigger>
          <TabsTrigger value="projects">Projects ({filteredProjects.length})</TabsTrigger>
          <TabsTrigger value="waiting">Waiting ({filteredWaiting.length})</TabsTrigger>
        </TabsList>

        {/* Actions tab */}
        <TabsContent value="actions" className="mt-4 space-y-4">
          {actionsLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)
          ) : filteredActions.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <Check size={20} className="mx-auto text-primary mb-2" />
                <p className="text-sm text-muted-foreground">All clear — no next actions</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(byContext).map(([ctx, ctxActions]) => (
              <Card key={ctx}>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {ctx} ({ctxActions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-2">
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
        </TabsContent>

        {/* Projects tab */}
        <TabsContent value="projects" className="mt-4">
          {projectsLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="space-y-2">
              {filteredProjects.map((p: any) => (
                <Card key={p.id} data-testid={`project-card-${p.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium">{p.title}</p>
                        {p.outcome && <p className="text-xs text-muted-foreground mt-0.5">→ {p.outcome}</p>}
                        <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded mt-1 mr-1 inline-block">
                          {formatLifeDomain(p.lifeDomain)}
                        </span>
                        {(p as any).ventures?.name && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded mt-1 inline-block">
                            {(p as any).ventures.name}
                          </span>
                        )}
                      </div>
                      {p.dueDate && (
                        <span className="text-[11px] text-muted-foreground tabular flex items-center gap-1 flex-shrink-0">
                          <Calendar size={10} />
                          {new Date(p.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Waiting tab */}
        <TabsContent value="waiting" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-1">
              {filteredWaiting.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nothing waiting</p>
              ) : (
                filteredWaiting.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                    <span className="text-sm flex-1">{a.title}</span>
                    <span className="text-[10px] text-muted-foreground">{formatLifeDomain(a.lifeDomain)}</span>
                    {a.delegatedTo && (
                      <span className="text-[10px] text-muted-foreground">→ {a.delegatedTo}</span>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
