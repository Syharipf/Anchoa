import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as dialog from "@tauri-apps/plugin-dialog";
import type { ComponentProps, ElementType, FormEvent, ReactNode } from "react";
import * as toastModule from "../shell/toast";
import { deferred, elements, hookHarness, type HookHarness } from "../test/hookHarness";
import { DialogActions, Field } from "../shell/Dialog";
import { Segmented } from "./fields";
import { ExportPdfDialog } from "./ExportPdfDialog";
import { exportFinanceRecap } from "./exportPdf";

const event = { preventDefault() {} } as FormEvent;

describe("finance recap export", () => {
  let harness: HookHarness<ReactNode> | undefined;
  const spies: { mockRestore(): void }[] = [];
  const toast = mock((_message: string, _tone?: string) => {});
  const close = mock(() => {});

  afterEach(() => {
    harness = undefined;
    spies.splice(0).forEach((spy) => spy.mockRestore());
    toast.mockClear();
    close.mockClear();
  });

  function mount(component: () => ReactNode) {
    harness = hookHarness(component);
    spies.push(spyOn(toastModule, "useToast").mockReturnValue(toast));
    harness.render();
  }

  function props<T extends ElementType>(type: T, label?: string): ComponentProps<T> {
    const node = elements(harness!.render()).find(
      (element) => element.type === type && (label === undefined || element.props.label === label),
    );
    if (!node) throw new Error(`Missing control: ${String(type)} ${label ?? ""}`);
    return node.props as ComponentProps<T>;
  }

  function value(label: string, v: string) {
    const input = elements(props(Field, label).children).find((element) => element.type === "input")!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: v } });
    harness!.render();
  }

  function submit() {
    (props("form").onSubmit as (event: FormEvent) => void)(event);
  }

  it("sends the folder, kind and period to the Rust command", async () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue("/home/kamu/rekap.pdf");
    spies.push(invoke);
    await exportFinanceRecap("/home/kamu", "monthly", "2026-10");
    expect(invoke).toHaveBeenCalledWith("finance_recap_pdf", { dir: "/home/kamu", kind: "monthly", period: "2026-10" });
    expect(await exportFinanceRecap("/home/kamu", "yearly", "2026").then((p) => p.split("/").pop())).toBe("rekap.pdf");
  });

  it("exports the current month by default and closes after a saved file", async () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue("/home/kamu/rekap-bulanan-2026-10.pdf");
    const pick = spyOn(dialog, "open").mockResolvedValue("/home/kamu");
    spies.push(invoke, pick);
    mount(() => ExportPdfDialog({ month: "2026-10", onClose: close }));
    submit();
    await harness!.settle();
    expect(pick).toHaveBeenCalledWith({ multiple: false, directory: true });
    expect(invoke).toHaveBeenCalledWith("finance_recap_pdf", { dir: "/home/kamu", kind: "monthly", period: "2026-10" });
    expect(toast).toHaveBeenCalledWith("Rekap Oktober 2026 disimpan ke /home/kamu/rekap-bulanan-2026-10.pdf", "info");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("exports the chosen year as a yearly recap", async () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue("/home/kamu/rekap-tahunan-2025.pdf");
    const pick = spyOn(dialog, "open").mockResolvedValue("/home/kamu");
    spies.push(invoke, pick);
    mount(() => ExportPdfDialog({ month: "2026-10", onClose: close }));
    props(Segmented, "Jenis rekap").onChange("yearly");
    value("Tahun", "2025");
    submit();
    await harness!.settle();
    expect(invoke).toHaveBeenCalledWith("finance_recap_pdf", { dir: "/home/kamu", kind: "yearly", period: "2025" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad year and a cancelled folder picker before invoking Rust", async () => {
    const invoke = spyOn(core, "invoke").mockResolvedValue("");
    spies.push(invoke);
    mount(() => ExportPdfDialog({ month: "2026-10", onClose: close }));

    props(Segmented, "Jenis rekap").onChange("yearly");
    value("Tahun", "20x5");
    submit();
    await harness!.settle();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Tahun harus 4 angka", "error");

    const pick = spyOn(dialog, "open").mockResolvedValue(null);
    spies.push(pick);
    value("Tahun", "2025");
    submit();
    await harness!.settle();
    expect(pick).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with a toast when Rust refuses", async () => {
    const pending = deferred<string>();
    const invoke = spyOn(core, "invoke").mockReturnValueOnce(pending.promise);
    const pick = spyOn(dialog, "open").mockResolvedValue("/home/kamu");
    spies.push(invoke, pick);
    mount(() => ExportPdfDialog({ month: "2026-10", onClose: close }));
    submit();
    harness!.render();
    expect(props(DialogActions).busy).toBe(true);
    pending.reject({ code: "invalid", message: "Periode tahun harus YYYY" });
    await harness!.settle();
    expect(toast).toHaveBeenCalledWith("Periode tahun harus YYYY", "error");
    expect(close).not.toHaveBeenCalled();
    expect(props(DialogActions).busy).toBe(false);
  });
});