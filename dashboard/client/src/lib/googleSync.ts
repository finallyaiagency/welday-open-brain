import { queryClient } from "@/lib/queryClient";
import { clearCachedGoogleProviderToken, getCachedGoogleProviderToken, getSession, supabase } from "@/lib/supabase";

const GOOGLE_SYNC_AGENT = "google_sync";
const DEFAULT_CALENDAR_ID = "primary";
const DEFAULT_TASK_LIST_ID = "@default";
const LOCAL_CHANGE_GRACE_MS = 2_000;
const GOOGLE_WRITABLE_ROLES = new Set(["owner", "writer"]);

type GoogleCalendarListEntry = {
  id: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
};

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  recurrence?: string[];
};

type GoogleTaskList = {
  id: string;
  title?: string;
};

type GoogleTask = {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: "needsAction" | "completed";
  completed?: string;
  deleted?: boolean;
};

type LocalCalendarEvent = {
  id: string;
  google_event_id: string | null;
  google_calendar_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  location: string | null;
  event_type: string | null;
  status: string | null;
  recurrence_rule: string | null;
  source: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
};

type LocalAction = {
  id: string;
  title: string;
  context: string | null;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  google_task_id: string | null;
  google_task_list_id: string | null;
  notes: string | null;
  source: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
};

export type GoogleSyncSummary = {
  syncedAt: string;
  calendarsSeen: number;
  taskListsSeen: number;
  eventsImported: number;
  eventsExported: number;
  eventUpdatesPushed: number;
  tasksImported: number;
  tasksExported: number;
  taskUpdatesPushed: number;
};

let activeSync: Promise<GoogleSyncSummary> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function getDateOnlyIso(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  if (value.includes("T")) return value;
  return `${value}T00:00:00.000Z`;
}

function addUtcDays(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hasLocalChanges(updatedAt: string | null, lastSyncedAt: string | null) {
  if (!updatedAt || !lastSyncedAt) return false;
  return new Date(updatedAt).getTime() - new Date(lastSyncedAt).getTime() > LOCAL_CHANGE_GRACE_MS;
}

async function getGoogleProviderToken() {
  const session = await getSession();
  return session?.provider_token || getCachedGoogleProviderToken() || null;
}

async function googleFetch<T>(url: string, providerToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearCachedGoogleProviderToken();
    }
    const text = await response.text();
    throw new Error(text || `Google API error (${response.status})`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

async function googleListAll<T>(buildUrl: (pageToken?: string) => string, providerToken: string) {
  const items: T[] = [];
  let pageToken: string | undefined;

  do {
    const data = await googleFetch<{ items?: T[]; nextPageToken?: string }>(buildUrl(pageToken), providerToken);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return items;
}

function buildGoogleCalendarEventPayload(event: Pick<LocalCalendarEvent, "title" | "description" | "location" | "status" | "start_at" | "end_at" | "all_day" | "recurrence_rule">) {
  const startDate = event.start_at.slice(0, 10);
  const rawEndDate = event.end_at ? event.end_at.slice(0, 10) : null;
  const endDate = !rawEndDate || rawEndDate <= startDate ? addUtcDays(startDate, 1) : rawEndDate;

  return {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    status: event.status === "cancelled" ? "cancelled" : undefined,
    start: event.all_day
      ? { date: startDate }
      : { dateTime: event.start_at },
    end: event.all_day
      ? { date: endDate }
      : { dateTime: event.end_at || event.start_at },
    recurrence: event.recurrence_rule ? [event.recurrence_rule] : undefined,
  };
}

function buildGoogleTaskPayload(action: Pick<LocalAction, "title" | "notes" | "due_date" | "status" | "completed_at">) {
  return {
    title: action.title,
    notes: action.notes || undefined,
    due: action.due_date ? `${action.due_date}T00:00:00.000Z` : undefined,
    status: action.status === "completed" ? "completed" : "needsAction",
    completed: action.status === "completed" ? (action.completed_at || nowIso()) : undefined,
  };
}

function invalidateGoogleQueries() {
  queryClient.invalidateQueries({ queryKey: ["/api/actions"] });
  queryClient.invalidateQueries({ queryKey: ["/api/portfolio/stats"] });
  queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
}

async function logGoogleSync(summary: string, success: boolean, errorMessage?: string) {
  try {
    await supabase.from("agent_logs").insert({
      agent_name: GOOGLE_SYNC_AGENT,
      action: success ? "sync" : "sync_failed",
      input_summary: "google_calendar_and_tasks",
      output_summary: summary,
      success,
      error_message: errorMessage,
      model_used: "google_calendar+google_tasks",
    });
  } catch {
    // Ignore logging failures during sync.
  }
}

async function syncCalendarEvents(providerToken: string, syncedAt: string) {
  const [{ data: localRows, error: localError }, calendars] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("id, google_event_id, google_calendar_id, title, description, start_at, end_at, all_day, location, event_type, status, recurrence_rule, source, updated_at, last_synced_at"),
    googleListAll<GoogleCalendarListEntry>((pageToken) => {
      const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
      url.searchParams.set("showHidden", "false");
      url.searchParams.set("minAccessRole", "reader");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return url.toString();
    }, providerToken),
  ]);

  if (localError) throw localError;

  const localEvents = ((localRows as LocalCalendarEvent[] | null) || []);
  const existingByGoogleId = new Map(localEvents.filter((event) => event.google_event_id).map((event) => [event.google_event_id as string, event]));
  const pendingGoogleIds = new Set(
    localEvents
      .filter((event) => event.google_event_id && hasLocalChanges(event.updated_at, event.last_synced_at))
      .map((event) => event.google_event_id as string),
  );
  const readableCalendars = calendars.filter((calendar) => calendar.id && calendar.accessRole && calendar.selected !== false);
  const writableCalendarIds = new Set(
    readableCalendars
      .filter((calendar) => GOOGLE_WRITABLE_ROLES.has(calendar.accessRole || ""))
      .map((calendar) => calendar.id),
  );
  const defaultCalendarId = readableCalendars.find((calendar) => calendar.primary && GOOGLE_WRITABLE_ROLES.has(calendar.accessRole || ""))?.id || DEFAULT_CALENDAR_ID;
  let eventsImported = 0;
  let eventsExported = 0;
  let eventUpdatesPushed = 0;
  const syncWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const syncWindowEnd = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  for (const calendar of readableCalendars) {
    const remoteEvents = await googleListAll<GoogleCalendarEvent>((pageToken) => {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`);
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("timeMin", syncWindowStart);
      url.searchParams.set("timeMax", syncWindowEnd);
      url.searchParams.set("maxResults", "2500");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return url.toString();
    }, providerToken);

    const upserts = remoteEvents
      .filter((event) => event.id && !pendingGoogleIds.has(event.id))
      .map((event) => {
        const existing = existingByGoogleId.get(event.id);
        return {
          google_event_id: event.id,
          google_calendar_id: calendar.id,
          title: event.summary || existing?.title || "Untitled event",
          description: event.description || null,
          start_at: event.start?.dateTime || getDateOnlyIso(event.start?.date, existing?.start_at || syncedAt),
          end_at: event.end?.dateTime || (event.end?.date ? getDateOnlyIso(event.end.date, syncedAt) : null),
          all_day: !!event.start?.date && !event.start?.dateTime,
          location: event.location || null,
          event_type: existing?.event_type || "personal",
          status: event.status || existing?.status || "confirmed",
          recurrence_rule: event.recurrence?.[0] || null,
          source: existing?.source || "google",
          last_synced_at: syncedAt,
        };
      });

    if (upserts.length) {
      const { error } = await supabase.from("calendar_events").upsert(upserts, { onConflict: "google_event_id" });
      if (error) throw error;
      eventsImported += upserts.length;
    }
  }

  const localNewEvents = localEvents.filter((event) => !event.google_event_id && event.source !== "google" && event.status !== "cancelled");
  for (const event of localNewEvents) {
    const calendarId = event.google_calendar_id && writableCalendarIds.has(event.google_calendar_id)
      ? event.google_calendar_id
      : defaultCalendarId;
    const created = await googleFetch<GoogleCalendarEvent>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      providerToken,
      {
        method: "POST",
        body: JSON.stringify(buildGoogleCalendarEventPayload(event)),
      },
    );

    const { error } = await supabase
      .from("calendar_events")
      .update({
        google_event_id: created.id,
        google_calendar_id: calendarId,
        last_synced_at: syncedAt,
      })
      .eq("id", event.id);

    if (error) throw error;
    eventsExported += 1;
  }

  const localChangedEvents = localEvents.filter(
    (event) =>
      event.google_event_id
      && hasLocalChanges(event.updated_at, event.last_synced_at)
      && writableCalendarIds.has(event.google_calendar_id || defaultCalendarId),
  );

  for (const event of localChangedEvents) {
    await googleFetch<GoogleCalendarEvent>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.google_calendar_id || defaultCalendarId)}/events/${encodeURIComponent(event.google_event_id as string)}`,
      providerToken,
      {
        method: "PATCH",
        body: JSON.stringify(buildGoogleCalendarEventPayload(event)),
      },
    );

    const { error } = await supabase
      .from("calendar_events")
      .update({ last_synced_at: syncedAt })
      .eq("id", event.id);

    if (error) throw error;
    eventUpdatesPushed += 1;
  }

  return {
    calendarsSeen: readableCalendars.length,
    eventsImported,
    eventsExported,
    eventUpdatesPushed,
  };
}

async function syncTasks(providerToken: string, syncedAt: string) {
  const [{ data: localRows, error: localError }, taskLists] = await Promise.all([
    supabase
      .from("gtd_actions")
      .select("id, title, context, status, due_date, completed_at, google_task_id, google_task_list_id, notes, source, updated_at, last_synced_at"),
    googleListAll<GoogleTaskList>((pageToken) => {
      const url = new URL("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return url.toString();
    }, providerToken),
  ]);

  if (localError) throw localError;

  const localActions = ((localRows as LocalAction[] | null) || []);
  const existingByGoogleId = new Map(localActions.filter((action) => action.google_task_id).map((action) => [action.google_task_id as string, action]));
  const pendingGoogleIds = new Set(
    localActions
      .filter((action) => action.google_task_id && hasLocalChanges(action.updated_at, action.last_synced_at))
      .map((action) => action.google_task_id as string),
  );
  const availableTaskLists = taskLists.length ? taskLists : [{ id: DEFAULT_TASK_LIST_ID, title: "My Tasks" }];
  const defaultTaskListId = DEFAULT_TASK_LIST_ID;
  let tasksImported = 0;
  let tasksExported = 0;
  let taskUpdatesPushed = 0;

  for (const taskList of availableTaskLists) {
    const remoteTasks = await googleListAll<GoogleTask>((pageToken) => {
      const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskList.id)}/tasks`);
      url.searchParams.set("showCompleted", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("showHidden", "true");
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return url.toString();
    }, providerToken);

    for (const task of remoteTasks) {
      if (!task.id || pendingGoogleIds.has(task.id)) continue;

      const existing = existingByGoogleId.get(task.id);
      const patch = {
        title: task.title || existing?.title || "Untitled task",
        notes: task.notes || null,
        due_date: task.due ? task.due.slice(0, 10) : null,
        completed_at: task.status === "completed" ? (task.completed || syncedAt) : null,
        status: task.deleted ? "cancelled" : task.status === "completed" ? "completed" : "active",
        google_task_id: task.id,
        google_task_list_id: taskList.id,
        source: existing?.source || "google",
        last_synced_at: syncedAt,
      };

      if (existing) {
        const { error } = await supabase.from("gtd_actions").update(patch).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("gtd_actions").insert({
          ...patch,
          context: null,
          life_domain: "unknown",
        });
        if (error) throw error;
      }

      tasksImported += 1;
    }
  }

  const localNewActions = localActions.filter((action) => !action.google_task_id && action.source !== "google" && action.status !== "cancelled");
  for (const action of localNewActions) {
    const created = await googleFetch<GoogleTask>(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(action.google_task_list_id || defaultTaskListId)}/tasks`,
      providerToken,
      {
        method: "POST",
        body: JSON.stringify(buildGoogleTaskPayload(action)),
      },
    );

    const { error } = await supabase
      .from("gtd_actions")
      .update({
        google_task_id: created.id,
        google_task_list_id: action.google_task_list_id || defaultTaskListId,
        last_synced_at: syncedAt,
      })
      .eq("id", action.id);

    if (error) throw error;
    tasksExported += 1;
  }

  const localChangedActions = localActions.filter(
    (action) => action.google_task_id && hasLocalChanges(action.updated_at, action.last_synced_at),
  );

  for (const action of localChangedActions) {
    const taskListId = action.google_task_list_id || defaultTaskListId;

    if (action.status === "cancelled") {
      await googleFetch<null>(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(action.google_task_id as string)}`,
        providerToken,
        { method: "DELETE" },
      );
    } else {
      await googleFetch<GoogleTask>(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(action.google_task_id as string)}`,
        providerToken,
        {
          method: "PATCH",
          body: JSON.stringify(buildGoogleTaskPayload(action)),
        },
      );
    }

    const { error } = await supabase
      .from("gtd_actions")
      .update({ last_synced_at: syncedAt })
      .eq("id", action.id);

    if (error) throw error;
    taskUpdatesPushed += 1;
  }

  return {
    taskListsSeen: availableTaskLists.length,
    tasksImported,
    tasksExported,
    taskUpdatesPushed,
  };
}

export async function syncGoogleWorkspace() {
  if (activeSync) return activeSync;

  activeSync = (async () => {
    const providerToken = await getGoogleProviderToken();
    if (!providerToken) {
      throw new Error("Google Calendar and Tasks are not connected. Reconnect Google from Settings.");
    }

    const syncedAt = nowIso();

    try {
      const [calendarSummary, taskSummary] = await Promise.all([
        syncCalendarEvents(providerToken, syncedAt),
        syncTasks(providerToken, syncedAt),
      ]);

      const summary: GoogleSyncSummary = {
        syncedAt,
        ...calendarSummary,
        ...taskSummary,
      };

      invalidateGoogleQueries();

      await logGoogleSync(
        [
          `${summary.eventsImported} events imported`,
          `${summary.eventsExported} events exported`,
          `${summary.eventUpdatesPushed} event updates pushed`,
          `${summary.tasksImported} tasks imported`,
          `${summary.tasksExported} tasks exported`,
          `${summary.taskUpdatesPushed} task updates pushed`,
        ].join(" | "),
        true,
      );

      return summary;
    } catch (error: any) {
      await logGoogleSync("Google Calendar/Tasks sync failed.", false, error?.message || "Unknown error");
      throw error;
    }
  })();

  try {
    return await activeSync;
  } finally {
    activeSync = null;
  }
}

export async function hasGoogleWorkspaceConnection() {
  const providerToken = await getGoogleProviderToken();
  if (!providerToken) return false;

  try {
    await googleFetch<{ items?: GoogleCalendarListEntry[] }>(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1&showHidden=false",
      providerToken,
    );
    return true;
  } catch {
    return false;
  }
}
