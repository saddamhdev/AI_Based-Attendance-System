import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

export function StudentsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN";
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [form, setForm] = useState({ studentCode: "", fullName: "", department: "", batch: "", section: "", active: true, faceEnrolled: false, biometricConsent: false });
  const [error, setError] = useState("");

  const load = () => api.students(query).then(setStudents).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex gap-2">
          <Input placeholder="Search by ID or name" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button variant="secondary" onClick={load}><Search className="mr-2 h-4 w-4" />Search</Button>
        </div>
      </Card>
      {canEdit ? <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Add student</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <Input placeholder="Student ID" value={form.studentCode} onChange={(e) => setForm({ ...form, studentCode: e.target.value })} />
          <Input placeholder="Full Name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        </div>
        <Button className="mt-3" onClick={async () => {
          try {
            await api.createStudent(form);
            setForm({ studentCode: "", fullName: "", department: "", batch: "", section: "", active: true, faceEnrolled: false, biometricConsent: false });
            load();
          } catch (e) { setError((e as Error).message); }
        }}>Save student</Button>
      </Card> : null}
      {error ? <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th>ID</th><th>Name</th><th>Department</th><th>Batch</th><th>Section</th><th>Status</th><th>Face</th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-slate-100"><td>{s.studentCode}</td><td>{s.fullName}</td><td>{s.department}</td><td>{s.batch}</td><td>{s.section}</td><td>{s.active ? "Active" : "Inactive"}</td><td>{s.faceEnrolled ? "Enrolled" : "Not enrolled"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
