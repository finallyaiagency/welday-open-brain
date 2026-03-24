import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReferences, fetchVentures } from "@/lib/supabaseQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Bookmark, ExternalLink, Folder, Tag, Filter, Grid, List as ListIcon, Plus, Copy, Check, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { GtdReference } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = ["howto", "contact", "credential", "research", "idea", "general"];
const AREAS = ["work", "personal", "health", "finance", "learning"];

export function ReferencePage() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [selectedVenture, setSelectedVenture] = useState<string>("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: references = [], isLoading: refsLoading } = useQuery({
    queryKey: ["/api/reference"],
    queryFn: fetchReferences,
  });

  const { data: ventures = [] } = useQuery({
    queryKey: ["/api/ventures"],
    queryFn: fetchVentures,
  });

  const filtered = useMemo(() => {
    return references.filter((r) => {
      const matchesSearch = 
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        (r.content || "").toLowerCase().includes(search.toLowerCase()) ||
        (r.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()));
      
      const matchesCategory = selectedCategory === "all" || r.category === selectedCategory;
      const matchesArea = selectedArea === "all" || r.area === selectedArea;
      const matchesVenture = selectedVenture === "all" || r.ventureId === selectedVenture;

      return matchesSearch && matchesCategory && matchesArea && matchesVenture;
    });
  }, [references, search, selectedCategory, selectedArea, selectedVenture]);

  const copyToClipboard = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({
      title: "Copied to clipboard",
      description: "Reference content has been copied.",
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Reference Browser</h1>
            <Badge variant="outline" className="text-purple-500 border-purple-500/30 uppercase tracking-widest text-[9px] px-2 font-bold">Knowledge Base</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Browse and search your saved links, notes, and reference materials.
          </p>
        </div>

        <div className="flex items-center gap-2">
           <div className="flex bg-muted/50 p-1 rounded-lg border border-border/50">
            <Button
              variant={layout === "grid" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLayout("grid")}
              className="h-8 w-8 p-0"
            >
              <Grid size={14} />
            </Button>
            <Button
              variant={layout === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLayout("list")}
              className="h-8 w-8 p-0"
            >
              <ListIcon size={14} />
            </Button>
          </div>
          <Button size="sm" className="h-9 gap-2 shadow-sm">
            <Plus size={16} /> Add Reference
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filters Sidebar */}
        <aside className="lg:col-span-1 space-y-6">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Filter size={12} /> Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-9 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Category</label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Categories</SelectItem>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Domain Area</label>
                <Select value={selectedArea} onValueChange={setSelectedArea}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="All Areas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Areas</SelectItem>
                    {AREAS.map(a => (
                      <SelectItem key={a} value={a} className="text-xs capitalize">{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Venture</label>
                <Select value={selectedVenture} onValueChange={setSelectedVenture}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="All Ventures" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Ventures</SelectItem>
                    {ventures.map(v => (
                      <SelectItem key={v.id} value={v.id} className="text-xs">{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(selectedCategory !== "all" || selectedArea !== "all" || selectedVenture !== "all" || search) && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="w-full text-[10px] h-8 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSelectedCategory("all");
                    setSelectedArea("all");
                    setSelectedVenture("all");
                    setSearch("");
                  }}
                >
                  Clear all filters
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="px-4">
             <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 px-1">Stats</h3>
             <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Total Items</span>
                  <span className="font-bold">{references.length}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Matching</span>
                  <span className="font-bold text-primary">{filtered.length}</span>
                </div>
             </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="lg:col-span-3">
          {refsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center space-y-4 bg-muted/20 rounded-xl border border-dashed">
              <div className="relative mx-auto w-16 h-16">
                <Bookmark size={48} className="text-muted-foreground/20 absolute inset-0" />
                <Search size={24} className="text-muted-foreground/40 absolute bottom-0 right-0" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No references found</p>
                <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or search query.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setSearch(""); setSelectedCategory("all"); setSelectedArea("all"); setSelectedVenture("all"); }}>
                Reset Filters
              </Button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {layout === "grid" ? (
                <motion.div 
                  key="grid"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-4"
                >
                  {filtered.map(item => (
                    <ReferenceCard 
                      key={item.id} 
                      item={item} 
                      onCopy={() => item.content && copyToClipboard(item.content, item.id)}
                      isCopied={copiedId === item.id}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-3"
                >
                   {filtered.map(item => (
                    <ReferenceListItem 
                      key={item.id} 
                      item={item} 
                      onCopy={() => item.content && copyToClipboard(item.content, item.id)}
                      isCopied={copiedId === item.id}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

function ReferenceCard({ item, onCopy, isCopied }: { item: GtdReference & { ventures?: { name: string } | null }; onCopy: () => void; isCopied: boolean }) {
  return (
    <Card className="group relative overflow-hidden transition-all hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 bg-card/60 backdrop-blur-sm">
      <div className="absolute top-0 left-0 w-1 h-full bg-primary/20 group-hover:bg-primary/50 transition-colors" />
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <h4 className="text-sm font-bold leading-tight group-hover:text-primary transition-colors line-clamp-2">
              {item.title}
            </h4>
            <div className="flex items-center gap-2">
               <Badge variant="outline" className="h-4 text-[8px] uppercase font-bold bg-muted/50 border-border/50 px-1.5">
                {item.category || "general"}
              </Badge>
              {item.area && (
                 <Badge variant="outline" className="h-4 text-[8px] uppercase font-bold bg-primary/5 text-primary border-primary/10 px-1.5">
                  {item.area}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-20 group-hover:opacity-100 transition-opacity">
            {item.content && (
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={onCopy} title="Copy content">
                {isCopied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </Button>
            )}
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-primary transition-colors">
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {item.content && (
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3 italic">
            {item.content}
          </p>
        )}
        <div className="flex flex-wrap gap-1 items-center">
          {item.ventures?.name && (
            <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium mr-2">
              <Folder size={10} className="text-blue-400" /> {item.ventures.name}
            </div>
          )}
          {item.tags?.map(tag => (
            <span key={tag} className="text-[9px] text-primary/70 flex items-center gap-0.5 bg-primary/5 px-1.5 py-0.5 rounded-full">
              <Tag size={8} className="opacity-50" /> {tag}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReferenceListItem({ item, onCopy, isCopied }: { item: GtdReference & { ventures?: { name: string } | null }; onCopy: () => void; isCopied: boolean }) {
  return (
    <div className="group flex items-center gap-4 p-3 rounded-lg border border-border/50 bg-card/40 hover:bg-card/80 hover:border-primary/30 transition-all">
       <div className={`p-2 rounded-md bg-muted/50 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors`}>
        <Bookmark size={16} />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{item.title}</h4>
          <Badge variant="outline" className="h-3.5 text-[7px] uppercase tracking-tighter bg-muted/50 px-1">{item.category || "general"}</Badge>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary/60 hover:underline flex items-center gap-1 truncate max-w-[200px]">
              <ExternalLink size={10} /> {item.url.replace(/^https?:\/\//, '')}
            </a>
          )}
          {item.ventures?.name && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Folder size={10} className="text-blue-400" /> {item.ventures.name}
            </span>
          )}
          <div className="flex gap-1">
            {item.tags?.slice(0, 3).map(tag => (
              <span key={tag} className="text-[9px] text-muted-foreground/60">#{tag}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {item.content && (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onCopy}>
            {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
