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

  const renderEditor = (body: string) =>
    renderToStaticMarkup(<BlockEditor {...defaultProps} body={body} />);

  const expectContains = (html: string, expectedSnippets: readonly string[]) => {
    for (const snippet of expectedSnippets) {
      expect(html).toContain(snippet);
    }
  };

  it("renders placeholder on empty body", () => {
    const html = renderEditor("");

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

    const html = renderEditor(body);

    // Each block in preview mode is a <button type="button">
    const buttonMatches = html.match(/<button type="button"/g);
    expect(buttonMatches).toHaveLength(3);

    expectContains(html, [
      "Rencana Peluncuran",
      "<h2",
      "Item langkah 1",
      "Item langkah 2",
      "<ul",
      "<pre",
      "const status = &#x27;ok&#x27;;",
    ]);
  });

  it.each([
    [
      "renders resolved and unresolved wikilinks in preview mode",
      "Lihat [[Halaman Ada]] dan [[Halaman Belum Dibuat]]",
      ["text-accent", "Halaman Ada", "border-dashed", "Halaman Belum Dibuat"],
    ],
    [
      "renders todo items with checkboxes",
      "- [x] Selesai\n- [ ] Belum selesai",
      ['type="checkbox"', "checked", "Selesai", "Belum selesai"],
    ],
    [
      "renders blockquotes and numbered lists",
      "> Sebuah kutipan\n\n1. Langkah pertama\n2. Langkah kedua",
      ["<blockquote", "Sebuah kutipan", "<ol", "Langkah pertama", "Langkah kedua"],
    ],
  ])("%s", (_name, body, expectedSnippets) => {
    expectContains(renderEditor(body), expectedSnippets);
  });

  it.each([
    ["# Judul 1", "<h2", "Judul 1"],
    ["## Judul 2", "<h3", "Judul 2"],
    ["### Judul 3", "<h4", "Judul 3"],
  ])("renders heading level for %s", (body, tag, label) => {
    const html = renderEditor(body);
    expect(html).toContain(tag);
    expect(html).toContain(label);
  });
});
