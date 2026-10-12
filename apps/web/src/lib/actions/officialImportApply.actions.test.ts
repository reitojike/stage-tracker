import { beforeEach, describe, expect, it, vi } from "vitest";

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "wrun_01TESTRUN";
const APPLY_WORKFLOW_ID =
  "workflow//./src/workflows/official-import/apply-workflow//officialImportApplyWorkflow";

const mockGetUser = vi.fn();
const mockIsCreator = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const mockMaybeSingle = vi.fn();
const mockFrom = vi.fn((table: string) => ({
  select: (columns: string) => ({
    eq: (column: string, value: string) => ({
      maybeSingle: () => {
        const result: unknown = mockMaybeSingle(table, columns, column, value);
        return result;
      },
    }),
  }),
}));
const mockStart = vi.fn();
const mockGetRun = vi.fn();
const supabaseStub = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabaseStub),
}));
vi.mock("@/lib/data/creator-capability", () => ({
  isDesignatedCatalogCreator: (...args: unknown[]) => mockIsCreator(...args),
}));
vi.mock("@/lib/revalidation", () => ({
  affectedReadSurfaces: { officialImportReview: vi.fn(() => []) },
  revalidateReadSurfaces: vi.fn(),
}));
vi.mock("workflow/api", () => ({
  start: (...args: unknown[]) => {
    const result: unknown = mockStart(...args);
    return result;
  },
  getRun: (...args: unknown[]) => {
    const result: unknown = mockGetRun(...args);
    return result;
  },
}));
vi.mock("@/workflows/official-import/apply-workflow", () => ({
  officialImportApplyWorkflow: Object.assign(vi.fn(), {
    workflowId: APPLY_WORKFLOW_ID,
  }),
}));

const { checkOfficialImportApplyResultAction } =
  await import("./officialImportApply.actions.js");

interface RunStubOptions {
  readonly workflowName?: () => Promise<string>;
  readonly status?: () => Promise<string>;
  readonly returnValue?: () => Promise<unknown>;
}

// Getter-backed like the SDK Run: each access performs one lookup.
function runStub(options: RunStubOptions = {}) {
  const access = { workflowName: 0, status: 0, returnValue: 0 };
  const run = {
    get workflowName() {
      access.workflowName += 1;
      return options.workflowName?.() ?? Promise.resolve(APPLY_WORKFLOW_ID);
    },
    get status() {
      access.status += 1;
      return options.status?.() ?? Promise.resolve("completed");
    },
    get returnValue() {
      access.returnValue += 1;
      return (
        options.returnValue?.() ??
        Promise.resolve({
          status: "applied",
          candidateId: CANDIDATE_ID,
          outcome: "written",
        })
      );
    },
  };
  mockGetRun.mockReturnValue(run);
  return access;
}

function check(candidateId = CANDIDATE_ID) {
  return checkOfficialImportApplyResultAction({
    candidateId,
    workflowRunId: RUN_ID,
  });
}

describe("checkOfficialImportApplyResultAction", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockIsCreator.mockReset();
    mockMaybeSingle.mockReset();
    mockFrom.mockClear();
    mockStart.mockReset();
    mockGetRun.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    mockIsCreator.mockResolvedValue(true);
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: CANDIDATE_ID,
        source_id: "event.kabuki-bito.schedule",
        candidate_kind: "event",
      },
      error: null,
    });
  });

  it("requires authentication before any candidate or run lookup", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await check();

    expect(result.serverError).toMatchObject({ kind: "unauthenticated" });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it("denies a non-creator before reading the candidate or run", async () => {
    mockIsCreator.mockResolvedValue(false);

    const result = await check();

    expect(result.serverError).toMatchObject({ kind: "permission-denied" });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it("reads the candidate through the caller's RLS client", async () => {
    runStub();

    await check();

    expect(mockFrom).toHaveBeenCalledWith("official_import_candidates");
    expect(mockMaybeSingle).toHaveBeenCalledWith(
      "official_import_candidates",
      "id, source_id, candidate_kind",
      "id",
      CANDIDATE_ID,
    );
  });

  it("denies a candidate that is not visible to the caller", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await check();

    expect(result.serverError).toMatchObject({ kind: "validation" });
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it.each([
    ["another source", "event.takarazuka.revue", "event"],
    [
      "a Kabuki-source ticket",
      "event.kabuki-bito.schedule",
      "ticket_opportunity",
    ],
  ])("denies %s candidate", async (_label, sourceId, kind) => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: CANDIDATE_ID, source_id: sourceId, candidate_kind: kind },
      error: null,
    });

    const result = await check();

    expect(result.serverError).toMatchObject({ kind: "validation" });
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it("reports an unconfirmed result when the candidate read fails", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });

    const result = await check();

    expect(result.data).toEqual({ outcome: "unconfirmed" });
    expect(JSON.stringify(result)).not.toContain("private database detail");
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it("denies a run of another workflow before reading its status", async () => {
    const access = runStub({
      workflowName: () =>
        Promise.resolve(
          "workflow//./src/workflows/official-import/shadow-workflow//officialImportShadowWorkflow",
        ),
    });

    const result = await check();

    expect(result.serverError).toMatchObject({ kind: "validation" });
    expect(access.status).toBe(0);
    expect(access.returnValue).toBe(0);
  });

  it("does not treat a workflow name suffix match as the apply workflow", async () => {
    const access = runStub({
      workflowName: () =>
        Promise.resolve("workflow//./other//officialImportApplyWorkflow"),
    });

    const result = await check();

    expect(result.serverError).toMatchObject({ kind: "validation" });
    expect(access.status).toBe(0);
  });

  it.each(["pending", "running"])(
    "reports %s without accessing the return value",
    async (status) => {
      const access = runStub({ status: () => Promise.resolve(status) });

      const result = await check();

      expect(result.data).toEqual({ outcome: "pending" });
      expect(access.status).toBe(1);
      expect(access.returnValue).toBe(0);
    },
  );

  it.each(["failed", "cancelled"])(
    "does not assert candidate failure for a %s run",
    async (status) => {
      const access = runStub({ status: () => Promise.resolve(status) });

      const result = await check();

      expect(result.data).toEqual({ outcome: "unconfirmed" });
      expect(access.returnValue).toBe(0);
    },
  );

  it("reports an applied result bound to the candidate", async () => {
    const access = runStub();

    const result = await check();

    expect(result.data).toEqual({ outcome: "applied" });
    expect(mockGetRun).toHaveBeenCalledWith(RUN_ID);
    expect(access.status).toBe(1);
    expect(access.returnValue).toBe(1);
  });

  it("reports a freshness refusal bound to the candidate", async () => {
    runStub({
      returnValue: () =>
        Promise.resolve({
          status: "freshness_refused",
          candidateId: CANDIDATE_ID,
        }),
    });

    const result = await check();

    expect(result.data).toEqual({ outcome: "freshness_refused" });
  });

  it.each([
    { status: "failed", failureClassification: "source_changed" },
    { status: "not_approved" },
  ])("reports a completed $status result as not applied", async (value) => {
    runStub({
      returnValue: () =>
        Promise.resolve({ ...value, candidateId: CANDIDATE_ID }),
    });

    const result = await check();

    expect(result.data).toEqual({ outcome: "not_applied" });
    expect(JSON.stringify(result)).not.toContain("source_changed");
  });

  it("denies a completed result for another candidate", async () => {
    runStub({
      returnValue: () =>
        Promise.resolve({
          status: "applied",
          candidateId: OTHER_CANDIDATE_ID,
          outcome: "written",
        }),
    });

    const result = await check();

    expect(result.data).toBeUndefined();
    expect(result.serverError).toMatchObject({ kind: "validation" });
  });

  it.each([
    null,
    "applied",
    { status: "applied" },
    { status: "applied", candidateId: CANDIDATE_ID },
    { status: "applied", candidateId: CANDIDATE_ID, outcome: "other" },
    { status: "unknown", candidateId: CANDIDATE_ID },
    { status: "failed", candidateId: CANDIDATE_ID },
    {
      status: "failed",
      candidateId: CANDIDATE_ID,
      failureClassification: "not_a_classification",
    },
    {
      status: "failed",
      candidateId: CANDIDATE_ID,
      failureClassification: null,
    },
  ])("treats a malformed completed result %j as unconfirmed", async (value) => {
    runStub({ returnValue: () => Promise.resolve(value) });

    const result = await check();

    expect(result.data).toEqual({ outcome: "unconfirmed" });
  });

  it.each([
    [
      "getRun throws",
      () =>
        mockGetRun.mockImplementation(() => {
          throw new Error("private workflow detail");
        }),
    ],
    [
      "the run lookup rejects",
      () =>
        runStub({
          workflowName: () =>
            Promise.reject(new Error("private workflow detail")),
        }),
    ],
    [
      "the status lookup rejects",
      () =>
        runStub({
          status: () => Promise.reject(new Error("private workflow detail")),
        }),
    ],
    [
      "the return value lookup rejects",
      () =>
        runStub({
          returnValue: () =>
            Promise.reject(new Error("private workflow detail")),
        }),
    ],
  ])(
    "reports unconfirmed without raw detail when %s",
    async (_label, arrange) => {
      arrange();

      const result = await check();

      expect(result.data).toEqual({ outcome: "unconfirmed" });
      expect(JSON.stringify(result)).not.toContain("private workflow detail");
    },
  );

  it("never starts, restarts or polls a run", async () => {
    runStub({ status: () => Promise.resolve("running") });

    await check();
    await check();

    expect(mockStart).not.toHaveBeenCalled();
    expect(mockGetRun).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed run ID before any lookup", async () => {
    const result = await checkOfficialImportApplyResultAction({
      candidateId: CANDIDATE_ID,
      workflowRunId: "../runs?x=1",
    });

    expect(result.validationErrors).toBeDefined();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockGetRun).not.toHaveBeenCalled();
  });
});
