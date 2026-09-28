import { formatIls } from "@flow/shared";

export function Money({ agorot }: { agorot: bigint }) {
  return (
    <bdi dir="ltr" className="num">
      {formatIls(agorot)}
    </bdi>
  );
}
