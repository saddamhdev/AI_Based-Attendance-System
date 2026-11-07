import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { api } from "../lib/api";

const statusStyle: Record<string, string> = {
  PROPOSED_PRESENT: "bg-green-100 text-green-700",
  PRESENT: "bg-green-100 text-green-700",
  PROPOSED_ABSENT: "bg-red-100 text-red-700",
  ABSENT: "bg-red-100 text-red-700",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-700",
};

export function ReviewPage() {
  const { sessionId } = useParams();
  const [review, setReview] = useState<any>(null);
  const [error, setError] = useState("");

  const load = () => api.review(Number(sessionId)).then(setReview).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [sessionId]);

  if (!review) return <Card className="p-4">Loading review...</Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Photo panel</h2>
        <p className="text-sm text-slate-600">Bounding-box overlays and per-face selection are supported by backend AI outputs. Unknown faces remain unassigned.</p>
        <p className="mt-2 text-xs text-amber-700">{review.draftNotice}</p>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Roster panel</h2>
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <p>Enrolled: {review.enrolledStudents}</p>
          <p>Review required: {review.reviewRequired}</p>
          <p>Proposed present: {review.proposedPresent}</p>
          <p>Proposed absent: {review.proposedAbsent}</p>
        </div>
        <div className="space-y-2">
          {review.roster.map((item: any) => (
            <div key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 p-2">
              <div>
                <p className="font-medium">{item.student.fullName}</p>
                <p className="text-xs text-slate-500">Similarity: {item.similarityScore ?? "N/A"} (not calibrated probability)</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={statusStyle[item.status]}>{item.status}</Badge>
                <Button size="sm" variant="secondary" onClick={() => api.mark(Number(sessionId), item.student.id, { status: "PRESENT", reason: "Manual override" }).then(load)}>Present</Button>
                <Button size="sm" variant="danger" onClick={() => api.mark(Number(sessionId), item.student.id, { status: "ABSENT", reason: "Manual override" }).then(load)}>Absent</Button>
              </div>
            </div>
          ))}
        </div>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={load}><AlertTriangle className="mr-2 h-4 w-4" />Save draft</Button>
          <Button onClick={() => api.confirm(Number(sessionId)).then(load).catch((e) => setError(e.message))}><CheckCircle2 className="mr-2 h-4 w-4" />Review and confirm</Button>
          <Button variant="danger" disabled><XCircle className="mr-2 h-4 w-4" />Double submit blocked</Button>
        </div>
      </Card>
    </div>
  );
}
