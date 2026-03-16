import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/lib/supabase";
import {
  LayoutDashboard, Briefcase, CheckSquare, Brain,
  Search, Inbox, Settings, Sun, Moon, LogOut, Zap, Activity
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/",           label: "Overview",    icon: LayoutDashboard },
  { href: "/ventures",   label: "Ventures",    icon: Briefcase },
  { href: "/assistant",  label: "Assistant",   icon: Zap,   highlight: true },
  { href: "/ceo",        label: "Virtual CEO", icon: Brain },
  { href: "/gtd",        label: "GTD",         icon: CheckSquare },
  { href: "/inbox",      label: "Inbox",       icon: Inbox },
  { href: "/search",     label: "Search",      icon: Search },
  { href: "/settings",   label: "Settings",    icon: Settings },
  { href: "/models",     label: "Model Status", icon: Activity },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-border flex flex-col">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-border">
          <svg viewBox="0 0 32 32" width="24" height="24" aria-label="Open Brain">
            <circle cx="16" cy="16" r="14" fill="none" stroke="hsl(186 85% 52%)" strokeWidth="1.5"/>
            <circle cx="16" cy="16" r="6" fill="none" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.5"/>
            <circle cx="16" cy="16" r="2.5" fill="hsl(186 85% 52%)"/>
            <line x1="16" y1="2" x2="16" y2="8" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
            <line x1="16" y1="24" x2="16" y2="30" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
            <line x1="2" y1="16" x2="8" y2="16" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
            <line x1="24" y1="16" x2="30" y2="16" stroke="hsl(186 85% 52%)" strokeWidth="1.5" opacity="0.6"/>
          </svg>
          <div>
            <div className="text-sm font-semibold leading-none">Open Brain</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-none">Welday Enterprises</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon, highlight }) => {
            const active = location === href;
            return (
              <Link key={href} href={href}>
                <a
                  data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium mb-0.5 transition-colors relative ${
                    active
                      ? "bg-primary/15 text-primary"
                      : highlight
                      ? "text-primary/80 hover:text-primary hover:bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  <Icon size={15} />
                  {label}
                  {highlight && !active && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary opacity-70" />
                  )}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-3 py-3 flex items-center gap-2">
          <button
            onClick={toggle}
            title="Toggle theme"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            title="Sign out"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <LogOut size={14} />
          </button>
          <span className="ml-auto text-[10px] text-muted-foreground tabular">v1.1</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );
}
