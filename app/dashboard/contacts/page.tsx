type Contact = {
  name: string;
  company: string;
  email: string;
  status: "Lead" | "Customer" | "Prospect";
  lastActivity: string;
};

const contacts: Contact[] = [
  {
    name: "Rahul Verma",
    company: "Acme Industries",
    email: "rahul.verma@acme.co",
    status: "Customer",
    lastActivity: "Call · Today",
  },
  {
    name: "Sarah Lee",
    company: "Northwind Partners",
    email: "sarah.lee@northwind.com",
    status: "Prospect",
    lastActivity: "Email · Yesterday",
  },
  {
    name: "Amit Patel",
    company: "Globex",
    email: "amit.patel@globex.io",
    status: "Lead",
    lastActivity: "Meeting · 2d ago",
  },
  {
    name: "Priya Sharma",
    company: "BlueSky Retail",
    email: "priya.sharma@bluesky.in",
    status: "Lead",
    lastActivity: "Note · 3d ago",
  },
];

export default function ContactsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Contacts
          </h1>
          <p className="mt-1 text-xs text-slate-500 md:text-sm">
            People and companies you&apos;re currently working with in this
            workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="search"
            placeholder="Search by name, company, or email"
            className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-800 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100 md:w-64"
          />
          <button className="rounded-full border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">
            Filter
          </button>
          <button className="rounded-full bg-[color:var(--color-brand-primary)] px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-700">
            + Add contact
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Company</th>
              <th className="px-4 py-2 text-left font-medium">Email</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">
                Last activity
              </th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact, index) => (
              <tr
                key={contact.email}
                className={index % 2 === 0 ? "bg-white" : "bg-slate-50/70"}
              >
                <td className="px-4 py-2 text-slate-900">{contact.name}</td>
                <td className="px-4 py-2 text-slate-700">{contact.company}</td>
                <td className="px-4 py-2 text-slate-600">{contact.email}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium " +
                      (contact.status === "Customer"
                        ? "bg-emerald-50 text-emerald-800"
                        : contact.status === "Lead"
                        ? "bg-sky-50 text-sky-800"
                        : "bg-amber-50 text-amber-800")
                    }
                  >
                    {contact.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-slate-600">
                  {contact.lastActivity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

