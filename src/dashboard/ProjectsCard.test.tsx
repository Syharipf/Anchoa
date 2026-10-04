import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectSummary } from "../api";
import { ProjectsCard } from "./ProjectsCard";

describe("ProjectsCard", () => {
  it("renders empty state when no projects exist", () => {
    const html = renderToStaticMarkup(
      <ProjectsCard projects={[]} onSelect={() => {}} />,
    );
    expect(html).toContain("Belum ada proyek");
  });

  it("renders up to 2 active projects with minimal 4px solid progress bar", () => {
    const projects: ProjectSummary[] = [
      {
        id: "p1",
        name: "Anchoa v1",
        status: "active",
        kind: "app",
        total: 10,
        done: 4,
        deadlineAt: null,
        deadlineDays: null,
      },
      {
        id: "p2",
        name: "Laporan akhir",
        status: "done",
        kind: "personal",
        total: 5,
        done: 5,
        deadlineAt: null,
        deadlineDays: null,
      },
      {
        id: "p3",
        name: "Proyek ketiga diabaikan",
        status: "active",
        kind: "app",
        total: 2,
        done: 1,
        deadlineAt: null,
        deadlineDays: null,
      },
    ];

    const html = renderToStaticMarkup(
      <ProjectsCard projects={projects} onSelect={() => {}} />,
    );

    expect(html).toContain("Anchoa v1");
    expect(html).toContain("40%");
    expect(html).toContain("Laporan akhir");
    expect(html).toContain("100%");
    expect(html).not.toContain("Proyek ketiga diabaikan");

    // Uses thin 4px solid bar with #262B35 track from artboard Main.dc.html
    expect(html).toContain("bg-[#262B35]");
    expect(html).toContain("h-1");
    expect(html).toContain("bg-accent");
    expect(html).toContain("bg-field-focus");
    // No fish silhouette in minimal project bars
    expect(html).not.toContain("anchoa-fish-school");
  });
});
