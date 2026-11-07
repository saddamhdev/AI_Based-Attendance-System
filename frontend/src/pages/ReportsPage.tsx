import { useEffect, useState } from "react";
import { Card } from "../components/ui/card";
import { api } from "../lib/api";

export function ReportsPage() {
  const [report, setReport] = useState<any>();
  useEffect(() => { api.reports().then(setReport).catch(() => {}); }, []);

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Attendance reports</h2>
      {!report ? <p>Loading...</p> : <div className="space-y-1 text-sm">
        <p>Finalized sessions: {report.finalizedSessions}</p>
        <p>Total records: {report.totalRecords}</p>
        <p>Present records: {report.presentRecords}</p>
        <p>Attendance percentage: {Number(report.attendancePercentage).toFixed(2)}%</p>
        <p className="text-slate-500">Denominator: {report.denominatorRule}</p>
      </div>}
      <p className="mt-3 text-xs text-slate-500">CSV/PDF export hooks can be added using this summarized finalized data.</p>
    </Card>
  );
}
