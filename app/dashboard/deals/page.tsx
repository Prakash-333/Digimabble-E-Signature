type DealStage = "New" | "In Progress" | "Negotiation" | "Won";

type Deal = {
  name: string;
  contact: string;
  stage: DealStage;
  value: string;
  closeDate: string;
};

const deals: Deal[] = [
  {
    name: "Acme rollout",
    contact: "Rahul Verma",
    stage: "Negotiation",
    value: "$34,000",
    closeDate: "Apr 28",
  },
  {
    name: "Northwind pilot",
    contact: "Sarah Lee",
    stage: "In Progress",
    value: "$18,500",
    closeDate: "May 3",
  },
  {
    name: "Globex renewals",
    contact: "Amit Patel",
    stage: "New",
    value: "$22,750",
    closeDate: "May 16",
  },
  {
    name: "BlueSky expansion",
    contact: "Priya Sharma",
    stage: "Won",
    value: "$14,200",
    closeDate: "Mar 30",
  },
];

export default function DealsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Deals
          </h1>
          <p className="mt-1 text-xs text-slate-500 md:text-sm">
            Track every opportunity as it moves through your pipeline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100">
            <option>All stages</option>
            <option>New</option>
            <option>In Progress</option>
            <option>Negotiation</option>
            <option>Won</option>
          </select>
          <button className="rounded-full border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">
            Export
          </button>
          <button className="rounded-full bg-[color:var(--color-brand-primary)] px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-700">
            + New deal
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Deal</th>
              <th className="px-4 py-2 text-left font-medium">Primary contact</th>
              <th className="px-4 py-2 text-left font-medium">Stage</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
              <th className="px-4 py-2 text-right font-medium">Close date</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal, index) => (
              <tr
                key={deal.name}
                className={index % 2 === 0 ? "bg-white" : "bg-slate-50/70"}
              >
                <td className="px-4 py-2 text-slate-900">{deal.name}</td>
                <td className="px-4 py-2 text-slate-700">{deal.contact}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      deal.stage === "Won"
                        ? "bg-emerald-50 text-emerald-800"
                        : deal.stage === "Negotiation"
                        ? "bg-amber-50 text-amber-800"
                        : deal.stage === "In Progress"
                        ? "bg-sky-50 text-sky-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {deal.stage}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-slate-900">
                  {deal.value}
                </td>
                <td className="px-4 py-2 text-right text-slate-600">
                  {deal.closeDate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

