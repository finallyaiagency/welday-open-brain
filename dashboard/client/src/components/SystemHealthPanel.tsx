import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Database, Server, Clock, CheckCircle2, AlertCircle, Play } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

export function SystemHealthPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/system/health"],
    queryFn: async () => {
      const response = await fetch("/api/system/health");
      if (!response.ok) throw new Error("Failed to fetch system health");
      return response.json();
    },
    refetchInterval: 10_000,
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return (
    <Card className="border-destructive/20 bg-destructive/5">
      <CardContent className="p-6 text-center space-y-2">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="text-sm font-medium">Error loading system health</p>
        <p className="text-xs text-muted-foreground">{(error as Error).message}</p>
      </CardContent>
    </Card>
  );

  const { pulse, modules, memoryDepth, serverTime } = data;

  const pulseTime = pulse?.last_pulse_at ? parseISO(pulse.last_pulse_at) : null;
  const isPulseHealthy = pulseTime && (Date.now() - pulseTime.getTime() < 120_000);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pulse Card */}
        <Card className={isPulseHealthy ? "border-green-500/20 bg-green-500/5" : "border-amber-500/20 bg-amber-500/5"}>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Activity size={12} className={isPulseHealthy ? "animate-pulse text-green-500" : "text-amber-500"} /> 
              Pulse Status
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{isPulseHealthy ? "Healthy" : "Delayed"}</p>
                <p className="text-[10px] text-muted-foreground">
                  Last: {pulseTime ? formatDistanceToNow(pulseTime, { addSuffix: true }) : "Never"}
                </p>
              </div>
              <Badge variant={isPulseHealthy ? "default" : "destructive"}>
                {isPulseHealthy ? "ONLINE" : "OFFLINE"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Server Status */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Server size={12} /> Server Time
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <p className="text-xl font-mono leading-none">{new Date(serverTime).toLocaleTimeString()}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{new Date(serverTime).toDateString()}</p>
          </CardContent>
        </Card>

        {/* Memory Depth */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Database size={12} /> Memory Depth
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <p className="text-2xl font-bold">{memoryDepth || 0}</p>
            <p className="text-[10px] text-muted-foreground">Total bot sessions in Open Brain</p>
          </CardContent>
        </Card>
      </div>

      {/* Module Registry */}
      <Card>
        <CardHeader className="p-4 border-b border-border/40">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Clock size={16} className="text-primary" /> Module Registry
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Module Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Cron</th>
                  <th className="px-4 py-3">Last Run</th>
                  <th className="px-4 py-3">Next Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {modules && modules.length > 0 ? modules.map((m: any) => (
                  <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium flex items-center gap-2 text-xs">
                      {m.module_name}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={m.status === 'active' ? 'outline' : 'secondary'} className="text-[9px] h-4">
                        {m.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">
                      {m.cron_expression || "-"}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-muted-foreground">
                      {m.last_run_at ? formatDistanceToNow(parseISO(m.last_run_at), { addSuffix: true }) : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <Play size={10} className="text-green-500" />
                        {m.next_run_at ? formatDistanceToNow(parseISO(m.next_run_at), { addSuffix: true }) : "Not scheduled"}
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground italic text-xs">
                      No active modules found in the registry.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
