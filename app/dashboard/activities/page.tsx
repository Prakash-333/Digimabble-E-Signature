type ActivityType = "Call" | "Email" | "Meeting";

type Activity = {
  type: ActivityType;
  subject: string;
  relatedTo: string;
  dueDate: string;
  status: "Planned" | "Completed" | "Overdue";
};

const activities: Activity[] = [];

export default function ActivitiesPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Activities
          </h1>
          <p className="mt-1 text-xs text-slate-500 md:text-sm">
            Keep track of calls, emails, and meetings across your deals and
            contacts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button className="rounded-full border border-violet-200 bg-violet-50 px-3 py-2 font-medium text-violet-700 hover:bg-violet-100 hover:border-violet-300">
            Today
          </button>
          <button className="rounded-full border border-slate-200 bg-slate-100 px-3 py-2 font-medium text-slate-800 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700">
            This week
          </button>
          <button className="rounded-full border border-slate-200 bg-white px-3 py-2 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700 font-medium text-slate-600">
            Overdue
          </button>
          <button className="rounded-full bg-[color:var(--color-brand-primary)] px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-700">
            + Add activity
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Subject</th>
              <th className="px-4 py-2 text-left font-medium">Related to</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity, index) => (
              <tr
                key={activity.subject}
                className={index % 2 === 0 ? "bg-white" : "bg-slate-50/70"}
              >
                <td className="px-4 py-2 text-slate-800">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--color-brand-primary)]/10 text-[11px] font-semibold text-[color:var(--color-brand-primary)]">
                    {activity.type[0]}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-900">{activity.subject}</td>
                <td className="px-4 py-2 text-slate-700">
                  {activity.relatedTo}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={
                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium " +
                      (activity.status === "Completed"
                        ? "bg-emerald-50 text-emerald-800"
                        : activity.status === "Planned"
                          ? "bg-sky-50 text-sky-800"
                          : "bg-amber-50 text-amber-800")
                    }
                  >
                    {activity.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-slate-600">
                  {activity.dueDate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
