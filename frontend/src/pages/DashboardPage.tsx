import { useEffect, useState } from "react";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

export function DashboardPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    if (user?.role !== "STUDENT") api.students().then(setStudents).catch(() => {});
    api.sessions().then(setSessions).catch(() => {});
  }, [user?.role]);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="p-4"><p className="text-sm text-slate-500">Role</p><p className="text-2xl font-semibold">{user?.role}</p></Card>
      <Card className="p-4"><p className="text-sm text-slate-500">Students</p><p className="text-2xl font-semibold">{students.length}</p></Card>
      <Card className="p-4"><p className="text-sm text-slate-500">Sessions</p><p className="text-2xl font-semibold">{sessions.length}</p></Card>
      <Card className="p-4 md:col-span-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent sessions</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th>ID</th><th>Date</th><th>State</th><th>Processing</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-slate-100"><td>{s.id}</td><td>{s.classDate ?? "-"}</td><td>{s.state}</td><td>{s.processingState}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
