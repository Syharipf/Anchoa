import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockPreview, inlineTokens } from "./markdown";

describe("markdown", () => {
  describe("inlineTokens", () => {
    it("returns empty array for empty string", () => {
      expect(inlineTokens("")).toEqual([]);
    });

    it("parses bold text", () => {
      expect(inlineTokens("**tebal**")).toEqual([
        { type: "bold", value: "tebal" },
      ]);
    });

    it("parses italic text with asterisk and underscore", () => {
      expect(inlineTokens("*miring*")).toEqual([
        { type: "italic", value: "miring" },
      ]);
      expect(inlineTokens("_miring_")).toEqual([
        { type: "italic", value: "miring" },
      ]);
    });

    it("parses inline code without interpreting inner markdown", () => {
      expect(inlineTokens("`kode`")).toEqual([
        { type: "code", value: "kode" },
      ]);
      expect(inlineTokens("`**b** [[x]]`")).toEqual([
        { type: "code", value: "**b** [[x]]" },
      ]);
    });

    it("parses markdown links", () => {
      expect(inlineTokens("[Anchoa](https://anchoa.app)")).toEqual([
        { type: "link", text: "Anchoa", href: "https://anchoa.app" },
      ]);
    });

    it("parses wikilinks with and without alias", () => {
      expect(inlineTokens("[[Catatan]]")).toEqual([
        { type: "wikilink", title: "Catatan" },
      ]);
      expect(inlineTokens("[[Catatan|alias]]")).toEqual([
        { type: "wikilink", title: "Catatan", alias: "alias" },
      ]);
    });

    it.each([
      ["**teks tanpa penutup"],
      ["*teks tanpa penutup"],
      ["`teks tanpa penutup"],
      ["[teks tanpa penutup"],
      ["[teks](tanpa penutup"],
      ["[[teks tanpa penutup"],
    ])("preserves unclosed syntax as plain text for '%s'", (input) => {
      expect(inlineTokens(input)).toEqual([{ type: "text", value: input }]);
    });

    it("parses mixed inline tokens with surrounding plain text", () => {
      const tokens = inlineTokens(
        "Halo **tebal** dan *miring* serta `kode`, [[Catatan|c]], dan [Link](https://example.com)!",
      );
      expect(tokens).toEqual([
        { type: "text", value: "Halo " },
        { type: "bold", value: "tebal" },
        { type: "text", value: " dan " },
        { type: "italic", value: "miring" },
        { type: "text", value: " serta " },
        { type: "code", value: "kode" },
        { type: "text", value: ", " },
        { type: "wikilink", title: "Catatan", alias: "c" },
        { type: "text", value: ", dan " },
        { type: "link", text: "Link", href: "https://example.com" },
        { type: "text", value: "!" },
      ]);
    });
  });

  describe("BlockPreview", () => {
    const defaultProps = {
      isResolved: () => false,
      onOpenLink: () => {},
      onOpenUrl: () => {},
      onToggleTodo: () => {},
    };

    it("does not render javascript: links as <a> tags", () => {
      const html = renderToStaticMarkup(
        <BlockPreview
          {...defaultProps}
          text="[bahaya](javascript:alert(1))"
        />,
      );
      expect(html).not.toContain("<a");
      expect(html).toContain("bahaya");
    });

    it("renders http and https links as <a> tags", () => {
      const html = renderToStaticMarkup(
        <BlockPreview
          {...defaultProps}
          text="[Anchoa](https://anchoa.app)"
        />,
      );
      expect(html).toContain('<a href="https://anchoa.app"');
      expect(html).toContain("Anchoa");
    });

    it("renders todo list with checkbox and checked attribute", () => {
      const html = renderToStaticMarkup(
        <BlockPreview
          {...defaultProps}
          text={"- [ ] Belum selesai\n- [x] Sudah selesai"}
        />,
      );
      expect(html).toContain('type="checkbox"');
      expect(html).toContain("checked");
      expect(html).toContain("Belum selesai");
      expect(html).toContain("Sudah selesai");
    });

    it("renders code blocks as <pre> and displays [[x]] as text", () => {
      const html = renderToStaticMarkup(
        <BlockPreview
          {...defaultProps}
          text={"```ts\nconst a = [[x]];\n```"}
        />,
      );
      expect(html).toContain("<pre");
      expect(html).toContain("<code>");
      expect(html).toContain("[[x]]");
      expect(html).not.toContain("<a");
    });

    it("applies dashed line class to unresolved wikilinks", () => {
      const html = renderToStaticMarkup(
        <BlockPreview
          {...defaultProps}
          isResolved={(title) => title === "Ada"}
          text="Tautan ke [[Belum Ada]]"
        />,
      );
      expect(html).toContain("dashed");
      expect(html).toContain("Belum Ada");
    });

    it("applies accent color to resolved wikilinks", () => {
      const html = renderToStaticMarkup(
        <BlockPreview
          {...defaultProps}
          isResolved={(title) => title === "Ada"}
          text="Tautan ke [[Ada]]"
        />,
      );
      expect(html).toContain("text-accent");
      expect(html).not.toContain("dashed");
      expect(html).toContain("Ada");
    });

    it.each([
      ["# Judul Utama", "<h2", "Judul Utama", "# "],
      ["## Sub Judul", "<h3", "Sub Judul", "## "],
      ["### Bagian Kecil", "<h4", "Bagian Kecil", "### "],
    ])("renders heading level %s", (text, tag, label, marker) => {
      const html = renderToStaticMarkup(
        <BlockPreview {...defaultProps} text={text} />,
      );
      expect(html).toContain(tag);
      expect(html).toContain(label);
      expect(html).not.toContain(marker);
    });

    it("renders bullet and numbered lists", () => {
      const bulletHtml = renderToStaticMarkup(
        <BlockPreview {...defaultProps} text={"- Poin satu\n- Poin dua"} />,
      );
      expect(bulletHtml).toContain("<ul");
      expect(bulletHtml).toContain("<li");
      expect(bulletHtml).toContain("Poin satu");
      expect(bulletHtml).toContain("Poin dua");

      const numHtml = renderToStaticMarkup(
        <BlockPreview {...defaultProps} text={"1. Pertama\n2. Kedua"} />,
      );
      expect(numHtml).toContain("<ol");
      expect(numHtml).toContain("<li");
      expect(numHtml).toContain("Pertama");
      expect(numHtml).toContain("Kedua");
    });

    it("renders quotes as <blockquote>", () => {
      const quoteHtml = renderToStaticMarkup(
        <BlockPreview {...defaultProps} text="> Ini sebuah kutipan" />,
      );
      expect(quoteHtml).toContain("<blockquote");
      expect(quoteHtml).toContain("Ini sebuah kutipan");
      expect(quoteHtml).not.toContain("> ");
    });
  });
});
