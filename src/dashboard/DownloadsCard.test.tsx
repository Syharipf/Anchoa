import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DownloadsSummary } from "../api";
import { DownloadsCard } from "./DownloadsCard";

describe("DownloadsCard", () => {
  it("renders empty state with 'Tidak ada unduhan aktif'", () => {
    const html = renderToStaticMarkup(
      <DownloadsCard downloads={{ speed: 0, items: [] }} onSelect={() => {}} />,
    );
    expect(html).toContain("Unduhan");
    expect(html).toContain("Tidak ada unduhan aktif");
  });

  it("renders undefined downloads as empty", () => {
    const html = renderToStaticMarkup(
      <DownloadsCard onSelect={() => {}} />,
    );
    expect(html).toContain("Unduhan");
    expect(html).toContain("Tidak ada unduhan aktif");
  });

  it("renders active downloads with progress and speed", () => {
    const summary: DownloadsSummary = {
      speed: 8_200_000,
      items: [
        {
          id: "d1",
          title: "Tutorial rigging Live2D",
          progress: 63,
          doneBytes: 630,
          totalBytes: 1000,
          speed: 8_200_000,
          eta: 19,
          status: "running",
        },
        {
          id: "d2",
          title: "Klip musik",
          progress: 100,
          doneBytes: 500,
          totalBytes: 500,
          speed: null,
          eta: null,
          status: "processing",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <DownloadsCard downloads={summary} onSelect={() => {}} />,
    );
    expect(html).toContain("Unduhan");
    expect(html).toContain("Tutorial rigging Live2D");
    expect(html).toContain("63%");
    expect(html).toContain("19 dtk lagi");
    expect(html).toContain("Klip musik");
    expect(html).toContain("Memproses (ffmpeg)…");
    expect(html).toContain("↓ 7,8 MB/s");
    expect(html).not.toContain("Tidak ada unduhan aktif");
  });
});
