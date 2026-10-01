import { beforeEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { resetBlockIdCounterForTests } from "./blocks";
import { BlockEditor } from "./BlockEditor";

describe("BlockEditor", () => {
  beforeEach(() => {
    resetBlockIdCounterForTests(1);
  });

  const defaultProps = {
    pageId: "page-1",
    titles: ["Halaman Ada", "Rencana Proyek"],
    onChange: () => {},
    onOpenLink: () => {},
    onOpenUrl: () => {},
    onCreatePage: async () => {},
  };

  it("renders placeholder on empty body", () => {
    const html = renderToStaticMarkup(
      <BlockEditor {...defaultProps} body="" />,
    );

    expect(html).toContain("Ketik / untuk jenis blok, [[ untuk menautkan");
    expect(html).toContain('<button type="button"');
  });

  it("renders three previews as buttons for body with heading, list, and code", () => {
    const body = [
      "# Rencana Peluncuran",
      "",
      "- Item langkah 1\n- Item langkah 2",
      "",
      "```typescript\nconst status = 'ok';\n```",
    ].join("\n");

    const html = renderToStaticMarkup(
      <BlockEditor {...defaultProps} body={body} />,
    );

    // Each block in preview mode is a <button type="button">
    const buttonMatches = html.match(/<button type="button"/g);
    expect(buttonMatches).toHaveLength(3);

    expect(html).toContain("Rencana Peluncuran");
    expect(html).toContain("<h2");
    expect(html).toContain("Item langkah 1");
    expect(html).toContain("Item langkah 2");
    expect(html).toContain("<ul");
    expect(html).toContain("<pre");
    expect(html).toContain("const status = &#x27;ok&#x27;;");
  });

  it("renders resolved and unresolved wikilinks in preview mode", () => {
    const body = "Lihat [[Halaman Ada]] dan [[Halaman Belum Dibuat]]";
    const html = renderToStaticMarkup(
      <BlockEditor {...defaultProps} body={body} />,
    );

    // Resolved link has accent styling
    expect(html).toContain("text-accent");
    expect(html).toContain("Halaman Ada");

    // Unresolved link has dashed border styling
    expect(html).toContain("border-dashed");
    expect(html).toContain("Halaman Belum Dibuat");
  });

  it("renders todo items with checkboxes", () => {
    const body = "- [x] Selesai\n- [ ] Belum selesai";
    const html = renderToStaticMarkup(
      <BlockEditor {...defaultProps} body={body} />,
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("Selesai");
    expect(html).toContain("Belum selesai");
  });

  it("renders blockquotes and numbered lists", () => {
    const body = "> Sebuah kutipan\n\n1. Langkah pertama\n2. Langkah kedua";
    const html = renderToStaticMarkup(
      <BlockEditor {...defaultProps} body={body} />,
    );

    expect(html).toContain("<blockquote");
    expect(html).toContain("Sebuah kutipan");
    expect(html).toContain("<ol");
    expect(html).toContain("Langkah pertama");
    expect(html).toContain("Langkah kedua");
  });

  it.each([
    ["# Judul 1", "<h2", "Judul 1"],
    ["## Judul 2", "<h3", "Judul 2"],
    ["### Judul 3", "<h4", "Judul 3"],
  ])("renders heading level for %s", (body, tag, label) => {
    const html = renderToStaticMarkup(
      <BlockEditor {...defaultProps} body={body} />,
    );
    expect(html).toContain(tag);
    expect(html).toContain(label);
  });
});
