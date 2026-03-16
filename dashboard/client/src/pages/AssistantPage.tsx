import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Send, Zap, Calendar, Inbox, Clock, RefreshCw, Key
} from "lucide-react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: Date;
  model?: string;
  keyIndex?: number | string;
};

function useContextStrip() {
  return useQuery({
    queryKey: ["/api/ea/context"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const in3 = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];

      const [overdue, todayDue, soon, inbox] = await Promise.all([
        supabase.from("gtd_actions").select("*", { head: true, count: "exact" }).eq("status", "active").lt("due_date", today),
        supabase.from("gtd_actions").select("*", { head: true, count: "exact" }).eq("status", "active").eq("due_date", today),
        supabase.from("gtd_actions").select("*", { head: true, count: "exact" }).eq("status", "active").gt("due_date", today).lte("due_date", in3),
        supabase.from("gtd_inbox").select("*", { head: true, count: "exact" }).eq("processed", false),
      ]);

      return {
        overdue: overdue.count || 0,
        today: todayDue.count || 0,
        soon: soon.count || 0,
        inbox: inbox.count || 0,
      };
    },
    refetchInterval: 60_000,
  });
}

function ContextStrip() {
  const { data, isLoading } = useContextStrip();

  if (isLoading) {
    return <div className="flex gap-2"><Skeleton className="h-6 w-20" /><Skeleton className="h-6 w-20" /></div>;
  }

  const pills = [
    { icon: Clock, label: `${data?.overdue || 0} overdue`, color: data?.overdue ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-muted-foreground bg-secondary border-transparent" },
    { icon: Calendar, label: `${data?.today || 0} today`, color: data?.today ? "text-amber-400 bg-amber-500/10 border-amber-500/20" : "text-muted-foreground bg-secondary border-transparent" },
    { icon: Zap, label: `${data?.soon || 0} soon`, color: "text-muted-foreground bg-secondary border-transparent" },
    { icon: Inbox, label: `${data?.inbox || 0} inbox`, color: data?.inbox ? "text-blue-400 bg-blue-500/10 border-blue-500/20" : "text-muted-foreground bg-secondary border-transparent" },
  ];

  return (
    <div className="flex gap-1.5 flex-wrap">
      {pills.map(({ icon: Icon, label, color }) => (
        <span key={label} className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${color}`}>
          <Icon size={9} />{label}
        </span>
      ))}
    </div>
  );
}

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const lines = msg.content.split("\n");

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
          <Zap size={11} className="text-primary" />
        </div>
      )}
      <div className={`max-w-[78%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : "bg-card border border-border rounded-bl-sm"
      }`}>
        {lines.map((line, i) => (
          <span key={i}>{line}{i < lines.length - 1 && <br />}</span>
        ))}
        <div className={`text-[10px] mt-1 flex justify-between items-center ${isUser ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
          <span>{msg.ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
          {!isUser && msg.model && (
            <span className="flex items-center gap-1.5 ml-3 opacity-80 bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10">
              <span className="font-medium text-[9px] uppercase tracking-wider">{msg.model.replace("gemini-", "G-")}</span>
              <span className="w-px h-2 bg-border" />
              <span className="font-semibold">{typeof msg.keyIndex === "string" ? msg.keyIndex : `Key ${msg.keyIndex}`}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "What's the one thing I should do right now?",
  "Give me my briefing for today",
  "What's overdue?",
  "What am I waiting on from others?",
  "I have 30 minutes - what's worth doing?",
  "Any urgent alerts I should know about?",
];

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: "Ready, sir. Ask me what to focus on, what's due, or just say 'briefing' for a daily rundown.",
  ts: new Date(),
};

export function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [retryMessage, setRetryMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const userText = (text || input).trim();
    if (!userText || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      ts: new Date(),
    };

    setRetryMessage(userText);
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const persona = "moneypenny";
    const history = messages
      .filter(m => m.id !== "welcome")
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/ea/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          history,
          persona,
          openRouterKey: openRouterKey.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok && res.status === 429) {
        setShowKeyInput(true);
      } else {
        setShowKeyInput(false);
      }

      const reply = data.reply || data.error || "Sorry, something went wrong.";

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        ts: new Date(),
        model: data.model,
        keyIndex: data.keyIndex,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Connection error - check your Supabase and Gemini environment variables.",
        ts: new Date(),
      }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearChat() {
    setMessages([{ ...WELCOME_MESSAGE, ts: new Date() }]);
    setRetryMessage("");
    setShowKeyInput(false);
  }

  const isFirstMessage = messages.length === 1;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center pulse-glow">
              <Zap size={13} className="text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none">Executive Assistant</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">Tactical · Today & This Week</p>
            </div>
          </div>
          <button
            onClick={clearChat}
            title="Clear conversation"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <ContextStrip />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {messages.map(msg => (
          <Bubble key={msg.id} msg={msg} />
        ))}

        {loading && (
          <div className="flex justify-start mb-3">
            <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
              <Zap size={11} className="text-primary" />
            </div>
            <div className="bg-card border border-border rounded-xl rounded-bl-sm px-3.5 py-2.5">
              <div className="flex gap-1 items-center h-4">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        {isFirstMessage && !loading && (
          <div className="mt-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-medium">Try asking</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  data-testid={`suggestion-${s.substring(0, 20).replace(/\s+/g, "-")}`}
                  onClick={() => send(s)}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 px-5 py-3 border-t border-border">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              data-testid="input-ea-chat"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything... Enter to send, Shift+Enter for new line"
              rows={1}
              className="resize-none text-sm pr-2 min-h-[40px] max-h-[120px] overflow-y-auto"
              style={{ height: "auto" }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
              disabled={loading}
            />
          </div>
          <Button
            data-testid="button-ea-send"
            onClick={() => send()}
            disabled={!input.trim() || loading}
            size="sm"
            className="h-10 w-10 p-0 flex-shrink-0"
          >
            <Send size={14} />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Also available in Telegram - message <strong>@Moneypenny_Welday_Ent_bot</strong> any time
        </p>

        {showKeyInput && (
          <div className="mt-4 p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-2">
              <Key size={14} className="text-indigo-500" />
              <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">All free models exhausted</p>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
              Gemini free quotas are depleted across all keys. Paste an <strong>OpenRouter API key</strong> below to continue via the paid fallback.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={openRouterKey}
                onChange={e => setOpenRouterKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="flex-1 bg-card border border-indigo-500/20 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500/40 outline-none"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-indigo-500/30 text-indigo-500 hover:bg-indigo-500/10"
                onClick={() => {
                  setShowKeyInput(false);
                  send(retryMessage);
                }}
                disabled={!retryMessage.trim() || loading}
              >
                Retry
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
