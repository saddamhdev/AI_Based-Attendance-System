import { Bell, BookOpenCheck, BookText, ClipboardList, LogOut, Settings, Users } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: BookOpenCheck },
  { to: "/students", label: "Students", icon: Users },
  { to: "/courses", label: "Courses", icon: BookText },
  { to: "/attendance", label: "Attendance", icon: BookOpenCheck },
  { to: "/history", label: "History", icon: ClipboardList },
  { to: "/reports", label: "Reports", icon: ClipboardList },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 p-4 md:grid-cols-[240px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4">
          <Link to="/dashboard" className="mb-4 block text-lg font-semibold text-indigo-700">Attendance AI</Link>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"}`
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main>
          <header className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <h1 className="text-lg font-semibold">Student Attendance Management</h1>
              <p className="text-xs text-slate-500">Session: {user?.role}</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-slate-200 p-2" aria-label="Notifications"><Bell className="h-4 w-4" /></button>
              <button className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm" onClick={logout}>
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </header>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
