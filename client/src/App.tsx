import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState, useRef } from "react";
import { useStore } from "@/hooks/use-store";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import EmployeeList from "@/pages/EmployeeList";
import RoleGridPage from "@/pages/RoleGrid";
import Settings from "@/pages/Settings";
import DaysOff from "@/pages/DaysOff";
import Login from "@/pages/login";
import PricingTool from "@/pages/PricingTool";
import PricingAdmin from "@/pages/PricingAdmin";
import Hiring from "@/pages/Hiring";
import TimeTracker from "@/pages/TimeTracker";
import Proposals from "@/pages/Proposals";
import SlideMethodologyAdmin from "@/pages/SlideMethodologyAdmin";
import Invoicing from "@/pages/Invoicing";
import ClientLedger from "@/pages/ClientLedger";
import AppAdmin from "@/pages/AppAdmin";
import KnowledgeCenter from "@/pages/KnowledgeCenter";
import { LayoutDashboard, Users, Grid3X3, Settings as SettingsIcon, LogOut, CalendarDays, DollarSign, ChevronDown, Briefcase, UserCheck, Timer, FileText, Layers, Pause, Play, Receipt, Shield, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

function NavDropdown({ label, icon: Icon, items, basePaths }: {
  label: string;
  icon: React.ElementType;
  items: { href: string; label: string; icon: React.ElementType }[];
  basePaths: string[];
}) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = basePaths.some(p => location === p || location.startsWith(p + "/"));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-accent ${
          isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground"
        }`}
      >
        <Icon className="w-4 h-4" />
        {label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-background border rounded-lg shadow-lg z-50 py-1">
          {items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors ${
                location === item.href ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Global API activity tracking via window events
let apiCallCount = 0;
export function signalApiStart() { apiCallCount++; window.dispatchEvent(new Event("api-activity")); }
export function signalApiEnd() { apiCallCount = Math.max(0, apiCallCount - 1); window.dispatchEvent(new Event("api-activity")); }
export function isApiActive() { return apiCallCount > 0; }

function Navigation() {
  const [apiPaused, setApiPaused] = useState<boolean>(true);
  const [apiActive, setApiActive] = useState(false);
  const [apiCost, setApiCost] = useState<{ month: string; today: string } | null>(null);
  const [location] = useLocation();

  // Listen for API activity events
  useEffect(() => {
    const handler = () => setApiActive(isApiActive());
    window.addEventListener("api-activity", handler);
    return () => window.removeEventListener("api-activity", handler);
  }, []);

  // On every page load: FORCE pause in DB, then read state
  // This ensures the API is ALWAYS paused when the page loads
  useEffect(() => {
    fetch("/api/api-pause", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true }),
    })
      .then(() => setApiPaused(true))
      .catch(() => setApiPaused(true));
    // Load API cost
    fetch("/api/api-cost", { credentials: "include" })
      .then(r => r.json())
      .then(d => setApiCost({ month: d.month_cost_usd ?? "0", today: d.today_cost_usd ?? "0" }))
      .catch(() => {});
  }, []);

  // Also auto-pause on every navigation
  const prevLocation = useRef(location);
  useEffect(() => {
    if (prevLocation.current !== location) {
      prevLocation.current = location;
      fetch("/api/api-pause", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: true }),
      }).then(() => setApiPaused(true)).catch(() => {});
    }
  }, [location]);

  const toggleApiPause = async () => {
    const newState = !apiPaused;
    // Resuming (going from paused → active) requires a password
    let password: string | undefined;
    if (newState === false) {
      const entered = window.prompt("Enter password to activate the API:");
      if (!entered) return; // cancelled
      password = entered;
    }
    const res = await fetch("/api/api-pause", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: newState, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Failed to update API state" }));
      alert(err.message || "Failed to update API state");
      return;
    }
    setApiPaused(newState);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.reload();
  };

  return (
    <nav className="border-b bg-background sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold tracking-tight text-primary">
              EENDIGO OP MODEL <span className="text-[10px] font-normal text-muted-foreground ml-1">v24Mar</span>
            </h1>
            <div className="flex items-center gap-1">
              <NavDropdown
                label="HR"
                icon={Briefcase}
                basePaths={["/", "/employees", "/roles", "/days-off", "/settings", "/time-tracker"]}
                items={[
                  { href: "/", label: "Dashboard", icon: LayoutDashboard },
                  { href: "/employees", label: "Employees", icon: Users },
                  { href: "/roles", label: "Role Grid", icon: Grid3X3 },
                  { href: "/days-off", label: "Days Off", icon: CalendarDays },
                  { href: "/time-tracker", label: "Time Tracker", icon: Timer },
                  { href: "/settings", label: "Settings", icon: SettingsIcon },
                ]}
              />
              <NavDropdown
                label="Pricing"
                icon={DollarSign}
                basePaths={["/pricing"]}
                items={[
                  { href: "/pricing", label: "Pricing Cases", icon: DollarSign },
                  { href: "/pricing/admin", label: "Pricing Admin", icon: SettingsIcon },
                ]}
              />
              <NavDropdown
                label="Proposals"
                icon={FileText}
                basePaths={["/proposals", "/knowledge"]}
                items={[
                  { href: "/proposals", label: "Proposals", icon: FileText },
                  { href: "/knowledge", label: "Knowledge Center", icon: BookOpen },
                  { href: "/proposals/methodology", label: "Slide Methodology", icon: Layers },
                ]}
              />
              <NavDropdown
                label="Hiring"
                icon={UserCheck}
                basePaths={["/hiring"]}
                items={[
                  { href: "/hiring", label: "Pipeline", icon: UserCheck },
                ]}
              />
              <NavDropdown
                label="AR"
                icon={Receipt}
                basePaths={["/invoicing", "/clients"]}
                items={[
                  { href: "/invoicing", label: "Invoicing", icon: Receipt },
                  { href: "/clients", label: "Client Ledger", icon: Users },
                ]}
              />
              <NavDropdown
                label="Admin"
                icon={Shield}
                basePaths={["/admin"]}
                items={[
                  { href: "/admin", label: "Cybersecurity", icon: Shield },
                ]}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Live API activity indicator + cost */}
            <div className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full transition-all ${
                apiActive ? "bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"
                : !apiPaused ? "bg-green-400"
                : "bg-muted-foreground/20"
              }`} title={apiActive ? "API call in progress!" : apiPaused ? "API paused" : "API active (idle)"} />
              {apiCost && (
                <span className="text-[10px] font-mono text-muted-foreground" title={`Today: $${apiCost.today} | Month: $${apiCost.month}`}>
                  ${apiCost.month}
                </span>
              )}
            </div>
            {(
              <Button
                variant={apiPaused ? "destructive" : "outline"}
                size="sm"
                onClick={toggleApiPause}
                className={apiPaused ? "" : "text-green-600 border-green-300 hover:bg-green-50"}
                title={apiPaused ? "API is paused — click to resume" : "API is active — click to pause"}
              >
                {apiPaused ? <Pause className="w-3.5 h-3.5 mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                {apiPaused ? "API Paused" : "API Active"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/employees" component={EmployeeList} />
      <Route path="/roles" component={RoleGridPage} />
      <Route path="/days-off" component={DaysOff} />
      <Route path="/settings" component={Settings} />
      <Route path="/pricing" component={PricingTool} />
      <Route path="/pricing/admin" component={PricingAdmin} />
      <Route path="/time-tracker" component={TimeTracker} />
      <Route path="/proposals" component={Proposals} />
      <Route path="/proposals/methodology" component={SlideMethodologyAdmin} />
      <Route path="/hiring" component={Hiring} />
      <Route path="/knowledge" component={KnowledgeCenter} />
      <Route path="/invoicing" component={Invoicing} />
      <Route path="/clients" component={ClientLedger} />
      <Route path="/admin" component={AppAdmin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { loadData, isLoaded } = useStore();

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navigation />
      <main className="flex-1 p-6 md:p-10 overflow-x-hidden">
        <div className="max-w-full mx-auto animate-in fade-in duration-500">
          <Router />
        </div>
      </main>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/check", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { authenticated: boolean }) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
