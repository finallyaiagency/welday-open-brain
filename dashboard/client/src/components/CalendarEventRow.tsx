import { format, parseISO, isToday } from "date-fns";
import { Clock } from "lucide-react";

export function CalendarEventRow({ event, showDate = false }: { event: any; showDate?: boolean }) {
  const isBusiness = event.life_domain === "business";
  const startAt = parseISO(event.start_at);
  const isTodayEv = isToday(startAt);
  
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0 opacity-90 group transition-all duration-300">
      <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 shadow-sm transition-transform group-hover:scale-110 ${isBusiness ? "bg-blue-500" : "bg-green-500"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/90 font-medium leading-snug group-hover:text-primary transition-colors line-clamp-1">{event.title}</p>
        <div className="flex gap-2 mt-0.5 items-center">
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 whitespace-nowrap opacity-80">
            <Clock size={10} />
            {(showDate && !isTodayEv) && `${format(startAt, "MMM d")} • `}
            {format(startAt, "h:mm a")}
            {event.end_at && ` - ${format(parseISO(event.end_at), "h:mm a")}`}
          </span>
          {event.location && (
            <span className="text-[10px] text-muted-foreground truncate opacity-60 max-w-[120px]">
              @{event.location}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
