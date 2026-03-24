import { format, parseISO, isToday } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CalendarEventRow({ event, showDate = false, onDelete }: { event: any; showDate?: boolean; onDelete?: (id: string) => void }) {
  const isBusiness = event.life_domain === "business";
  const startAt = parseISO(event.start_at);
  const isTodayEv = isToday(startAt);
  
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0 opacity-90 group transition-all duration-300 relative pr-8">
      <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 shadow-sm transition-transform group-hover:scale-110 ${isBusiness ? "bg-blue-500" : "bg-green-500"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/90 font-medium leading-snug group-hover:text-primary transition-colors line-clamp-1">{event.title}</p>
        <div className="flex gap-2 mt-0.5 items-center">
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 whitespace-nowrap opacity-80">
            <Clock size={10} />
            {(showDate && !isTodayEv) && `${formatInTimeZone(startAt, "America/New_York", "MMM d")} • `}
            {formatInTimeZone(startAt, "America/New_York", "h:mm a")}
            {event.end_at && ` - ${formatInTimeZone(parseISO(event.end_at), "America/New_York", "h:mm a")}`}
          </span>
          {event.location && (
            <span className="text-[10px] text-muted-foreground truncate opacity-60 max-w-[120px]">
              @{event.location}
            </span>
          )}
        </div>
      </div>
      {onDelete && (
        <Button
          variant="ghost" 
          size="icon" 
          className="h-6 w-6 absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(event.id);
          }}
        >
          <Trash2 size={12} />
        </Button>
      )}
    </div>
  );
}
