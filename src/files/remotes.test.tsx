import { describe, expect, it, spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteBadge } from "./RemoteBadge";
import { isRemotePath, isWithin, listFolder, normalizeRemoteTarget } from "./remotes";

describe("file manager remotes — helpers", () => {
  describe("isRemotePath", () => {
    it("detects the rclone prefix", () => {
      expect(isRemotePath("rclone:gdrive:")).toBe(true);
      expect(isRemotePath("rclone:gdrive:Docs/Files")).toBe(true);
      expect(isRemotePath("/home/user")).toBe(false);
      expect(isRemotePath("")).toBe(false);
      expect(isRemotePath("random")).toBe(false);
    });
  });

  describe("normalizeRemoteTarget", () => {
    it("returns a bare remote for a bare remote path", () => {
      expect(normalizeRemoteTarget("rclone:gdrive:")).toBe("rclone:gdrive:");
    });
    it("trims leading and trailing slashes from the sub-path", () => {
      expect(normalizeRemoteTarget("rclone:gdrive:/Docs//")).toBe("rclone:gdrive:Docs");
    });
    it("trims surrounding whitespace", () => {
      expect(normalizeRemoteTarget("  rclone:gdrive:Docs  ")).toBe("rclone:gdrive:Docs");
    });
    it("keeps inner path segments intact", () => {
      expect(normalizeRemoteTarget("rclone:my-remote:sub/path/file.txt")).toBe(
        "rclone:my-remote:sub/path/file.txt",
      );
    });
  });

  describe("isWithin", () => {
    it("matches the root itself and its descendants only", () => {
      expect(isWithin("/home/u", "/home/u")).toBe(true);
      expect(isWithin("/home/u/mnt/nas", "/home/u")).toBe(true);
      expect(isWithin("/home/user2", "/home/u")).toBe(false);
      expect(isWithin("/mnt/nas", "/home/u")).toBe(false);
      expect(isWithin("/home/u", "")).toBe(false);
    });
  });

  describe("listFolder", () => {
    it("routes rclone paths to list_remote with the canonical target", async () => {
      const spy = spyOn(core, "invoke").mockResolvedValue({});
      try {
        await listFolder("rclone:gdrive:/Docs/", true);
        expect(spy).toHaveBeenCalledWith("list_remote", { path: "rclone:gdrive:Docs", hidden: true });
      } finally {
        spy.mockRestore();
      }
    });

    it("keeps local paths on the guarded list_dir command", async () => {
      const spy = spyOn(core, "invoke").mockResolvedValue({});
      try {
        await listFolder("/home/u", false);
        expect(spy).toHaveBeenCalledWith("list_dir", { path: "/home/u", hidden: false });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("RemoteBadge", () => {
    it("renders an accessible cloud glyph with the given className", () => {
      const html = renderToStaticMarkup(<RemoteBadge className="text-accent" />);
      expect(html).toMatch(/<svg[^>]*>/);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("text-accent");
    });
    it("renders without a custom className", () => {
      const html = renderToStaticMarkup(<RemoteBadge />);
      expect(html).toMatch(/<svg[^>]*>/);
      expect(html).toContain('aria-hidden="true"');
    });
  });
});
