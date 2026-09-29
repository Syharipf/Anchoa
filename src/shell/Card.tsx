import type { ReactNode } from "react";
import { H2, PANEL } from "./ui";

export function Card({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className={`${PANEL} flex flex-col gap-1`}>
      <h2 className={`${H2} mb-2`}>{title}</h2>
      {children}
    </section>
  );
}
