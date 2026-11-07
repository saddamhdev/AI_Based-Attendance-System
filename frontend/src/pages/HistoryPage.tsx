import { useEffect, useState } from "react";
import { Card } from "../components/ui/card";
import { api } from "../lib/api";

export function HistoryPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  useEffect(() => { api.sessions().then(setSessions).catch(() => {}); }, []);

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Attendance history</h2>
      <table className="min-w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>ID</th><th>Date</th><th>Status</th><th>Processing</th></tr></thead>
        <tbody>{sessions.map((s) => <tr key={s.id} className="border-t border-slate-100"><td>{s.id}</td><td>{s.classDate}</td><td>{s.state}</td><td>{s.processingState}</td></tr>)}</tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Authorized corrections require reason input and are logged in audit history.</p>
    </Card>
  );
}
