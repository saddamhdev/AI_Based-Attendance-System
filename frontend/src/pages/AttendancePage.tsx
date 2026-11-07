import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";

export function AttendancePage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [payload, setPayload] = useState({ courseId: 0, sectionId: 0, classDate: new Date().toISOString().slice(0, 10), classTime: "10:00 AM" });
  const [error, setError] = useState("");

  const load = () => api.sessions().then(setSessions).catch((e) => setError(e.message));

  useEffect(() => {
    api.courses().then((c) => {
      setCourses(c);
      if (c[0]) setPayload((p) => ({ ...p, courseId: c[0].id }));
    });
    api.sections().then((s) => {
      setSections(s);
      if (s[0]) setPayload((p) => ({ ...p, sectionId: s[0].id }));
    });
    load();
  }, []);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Create attendance draft</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <select className="h-10 rounded-md border border-slate-300 px-3" value={payload.courseId} onChange={(e) => setPayload({ ...payload, courseId: Number(e.target.value) })}>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}
          </select>
          <select className="h-10 rounded-md border border-slate-300 px-3" value={payload.sectionId} onChange={(e) => setPayload({ ...payload, sectionId: Number(e.target.value) })}>
            {sections.map((section) => <option key={section.id} value={section.id}>Section {section.sectionCode}</option>)}
          </select>
          <Input type="date" value={payload.classDate} onChange={(e) => setPayload({ ...payload, classDate: e.target.value })} />
          <Input value={payload.classTime} onChange={(e) => setPayload({ ...payload, classTime: e.target.value })} />
        </div>
        <Button className="mt-3" onClick={async () => {
          try {
            await api.createSession(payload);
            load();
          } catch (e) { setError((e as Error).message); }
        }}>Create draft session</Button>
      </Card>
      {error ? <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <Card className="p-4">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th>ID</th><th>Date</th><th>State</th><th>Processing</th><th>Actions</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-slate-100"><td>{s.id}</td><td>{s.classDate}</td><td>{s.state}</td><td>{s.processingState}</td><td className="space-x-2"><Link className="text-indigo-600" to={`/attendance/${s.id}/upload`}>Upload</Link><Link className="text-indigo-600" to={`/attendance/${s.id}/review`}>Review</Link></td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
