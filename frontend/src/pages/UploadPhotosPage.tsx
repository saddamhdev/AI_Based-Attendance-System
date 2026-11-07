import { UploadCloud } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { api } from "../lib/api";

export function UploadPhotosPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("Upload 2-3 classroom photos with visible faces.");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  return (
    <Card className="p-4">
      <h2 className="mb-2 text-lg font-semibold">Upload classroom photos</h2>
      <p className="mb-3 text-sm text-slate-600">Processing stages: Uploading → Detecting faces → Matching students → Ready for review.</p>
      <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">{files.map((f) => <span key={f.name} className="rounded bg-slate-100 px-2 py-1">{f.name}</span>)}</div>
      {error ? <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <p className="mt-3 text-sm">{status}</p>
      <Button className="mt-3" disabled={loading} onClick={async () => {
        setLoading(true); setError("");
        try {
          setStatus("Uploading...");
          await api.uploadPhotos(Number(sessionId), files);
          setStatus("Processing requested. Open review in a few moments.");
          navigate(`/attendance/${sessionId}/review`);
        } catch (e) {
          setError((e as Error).message);
          setStatus("Upload failed. You can retry or proceed with manual attendance.");
        } finally { setLoading(false); }
      }}><UploadCloud className="mr-2 h-4 w-4" /> {loading ? "Uploading..." : "Start processing"}</Button>
    </Card>
  );
}
