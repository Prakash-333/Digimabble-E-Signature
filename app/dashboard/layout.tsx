"use client";
export const dynamic = 'force-dynamic';

import Head from "next/head";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  LayoutDashboard,
  FileText,
  FileSignature,
  FolderOpen,
  Folder,
  BarChart3,
  User,
  LogOut,
  Settings,
  Menu,
  Bell
} from "lucide-react";
import { supabase } from "../lib/supabase/browser";
import { getMatchingRecipient, isCompletedForRecipient, normalizeEmail, type SharedDocumentRecord } from "../lib/documents";
import { getHiddenNotificationIds, getSeenNotificationIds, markNotificationsSeen } from "../lib/notification-storage";

// Same navItems...
const navItems = [
  { href: "/dashboard", label: "Dashboard", section: "MAIN", icon: LayoutDashboard },
  { href: "/dashboard/templates", label: "Templates", section: "DOCUMENTS", icon: FileText },
  { href: "/dashboard/sign-document", label: "Sign Document", section: "DOCUMENTS", icon: FileSignature },
  { href: "/dashboard/documents", label: "Shared Documents", section: "DOCUMENTS", icon: FolderOpen },
  { href: "/dashboard/my-documents", label: "My Documents", section: "DOCUMENTS", icon: Folder },
  { href: "/dashboard/reports", label: "Reports", section: "ANALYTICS", icon: BarChart3 },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userLabel, setUserLabel] = useState("User");
  const [notificationCount, setNotificationCount] = useState(0);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


  useEffect(() => {
    let mounted = true;

    const syncSession = async () => {
      try {
        // Race getSession against a 15-second timeout.
        // If it stalls, redirect to login cleanly.
        const result = await Promise.race([
          supabase.auth.getUser(),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 15000)
          ),
        ]);

        // Timeout fired — send to login
        if (result === null) {
          console.warn("getUser timed out — redirecting to login.");
          if (mounted) router.replace("/login");
          return;
        }

        const { data, error } = result;
        if (error) {
          console.error("User sync error:", {
            message: error.message,
            status: (error as any).status
          });
          setAuthError(error.message);
        }
        if (!mounted) return;

        const user = data?.user;
        if (!user) {
          router.replace("/login");
          return;
        }
        setCurrentUserId(user.id);

        const name =
          user.user_metadata?.full_name ||
          user.email ||
          "User";
        setUserLabel(name);
        
        // Unblock the UI before fetching documents so it doesn't hang!
        if (mounted) setLoadingSession(false);

        const userEmail = normalizeEmail(user.email);
        if (userEmail) {
          try {
            const { data: rows, error: fetchError } = await supabase
              .from("documents")
              .select("id, owner_id, recipients, status, category, sender, sent_at")
              .order("sent_at", { ascending: false })
              .limit(200);

            if (fetchError) throw fetchError;

            const hiddenIds = getHiddenNotificationIds(user.id);
            const seenIds = getSeenNotificationIds(user.id);
            
            const ids: string[] = [];
            ((rows ?? []) as SharedDocumentRecord[]).forEach((row) => {
              if (row.owner_id !== user.id) {
                // Incoming Request
                if (hiddenIds.has(row.id) || seenIds.has(row.id)) return;
                const isRecipient = Boolean(getMatchingRecipient(row.recipients, userEmail));
                if (isRecipient && !isCompletedForRecipient(row.status)) {
                  ids.push(row.id);
                }
              } else {
                // Outgoing Update (track completions)
                row.recipients.forEach((r) => {
                  if (["signed", "reviewed", "approved", "rejected"].includes(r.status || "")) {
                    const virtualId = `${row.id}_${normalizeEmail(r.email)}_${r.status}`;
                    if (!hiddenIds.has(virtualId) && !seenIds.has(virtualId)) {
                      ids.push(virtualId);
                    }
                  }
                });
              }
            });
            setPendingIds(ids);
            setNotificationCount(ids.length);
          } catch (err: any) {
            console.warn("Failed to fetch notification rows:", err);
          }
        } else {
          setPendingIds([]);
          setNotificationCount(0);
        }
      } catch (err: any) {
        console.error("Unexpected error in syncSession:", err);
        setAuthError(err.message || "Failed to connect to authentication server.");
        if (mounted) setLoadingSession(false);
      }
    };

    syncSession();

    const { data } = supabase.auth.onAuthStateChange(async (_event: string, session: any) => {
      try {
        if (!session) {
          router.replace("/login");
          return;
        }
        setCurrentUserId(session.user.id);
        const name =
          session.user.user_metadata?.full_name ||
          session.user.email ||
          "User";
        setUserLabel(name);
        
        // Unblock the UI prior to document fetch
        if (mounted) setLoadingSession(false);
        
        const { data: rows, error: fetchError } = await supabase
          .from("documents")
          .select("id, owner_id, recipients, status, category, sender, sent_at")
          .order("sent_at", { ascending: false })
          .limit(200);

        if (fetchError) {
          console.warn("Failed to fetch documents on auth change:", fetchError);
        } else {
          const userEmail = normalizeEmail(session.user.email);
          const hiddenIds = getHiddenNotificationIds(session.user.id);
          const seenIds = getSeenNotificationIds(session.user.id);

          const ids: string[] = [];
          ((rows ?? []) as SharedDocumentRecord[]).forEach((row) => {
            if (row.owner_id !== session.user.id) {
              if (hiddenIds.has(row.id) || seenIds.has(row.id)) return;
              const isRecipient = Boolean(getMatchingRecipient(row.recipients, userEmail));
              if (isRecipient && !isCompletedForRecipient(row.status)) {
                ids.push(row.id);
              }
            } else {
              row.recipients.forEach((r) => {
                if (["signed", "reviewed", "approved", "rejected"].includes(r.status || "")) {
                  const virtualId = `${row.id}_${normalizeEmail(r.email)}_${r.status}`;
                  if (!hiddenIds.has(virtualId) && !seenIds.has(virtualId)) {
                    ids.push(virtualId);
                  }
                }
              });
            }
          });
          setPendingIds(ids);
          setNotificationCount(ids.length);
        }
      } catch (err: any) {
        console.error("Error in onAuthStateChange handler:", err);
        if (mounted) setLoadingSession(false);
      }
    });

    // Periodic refresh for notifications (every 60 seconds)
    // This handles "Internal" documents where only dashboard notifications are requested.
    const intervalId = setInterval(syncSession, 60000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
      data.subscription.unsubscribe();
    };
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const handleNotificationClick = () => {
    if (pendingIds.length > 0) {
      markNotificationsSeen(currentUserId, pendingIds);
      setNotificationCount(0);
      setPendingIds([]);
    }
    router.push("/dashboard/notifications");
  };

  if (loadingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <p className="text-sm text-slate-500 font-medium mb-3">
            {authError ? "Connection Issue" : "Loading your session..."}
          </p>
          {authError ? (
            <div className="max-w-md animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
                <p className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2">Error Details</p>
                <p className="text-sm text-red-700 font-medium leading-relaxed">
                  {authError.includes("Failed to fetch") 
                    ? "Could not connect to the database. Please check your internet connection or verify your Supabase URL/Key in .env.local."
                    : authError}
                </p>
                <button 
                  onClick={() => window.location.reload()}
                  className="mt-4 rounded-xl bg-white px-4 py-2 text-xs font-bold text-red-600 shadow-sm border border-red-200 hover:bg-red-50 transition-colors"
                >
                  Retry Connection
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-center flex-col items-center gap-4 mt-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Initializing SmartDocs</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 w-full overflow-hidden">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400..700&display=swap" rel="stylesheet" />
      </Head>
      {/* Sidebar */}
      <aside className={`h-screen flex-shrink-0 overflow-y-auto overflow-x-hidden bg-white border-r border-slate-200 text-slate-700 transition-all duration-300 flex flex-col ${isSidebarCollapsed ? "w-20" : "w-72"}`}>
        <div className={`flex items-center ${isSidebarCollapsed ? "justify-center px-0 py-4" : "gap-3 px-5 py-5"}`}>
          {!isSidebarCollapsed ? (
            <>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-600 shadow-sm border border-violet-200">
                {userLabel
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "U"}
              </div>

              <div className="overflow-hidden whitespace-nowrap">
                <p className="text-sm font-bold tracking-tight text-violet-600 uppercase">SMARTDOCS</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider">Intelligent Agreements</p>
              </div>
            </>
          ) : (
            <div className="flex h-10 w-10 mt-1 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-600 shadow-sm border border-violet-200">
              {userLabel
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase() || "U"}
            </div>

          )}
        </div>

        <nav className="mt-2 flex flex-col px-3 text-sm font-medium">
          <div className="space-y-1">
            {["MAIN", "DOCUMENTS", "ANALYTICS"].map((section, idx) => {
              const items = navItems.filter((item) => item.section === section);
              if (!items.length) return null;
              return (
                <div key={section} className={`${idx > 0 && !isSidebarCollapsed ? "mt-4" : ""} ${isSidebarCollapsed ? "mb-1" : "mb-4"} text-slate-600 space-y-1`}>
                  {!isSidebarCollapsed && (
                    <p className="px-4 mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      {section === "MAIN" ? "MAIN" : section}
                    </p>
                  )}
                  {items.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={isSidebarCollapsed ? item.label : undefined}
                        className={`flex items-center rounded-xl transition-colors ${isSidebarCollapsed ? "justify-center p-3 mx-auto w-12 h-12 mb-2" : "gap-3 px-4 py-3"
                          } ${isActive
                            ? "bg-violet-100 text-violet-700 font-semibold"
                            : "text-slate-500 hover:bg-violet-50 hover:text-violet-700"
                          }`}
                      >
                        <Icon className={`h-5 w-5 shrink-0 ${isActive ? "text-violet-600" : "text-slate-400"}`} strokeWidth={isActive ? 2.5 : 2} />
                        {!isSidebarCollapsed && <span className="whitespace-nowrap overflow-hidden">{item.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className={`${isSidebarCollapsed ? "mb-2" : "mb-4"} text-slate-600 space-y-1`}>

            {!isSidebarCollapsed && (
              <p className="px-4 mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                SETTINGS
              </p>
            )}
            <Link
              href="/dashboard/settings"
              title={isSidebarCollapsed ? "Settings" : undefined}
              className={`flex items-center rounded-xl transition-colors ${isSidebarCollapsed ? "justify-center p-3 mx-auto w-12 h-12" : "gap-3 px-4 py-3"
                } ${pathname.includes("/settings")
                  ? "bg-violet-100 text-violet-700 font-semibold"
                  : "text-slate-500 hover:bg-violet-50 hover:text-violet-700"
                }`}
            >
              <Settings className={`h-5 w-5 shrink-0 ${pathname.includes("/settings") ? "text-violet-600" : "text-slate-400"}`} strokeWidth={pathname.includes("/settings") ? 2.5 : 2} />
              {!isSidebarCollapsed && <span className="whitespace-nowrap overflow-hidden">Settings</span>}
            </Link>
          </div>
        </nav>

        {!isSidebarCollapsed ? (
          <div className="border-t border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="overflow-hidden whitespace-nowrap">
                <p className="font-semibold text-slate-700">{userLabel}</p>
                <p className="text-[11px] text-slate-500">Admin</p>
              </div>
              <button 
                onClick={handleNotificationClick}
                title="Notifications" 
                className={`relative ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  pathname.includes("/notifications")
                    ? "bg-violet-100 text-violet-600 shadow-sm"
                    : "bg-slate-50 text-slate-400 hover:bg-violet-50 hover:text-violet-600"
                }`}
              >
                <Bell className="h-4 w-4" />
                {notificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                    {notificationCount}
                  </span>
                )}
              </button>

            </div>

            <button onClick={handleLogout} className="mt-4 flex items-center gap-3 rounded-full border border-violet-600 bg-white px-5 py-2.5 text-sm font-medium text-violet-600 hover:bg-red-600 hover:!text-white hover:border-red-600 transition-all group">
              <LogOut className="h-4 w-4 shrink-0 transition-colors text-violet-600 group-hover:!text-white" />
              <span className="text-violet-600 group-hover:!text-white font-semibold">Log out</span>
            </button>
          </div>
        ) : (
          <div className="border-t border-slate-200 py-4 flex flex-col items-center gap-4">
            <button 
              onClick={handleNotificationClick}
              title="Notifications" 
              className={`relative inline-flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
                pathname.includes("/notifications")
                  ? "bg-violet-100 text-violet-600 shadow-sm"
                  : "bg-slate-50 text-slate-400 hover:bg-violet-50 hover:text-violet-600"
              }`}
            >
              <Bell className="h-5 w-5" />
              {notificationCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                  {notificationCount}
                </span>
              )}
            </button>


            <button onClick={handleLogout} title="Logout" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-violet-600 bg-white text-violet-600 hover:bg-red-600 hover:!text-white hover:border-red-600 transition-all group">
              <LogOut className="h-5 w-5 transition-colors text-violet-600 group-hover:!text-white" />
            </button>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-violet-600 bg-white text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 ml-2">
              {pathname.includes("/settings") ? "Settings" : pathname.includes("/notifications") ? "Notifications" : (navItems.find(item => item.href === pathname || (item.href !== "/dashboard" && pathname.startsWith(item.href)))?.label || "Dashboard")}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs relative" ref={profileDropdownRef}>
            <button
              onClick={handleNotificationClick}
              title="Notifications"
              className={`relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                pathname.includes("/notifications")
                  ? "border-violet-200 bg-violet-100 text-violet-600"
                  : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600"
              }`}
            >
              <Bell className="h-4 w-4" />
              {notificationCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
                  {notificationCount}
                </span>
              )}
            </button>
            
            <button 
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center rounded-full border border-slate-200 bg-white p-1 hover:border-violet-300 transition-all active:scale-95 shadow-sm"
              aria-label="User menu"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-[13px] font-bold text-white shadow-sm ring-2 ring-violet-50">
                {userLabel
                  .split(" ")
                  .map((p) => p[0])
                  .join("")
                  .slice(0, 1)
                  .toUpperCase() || "U"}
              </div>
            </button>

            {isProfileOpen && (
              <div className="absolute right-0 top-full mt-3 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-200/50 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-3 py-2.5 mb-1.5 border-b border-slate-50">
                  <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Account</p>
                  <p className="text-sm font-semibold text-slate-700 truncate">{userLabel}</p>
                </div>
                
                <Link 
                  href="/dashboard/settings" 
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-violet-50 hover:text-violet-700 transition-all group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 group-hover:bg-violet-100 transition-colors">
                    <Settings className="h-4 w-4 text-slate-400 group-hover:text-violet-600" />
                  </div>
                  Profile
                </Link>
                
                <Link 
                  href="/dashboard/my-documents" 
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-violet-50 hover:text-violet-700 transition-all group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 group-hover:bg-violet-100 transition-colors">
                    <Folder className="h-4 w-4 text-slate-400 group-hover:text-violet-600" />
                  </div>
                  My Documents
                </Link>
                
                <div className="my-1.5 border-t border-slate-100" />
                
                <button 
                  onClick={() => {
                    handleLogout();
                    setIsProfileOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-all group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 group-hover:bg-red-100 transition-colors">
                    <LogOut className="h-4 w-4 text-red-600" />
                  </div>
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-slate-50 p-4 pt-0">{children}</main>
      </div>
    </div>
  );
}
