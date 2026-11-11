import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectUtilityBillsScreen } from "./project-utility-bills-screen";
import { ProjectUtilityIncomeScreen } from "./project-utility-income-screen";
import { ProjectUtilitiesScreen } from "./project-utilities-screen";
import { GEFEN, storyUtilityClient, utilityIncomeSample, utilityTypesSample } from "./utility-refunds-sample";
import type { RpcClient } from "../recurring-actions";
import { ToastProvider } from "../ui/toast";
import { UtilityClientProvider } from "../utility-refunds";

// FLOW-1159 (V3-J-B3-ByType, V3-J-A3-Bill, V3-J-Income): a property's bills by type, a bill's drawer, the income around a bill.
const db = vi.hoisted(() => ({ hold: false }));

vi.mock("../lib/supabase", () => ({ getSupabase: () => null }));
vi.mock("../use-is-viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-is-viewer")>()),
  useHoldWrites: () => db.hold,
}));

afterEach(() => {
  db.hold = false;
  act(() => { onlineManager.setOnline(true); });
});

function renderAt(entry: string, client: RpcClient) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>
          <UtilityClientProvider client={client}>
            <Routes>
              <Route path="/projects/:projectId/utilities" element={<ProjectUtilitiesScreen />} />
              <Route path="/projects/:projectId/utilities/bills" element={<ProjectUtilityBillsScreen />} />
              <Route path="/projects/:projectId/utilities/bills/:billId/income" element={<ProjectUtilityIncomeScreen />} />
            </Routes>
          </UtilityClientProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const billsEntry = `/projects/${GEFEN}/utilities/bills`;
const incomeEntry = `/projects/${GEFEN}/utilities/bills/t-power-10/income`;
const renderBills = (client: RpcClient = storyUtilityClient(utilityTypesSample())) => { renderAt(billsEntry, client); };

describe("ProjectUtilityBillsScreen", () => {
  it("says what the tenant owes, and one head per type, newest activity first, with what is missing", async () => {
    renderBills();
    expect((await screen.findAllByRole("heading", { level: 2 })).map((head) => head.textContent)).toEqual(["מים", "חשמל", "ביוב"]);
    const summary = (name: string) => screen.getByRole("heading", { name }).closest(".ui-group-head")?.querySelector(".ui-group-summary")?.textContent;
    expect(summary("מים")).toBe("הכול הוחזר");
    expect(summary("חשמל")).toBe("חסר $297.30");
    expect(summary("ביוב")).toBe("חסר $64.30");
    // 108.40 + 188.90 power, 64.30 sewer: not refunded and waiting.
    expect(screen.getByText("השוכר חייב").closest("header")?.textContent).toContain("$361.60");
  });

  it("reads 'הכול הוחזר' under the title when nothing is owed", async () => {
    renderBills(storyUtilityClient(utilityTypesSample().filter((bill) => bill.state === "refunded" || bill.state === "seen")));
    await screen.findByRole("heading", { name: "מים" });
    expect(screen.queryByText("השוכר חייב")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).closest("header")?.textContent).toContain("הכול הוחזר");
  });

  it("lists a type's bills newest activity first: the date and supplier, its status line, its amount", async () => {
    renderBills();
    const rows = await screen.findAllByRole("button", { name: /City Light/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("04/11/26 · City Light"),
      // "Latest update first": September's bill came back on 07/10, after October's bill of the 06th.
      expect.stringContaining("04/09/26 · City Light"),
      expect.stringContaining("06/10/26 · City Light"),
    ]);
    expect(rows[0]?.textContent).toContain("עוד לא הוחזר · 5 ימים");
    expect(rows[1]?.textContent).toContain("הוחזר ב־07/10/26 · 33 ימים אחרי");
    expect(rows[2]?.textContent).toContain("לא הוחזר · 34 ימים");
    expect(rows[2]?.textContent).toContain("$188.90");
  });

  it("opens the bill's drawer: its status, the type's pattern and history, and the way into the income", async () => {
    renderBills();
    fireEvent.click(await screen.findByRole("button", { name: /06\/10\/26 · City Light/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("לא הוחזר · 34 ימים", { selector: "p" })).toBeTruthy();
    expect(await within(dialog).findByText("בדרך כלל חשמל מוחזר כ־33 ימים אחרי החשבון. החשבון הזה כבר מעבר לזה.")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "כל חשבונות החשמל בנכס" })).toBeTruthy();
    const history = [...dialog.querySelectorAll(".ui-urf-hist")];
    expect(history.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual(["/transactions/t-power-11", "/transactions/t-power-09", "/transactions/t-power-10"]);
    expect(history.map((row) => row.getAttribute("data-current"))).toEqual([null, null, "true"]);
    const income = within(dialog).getByRole("link", { name: /מה נכנס סביב החשבון הזה/ });
    expect(income.getAttribute("href")).toBe(`/projects/${GEFEN}/utilities/bills/t-power-10/income`);
    expect(income.textContent).toContain("תנועות נכנס של דירת הגפן 3 · חודשיים לפני ואחרי 06/10/26");
    // Its answers stay: ראיתי, החברה משלמת תמיד, the payment picker, the transaction.
    expect(within(dialog).getByRole("button", { name: "ראיתי, אין צורך בטיפול" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^החברה משלמת תמיד/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "הוחזר · בחירת התשלום" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "פתיחת התנועה" }).getAttribute("href")).toBe("/transactions/t-power-10");
  });

  it("gives a refunded bill no answers, only its context and its transaction", async () => {
    renderBills();
    fireEvent.click(await screen.findByRole("button", { name: /04\/11\/26 · City Water/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("הוחזר באותו חודש · 06/11/26", { selector: "p" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "ראיתי, אין צורך בטיפול" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "הוחזר · בחירת התשלום" })).toBeNull();
    expect(within(dialog).getByRole("link", { name: "פתיחת התנועה" })).toBeTruthy();
  });

  it("gives a viewer rows that open the transaction, and no drawer", async () => {
    db.hold = true;
    renderBills();
    const row = await screen.findByRole("link", { name: /06\/10\/26 · City Light/ });
    expect(row.getAttribute("href")).toBe("/transactions/t-power-10");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has an empty state, and shows none while the read is out", async () => {
    renderBills(storyUtilityClient([]));
    expect(await screen.findByText("אין עדיין חשבונות בנכס")).toBeTruthy();
  });

  it("shows no group and no empty state while the read is out", () => {
    renderBills({ rpc: () => new Promise(() => undefined) } as unknown as RpcClient);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByText("אין עדיין חשבונות בנכס")).toBeNull();
  });

  it("offers a retry when the read failed", async () => {
    renderBills({ rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) } as unknown as RpcClient);
    expect(await screen.findByText("החשבונות לא נטענו")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ניסיון חוזר|נסו שוב/ })).toBeTruthy();
  });

  it("ends with מי משלם, a link to the payers page; the back goes to the project, named (FLOW-1169)", async () => {
    renderBills();
    const link = await screen.findByRole("link", { name: /^מי משלם/ });
    expect(link.getAttribute("href")).toBe(`/projects/${GEFEN}/utilities`);
    expect(link.textContent).toContain("שוכר או חברה, לכל ספק");
    const back = screen.getAllByRole("link", { name: /דירת הגפן 3/ }).find((item) => item.getAttribute("href") === `/projects/${GEFEN}`);
    expect(back).toBeTruthy();
  });

  it("keeps מי משלם in the empty state, and names a project it does not know as פרויקט", async () => {
    renderBills(storyUtilityClient([]));
    expect(await screen.findByText("אין עדיין חשבונות בנכס")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^מי משלם/ }).getAttribute("href")).toBe(`/projects/${GEFEN}/utilities`);
    expect(screen.getAllByRole("link", { name: /פרויקט/ }).some((item) => item.getAttribute("href") === `/projects/${GEFEN}`)).toBe(true);
  });

  it("the payers page has no כל החשבונות row; its back goes to the bills by type, named so (FLOW-1169)", async () => {
    renderAt(`/projects/${GEFEN}/utilities`, storyUtilityClient());
    await screen.findByRole("heading", { name: "חשבונות" });
    expect(screen.queryByRole("link", { name: /^כל החשבונות/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /לפי חודש/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /חשבונות מול השוכר/ }).some((item) => item.getAttribute("href") === billsEntry)).toBe(true);
  });
});

describe("ProjectUtilityIncomeScreen", () => {
  const renderIncome = (client: RpcClient = storyUtilityClient(utilityTypesSample())) => { renderAt(incomeEntry, client); };

  it("pins the checked bill, then the payments newest first with the bill's marker between", async () => {
    renderIncome();
    const bill = (await screen.findByRole("region", { name: "החשבון שבודקים" })).textContent;
    expect(bill).toContain("City Light · חשמל · 06/10/26");
    expect(bill).toContain("לא הוחזר · 34 ימים");
    expect(bill).toContain("−$188.90");
    expect(screen.getByRole("heading", { level: 1 }).closest("header")?.textContent).toContain("דירת הגפן 3 · חשמל");
    const list = screen.getByRole("list", { name: "תשלומים מהשוכר" });
    expect([...list.children].map((item) => item.textContent)).toEqual([
      expect.stringContaining("Rent Pay · 06/11/26"),
      expect.stringContaining("Rent Pay · 07/10/26"),
      "החשבון · 06/10/26",
      expect.stringContaining("Rent Pay · 10/09/26"),
      expect.stringContaining("Zelle · 12/08/26"),
    ]);
    const october = list.children[1];
    expect(october?.textContent).toContain("חשמל $180.20 · החזיר את 04/09/26");
    expect(october?.textContent).toContain("שכירות $1,750 · מים $122.80 · ביוב $68.40");
    expect(october?.textContent).toContain("+$2,121.40");
    expect(october?.querySelector("a")?.getAttribute("href")).toBe("/transactions/pay-rent-10");
    // No part of November's payment is the bill's type: the line says so, in the signal colour.
    expect(list.children[0]?.querySelector(".ui-uri-hit")?.getAttribute("data-missing")).toBe("true");
    expect(october?.querySelector(".ui-uri-hit")?.getAttribute("data-missing")).toBeNull();
  });

  it("reads two months by default, and a wider window asks the server for it", async () => {
    const client = storyUtilityClient(utilityTypesSample());
    const rpc = vi.spyOn(client, "rpc");
    renderIncome(client);
    await screen.findByRole("region", { name: "החשבון שבודקים" });
    expect(screen.getByRole("radio", { name: "חודשיים" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("חודשיים לפני ואחרי")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("list_utility_income", { p_bill_transaction_id: "t-power-10", p_months: 2 });
    fireEvent.click(screen.getByRole("radio", { name: "3 חודשים" }));
    expect(await screen.findByText("3 חודשים לפני ואחרי")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("list_utility_income", { p_bill_transaction_id: "t-power-10", p_months: 3 });
    expect(screen.getByRole("radio", { name: "3 חודשים" }).getAttribute("aria-checked")).toBe("true");
  });

  it("says no payment came in, and still marks the bill's day", async () => {
    renderIncome(storyUtilityClient(utilityTypesSample(), undefined, { ...utilityIncomeSample(), lines: [] }));
    expect(await screen.findByText("לא נכנס תשלום מהשוכר בטווח הזה")).toBeTruthy();
    expect(screen.getByText("החשבון · 06/10/26")).toBeTruthy();
  });

  it("offers a retry when the read failed, and shows no bill while it is out", async () => {
    renderIncome({ rpc: () => Promise.resolve({ data: null, error: { message: "bill not found" } }) } as unknown as RpcClient);
    expect(await screen.findByText("התנועות לא נטענו")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "החשבון שבודקים" })).toBeNull();
  });

  it("offline, says from when the payments are shown", async () => {
    renderIncome();
    await screen.findByRole("region", { name: "החשבון שבודקים" });
    act(() => { onlineManager.setOnline(false); });
    expect(await screen.findByText(/אין חיבור/)).toBeTruthy();
  });
});
