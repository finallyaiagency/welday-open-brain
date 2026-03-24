import { useState, useEffect, useRef } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO, isToday, startOfWeek, endOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import type { GtdAction } from "@shared/schema";

export function CalendarView({ events, actions, onCompleteAction, onDeleteEvent }: { events: any[]; actions: GtdAction[]; onCompleteAction?: (id: string) => void, onDeleteEvent?: (id: string) => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const todayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (todayRef.current) {
      setTimeout(() => {
        todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [currentDate]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const dateFormat = "MMMM yyyy";
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToToday = () => setCurrentDate(new Date());

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold tracking-tight text-foreground/90 flex items-center gap-2">
            <CalendarIcon size={20} className="text-primary/70" />
            {format(currentDate, dateFormat)}
          </h2>
          <div className="flex items-center rounded-md border border-border bg-background shadow-sm overflow-hidden">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-r border-border hover:bg-muted" onClick={prevMonth}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-4 rounded-none text-xs font-semibold hover:bg-muted" onClick={goToToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-l border-border hover:bg-muted" onClick={nextMonth}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </div>

      <Card className="border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden shadow-sm">
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
          {weekDays.map(day => (
            <div key={day} className="py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-[minmax(130px,1fr)] bg-border/60 gap-px">
          {days.map((day, i) => {
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isTodayDay = isToday(day);
            const dayEvents = events.filter(e => e.start_at && isSameDay(parseISO(e.start_at), day));
            const dayActions = actions.filter(a => a.dueDate && isSameDay(parseISO(a.dueDate), day));

            return (
              <div 
                key={i} 
                ref={isTodayDay ? todayRef : null}
                className={`bg-card p-2 transition-colors hover:bg-primary/[0.02] flex flex-col gap-1.5 overflow-hidden ${isCurrentMonth ? "" : "opacity-40 bg-muted/10"} ${isTodayDay ? "ring-1 ring-inset ring-primary/20" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold w-7 h-7 flex items-center justify-center rounded-full transition-colors ${isTodayDay ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20 ring-offset-1 ring-offset-background" : "text-muted-foreground hover:bg-muted"}`}>
                    {format(day, "d")}
                  </span>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-1.5 mt-1 pr-1 custom-scrollbar">
                  {dayEvents.map(event => {
                    const isBusiness = event.life_domain === "business";
                    const hasTime = !event.all_day && event.start_at;
                    const time = hasTime ? formatInTimeZone(parseISO(event.start_at), "America/New_York", "h:mma").toLowerCase() : "";
                    
                    return (
                      <div key={event.id} className={`text-[10px] px-1.5 py-1 rounded truncate border flex items-center gap-1.5 cursor-default hover:opacity-80 transition-opacity group relative ${isBusiness ? "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400" : "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400"}`}>
                        {hasTime && <span className="font-semibold opacity-70 tabular-nums leading-none tracking-tight">{time}</span>}
                        <span className="truncate flex-1 leading-none pr-3">{event.title}</span>
                        {onDeleteEvent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteEvent(event.id);
                            }}
                            className="bg-background/80 hover:bg-destructive hover:text-destructive-foreground p-0.5 rounded absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={8} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  
                  {dayActions.map(action => (
                    <div 
                      key={action.id} 
                      className="text-[10px] px-1.5 py-1 rounded truncate bg-secondary/40 border border-border/50 text-foreground/80 flex items-center gap-1.5 cursor-pointer hover:bg-secondary/80 transition-colors group"
                      onClick={() => onCompleteAction && onCompleteAction(action.id)}
                      title="Click to complete"
                    >
                      <div className="w-1.5 h-1.5 rounded-sm bg-primary/40 flex-shrink-0 group-hover:bg-primary transition-colors" />
                      <span className="truncate flex-1 leading-none">{action.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 4px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
      `}</style>
    </motion.div>
  );
}
