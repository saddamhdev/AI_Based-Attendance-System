import { useEffect, useState } from "react";
import { Card } from "../components/ui/card";
import { api } from "../lib/api";

export function CoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);

  useEffect(() => {
    api.courses().then(setCourses).catch(() => {});
    api.sections().then(setSections).catch(() => {});
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Courses</h2>
        <ul className="space-y-1 text-sm">
          {courses.map((course) => <li key={course.id}>{course.code} - {course.name}</li>)}
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Sections</h2>
        <ul className="space-y-1 text-sm">
          {sections.map((section) => <li key={section.id}>Section {section.sectionCode} (Course #{section.course.id})</li>)}
        </ul>
      </Card>
    </div>
  );
}
