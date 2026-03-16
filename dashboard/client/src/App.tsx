import { useHashLocation } from "wouter/use-hash-location";
import { Router, Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";

// Pages
import { OverviewPage } from "@/pages/OverviewPage";
import { VenturesPage } from "@/pages/VenturesPage";
import { GTDPage } from "@/pages/GTDPage";
import { CEOPage } from "@/pages/CEOPage";
import { AssistantPage } from "@/pages/AssistantPage";
import { SearchPage } from "@/pages/SearchPage";
import { InboxPage } from "@/pages/InboxPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ModelsPage } from "@/pages/ModelsPage";
import NotFound from "@/pages/not-found";

function AppRoutes() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={OverviewPage} />
        <Route path="/ventures" component={VenturesPage} />
        <Route path="/assistant" component={AssistantPage} />
        <Route path="/ceo" component={CEOPage} />
        <Route path="/gtd" component={GTDPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/inbox" component={InboxPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/models" component={ModelsPage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
          <AuthGuard>
            <AppRoutes />
          </AuthGuard>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
