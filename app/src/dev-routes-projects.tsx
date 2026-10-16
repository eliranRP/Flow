import { Link } from "react-router-dom";
import { BackButton } from "./ui/back";
import { ProjectCategoryScreen } from "./screens/flow-screens";

const devLinks: Array<[string, string]> = [
  ["/e2e/expense", "הוצאה לבדיקה"],
  ["/projects/herzl?preview=1", "פרויקט לדוגמה"],
  ["/transactions/1?preview=1", "תנועה לדוגמה"],
  ["/transactions/1/split?preview=1", "פיצול לדוגמה"],
  ["/settings/categories?preview=1", "קטגוריות לדוגמה"],
  ["/settings/connections?preview=1", "חיבורים לדוגמה"],
  ["/loans?preview=1", "הלוואות לדוגמה"],
  ["/unpaid?preview=1", "חשבוניות לדוגמה"],
  ["/onboarding?preview=1", "הצטרפות לדוגמה"],
  ["/install?preview=1", "התקנה לדוגמה"],
  ["/review/change?preview=1", "שינוי לדוגמה"],
  ["/e2e/split?save=fail", "פיצול שנכשל"],
];

export function DevProject() {
  return (
    <main className="ui-page-pad">
      <h1 className="t-title-1">פרויקט לבדיקה</h1>
      <div style={{ blockSize: "1800px" }} />
      <nav className="ui-stack">
        {devLinks.map(([to, label]) => (
          <Link key={to} to={to}>{label}</Link>
        ))}
      </nav>
    </main>
  );
}

export function DevExpense() {
  return (
    <main className="ui-page-pad">
      <h1 className="t-title-1">הוצאה לבדיקה</h1>
      <BackButton fallback="/projects?preview=1" />
    </main>
  );
}

export function DevProjectCategory() {
  return (
    <ProjectCategoryScreen
      backTo="/e2e/project-detail"
      sample={{
        categoryName: "חומרים",
        projectName: "שיפוץ הרצל 12",
        rows: [{
          id: "t1",
          description: "מלט",
          doc_date: "2026-09-12",
          amount_net: -400n,
        }],
      }}
    />
  );
}
