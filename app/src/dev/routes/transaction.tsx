import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import type { TransactionDetail } from "@flow/shared";
import type { LineSplitRead } from "../../line-split";
import { DevTransactionBoard } from "../transaction-board";
import { TransactionScreen } from "../../screens/flow-screens";
import { useHomePreview } from "../../preview";
import { transactionQueryOptions } from "../../use-books";
import type { DevRoute } from "./types";

export function DevTransactionGate() {
  const { transactionId = "" } = useParams();
  if (transactionId === "t-filed") return <DevTransaction />;
  const step = /^t-step-(\d+)$/.exec(transactionId);
  if (step) return <DevStepTransaction n={Number(step[1])} />;
  return <TransactionScreen />;
}

/** A tall list whose rows open sample cards, for the prev and next e2e. */
function stepSample(n: number): NonNullable<TransactionDetail> {
  return {
    id: `t-step-${String(n)}`,
    description: `תנועה ${String(n)}`,
    direction: "expense",
    doc_date: "2026-09-29",
    amount_gross: BigInt(-n * 11_800),
    amount_net: BigInt(-n * 10_000),
    vat_amount: BigInt(-n * 1_800),
    vat_status: "assumed",
    source: "manual",
    project_id: "p1",
    project_name: "שיפוץ הרצל 12",
    category_id: "c1",
    category_name: "חומרים",
    supplier_name: `ספק ${String(n)}`,
    customer_name: null,
    paid: true,
    open_gross_agorot: null,
    allocations: [],
  };
}

/** FLOW-345: `?long=1` splits the card into eight categories, so its content runs on under the step row. */
function longSplit(n: number): LineSplitRead {
  const names = ["חומרים", "עבודה", "הובלה", "ציוד והשכרה", "חשמל", "אינסטלציה", "צבע", "ניקיון"];
  return {
    transactionId: `t-step-${String(n)}`,
    currency: "ILS",
    lineMinor: BigInt(-n * 10_000),
    partsMatch: true,
    parts: names.map((name, i) => ({
      category_id: `c${String(i + 1)}`,
      category_name: name,
      project_id: "p1",
      project_name: "שיפוץ הרצל 12",
      amount_minor: BigInt(-n * 1_250),
      percent: null,
      rest: i === names.length - 1,
    })),
  };
}

function DevStepTransaction({ n }: { n: number }) {
  // FLOW-345: the cache holds the neighbours, as the live card's prefetch leaves it, so a drag peeks their names.
  const client = useQueryClient();
  const preview = useHomePreview();
  const [params] = useSearchParams();
  useEffect(() => {
    for (const side of [n - 1, n + 1]) {
      if (side >= 1 && side <= 24) client.setQueryData(transactionQueryOptions(preview, `t-step-${String(side)}`).queryKey, stepSample(side));
    }
  }, [client, preview, n]);
  return (
    <TransactionScreen
      sample={stepSample(n)}
      sampleProjects={[{ id: "p1", name: "שיפוץ הרצל 12" }]}
      sampleCategories={[{ id: "c1", name: "חומרים" }]}
      sampleLineSplit={params.get("long") === "1" ? longSplit(n) : undefined}
    />
  );
}

export function DevTransaction() {
  return <DevTransactionBoard />;
}

export const transactionRoutes: DevRoute[] = [{ path: "txn", element: <DevTransaction /> }];
