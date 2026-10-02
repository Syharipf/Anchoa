import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type EmailAssistance, type EmailMessage } from "../api";
import { ProposalCard } from "../assistant/ProposalCard";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { Dialog } from "../shell/Dialog";
import { ConnectionForm } from "./ConnectionForm";
import { ComposeDialog } from "./ComposeDialog";
import { EmailList } from "./EmailList";
import { EmailPage } from "./EmailPage";
import { ReadingPane } from "./ReadingPane";
import { StarButton } from "./StarButton";
import { textParts } from "./view";

const message: EmailMessage = {
  id: "mail-1", folder: "INBOX", uid: 1, subject: "Halo", body: "Pesan pertama",
  messageId: "welcome@example.com", fromName: "Siti", fromAddr: "siti@example.com",
  toAddrs: ["anchoa@gmail.com"], sentAt: new Date(2026, 9, 2, 9).getTime(),
  unread: true, starred: false, hasHtml: false, bodyCached: false,
};

const assistance: EmailAssistance = {
  summary: ["Siti meminta laporan.", "Kirim sebelum Jumat."],
  replies: ["Baik, saya siapkan.", "Laporan segera saya kirim.", "Bisa kita diskusikan dulu?"],
  action: { id: "proposal-1", name: "create_task", summary: "Buat tugas laporan", args: { title: "Siapkan laporan" } },
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
    start(() => EmailPage({}));
    return list;
  }

  function readingPane(onChanged?: () => void) {
    start(() => ReadingPane({ message, busy: false, onStar() {}, onArchive() {}, onSent() {}, onChanged }));
  }

  async function assist() {
    await (element("button", "aria-label", "Ringkas email").props.onClick as () => Promise<void>)();
    await harness.settle();
  }

  it("requests a summary on demand, shows loading, and queues an action for approval", async () => {
    const pending = deferred<EmailAssistance>();
    const generate = spyOn(api, "emailAssist").mockReturnValue(pending.promise);
    const decide = spyOn(api, "assistantDecide").mockResolvedValue(null);
    spies.push(generate, decide);
    readingPane();
    expect(renderToStaticMarkup(harness.render())).toContain("Ringkasan asisten");
    expect(generate).not.toHaveBeenCalled();
    const handler = element("button", "aria-label", "Ringkas email").props.onClick as () => Promise<void>;
    const request = handler();
    await handler();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(message.id);
    expect(element("button", "aria-label", "Ringkas email").props.disabled).toBe(true);
    expect(element("p", "role", "status").props.children).toBe("Asisten sedang merangkum…");
    pending.resolve(assistance);
    await request;
    await harness.settle();
    expect(elements(harness.render()).filter((el) => el.type === "li").map((el) => el.props.children)).toEqual(assistance.summary);
    expect(element(ProposalCard).props.proposal).toEqual(assistance.action);
    expect(decide).not.toHaveBeenCalled();
  });

  it("fills the reply from a suggestion without sending or approving anything", async () => {
    const send = spyOn(api, "emailSend").mockResolvedValue(undefined);
    const decide = spyOn(api, "assistantDecide").mockResolvedValue(null);
    spies.push(send, decide, spyOn(api, "emailAssist").mockResolvedValue(assistance));
    readingPane();
    await assist();
    for (const reply of assistance.replies) {
      const suggestion = element("button", "children", reply);
      expect(suggestion.props.type).toBe("button");
      (suggestion.props.onClick as () => void)();
      expect(element("textarea", "id", "email-reply").props.value).toBe(reply);
    }
    expect(send).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("shows assistant errors and allows retry", async () => {
    spies.push(spyOn(api, "emailAssist").mockRejectedValueOnce({ message: "Jawaban model tidak valid" })
      .mockResolvedValue({ ...assistance, action: null }));
    readingPane();
    await assist();
    expect(element("p", "role", "alert").props.children).toBe("Jawaban model tidak valid");
    expect(element("button", "aria-label", "Ringkas email").props.disabled).toBe(false);
    await assist();
    expect(elements(harness.render()).some((el) => el.props.role === "alert")).toBe(false);
    expect(elements(harness.render()).some((el) => el.type === ProposalCard)).toBe(false);
  });

  it.each([true, false])("uses the existing approval command and clears a decided proposal (%s)", async (approve) => {
    const decide = spyOn(api, "assistantDecide").mockRejectedValueOnce(new Error("Coba keputusan lagi"))
      .mockResolvedValue(null);
    spies.push(decide, spyOn(api, "emailAssist").mockResolvedValue(assistance));
    const changed = mock(() => {});
    readingPane(changed);
    await assist();
    const handler = element(ProposalCard).props.onDecide as (id: string, approve: boolean) => Promise<void>;
    await expect(handler("proposal-1", approve)).rejects.toThrow("Coba keputusan lagi");
    expect(element("p", "role", "alert").props.children).toBe("Coba keputusan lagi");
    expect(element(ProposalCard)).toBeDefined();
    await handler("proposal-1", approve);
    await harness.settle();
    expect(decide).toHaveBeenLastCalledWith("proposal-1", approve);
    expect(changed).toHaveBeenCalledTimes(approve ? 1 : 0);
    expect(elements(harness.render()).some((el) => el.type === ProposalCard)).toBe(false);
  });

  it("rejects a shown proposal when another email is selected", async () => {
    const decide = spyOn(api, "assistantDecide").mockResolvedValue(null);
    spies.push(decide, spyOn(api, "emailAssist").mockResolvedValue(assistance));
    let selected = message;
    start(() => ReadingPane({ message: selected, busy: false, onStar() {}, onArchive() {}, onSent() {} }));
    await assist();
    selected = { ...message, id: "mail-2" };
    harness.render();
    await harness.settle();
    expect(decide).toHaveBeenCalledWith("proposal-1", false);
  });

  it("discards a summary that finishes after selecting another email", async () => {
    const pending = deferred<EmailAssistance>();
    const decide = spyOn(api, "assistantDecide").mockResolvedValue(null);
    spies.push(decide, spyOn(api, "emailAssist").mockReturnValue(pending.promise));
    let selected = message;
    start(() => ReadingPane({ message: selected, busy: false, onStar() {}, onArchive() {}, onSent() {} }));
    const request = (element("button", "aria-label", "Ringkas email").props.onClick as () => Promise<void>)();
    selected = { ...message, id: "mail-2" };
    harness.render();
    pending.resolve(assistance);
    await request;
    await harness.settle();
    expect(elements(harness.render()).some((el) => el.type === "li" || el.type === ProposalCard)).toBe(false);
    expect(element("button", "aria-label", "Ringkas email").props.disabled).toBe(false);
    expect(decide).toHaveBeenCalledWith("proposal-1", false);
  });

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
    const link = element("button", "children", "myaccount.google.com/apppasswords");
    expect(link.props["aria-label"]).toBeUndefined();
    (link.props.onClick as () => void)();
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
    expect(html).toContain("<time");
    expect(html).not.toContain('aria-label="Buka email');
    expect(html).not.toContain('aria-label="Belum dibaca"');
    expect(html).toContain('aria-hidden="true" class="absolute top-4 left-2');
    expect(html).toContain('<span class="sr-only">Belum dibaca</span>');
    expect(html).toContain('aria-label="Bintangi Halo"');
  });

  it.each(["Halo", ""])("keeps the star toggle name constant for subject '%s'", (subject) => {
    for (const starred of [false, true]) {
      const button = StarButton({ message: { ...message, subject, starred }, busy: false, onStar() {} });
      expect(button.props["aria-label"]).toBe(`Bintangi ${subject || "(Tanpa subjek)"}`);
      expect(button.props["aria-pressed"]).toBe(starred);
    }
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
    for (const part of textParts(body)) {
      const rendered = elements(harness.render()).find((el) => el.key === String(part.offset));
      expect(rendered?.type).toBe(part.url ? "button" : "span");
      expect(rendered?.props.children).toBe(part.text);
    }
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
    const reply = () => element("textarea", "id", "email-reply");
    expect(reply().props["aria-label"]).toBeUndefined();
    expect(element("label", "htmlFor", "email-reply").props.children).toEqual(["Balas ke ", "siti@example.com"]);
    (reply().props.onChange as (event: unknown) => void)({ target: { value: "Terima kasih" } });
    await submit();
    expect(send).toHaveBeenCalledWith({ to: ["siti@example.com"], subject: "Re: Halo", body: "Terima kasih", replyToId: "mail-1" });
    expect(reply().props.value).toBe(success ? "" : "Terima kasih");
    expect(onSent).toHaveBeenCalledTimes(success ? 1 : 0);
    if (!success) expect(element("p", "role", "alert").props.children).toBe("Kirim gagal");
  });

  it("replies to the original recipients of sent mail and labels them", async () => {
    const send = spyOn(api, "emailSend").mockResolvedValue(undefined);
    spies.push(send);
    const toAddrs = ["siti@example.com", "dewi@example.com"];
    start(() => ReadingPane({ message: { ...message, folder: "[Gmail]/Sent Mail", fromAddr: "anchoa@gmail.com", toAddrs },
      busy: false, onStar() {}, onArchive() {}, onSent() {} }));
    expect(element("label", "htmlFor", "email-reply").props.children).toEqual(["Balas ke ", toAddrs.join(", ")]);
    (element("textarea", "id", "email-reply").props.onChange as (event: unknown) => void)({ target: { value: "Kabar lagi" } });
    await submit();
    expect(send).toHaveBeenCalledWith({ to: toAddrs, subject: "Re: Halo", body: "Kabar lagi", replyToId: "mail-1" });
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
    start(() => EmailPage({}));
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
    list.mockResolvedValue([{ ...message, unread: false, starred: true, bodyCached: true }]);
    await (element(ReadingPane).props.onStar as (mail: EmailMessage) => Promise<void>)({ ...message, unread: false });
    expect(flag).toHaveBeenCalledWith("mail-1", "starred", true);
    expect((element(ReadingPane).props.message as EmailMessage).starred).toBe(true);
    list.mockResolvedValue([]);
    await (element(ReadingPane).props.onArchive as (mail: EmailMessage) => Promise<void>)(message);
    await harness.settle();
    expect(archive).toHaveBeenCalledWith("mail-1");
    expect(elements(harness.render()).some((el) => el.type === ReadingPane)).toBe(false);
  });

  it("shows an email immediately from list data while the body loads without a blank pane", async () => {
    connectedPage();
    const pending = deferred<EmailMessage>();
    spies.push(spyOn(api, "emailOpen").mockReturnValue(pending.promise));
    await harness.settle();
    const openPromise = (element(EmailList).props.onOpen as (id: string) => Promise<void>)(message.id);
    // While emailOpen is in flight, ReadingPane is already shown with list data
    const pane = element(ReadingPane);
    expect(pane).toBeDefined();
    expect((pane.props.message as EmailMessage).id).toBe(message.id);
    expect((pane.props.message as EmailMessage).subject).toBe(message.subject);
    expect(elements(harness.render()).some((el) => el.props.children === "Membuka email…")).toBe(false);

    pending.resolve({ ...message, body: "Full loaded body", unread: false, bodyCached: true });
    await openPromise;
    await harness.settle();
    expect((element(ReadingPane).props.message as EmailMessage).body).toBe("Full loaded body");
  });

  it.each(["sync", "filter"])("refreshes the reading pane flags on %s and toggles the latest star", async (reload) => {
    const list = connectedPage();
    const opened = { ...message, unread: false, bodyCached: true };
    spies.push(spyOn(api, "emailOpen").mockResolvedValue(opened));
    const flag = spyOn(api, "emailSetFlag").mockResolvedValue(undefined);
    spies.push(flag);
    await harness.settle();
    await (element(EmailList).props.onOpen as (id: string) => Promise<void>)(message.id);
    const refreshed = { ...opened, unread: true, starred: true };
    list.mockResolvedValue([refreshed]);
    if (reload === "sync") (element("button", "aria-label", "Sinkronkan").props.onClick as () => void)();
    else (element(EmailList).props.onFilter as (filter: string) => void)("unread");
    await harness.settle();
    const pane = element(ReadingPane);
    expect(pane.props.message).toEqual(refreshed);
    list.mockResolvedValue([{ ...refreshed, starred: false }]);
    await (pane.props.onStar as (mail: EmailMessage) => Promise<void>)(pane.props.message as EmailMessage);
    expect(flag).toHaveBeenCalledWith(message.id, "starred", false);
  });

  it.each([true, false])("queues one follow-up sync when sends finish during sync (success=%s)", async (success) => {
    const list = connectedPage();
    await harness.settle();
    list.mockResolvedValue([]);
    (element("button", "aria-label", "Terkirim").props.onClick as () => void)();
    await harness.settle();
    (element("button", "children", "Tulis").props.onClick as () => void)();
    const onSent = element(ComposeDialog).props.onSent as () => void;
    const pending = deferred<{ headers: number }>();
    const followUp = deferred<{ headers: number }>();
    const sync = api.emailSync as unknown as ReturnType<typeof mock>;
    sync.mockReturnValueOnce(pending.promise).mockReturnValueOnce(followUp.promise);
    (element("button", "aria-label", "Sinkronkan").props.onClick as () => void)();
    onSent();
    onSent();
    expect(sync).toHaveBeenCalledTimes(2);
    if (success) pending.resolve({ headers: 1 });
    else pending.reject(new Error("Offline"));
    await harness.settle();
    expect(sync).toHaveBeenCalledTimes(3);
    expect(element("button", "aria-label", "Sinkronkan").props.disabled).toBe(true);
    expect(element(EmailList).props.messages).toEqual([]);
    const sent = { ...message, id: "sent-1", folder: "[Gmail]/Sent Mail", fromAddr: "anchoa@gmail.com", unread: false };
    list.mockResolvedValue([sent]);
    followUp.resolve({ headers: 1 });
    await harness.settle();
    expect(element(EmailList).props.messages).toEqual([sent]);
    expect(sync).toHaveBeenCalledTimes(3);
    expect(element("button", "aria-label", "Sinkronkan").props.disabled).toBe(false);
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
    start(() => EmailPage({}));
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
    (api.emailList as unknown as ReturnType<typeof mock>).mockResolvedValue([]);
    (element("button", "aria-label", "Sinkronkan").props.onClick as () => void)();
    await harness.settle();
    expect(element(ReadingPane).props.message).toEqual({ ...message, unread: false });
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
    (element("textarea", "id", "email-reply").props.onChange as (event: unknown) => void)({ target: { value: "Balasan" } });
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
