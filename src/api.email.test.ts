import { expect, it, spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { api } from "./api";

it("email wrappers use the registered command names and camelCase arguments", async () => {
  const spy = spyOn(core, "invoke").mockResolvedValue(undefined);
  try {
    await api.emailStatus();
    expect(spy).toHaveBeenLastCalledWith("email_status");
    await api.emailConnect("anchoa@gmail.com", "abcdefghijklmnop");
    expect(spy).toHaveBeenLastCalledWith("email_connect", { address: "anchoa@gmail.com", appPassword: "abcdefghijklmnop" });
    await api.emailDisconnect();
    expect(spy).toHaveBeenLastCalledWith("email_disconnect");
    await api.emailSync();
    expect(spy).toHaveBeenLastCalledWith("email_sync");
    await api.emailList("inbox");
    expect(spy).toHaveBeenLastCalledWith("email_list", { folder: "inbox", filter: "all", limit: 200 });
    await api.emailList("starred", "unread", 20);
    expect(spy).toHaveBeenLastCalledWith("email_list", { folder: "starred", filter: "unread", limit: 20 });
    await api.emailOpen("id");
    expect(spy).toHaveBeenLastCalledWith("email_open", { id: "id" });
    await api.emailSetFlag("id", "starred", true);
    expect(spy).toHaveBeenLastCalledWith("email_set_flag", { id: "id", flag: "starred", on: true });
    await api.emailArchive("id");
    expect(spy).toHaveBeenLastCalledWith("email_archive", { id: "id" });
    const draft = { to: ["siti@example.com"], subject: "Balasan", body: "Terima kasih", replyToId: "id" };
    await api.emailSend(draft);
    expect(spy).toHaveBeenLastCalledWith("email_send", { draft });
  } finally {
    spy.mockRestore();
  }
});
