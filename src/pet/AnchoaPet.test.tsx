import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnchoaPet } from "./AnchoaPet";
import { LautAko } from "./LautAko";

describe("AnchoaPet", () => {
  it("renders idle pet image with label", () => {
    const html = renderToStaticMarkup(<AnchoaPet status="idle" />);
    expect(html).toContain('aria-label="Ako: Diam"');
    expect(html).toContain("ako");
    expect(html).toContain("role=\"img\"");
  });

  it("renders listening and speaking statuses", () => {
    const listeningHtml = renderToStaticMarkup(<AnchoaPet status="listening" />);
    expect(listeningHtml).toContain('aria-label="Ako: Mendengarkan"');

    const speakingHtml = renderToStaticMarkup(<AnchoaPet status="speaking" level={0.8} />);
    expect(speakingHtml).toContain('aria-label="Ako: Berbicara"');
    expect(speakingHtml).toContain("lipsync");
  });

  it("renders button when onPoke is provided", () => {
    const html = renderToStaticMarkup(<AnchoaPet status="idle" onPoke={() => {}} />);
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Ako: Diam"');
  });

  it("renders crop=head with head class", () => {
    const html = renderToStaticMarkup(<AnchoaPet crop="head" size={44} />);
    expect(html).toContain("head");
    expect(html).toContain("tiny");
  });
});

describe("LautAko", () => {
  it("renders underwater svg backdrop", () => {
    const html = renderToStaticMarkup(<LautAko />);
    expect(html).toContain("laut");
    expect(html).toContain('viewBox="0 0 400 400"');
  });
});
