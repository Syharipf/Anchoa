import type { ReactNode } from "react";

export function Card({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}
