import { projectDetailSchema } from "@flow/shared";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "./demo/model";
import { noteShownCompanyUser, resetShownCompanyForTests, setShownCompany } from "./lib/company-header";
import { forgetProjectReads, keepProjectReadsFor, saveProjectRead, savedProjectRead } from "./project-cache";
import { projectQueryOptions } from "./use-books";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPANY_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function project(id = "herzl") {
  const parsed = projectDetailSchema.parse(JSON.parse(JSON.stringify(demoProject(id), (_key, value: unknown) => (
    typeof value === "bigint" ? value.toString() : value
  ))));
  if (parsed == null) throw new Error("no demo project");
  return parsed;
}

describe("saved project reads (FLOW-804)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetShownCompanyForTests();
    setShownCompany(USER_A, COMPANY_A);
  });

  it("gives back the read as it was saved, bigints and all, with its date", () => {
    const read = project();
    saveProjectRead("herzl||", read, 1_000);
    const saved = savedProjectRead("herzl||");
    expect(saved?.at).toBe(1_000);
    expect(saved?.data).toEqual(read);
    expect(typeof saved?.data.income_agorot).toBe("bigint");
    expect(savedProjectRead("herzl|2026-01-01|2026-01-31")).toBeNull();
  });

  it("shows a read only to the user and the company it was read for", () => {
    saveProjectRead("herzl||", project());
    setShownCompany(USER_A, COMPANY_B);
    expect(savedProjectRead("herzl||")).toBeNull();
    setShownCompany(USER_B, COMPANY_A);
    expect(savedProjectRead("herzl||")).toBeNull();
    setShownCompany(USER_A, null);
    expect(savedProjectRead("herzl||")).toBeNull();
    // Nothing is saved without a company to name.
    saveProjectRead("levi||", project("levi"));
    setShownCompany(USER_A, COMPANY_A);
    expect(savedProjectRead("levi||")).toBeNull();
    expect(savedProjectRead("herzl||")).not.toBeNull();
  });

  it("starts over for another company, keeping only that company's reads", () => {
    saveProjectRead("herzl||", project());
    setShownCompany(USER_A, COMPANY_B);
    saveProjectRead("levi||", project("levi"));
    setShownCompany(USER_A, COMPANY_A);
    expect(savedProjectRead("herzl||")).toBeNull();
  });

  it("drops every read on sign-out and for another user", () => {
    saveProjectRead("herzl||", project());
    keepProjectReadsFor(USER_A);
    expect(savedProjectRead("herzl||")).not.toBeNull();
    keepProjectReadsFor(USER_B);
    expect(localStorage.getItem("flow-project-reads")).toBeNull();
    saveProjectRead("herzl||", project());
    keepProjectReadsFor(null);
    expect(localStorage.getItem("flow-project-reads")).toBeNull();
    saveProjectRead("herzl||", project());
    forgetProjectReads();
    expect(localStorage.getItem("flow-project-reads")).toBeNull();
  });

  it("keeps the six newest reads and none too large to keep", () => {
    for (let index = 0; index < 8; index += 1) saveProjectRead(`p${String(index)}||`, project(), index);
    expect(savedProjectRead("p0||")).toBeNull();
    expect(savedProjectRead("p1||")).toBeNull();
    expect(savedProjectRead("p2||")?.at).toBe(2);
    expect(savedProjectRead("p7||")?.at).toBe(7);
    const large = { ...project(), name: "x".repeat(200_001) };
    saveProjectRead("p7||", large);
    // The old copy goes too: it is no longer the project's last read.
    expect(savedProjectRead("p7||")).toBeNull();
    expect(savedProjectRead("p6||")?.at).toBe(6);
  });

  it("drops the reads when storage refuses a write", () => {
    saveProjectRead("herzl||", project());
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    saveProjectRead("levi||", project("levi"));
    setItem.mockRestore();
    expect(localStorage.getItem("flow-project-reads")).toBeNull();
  });

  it("starts a project page's read from the saved one, stale, so it is read again", () => {
    noteShownCompanyUser(USER_A);
    const read = project();
    const at = Date.now() - 3_600_000;
    saveProjectRead("herzl||", read, at);
    const client = new QueryClient();
    const observer = new QueryObserver(client, { ...projectQueryOptions("off", "herzl", null), staleTime: 10_000 });
    const result = observer.getCurrentResult();
    expect(result.data).toEqual(read);
    expect(result.dataUpdatedAt).toBe(at);
    expect(result.isStale).toBe(true);
    // A preview never shows the books' saved reads.
    const preview = new QueryObserver(client, projectQueryOptions("empty", "herzl", null));
    expect(preview.getCurrentResult().data).toBeUndefined();
  });
});
