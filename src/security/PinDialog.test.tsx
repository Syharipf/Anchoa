import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "../api";
import { Dialog, DialogActions } from "../shell/Dialog";
import { elements, hookHarness } from "../test/hookHarness";
import { isValidPin, PinDialog } from "./PinDialog";
import { PinFields } from "./PinFields";

describe("PinDialog and PinFields", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let setPinSpy: ReturnType<typeof spyOn<typeof api, "setPin">>;
  let disablePinSpy: ReturnType<typeof spyOn<typeof api, "disablePin">>;

  afterEach(() => {
    harness?.dispose();
    setPinSpy?.mockRestore();
    disablePinSpy?.mockRestore();
  });

  it("validates PIN format correctly", () => {
    expect(isValidPin("")).toBe(false);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("abcd")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
  });

  it("renders inputs in PinFields according to mode", () => {
    // create mode: newPin and confirmPin inputs
    const createHarness = hookHarness(() =>
      PinFields({
        mode: "create",
        currentPin: "",
        newPin: "",
        confirmPin: "",
        onCurrentPinChange: () => {},
        onNewPinChange: () => {},
        onConfirmPinChange: () => {},
      }),
    );
    const createInputs = elements(createHarness.render()).filter((el) => el.type === "input");
    expect(createInputs).toHaveLength(2);
    expect(createInputs[0].props["aria-label"]).toBe("PIN");
    expect(createInputs[1].props["aria-label"]).toBe("Konfirmasi PIN");
    createHarness.dispose();

    // change mode: current, new, and confirm inputs
    const changeHarness = hookHarness(() =>
      PinFields({
        mode: "change",
        currentPin: "",
        newPin: "",
        confirmPin: "",
        onCurrentPinChange: () => {},
        onNewPinChange: () => {},
        onConfirmPinChange: () => {},
      }),
    );
    const changeInputs = elements(changeHarness.render()).filter((el) => el.type === "input");
    expect(changeInputs).toHaveLength(3);
    expect(changeInputs[0].props["aria-label"]).toBe("PIN saat ini");
    expect(changeInputs[1].props["aria-label"]).toBe("PIN baru");
    expect(changeInputs[2].props["aria-label"]).toBe("Konfirmasi PIN");
    changeHarness.dispose();

    // disable mode: only current input
    const disableHarness = hookHarness(() =>
      PinFields({
        mode: "disable",
        currentPin: "",
        newPin: "",
        confirmPin: "",
        onCurrentPinChange: () => {},
        onNewPinChange: () => {},
        onConfirmPinChange: () => {},
      }),
    );
    const disableInputs = elements(disableHarness.render()).filter((el) => el.type === "input");
    expect(disableInputs).toHaveLength(1);
    expect(disableInputs[0].props["aria-label"]).toBe("PIN saat ini");
    disableHarness.dispose();
  });

  it("handles create PIN mode with validation and backend submission", async () => {
    let closed = false;
    let succeeded = false;
    setPinSpy = spyOn(api, "setPin").mockResolvedValue(undefined);

    harness = hookHarness(() =>
      PinDialog({
        mode: "create",
        onClose: () => {
          closed = true;
        },
        onSuccess: () => {
          succeeded = true;
        },
      }),
    );

    const render = () => harness.render();
    const dialog = elements(render()).find((el) => el.type === Dialog)!;
    expect(dialog).toBeDefined();
    expect(dialog.props.title).toBe("Buat PIN");

    const fields = () => elements(render()).find((el) => el.type === PinFields)!;
    const form = () => elements(render()).find((el) => el.type === "form")!;

    // Test mismatched confirmation
    (fields().props.onNewPinChange as (val: string) => void)("1234");
    (fields().props.onConfirmPinChange as (val: string) => void)("5678");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    let alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert?.props.children).toBe("Konfirmasi PIN tidak cocok");
    expect(setPinSpy).not.toHaveBeenCalled();

    // Test invalid length
    (fields().props.onNewPinChange as (val: string) => void)("12");
    (fields().props.onConfirmPinChange as (val: string) => void)("12");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert?.props.children).toBe("PIN harus 4–8 digit angka");
    expect(setPinSpy).not.toHaveBeenCalled();

    // Test successful submission
    (fields().props.onNewPinChange as (val: string) => void)("1234");
    (fields().props.onConfirmPinChange as (val: string) => void)("1234");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    expect(setPinSpy).toHaveBeenCalledWith(null, "1234");
    expect(succeeded).toBe(true);

    // Cancel triggers onClose
    const actions = elements(render()).find((el) => el.type === DialogActions)!;
    (actions.props.onCancel as () => void)();
    expect(closed).toBe(true);
  });

  it("handles change PIN mode and shows backend error", async () => {
    let succeeded = false;
    setPinSpy = spyOn(api, "setPin").mockRejectedValue({
      code: "invalid",
      message: "PIN lama salah",
    });

    harness = hookHarness(() =>
      PinDialog({
        mode: "change",
        onClose: () => {},
        onSuccess: () => {
          succeeded = true;
        },
      }),
    );

    const render = () => harness.render();
    const dialog = elements(render()).find((el) => el.type === Dialog)!;
    expect(dialog.props.title).toBe("Ganti PIN");

    const fields = () => elements(render()).find((el) => el.type === PinFields)!;
    const form = () => elements(render()).find((el) => el.type === "form")!;

    // Missing current PIN
    (fields().props.onNewPinChange as (val: string) => void)("5678");
    (fields().props.onConfirmPinChange as (val: string) => void)("5678");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    let alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert?.props.children).toBe("PIN saat ini harus diisi");

    // Enter wrong current PIN -> backend rejects
    (fields().props.onCurrentPinChange as (val: string) => void)("0000");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    expect(setPinSpy).toHaveBeenCalledWith("0000", "5678");
    expect(succeeded).toBe(false);
    alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert?.props.children).toBe("PIN lama salah");

    // Enter correct old PIN
    setPinSpy.mockResolvedValueOnce(undefined);
    (fields().props.onCurrentPinChange as (val: string) => void)("1234");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    expect(setPinSpy).toHaveBeenCalledWith("1234", "5678");
    expect(succeeded).toBe(true);
  });

  it("handles disable PIN mode and shows backend error", async () => {
    let succeeded = false;
    disablePinSpy = spyOn(api, "disablePin").mockRejectedValue({
      code: "invalid",
      message: "PIN salah",
    });

    harness = hookHarness(() =>
      PinDialog({
        mode: "disable",
        onClose: () => {},
        onSuccess: () => {
          succeeded = true;
        },
      }),
    );

    const render = () => harness.render();
    const dialog = elements(render()).find((el) => el.type === Dialog)!;
    expect(dialog.props.title).toBe("Matikan PIN");

    const fields = () => elements(render()).find((el) => el.type === PinFields)!;
    const form = () => elements(render()).find((el) => el.type === "form")!;

    // Empty current PIN
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    let alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert?.props.children).toBe("PIN saat ini harus diisi");

    // Wrong current PIN
    (fields().props.onCurrentPinChange as (val: string) => void)("9999");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    expect(disablePinSpy).toHaveBeenCalledWith("9999");
    expect(succeeded).toBe(false);
    alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert?.props.children).toBe("PIN salah");

    // Correct current PIN
    disablePinSpy.mockResolvedValueOnce(undefined);
    (fields().props.onCurrentPinChange as (val: string) => void)("1234");
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    expect(disablePinSpy).toHaveBeenCalledWith("1234");
    expect(succeeded).toBe(true);
  });
});
