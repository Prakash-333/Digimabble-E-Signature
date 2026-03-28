export default function ReportsPage() {
  return (
    <div className="px-4 pb-8 pt-6 md:px-8 md:pb-10 md:pt-8">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Reports
          </h1>
        </div>
        <div className="flex min-h-[260px] items-center justify-center px-6 pb-10">
          <div className="max-w-md text-center">
            <p className="text-lg font-semibold tracking-tight text-slate-900">
              No reports yet
            </p>
            <p className="mt-2 text-sm text-slate-500">
              This section is intentionally empty for now.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
