"use client";

import Head from "next/head";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FileText,
  FileSignature,
  FolderOpen,
  Folder,
  BarChart3,
  Settings,
  Menu,
  Bell,
  LogOut
} from "lucide-react";
import { supabase } from "../lib/supabase/browser";

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
  const [userLabel, setUserLabel] = useState("User");

  useEffect(() => {
    let mounted = true;

    const syncSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Session sync error:", {
          message: error.message,
          status: error.status
        });
      }
      if (!mounted) return;

      const session = data.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      const name =
        session.user.user_metadata?.full_name ||
        session.user.email ||
        "User";
      setUserLabel(name);
      setLoadingSession(false);
    };

    syncSession();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
        return;
      }

      const name =
        session.user.user_metadata?.full_name ||
        session.user.email ||
        "User";
      setUserLabel(name);
      setLoadingSession(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (loadingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading session...
      </div>
    );
  }

  return (
    <div className="flex bg-slate-50 min-h-screen w-full overflow-x-hidden">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400..700&display=swap" rel="stylesheet" />
      </Head>
      {/* Sidebar */}
      <aside className={`sticky top-0 h-screen flex-shrink-0 overflow-y-auto overflow-x-hidden bg-white border-r border-slate-200 text-slate-700 transition-all duration-300 flex flex-col ${isSidebarCollapsed ? "w-20" : "w-72"}`}>
        <div className={`flex items-center ${isSidebarCollapsed ? "justify-center px-0 py-4" : "gap-3 px-5 py-5"}`}>
          {!isSidebarCollapsed ? (
            <>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500 text-sm font-semibold text-white shadow-md">
                HD
              </div>
              <div className="overflow-hidden whitespace-nowrap">
                <p className="text-sm font-bold tracking-tight text-violet-600 uppercase">SMARTDOCS</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider">Intelligent Agreements</p>
              </div>
            </>
          ) : (
            <div className="flex h-10 w-10 mt-1 shrink-0 items-center justify-center rounded-2xl bg-violet-500 text-sm font-semibold text-white shadow-md">
              HD
            </div>
          )}
        </div>

        <nav className="mt-2 flex-1 flex flex-col px-3 text-sm font-medium h-full">
          <div className="flex-1 space-y-1">
            {["MAIN", "DOCUMENTS", "ANALYTICS"].map((section, idx) => {
              const items = navItems.filter((item) => item.section === section);
              if (!items.length) return null;
              return (
                <div key={section} className={`${idx > 0 && !isSidebarCollapsed ? "mt-4" : ""} ${isSidebarCollapsed ? "mb-1" : "mb-4"} text-slate-600 space-y-1`}>
                  {!isSidebarCollapsed && (
                    <p className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">
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

          <div className={`mt-auto ${isSidebarCollapsed ? "mb-2" : "mb-4"} text-slate-600 space-y-1`}>
            {!isSidebarCollapsed && (
              <p className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-600">
                {userLabel
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "U"}
              </div>
              <div className="text-xs overflow-hidden whitespace-nowrap">
                <p className="font-semibold text-slate-700">{userLabel}</p>
                <p className="text-[11px] text-slate-500">Admin</p>
              </div>
              <button title="Notifications" className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-violet-500 hover:bg-violet-100 hover:text-violet-600 transition-colors">
                <Bell className="h-4 w-4" />
              </button>
            </div>
            <button onClick={handleLogout} className="mt-4 flex items-center gap-3 rounded-full border border-violet-600 bg-white px-5 py-2.5 text-sm font-medium text-violet-600 hover:bg-red-600 hover:!text-white hover:border-red-600 transition-all group">
              <LogOut className="h-4 w-4 shrink-0 transition-colors text-violet-600 group-hover:!text-white" />
              <span className="text-violet-600 group-hover:!text-white font-semibold">Log out</span>
            </button>
          </div>
        ) : (
          <div className="border-t border-slate-200 py-4 flex flex-col items-center gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-600">
              {userLabel
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase() || "U"}
            </div>
            <button title="Notifications" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-violet-500 hover:bg-violet-100 hover:text-violet-600 transition-colors">
              <Bell className="h-4 w-4" />
            </button>
            <button onClick={handleLogout} title="Logout" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-violet-600 bg-white text-violet-600 hover:bg-red-600 hover:!text-white hover:border-red-600 transition-all group">
              <LogOut className="h-5 w-5 transition-colors text-violet-600 group-hover:!text-white" />
            </button>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-x-hidden">
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
              {pathname.includes("/settings") ? "Settings" : (navItems.find(item => item.href === pathname || (item.href !== "/dashboard" && pathname.startsWith(item.href)))?.label || "Dashboard")}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <button className="hidden items-center rounded-full border border-violet-600 bg-white px-4 py-2 text-xs font-semibold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95 md:inline-flex">
              + Add New
            </button>
            <button onClick={handleLogout} className="inline-flex items-center rounded-full border border-violet-600 bg-white px-5 py-2 text-sm font-semibold text-violet-600 shadow-sm hover:bg-red-600 hover:!text-white hover:border-red-600 transition-all active:scale-95 group">
              <LogOut className="h-4 w-4 mr-2 transition-colors text-violet-600 group-hover:!text-white" />
              <span className="text-violet-600 group-hover:!text-white">Logout</span>
            </button>
          </div>
        </header>

        <main className="flex-1 bg-slate-50 p-4">{children}</main>
      </div>
    </div>
  );
}
