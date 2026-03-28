import Link from "next/link";

const benefits = [
  {
    title: "Move faster with every deal",
    description:
      "Centralize contacts, deals, and activities so your team always knows what comes next.",
  },
  {
    title: "Stay organized and in control",
    description:
      "Track every interaction with a clear, auditable history across the entire customer lifecycle.",
  },
  {
    title: "Work where your team works",
    description:
      "Connect your CRM with the tools you already rely on—email, calendar, and more.",
  },
  {
    title: "Secure by design",
    description:
      "Modern security practices and sensible defaults so you can focus on growing relationships.",
  },
];

const trustBadges = [
  "Role-based access",
  "Audit-ready activity history",
  "Best practices for modern SaaS",
  "Data residency awareness",
];

const integrationLogos = ["Gmail", "Outlook", "Slack", "HubSpot", "Salesforce"];

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="crm-container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--color-brand-primary)] text-white font-semibold">
              N
            </div>
            <span className="text-lg font-semibold tracking-tight">
              SmartDocs CRM
            </span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-slate-700 md:flex">
            <Link href="#products" className="hover:text-slate-900">
              Products
            </Link>
            <Link href="#solutions" className="hover:text-slate-900">
              Solutions
            </Link>
            <Link href="#resources" className="hover:text-slate-900">
              Resources
            </Link>
            <Link href="/login" className="hover:text-slate-900">
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-[color:var(--color-brand-primary)] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main className="crm-container py-16 md:py-24">
        <section className="grid gap-12 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-brand-primary)]" />
              CRM inspired by DocuSign
            </div>
            <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              Manage every customer relationship{" "}
              <span className="text-[color:var(--color-brand-primary)]">
                with confidence
              </span>
              .
            </h1>
            <p className="mt-4 max-w-xl text-balance text-base text-slate-600 md:text-lg">
              SmartDocs CRM gives you a clear, connected view of leads, deals, and
              activities—all in a clean interface that feels as polished as the
              tools you already trust.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-full bg-[color:var(--color-brand-primary)] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Start free trial
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                View dashboard demo
              </Link>
              <span className="mt-1 text-xs text-slate-500">
                No credit card required · Demo data only
              </span>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-xl shadow-slate-200/70">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  Pipeline overview
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  Q2 New Business
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                78% to target
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Open deals</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">32</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Won this month</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  $84k
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Overdue tasks</p>
                <p className="mt-1 text-lg font-semibold text-amber-600">7</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">
                Today&apos;s schedule
              </p>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-700">
                <li>
                  09:00 · Call with{" "}
                  <span className="font-medium">Acme Industries</span>
                </li>
                <li>
                  11:30 · Demo for{" "}
                  <span className="font-medium">Northwind Partners</span>
                </li>
                <li>
                  15:00 · Follow-up email to{" "}
                  <span className="font-medium">Globex</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section
          id="products"
          className="mt-20 border-y border-slate-200 bg-white py-10 md:mt-24 md:py-14"
        >
          <div className="grid gap-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:items-start">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Go from scattered spreadsheets to a connected CRM.
              </h2>
              <p className="mt-3 text-sm text-slate-600 md:text-base">
                Replace manual tracking with a single workspace for contacts,
                deals, and every customer touchpoint—no backend required for
                this demo experience.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {benefits.map((benefit) => (
                <div
                  key={benefit.title}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    {benefit.title}
                  </h3>
                  <p className="mt-2 text-xs text-slate-600 md:text-sm">
                    {benefit.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="solutions"
          className="mt-16 rounded-2xl bg-slate-900 px-6 py-8 text-slate-50 md:mt-20 md:px-10 md:py-10"
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                Trust &amp; security
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Designed to keep your agreements safe.
              </h2>
              <p className="mt-3 max-w-md text-sm text-slate-300">
                While this CRM is a demo, its structure mirrors how real teams
                model secure, auditable agreement workflows.
              </p>
            </div>
            <div className="grid flex-1 gap-3 text-xs md:grid-cols-2">
              {trustBadges.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-slate-950">
                    ✓
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 flex flex-col gap-6 md:mt-20 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              Works alongside the tools you already use.
            </h2>
            <p className="mt-3 max-w-md text-sm text-slate-600 md:text-base">
              Bring email, calendar, and communication data into a single view
              so every rep has the full story.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-700">
            {integrationLogos.map((logo) => (
              <div
                key={logo}
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm"
              >
                <span className="mr-2 h-1.5 w-1.5 rounded-full bg-[color:var(--color-brand-primary)]" />
                {logo}
              </div>
            ))}
          </div>
        </section>

        <section id="resources" className="mt-16 md:mt-20">
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-8 md:px-10 md:py-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Explore the dashboard in minutes.
                </h2>
                <p className="mt-2 max-w-xl text-sm text-slate-600 md:text-base">
                  Jump into the CRM experience to see how contacts, deals,
                  and activities come together in a single, focused workspace.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-full bg-[color:var(--color-brand-accent)] px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-sm hover:bg-amber-400"
                >
                  Open CRM
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  Create test workspace
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-16 border-t border-slate-200 bg-white py-10 md:mt-20">
        <div className="crm-container grid gap-8 text-sm text-slate-600 md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[color:var(--color-brand-primary)] text-white text-xs font-semibold">
                N
              </div>
              <span className="text-base font-semibold text-slate-900">
                SmartDocs CRM
              </span>
            </div>
            <p className="mt-3 max-w-xs text-xs text-slate-500">
              A CRM interface built for demos, prototypes, and learning modern
              web UI patterns.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Product</p>
            <ul className="mt-3 space-y-1 text-xs">
              <li>Overview</li>
              <li>Pipeline</li>
              <li>Contacts</li>
              <li>Activities</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Company</p>
            <ul className="mt-3 space-y-1 text-xs">
              <li>About</li>
              <li>Security</li>
              <li>Status</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Resources</p>
            <ul className="mt-3 space-y-1 text-xs">
              <li>Docs</li>
              <li>API (coming soon)</li>
              <li>Support</li>
            </ul>
          </div>
        </div>
        <div className="crm-container mt-8 flex flex-col items-start justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500 md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} SmartDocs CRM. For demonstration only.</p>
          <div className="flex flex-wrap gap-4">
            <span>Terms</span>
            <span>Privacy</span>
            <span>Cookie settings</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
