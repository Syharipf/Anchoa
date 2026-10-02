import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import type { ChangeEvent, ComponentProps, ElementType, FormEvent, ReactNode } from "react";
import { type AccountView, type TransactionView } from "../api";
import { DialogActions, Field } from "../shell/Dialog";
import * as toastModule from "../shell/toast";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { AccountForm } from "./AccountForm";
import { BillForm } from "./BillForm";
import { BudgetForm } from "./BudgetForm";
import { MoneyField, Segmented } from "./fields";
import { TransactionForm } from "./TransactionForm";

const accounts: AccountView[] = ["BCA", "GoPay"].map((name, index) => ({
  id: `a${index}`, name, kind: "bank", currency: "IDR", openingBalance: 0, balance: 0,
}));
const edit: TransactionView = {
  id: "transaction", title: "Kopi", body: "Catatan", amount: -1, category: "Makan & minum",
  accountId: "a0", accountName: "BCA", occurredAt: new Date("2026-09-29T00:00:00+07:00").getTime(),
  createdAt: 0, transferId: null, counterAccountId: null, counterAccountName: null, billId: null, scheduled: false,
};
const event = { preventDefault() {} } as FormEvent;

describe("finance forms", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>> | undefined;
  const spies: { mockRestore(): void }[] = [];
  const saved = mock(() => {});
  const toast = mock((_message: string, _tone?: string) => {});
  const close = () => {};

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
    spies.splice(0).forEach((spy) => spy.mockRestore());
    saved.mockClear();
    toast.mockClear();
  });

  function mount(component: () => ReactNode) {
    harness = hookHarness(component);
    spies.push(spyOn(toastModule, "useToast").mockReturnValue(toast));
    harness.render();
  }

  function props<T extends ElementType>(type: T, label?: string): ComponentProps<T> {
    const node = elements(harness!.render()).find((element) => element.type === type && (label === undefined || element.props.label === label));
    if (!node) throw new Error(`Missing control: ${String(type)} ${label ?? ""}`);
    return node.props as ComponentProps<T>;
  }

  function field(label: string, value: string) {
    const input = elements(props(Field, label).children).find((element) => element.type === "input")!;
    (input.props.onChange as (event: ChangeEvent<HTMLInputElement>) => void)({ target: { value } } as ChangeEvent<HTMLInputElement>);
    harness!.render();
  }

  function money(label: string, value: string) {
    props(MoneyField, label).onChange(value);
    harness!.render();
  }

  function submit() { (props("form").onSubmit as (event: FormEvent) => void)(event); }

  it.each(["expense", "income", "transfer"] as const)("submits %s as integer money at local midnight through the API", async (kind) => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => TransactionForm({ accounts, categories: { expense: ["Kopi"], income: ["Gaji"] }, onClose: close, onSaved: saved }));
    props(Segmented, "Jenis transaksi").onChange(kind);
    money("Jumlah", "Rp 25.001");
    field("Tanggal", "2026-10-01");
    submit();
    await harness!.settle();
    const occurredAt = new Date("2026-09-30T17:00:00Z").getTime();
    if (kind === "transfer") {
      expect(invoke).toHaveBeenCalledWith("save_transfer", { input: { transferId: undefined, fromAccountId: "a0", toAccountId: "a1", amount: 25001, occurredAt, title: "" } });
      expect(elements(harness!.render()).some((element) => element.type === "textarea")).toBe(false);
    } else {
      expect(invoke).toHaveBeenCalledWith("save_transaction", { input: { id: undefined, kind, amount: 25001, accountId: "a0", occurredAt, category: "", title: "", body: "" } });
      expect(elements(harness!.render()).find((element) => element.type === "option")?.props.value).toBe(kind === "income" ? "Gaji" : "Kopi");
    }
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it.each(["", "0", "-1", "1,5", "1.5", "9007199254740992"])("rejects invalid transaction money %s before invoking Rust", (amount) => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => TransactionForm({ accounts, categories: null, onClose: close, onSaved: saved }));
    money("Jumlah", amount);
    submit();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Jumlah harus angka bulat lebih dari 0", "error");
  });

  it.each(["", "bad-date", "2026-02-30"])("rejects invalid transaction date %s", (date) => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => TransactionForm({ accounts, categories: null, onClose: close, onSaved: saved }));
    money("Jumlah", "1");
    field("Tanggal", date);
    submit();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Tanggal wajib diisi", "error");
  });

  it("preserves edits after AppError and retries after the save settles", async () => {
    const pending = deferred<unknown>();
    const invoke = spyOn(core, "invoke").mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => TransactionForm({ edit, accounts, categories: null, onClose: close, onSaved: saved }));
    money("Jumlah", "17");
    submit();
    harness!.render();
    expect(props(DialogActions).busy).toBe(true);
    submit();
    expect(invoke).toHaveBeenCalledTimes(1);
    pending.reject({ code: "invalid", message: "Akun tidak ditemukan" });
    await harness!.settle();
    expect(toast).toHaveBeenCalledWith("Akun tidak ditemukan", "error");
    expect(saved).not.toHaveBeenCalled();
    expect(props(MoneyField, "Jumlah").value).toBe("17");
    expect(props(DialogActions).busy).toBe(false);
    submit();
    await harness!.settle();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("keeps existing transfers in the transfer form and deletes the original ID", async () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    const transfer = { ...edit, transferId: "transfer", counterAccountId: "a1" };
    mount(() => TransactionForm({ edit: transfer, accounts, categories: null, onClose: close, onSaved: saved }));
    const segmented = props(Segmented, "Jenis transaksi");
    expect(segmented.value).toBe("transfer");
    expect(segmented.disabled!("income")).toBe(true);
    expect(segmented.disabled!("expense")).toBe(true);
    expect(segmented.disabled!("transfer")).toBe(false);
    submit();
    await harness!.settle();
    expect(invoke).toHaveBeenCalledWith("save_transfer", { input: { transferId: "transfer", fromAccountId: "a0", toAccountId: "a1", amount: 1, occurredAt: edit.occurredAt, title: "Kopi" } });
    props(DialogActions).onDelete!();
    await harness!.settle();
    expect(invoke).toHaveBeenLastCalledWith("delete_transaction", { id: edit.id });
  });

  it.each(["", "−Rp 50.001"])("accepts zero or debt as an account opening balance: %s", async (opening) => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => AccountForm({ onClose: close, onSaved: saved }));
    field("Nama", "BCA");
    money("Saldo awal", opening);
    submit();
    await harness!.settle();
    expect(invoke).toHaveBeenCalledWith("save_account", { input: { id: undefined, name: "BCA", kind: "bank", openingBalance: opening === "" ? 0 : -50001 } });
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("refuses fractional opening balances", () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => AccountForm({ onClose: close, onSaved: saved }));
    money("Saldo awal", "1,5");
    submit();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Saldo awal harus angka bulat", "error");
  });

  it("saves a bill amount and due date without scaling or a UTC date shift", async () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => BillForm({ accounts, onClose: close, onSaved: saved }));
    field("Nama", "Air");
    money("Jumlah", "Rp 1");
    field("Jatuh tempo", "2026-10-01");
    submit();
    await harness!.settle();
    expect(invoke).toHaveBeenCalledWith("save_bill", { input: { id: undefined, name: "Air", amount: 1, accountId: "a0", repeat: "monthly", dueAt: new Date("2026-09-30T17:00:00Z").getTime() } });
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("refuses bad bill amounts and missing due dates", () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => BillForm({ accounts, onClose: close, onSaved: saved }));
    money("Jumlah", "1,5");
    submit();
    expect(toast).toHaveBeenLastCalledWith("Jumlah harus angka bulat lebih dari 0", "error");
    money("Jumlah", "1");
    field("Jatuh tempo", "");
    submit();
    expect(toast).toHaveBeenLastCalledWith("Jatuh tempo wajib diisi", "error");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sets and removes the budget with integer or null arguments", async () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => BudgetForm({ current: 1000, onClose: close, onSaved: saved }));
    money("Batas per bulan", "2.001");
    submit();
    await harness!.settle();
    expect(invoke).toHaveBeenCalledWith("set_budget", { amount: 2001 });
    props(DialogActions).onDelete!();
    await harness!.settle();
    expect(invoke).toHaveBeenLastCalledWith("set_budget", { amount: null });
  });

  it("refuses non-positive budgets and omits removal for a new budget", () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
    spies.push(invoke);
    mount(() => BudgetForm({ current: null, onClose: close, onSaved: saved }));
    expect(props(DialogActions).onDelete).toBeUndefined();
    money("Batas per bulan", "0");
    submit();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Batas harus angka bulat lebih dari 0", "error");
  });

  it("normalizes valid MoneyField text on blur and preserves invalid text", () => {
    const change = mock((_value: string) => {});
    for (const [value, expected] of [["Rp 25.001", "25.001"], ["−1", "-1"], ["1,5", null]] as const) {
      const input = elements(MoneyField({ label: "Jumlah", value, onChange: change })).find((element) => element.type === "input")!;
      (input.props.onBlur as () => void)();
      if (expected === null) expect(change).not.toHaveBeenCalled();
      else expect(change).toHaveBeenCalledWith(expected);
      change.mockClear();
    }
  });
});
