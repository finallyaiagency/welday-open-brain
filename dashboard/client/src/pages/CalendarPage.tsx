import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchCalendarEvents, completeAction, fetchActions, deleteCalendarEvent } from "@/lib/supabaseQueries";
import { queryClient } from "@/lib/queryClient";
import { CalendarView } from "@/components/CalendarView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Clock, MapPin, ChevronRight, CheckCircle2 } from "lucide-react";
import { format, isToday, isTomorrow, parseISO, addDays, isSameDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarEventRow } from "@/components/CalendarEventRow";

export function CalendarPage() {
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["/api/calendar/events"],
    queryFn: fetchCalendarEvents,
    refetchInterval: 60_000,
  });

  const { data: actions = [] } = useQuery({
    queryKey: ["/api/actions", "active"],
    queryFn: () => fetchActions("active"),
  });

  const completeMutation = useMutation({
    mutationFn: completeAction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/actions"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCalendarEvent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] }),
  });

  const upcomingEvents = events
    .filter(e => new Date(e.start_at) >= new Date())
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 10);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto h-full flex flex-col">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarIcon className="text-primary" /> Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your schedule and time-blocked actions.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Left Column: Full Calendar */}
        <div className="lg:col-span-3 h-full overflow-hidden">
          <Card className="h-full flex flex-col">
            <CardContent className="p-4 flex-1 min-h-0 overflow-auto">
              <CalendarView 
                events={events} 
                actions={actions}
                onCompleteAction={(id) => completeMutation.mutate(id)}
                onDeleteEvent={(id) => {
                  if (confirm("Are you sure you want to delete this event?")) {
                    deleteMutation.mutate(id);
                  }
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Upcoming & Context */}
        <aside className="space-y-6 overflow-y-auto pr-1">
          <section className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Clock size={12} /> Upcoming Events
            </h2>
            <div className="space-y-3">
              {eventsLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
              ) : upcomingEvents.length === 0 ? (
                <Card className="bg-muted/20 border-border/50">
                  <CardContent className="p-4 text-center text-xs text-muted-foreground italic">
                    No upcoming events
                  </CardContent>
                </Card>
              ) : (
                upcomingEvents.map((event) => {
                  const startDate = parseISO(event.start_at);
                  const isTodayEv = isToday(startDate);
                  const isTomorrowEv = isTomorrow(startDate);
                  
                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                    >
                      <Card className={`hover:border-primary/20 transition-all ${isToday(parseISO(event.start_at)) ? "border-primary/20 bg-primary/5 shadow-sm" : ""}`}>
                        <CardContent className="p-3">
                          <CalendarEventRow 
                            event={event} 
                            showDate={true} 
                            onDelete={(id) => {
                              if (confirm("Are you sure you want to delete this event?")) {
                                deleteMutation.mutate(id);
                              }
                            }} 
                          />
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })
              )}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <CheckCircle2 size={12} /> Master Context
            </h2>
            <Card className="bg-secondary/20 border-border/40">
              <CardContent className="p-4 space-y-3">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Events represent <strong>hard landscape</strong>: things that MUST happen at a specific time. 
                  Actions are things to do <strong>as soon as possible</strong>.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span className="text-[10px] font-medium">Business Appointment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-[10px] font-medium">Personal Commitment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/40 border border-primary/60" />
                    <span className="text-[10px] font-medium">Time-Blocked Action</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
