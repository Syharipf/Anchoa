import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type EmailMessage } from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { Dialog } from "../shell/Dialog";
import { ConnectionForm } from "./ConnectionForm";
import { ComposeDialog } from "./ComposeDialog";
import { EmailList } from "./EmailList";
import { EmailPage } from "./EmailPage";
import { ReadingPane } from "./ReadingPane";

const message: EmailMessage = {
  id: "mail-1", folder: "INBOX", uid: 1, subject: "Halo", body: "Pesan pertama",
  messageId: "welcome@example.com", fromName: "Siti", fromAddr: "siti@example.com",
  toAddrs: ["anchoa@gmail.com"], sentAt: new Date(2026, 9, 2, 9).getTime(),
  unread: true, starred: false, hasHtml: false, bodyCached: false,
};

describe("email UI", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  const spies: { mockRestore: () => void }[] = [];
  afterEach(() => {
    harness?.dispose();
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });
  function start(component: () => ReactNode) {
    harness = hookHarness(component);
    harness.render();
  }
  function element(type: unknown, key?: string, value?: unknown) {
    const found = elements(harness.render()).find((el) => el.type === type && (!key || el.props[key] === value));
    expect(found).toBeDefined();
    return found!;
  }
  function change(id: string, value: string) {
    (element("input", "id", id).props.onChange as (event: unknown) => void)({ target: { value } });
  }
  async function submit() {
    await (element("form").props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    await harness.settle();
  }
  function connectedPage() {
    spies.push(spyOn(api, "emailStatus").mockResolvedValue({ connected: true, address: "anchoa@gmail.com" }));
    spies.push(spyOn(api, "emailSync").mockResolvedValue({ headers: 1 }));
    const list = spyOn(api, "emailList").mockResolvedValue([message]);
    spies.push(list);
    start(EmailPage);
    return list;
  }

  it.each([true, false])("clears the App Password immediately on submit (success=%s)", async (success) => {
    const pending = deferred<{ connected: boolean; address: string | null }>();
    const connect = spyOn(api, "emailConnect").mockReturnValue(pending.promise);
    spies.push(connect);
    const onConnected = mock(() => {});
    start(() => ConnectionForm({ onConnected }));
    change("email-address", "anchoa@gmail.com");
    change("email-password", "abcdefghijklmnop");
    expect(element("input", "id", "email-password").props.type).toBe("password");
    const submitting = (element("form").props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    expect(element("input", "id", "email-password").props.value).toBe("");
    expect(connect).toHaveBeenCalledWith("anchoa@gmail.com", "abcdefghijklmnop");
    if (success) pending.resolve({ connected: true, address: "anchoa@gmail.com" });
    else pending.reject(new Error("Login gagal"));
    await submitting;
    await harness.settle();
    expect(onConnected).toHaveBeenCalledTimes(success ? 1 : 0);
    if (!success) expect(element("p", "role", "alert").props.children).toBe("Login gagal");
  });

  it("also clears the password and reports a synchronous connection failure", async () => {
    spies.push(spyOn(api, "emailConnect").mockImplementation(() => { throw new Error("Layanan gagal"); }));
    start(() => ConnectionForm({ onConnected() {} }));
    change("email-address", "anchoa@gmail.com");
    change("email-password", "abcdefghijklmnop");
    await submit();
    expect(element("input", "id", "email-password").props.value).toBe("");
    expect(element("p", "role", "alert").props.children).toBe("Layanan gagal");
  });

  it("explains App Password setup and opens the Google page through api.openLink", async () => {
    const open = spyOn(api, "openLink").mockResolvedValue(undefined);
    spies.push(open);
    start(() => ConnectionForm({ onConnected() {} }));
    (element("button", "aria-label", "Buka Google App Password").props.onClick as () => void)();
    await harness.settle();
    expect(open).toHaveBeenCalledWith("https://myaccount.google.com/apppasswords");
    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Sambungkan Gmail");
    expect(html).toContain("2-Step Verification");
  });

  it("renders supported folders, unread tabs, lime dots and an independent star toggle", () => {
    const html = renderToStaticMarkup(<EmailList messages={[message]} folder="inbox" filter="all" loading={false}
      selectedId={null} busy={false} onFilter={() => {}} onOpen={() => {}} onStar={() => {}} />);
    expect(html).toContain("w-[340px]");
    expect(html).toContain("Semua");
    expect(html).toContain("Belum dibaca");
    expect(html).toContain("bg-accent");
    expect(html).toContain("Siti");
    expect(html).toContain("Halo");
    expect(html).toContain('aria-label="Bintangi Halo"');
  });

  it("renders malicious markup as text, no images, and opens only detected web links", async () => {
    const open = spyOn(api, "openLink").mockResolvedValue(undefined);
    spies.push(open);
    const body = '<img src="https://tracker.test/pixel" onerror="alert(1)">\n<script>alert(1)</script>\nBuka https://example.com/info.';
    start(() => ReadingPane({ message: { ...message, body }, busy: false, onStar() {}, onArchive() {}, onSent() {} }));
    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("pr-[88px]");
    (element("button", "aria-label", "Buka https://example.com/info").props.onClick as () => void)();
    await harness.settle();
    expect(open).toHaveBeenCalledWith("https://example.com/info");
    expect(elements(harness.render()).filter((el) => String(el.props["aria-label"]).startsWith("Buka https://"))).toHaveLength(2);
  });

  it.each([true, false])("sends a reply with one Re: prefix and clears only on success (%s)", async (success) => {
    const send = spyOn(api, "emailSend");
    if (success) send.mockResolvedValue(undefined);
    else send.mockRejectedValue(new Error("Kirim gagal"));
    spies.push(send);
    const onSent = mock(() => {});
    start(() => ReadingPane({ message: { ...message, subject: "re: Re: Halo" }, busy: false, onStar() {}, onArchive() {}, onSent }));
    const reply = () => element("textarea", "aria-label", "Tulis balasan");
    (reply().props.onChange as (event: unknown) => void)({ target: { value: "Terima kasih" } });
    await submit();
    expect(send).toHaveBeenCalledWith({ to: ["siti@example.com"], subject: "Re: Halo", body: "Terima kasih", replyToId: "mail-1" });
    expect(reply().props.value).toBe(success ? "" : "Terima kasih");
    expect(onSent).toHaveBeenCalledTimes(success ? 1 : 0);
    if (!success) expect(element("p", "role", "alert").props.children).toBe("Kirim gagal");
  });

  it.each([true, false])("uses Dialog for compose and preserves the draft on send errors (%s)", async (success) => {
    const send = spyOn(api, "emailSend");
    if (success) send.mockResolvedValue(undefined);
    else send.mockRejectedValue(new Error("SMTP gagal"));
    spies.push(send);
    const onClose = mock(() => {});
    const onSent = mock(() => {});
    start(() => ComposeDialog({ onClose, onSent }));
    expect(element(Dialog).props.title).toBe("Tulis email");
    change("email-to", "siti@example.com, dewi@example.com");
    change("email-subject", "Kabar");
    (element("textarea", "id", "email-body").props.onChange as (event: unknown) => void)({ target: { value: "Halo semua" } });
    await submit();
    expect(send).toHaveBeenCalledWith({ to: ["siti@example.com", "dewi@example.com"], subject: "Kabar", body: "Halo semua" });
    expect(onClose).toHaveBeenCalledTimes(success ? 1 : 0);
    expect(onSent).toHaveBeenCalledTimes(success ? 1 : 0);
    if (!success) expect(element("p", "role", "alert").props.children).toBe("SMTP gagal");
  });

  it("shows connection form without syncing until connected", async () => {
    spies.push(spyOn(api, "emailStatus").mockResolvedValue({ connected: false, address: null }));
    const sync = spyOn(api, "emailSync").mockResolvedValue({ headers: 1 });
    spies.push(sync, spyOn(api, "emailList").mockResolvedValue([message]));
    start(EmailPage);
    await harness.settle();
    expect(element(ConnectionForm)).toBeDefined();
    expect(sync).not.toHaveBeenCalled();
    (element(ConnectionForm).props.onConnected as (status: unknown) => void)({ connected: true, address: "anchoa@gmail.com" });
    await harness.settle();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("syncs on open, loads folder/filter selections, and supports manual sync", async () => {
    const list = connectedPage();
    await harness.settle();
    expect(api.emailSync).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenLastCalledWith("inbox", "all");
    (element("button", "aria-label", "Berbintang").props.onClick as () => void)();
    await harness.settle();
    expect(list).toHaveBeenLastCalledWith("starred", "all");
    (element(EmailList).props.onFilter as (filter: string) => void)("unread");
    await harness.settle();
    expect(list).toHaveBeenLastCalledWith("starred", "unread");
    (element("button", "aria-label", "Sinkronkan").props.onClick as () => void)();
    await harness.settle();
    expect(api.emailSync).toHaveBeenCalledTimes(2);
  });

  it("opens, marks a row read, toggles its star, and archives it", async () => {
    const list = connectedPage();
    const open = spyOn(api, "emailOpen").mockResolvedValue({ ...message, unread: false, bodyCached: true });
    const flag = spyOn(api, "emailSetFlag").mockResolvedValue(undefined);
    const archive = spyOn(api, "emailArchive").mockResolvedValue(undefined);
    spies.push(open, flag, archive);
    await harness.settle();
    list.mockResolvedValue([{ ...message, unread: false }]);
    await (element(EmailList).props.onOpen as (id: string) => Promise<void>)(message.id);
    await harness.settle();
    expect(open).toHaveBeenCalledWith("mail-1");
    expect((element(EmailList).props.messages as EmailMessage[])[0].unread).toBe(false);
    expect((element(ReadingPane).props.message as EmailMessage).bodyCached).toBe(true);
    await (element(ReadingPane).props.onStar as (mail: EmailMessage) => Promise<void>)({ ...message, unread: false });
    expect(flag).toHaveBeenCalledWith("mail-1", "starred", true);
    expect((element(ReadingPane).props.message as EmailMessage).starred).toBe(true);
    list.mockResolvedValue([]);
    await (element(ReadingPane).props.onArchive as (mail: EmailMessage) => Promise<void>)(message);
    await harness.settle();
    expect(archive).toHaveBeenCalledWith("mail-1");
    expect(elements(harness.render()).some((el) => el.type === ReadingPane)).toBe(false);
  });

  it("shows sync errors while keeping cached mail available", async () => {
    connectedPage();
    await harness.settle();
    (api.emailSync as unknown as ReturnType<typeof mock>).mockRejectedValue(new Error("Offline"));
    (element("button", "aria-label", "Sinkronkan").props.onClick as () => void)();
    await harness.settle();
    expect(element("p", "role", "alert").props.children).toBe("Offline");
    expect(element(EmailList).props.messages).toEqual([message]);
  });

  it("renders status errors with a working retry", async () => {
    const status = spyOn(api, "emailStatus").mockRejectedValueOnce(new Error("DB gagal"))
      .mockResolvedValue({ connected: false, address: null });
    spies.push(status);
    start(EmailPage);
    expect(element("span", "role", "status").props.children).toBe("Memuat akun email…");
    await harness.settle();
    expect(element("p", "role", "alert").props.children).toBe("DB gagal");
    (element("button", "children", "Coba lagi").props.onClick as () => void)();
    await harness.settle();
    expect(element(ConnectionForm)).toBeDefined();
  });

  it("displays list and sync loading until their responses arrive", async () => {
    connectedPage();
    const syncing = deferred<{ headers: number }>();
    const listing = deferred<EmailMessage[]>();
    (api.emailSync as unknown as ReturnType<typeof mock>).mockReturnValue(syncing.promise);
    (api.emailList as unknown as ReturnType<typeof mock>).mockReturnValue(listing.promise);
    await harness.settle();
    expect(element("button", "aria-label", "Sinkronkan").props.disabled).toBe(true);
    expect(element(EmailList).props.loading).toBe(true);
    syncing.resolve({ headers: 1 });
    listing.resolve([message]);
    await harness.settle();
    expect(element("button", "aria-label", "Sinkronkan").props.disabled).toBe(false);
    expect(element(EmailList).props.loading).toBe(false);
  });

  it("keeps the unread row and shows an error when opening fails", async () => {
    connectedPage();
    spies.push(spyOn(api, "emailOpen").mockRejectedValue(new Error("IMAP gagal")));
    await harness.settle();
    await (element(EmailList).props.onOpen as (id: string) => Promise<void>)(message.id);
    await harness.settle();
    expect(element("p", "role", "alert").props.children).toBe("IMAP gagal");
    expect((element(EmailList).props.messages as EmailMessage[])[0].unread).toBe(true);
  });

  it("removes an opened message from the unread list while retaining the reading pane", async () => {
    connectedPage();
    spies.push(spyOn(api, "emailOpen").mockResolvedValue({ ...message, unread: false }));
    await harness.settle();
    (element(EmailList).props.onFilter as (filter: string) => void)("unread");
    await harness.settle();
    await (element(EmailList).props.onOpen as (id: string) => Promise<void>)(message.id);
    await harness.settle();
    expect(element(EmailList).props.messages).toEqual([]);
    expect(element(ReadingPane)).toBeDefined();
  });

  it("keeps the latest selected message when opens complete out of order", async () => {
    connectedPage();
    const first = deferred<EmailMessage>();
    spies.push(spyOn(api, "emailOpen").mockReturnValueOnce(first.promise).mockResolvedValue({ ...message, id: "mail-2", subject: "Kedua" }));
    await harness.settle();
    const open = element(EmailList).props.onOpen as (id: string) => Promise<void>;
    const pending = open("mail-1");
    await open("mail-2");
    first.resolve(message);
    await pending;
    expect((element(ReadingPane).props.message as EmailMessage).id).toBe("mail-2");
  });

  it("prevents duplicate reply submissions while the send is pending", async () => {
    const pending = deferred<void>();
    const send = spyOn(api, "emailSend").mockReturnValue(pending.promise);
    spies.push(send);
    start(() => ReadingPane({ message, busy: false, onStar() {}, onArchive() {}, onSent() {} }));
    (element("textarea", "aria-label", "Tulis balasan").props.onChange as (event: unknown) => void)({ target: { value: "Balasan" } });
    const handler = element("form").props.onSubmit as (event: unknown) => Promise<void>;
    const event = { preventDefault() {} };
    const first = handler(event);
    await handler(event);
    expect(send).toHaveBeenCalledTimes(1);
    pending.resolve();
    await first;
  });

  it("drops stale folder and open responses", async () => {
    const list = connectedPage();
    await harness.settle();
    const oldList = deferred<EmailMessage[]>();
    list.mockReturnValueOnce(oldList.promise).mockResolvedValue([]);
    (element("button", "aria-label", "Berbintang").props.onClick as () => void)();
    harness.render();
    (element("button", "aria-label", "Terkirim").props.onClick as () => void)();
    await harness.settle();
    oldList.resolve([message]);
    await harness.settle();
    expect(element(EmailList).props.messages).toEqual([]);
    const pendingOpen = deferred<EmailMessage>();
    spies.push(spyOn(api, "emailOpen").mockReturnValue(pendingOpen.promise));
    const opening = (element(EmailList).props.onOpen as (id: string) => Promise<void>)(message.id);
    (element("button", "aria-label", "Kotak masuk").props.onClick as () => void)();
    harness.render();
    pendingOpen.resolve(message);
    await opening;
    await harness.settle();
    expect(elements(harness.render()).some((el) => el.type === ReadingPane)).toBe(false);
  });
});
