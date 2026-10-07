import { describe, expect, it, spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { api, errorMessage, type SecurityStatus } from "./api";

describe("Security API wrappers", () => {
  it("formats error messages correctly for string and object errors", () => {
    expect(errorMessage("Anchoa terkunci")).toBe("Anchoa terkunci");
    expect(errorMessage({ code: "locked", message: "Anchoa terkunci" })).toBe("Anchoa terkunci");
    expect(errorMessage(new Error("Anchoa terkunci"))).toBe("Anchoa terkunci");
  });

  it("calls security_status command via invoke", async () => {
    const expected: SecurityStatus = { pinEnabled: true, passwordEnabled: false, locked: true };
    const spy = spyOn(core, "invoke").mockResolvedValueOnce(expected);
    const result = await api.securityStatus();
    expect(spy).toHaveBeenCalledWith("security_status");
    expect(result).toEqual(expected);
    spy.mockRestore();
  });

  it("calls unlock command with pin", async () => {
    const spy = spyOn(core, "invoke").mockResolvedValueOnce(undefined);
    await api.unlock("1234");
    expect(spy).toHaveBeenCalledWith("unlock", { pin: "1234" });
    spy.mockRestore();
  });

  it("calls set_pin command with new pin and null old pin", async () => {
    const spy = spyOn(core, "invoke").mockResolvedValueOnce(undefined);
    await api.setPin(null, "1234");
    expect(spy).toHaveBeenCalledWith("set_pin", { old: null, new: "1234" });
    spy.mockRestore();
  });

  it("calls set_pin command with both old and new pin", async () => {
    const spy = spyOn(core, "invoke").mockResolvedValueOnce(undefined);
    await api.setPin("1234", "5678");
    expect(spy).toHaveBeenCalledWith("set_pin", { old: "1234", new: "5678" });
    spy.mockRestore();
  });

  it("calls disable_pin command with pin", async () => {
    const spy = spyOn(core, "invoke").mockResolvedValueOnce(undefined);
    await api.disablePin("1234");
    expect(spy).toHaveBeenCalledWith("disable_pin", { pin: "1234" });
    spy.mockRestore();
  });
});
