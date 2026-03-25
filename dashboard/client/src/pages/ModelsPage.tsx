import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Zap, 
  Key, 
  Activity, 
  Clock, 
  RefreshCw,
  AlertCircle,
  CheckCircle2
} from "lucide-react";

type ModelStatus = {
  model: string;
  statuses: string[];
};

export function ModelsPage() {
  const { data, isLoading, refetch, isRefetching } = useQuery<{ results: ModelStatus[]; ts: string }>({
    queryKey: ["/api/test-models"],
    queryFn: async () => {
      const res = await fetch(`/api/test-models?t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to fetch model status");
      return res.json();
    },
    refetchInterval: 300_000, // Refresh every 5 mins
    staleTime: 0,
    gcTime: 0,
  });

  const lastUpdated = data?.ts 
    ? new Date(data.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) 
    : null;

  const replenishmentInfo = [
    { label: "Daily Reset", value: "12:00 AM PT", icon: Clock, desc: "Global quota resets daily" },
    { label: "Rolling Window", value: "60 seconds", icon: RefreshCw, desc: "Per-minute rate limits" },
    { label: "Keys Configured", value: "3 Active", icon: Key, desc: "Automatic failover enabled" },
  ];

  const getStatusColor = (status: string) => {
    if (status.includes("200")) return "text-green-500 bg-green-500/10 border-green-500/20";
    if (status.includes("429")) return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    if (status.includes("Cooldown")) return "text-indigo-500 bg-indigo-500/10 border-indigo-500/20";
    if (status.includes("Error") || status.includes("Err")) return "text-red-500 bg-red-500/10 border-red-500/20";
    return "text-muted-foreground bg-secondary border-transparent";
  };

  return (
    <div className="flex flex-col h-full bg-background p-6 space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Models Status</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-muted-foreground">Real-time health of your Gemini API keys.</p>
            {lastUpdated && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                Updated {lastUpdated}
              </span>
            )}
          </div>
        </div>
        <button 
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors text-sm font-medium"
        >
          <RefreshCw size={14} className={isRefetching ? "animate-spin" : ""} />
          {isRefetching ? "Checking..." : "Refresh Status"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {replenishmentInfo.map((item) => (
          <Card key={item.label} className="bg-card/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <item.icon size={18} className="text-primary" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className="text-lg font-bold">{item.value}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{item.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-primary" />
            <div>
              <CardTitle className="text-lg">Key Health Matrix</CardTitle>
              <CardDescription>Status code per model across your configured keys.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground font-medium uppercase text-[10px] tracking-widest border-b border-border">
                  <th className="text-left px-6 py-3">Model Name</th>
                  <th className="text-center px-4 py-3">Key 1</th>
                  <th className="text-center px-4 py-3">Key 2</th>
                  <th className="text-center px-4 py-3">Key 3</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-32" /></td>
                      {[0, 1, 2].map(j => <td key={j} className="px-4 py-4"><Skeleton className="h-6 w-16 mx-auto" /></td>)}
                    </tr>
                  ))
                ) : (
                  data?.results.map((row) => (
                    <tr key={row.model} className="hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4 font-medium flex items-center gap-2">
                        <Zap size={14} className="text-primary/70" />
                        {row.model}
                      </td>
                      {row.statuses.map((status, idx) => (
                        <td key={idx} className="px-4 py-4 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${getStatusColor(status)}`}>
                            {status.split(": ")[1]}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-500" />
              Status Interpretation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Badge variant="outline" className="h-6 border-green-500/20 bg-green-500/10 text-green-500 font-bold">200</Badge>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong>Healthy.</strong> Model is responding normally. No immediate action required.
              </p>
            </div>
            <div className="flex gap-3">
              <Badge variant="outline" className="h-6 border-amber-500/20 bg-amber-500/10 text-amber-500 font-bold">429</Badge>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong>Exhausted.</strong> Daily or per-minute quota reached.
              </p>
            </div>
            <div className="flex gap-3">
              <Badge variant="outline" className="h-6 border-indigo-500/20 bg-indigo-500/10 text-indigo-500 font-bold">Cooldown</Badge>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong>Sidelined.</strong> To avoid lockouts, this key is resting for 3 hours before being tried again.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border border-dashed bg-muted/30">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
              <AlertCircle size={16} />
              About Multi-Key Failover
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground leading-relaxed italic">
              "Welday-Open-Brain uses a cascading failover system. When Key 1 hits a 429 error, it instantly retires for the current session and tries Key 2, followed by Key 3. This triples your daily interactive capacity without requiring manual intervention."
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
