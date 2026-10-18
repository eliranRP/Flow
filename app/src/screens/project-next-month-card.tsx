import { formatAmountText } from "@flow/shared";
import { Link } from "react-router-dom";
import { cashMonthName } from "../cash";
import { basisLine, type NextMonthForecast } from "../project-next-month";
import { Amount } from "../ui/amount";
import { ChevronIcon } from "../ui/icons";

/**
 * The ProfitProject frame's dashed card above the month rows: next month's forecast for the project
 * (income less expenses, before the share of general expenses), what it is made of, and a link to the
 * ProfitNext page. Nothing shows when the project expects nothing next month.
 */
export function NextMonthCard({ forecast, currency, href }: { forecast: NextMonthForecast | null; currency: string; href: string }) {
  if (forecast == null || forecast.rows.length === 0) return null;
  const name = cashMonthName(forecast.month);
  const net = forecast.netMinor;
  const totals = `הכנסות ${formatAmountText(forecast.incomeMinor, currency)} · הוצאות ${formatAmountText(forecast.expenseMinor, currency)}`;
  return (
    <Link
      to={href}
      className="ui-pn-card ui-hit m-press"
      aria-label={`צפי ${name}, ${net < 0n ? "הפסד" : "רווח"} ${formatAmountText(net < 0n ? -net : net, currency)}`}
    >
      <span className="ui-pn-card-text">
        <span className="ui-pn-card-top">
          <span className="ui-pn-card-month">
            {name}
            <span className="ui-pn-tag">צפי</span>
          </span>
          <Amount agorot={net} currency={currency} direction={net > 0n ? "income" : undefined} />
        </span>
        <span className="ui-pn-card-meta">{totals}</span>
        <span className="ui-pn-card-basis">{basisLine(forecast)}</span>
      </span>
      <span className="ui-pn-card-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>
    </Link>
  );
}
