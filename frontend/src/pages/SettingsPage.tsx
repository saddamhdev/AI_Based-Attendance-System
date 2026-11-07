import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.settings().then((items) => {
      const mapped = Object.fromEntries(items.map((item: any) => [item.key, item.value]));
      setSettings(mapped);
    }).catch(() => {});
  }, []);

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Settings</h2>
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <label className="text-sm">Recognition threshold</label>
          <Input value={settings.recognition_threshold ?? ""} onChange={(e) => setSettings({ ...settings, recognition_threshold: e.target.value })} />
        </div>
        <div>
          <label className="text-sm">Photo retention days</label>
          <Input value={settings.photo_retention_days ?? ""} onChange={(e) => setSettings({ ...settings, photo_retention_days: e.target.value })} />
        </div>
      </div>
      <Button className="mt-3" onClick={async () => {
        await api.updateSettings(settings);
        setMessage("Settings updated.");
      }}>Save settings</Button>
      {message ? <p className="mt-2 text-sm text-green-700">{message}</p> : null}
      <p className="mt-3 text-xs text-slate-500">Consent withdrawal and biometric deletion workflows are enforced in backend audit and retention controls.</p>
    </Card>
  );
}
