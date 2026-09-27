# SUMIT API: research for Flow (read-only P&L sync)

*Researched 2026-09-26 (Asia/Jerusalem). I used only public sources: no sign-up, no credentials, and no live API calls.*
*I saved a snapshot of the official OpenAPI spec (84 paths) at `/workspace/flow-tech/sumit-scratch/sumit-swagger-2026-09-26.json`.*

**Legend:** ✅ = verified in an official SUMIT source (Swagger or help center). 🟡 = reported by a third party (GitHub code or blog), not confirmed by SUMIT. ❓ = **UNVERIFIED** (my inference, or not found anywhere). Test these against a SUMIT test-plan account before committing.

## Sources (cited as [S#])

| # | Source |
|---|---|
| S1 | Official OpenAPI spec: https://api.sumit.co.il/swagger/v1/swagger.json (UI: https://api.sumit.co.il/swagger/index.html) |
| S2 | API key management: https://help.sumit.co.il/he/articles/15532017 |
| S3 | Pricing plans (iframe embedded in https://www.sumit.co.il/pricing/): https://app.sumit.co.il/actionsbilling/packagesiframe/ |
| S4 | How pricing works (actions, API calls): https://help.sumit.co.il/he/articles/5507895 |
| S5 | Triggers intro (webhook retry behaviour): https://help.sumit.co.il/he/articles/6324125 |
| S6 | Trigger → webhook to Make (plan and module requirements): https://help.sumit.co.il/he/articles/10442304 |
| S7 | Sending webhooks from SUMIT: https://help.sumit.co.il/he/articles/11577644 |
| S8 | Make integration and trigger types: https://help.sumit.co.il/he/articles/5840257 |
| S9 | Document type enums in the API: https://help.sumit.co.il/he/articles/15286348 |
| S10 | Expenses module intro: https://help.sumit.co.il/he/articles/5789335 |
| S11 | Expense document types: https://help.sumit.co.il/he/articles/5797299 |
| S12 | Assigning income and expenses to projects: https://help.sumit.co.il/he/articles/12180338 |
| S13 | Budget module ("סעיף תקציבי"): https://help.sumit.co.il/he/articles/6359435 |
| S14 | Test plan ("תצורת בדיקות"): https://help.sumit.co.il/he/articles/15291230 |
| S15 | Integration testing: https://help.sumit.co.il/he/articles/5840939 |
| S16 | Developer support policy: https://help.sumit.co.il/he/articles/10501363 |
| S17 | Developer overview: https://help.sumit.co.il/he/articles/5840952 |
| S18 | Third-party Python client, "cfo" repo: https://github.com/amitpo23/cfo/blob/86c9a7b4e140d2470d183ec52db0a44ebca4a6c9/docs/SUMIT_API_REFERENCE.md and https://github.com/amitpo23/cfo/blob/86c9a7b4e140d2470d183ec52db0a44ebca4a6c9/src/cfo/integrations/sumit_integration.py |
| S19 | Third-party TS package: https://github.com/Digitizers/sumit-api/blob/main/docs/API_REFERENCE.md |
| S20 | Third-party CRM list script (numeric Folder id): https://github.com/nm-digitalhub/KALFA-RSVP-React/blob/77f686b3fe6807e762fd3cf275f7174930f0270f/scripts/sumit-crm-list-customers.ts |
| S21 | Developer portal: https://app.sumit.co.il/developers/api/ |
| S22 | Accounting-office team access (SUMIT Books): https://help.sumit.co.il/books/he/articles/5836756 |

---

## 1. Summary

> **Update 26 Sep 2026:** most open points were tested on a real SUMIT test company; see §1a. Main changes:
> - The CRM endpoint `crm/data/listentities` on the "מסמכים" folder returns **net, VAT rate, gross and receipt→invoice / credit→invoice links for all documents in one call**, so no per-document `getdetails` is needed.
> - `getdetails` did **not** consume billed actions on the test plan.
> - Round 2 (after the owner enabled the modules): **expenses, budget sections (read and write) and triggers all work through the API**. Budget sections are only readable through the CRM endpoint. API-created expenses carry no VAT split.

- **The API is usable for Flow's read side.** One endpoint, `POST /accounting/documents/list/`, returns income and expense documents. You can filter by document type and date range, and a page holds up to 1,000 rows [S1]. The document-type enum covers income documents (0–14) and supplier/expense documents (15–22) [S1][S9].
- **Authentication uses a per-company static key** (`CompanyID` + private `APIKey`) sent in the JSON body. I found no OAuth and no partner/multi-tenant app model [S1][S2]. To connect, each Flow customer creates a key in SUMIT and pastes it into Flow.
- **API access needs a paid plan.** It is included from the "התחלה" (Start) plan: 19 ₪/month + VAT billed annually, with 250 API calls/month included. The free plan has no API [S2][S3].
- **Every API call counts against the customer's own SUMIT quota.** Overage is billed to them, e.g. about 0.0875 ₪/call on Start [S3][S4]. That makes call efficiency a product requirement: the sync must use very few calls per customer per month.
- **Webhooks ("טריגרים") exist** and can be subscribed via the API. They need the "צמיחה" (Growth) plan (99 ₪/month) plus the Triggers, API and Views modules [S1][S6]. Most contractors on Start can't use them, so **polling is the default**.
- **Main gaps for a per-project P&L:**
  - The list response has **no VAT and no line items**. You need a per-document `getdetails` call for those [S1], and a third party reports that call is billable [S18].
  - **No native "project" field is exposed in the list API.** SUMIT's project concept, "סעיף תקציבי"/"סעיף על", needs the "מתקדם" (Advanced) plan at 299 ₪/month, and I couldn't confirm it is readable via the API [S12][S13].
  - **Structured expenses** exist only if the customer turned on "ניהול הוצאות מלא" (full expense management) [S10][S11].
  - There is **no bank-transaction endpoint** [S1].
  - There is **no "modified since" filter** [S1].
- **Recommendation:**
  - Poll with a cheap, windowed `documents/list` scan: about 1–2 calls per sync, 1–2 syncs per day, plus an on-open refresh throttled to once every 6 hours.
  - Cache everything in Flow's own database. Assign projects inside Flow, with rules such as customer → project and supplier → project.
  - Call `getdetails` only lazily, and cache the result forever.

## 1a. Verified on test account (26 Sep 2026)

I made real calls on 26 Sep 2026, 21:1x IL time, against the SUMIT **test** company "Flow Test" (CompanyID 2389917160, plan "בדיקות | חינם תמיד", VAT no. 999999998). The API key was loaded from `sumit-test.creds` and is redacted everywhere. Every call (request and response, key redacted) is logged in `/workspace/flow-tech/sumit-verify/calls.jsonl`; the scripts are in the same folder.

**Budget used: 47 calls**, all HTTP 200. That is 13 `listquotas`, 8 `documents/create` (5 succeeded), 7 `documents/list`, 6 `crm/data/listentities`, 4 `getdetails`, 2 `listfolders`, 2 `addexpense` (rejected), and 1 each of `companies/getdetails`, `getfolder`, `companies/update`, `installapplications` (rejected) and `triggers/unsubscribe` (probe). **Actions ("Operations") used: 5 of 100.**

### Test data created (dates are limited to 3 days back, see below)

| DocumentID | Type | No. | Date | Customer | Net | VAT 18 % | Gross | Project (in Description) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2389918613 | 0 Invoice | 20000 | 2026-09-24 | יזמות הגליל בע"מ | 10,000 | 1,800 | 11,800 | שיפוץ הרצל 12 | 2 lines |
| 2389918621 | 2 Receipt | 30000 | 2026-09-25 | יזמות הגליל בע"מ | – | – | 11,800 | שיפוץ הרצל 12 | bank transfer; `OriginalDocumentID` = 20000 |
| 2389918419 | 1 InvoiceAndReceipt | 10000 | 2026-09-25 | משפחת כהן | 5,000 | 900 | 5,900 | פרגולה בית כהן | `VATIncluded=true`; cheque dated 2026-10-15 |
| 2389918428 | 0 Invoice | 20001 | 2026-09-26 | ד.ל. נכסים בע"מ | 8,000 | 1,440 | 9,440 | שיפוץ הרצל 12 | |
| 2389918625 | 5 CreditInvoice | 2000 | 2026-09-26 | ד.ל. נכסים בע"מ | −1,000 | −180 | −1,180 | – | `OriginalDocumentID` = 20001 |

- **No expense documents could be created:**
  - `addexpense` returned `"ההרשאה נדחתה: Expenses addition isn't active"`.
  - `documents/create` with Type 16 returned `"Document type not supported: ExpenseInvoice"`.
  - Installing the Expenses app via the API returned `"Unable to install applications, as there's no payment method specified"`.
  - Enabling "ניהול הוצאות מלא" (full expense management) in the SUMIT UI is a manual step for the owner.
- **No budget section could be set:** the Budget module isn't installed, there is no "סעיפים תקציביים" folder, and no budget property exists on documents. The `Website_Typed_Application` install enum doesn't include Budget or Triggers.
- **Setup quirks I hit:**
  - The first `create` failed with `"Missing organization details (Corporate Number / Phone Number)"` until I set `CompanyType=2` (LicensedDealer) and an address via `/website/companies/update/`.
  - Backdating is blocked by default: `"המערכת מגבילה הפקת מסמכים בתאריך עבר עד שלושה ימים אחורה"`, i.e. SUMIT allows document dates at most 3 days in the past. This matters only for writes, not for Flow's reads.

### Sample request / response (key redacted, trimmed)

`POST https://api.sumit.co.il/accounting/documents/list/`
```json
{"Paging":{"StartIndex":0,"PageSize":1000},
 "Credentials":{"CompanyID":2389917160,"APIKey":"<REDACTED>"}}
```
```json
{"Data":{"Documents":[
  {"IsDraft":false,"Date":"2026-09-24T00:00:00+03:00","CustomerID":2389918411,
   "CustomerName":"יזמות הגליל בע\"מ","Language":0,"Currency":0,"Type":0,
   "Description":"פרויקט: שיפוץ הרצל 12","ExternalReference":null,
   "DueDate":"2026-09-24T00:00:00+03:00","DocumentDownloadURL":"https://pay.sumit.co.il/…",
   "DocumentPaymentURL":"https://pay.sumit.co.il/…","DocumentID":2389918613,
   "DocumentNumber":20000,"DocumentValue":11800.0,"CompanyValue":11800.0,
   "IsClosed":true,"AssignmentNumber":null},
  {"…":"…","Type":5,"DocumentID":2389918625,"DocumentValue":-1180.0,"CompanyValue":-1180.0,"IsClosed":null}
 ],"HasNextPage":false},
 "Status":0,"UserErrorMessage":null,"TechnicalErrorDetails":null}
```

`POST /accounting/documents/getdetails/` with `{"DocumentID":2389918419}` (invoice-receipt, trimmed):
```json
{"Document":{"Type":1,"DocumentValue":5900.0,"CompanyValue":5900.0,
   "Customer":{"ID":2389918418,"Name":"משפחת כהן","NoVAT":false,"Folder":"2375133706"}},
 "Items":[{"Quantity":1.0,"UnitPrice":5000.0,"TotalPrice":5000.0,"VAT":900.0,
           "Item":{"ID":2389918423,"Name":"פרגולת עץ - בית כהן"}}],
 "Payments":[{"Amount":5900.0,"Type":4,
   "Details_Cheque":{"BankNumber":10,"BranchNumber":800,"AccountNumber":"987654",
                     "ChequeNumber":"5001","DueDate":"2026-10-15T00:00:00+03:00"}}]}
```
The receipt (`Type 2`) returns `Items: null` and `Payments:[{"Amount":11800.0,"Type":3,"Details_BankTransfer":{…,"Reference":"TRF-778","DueDate":"2026-09-25…"}}]`. **There is no field linking it to its invoice.**

**Key discovery.** `POST /crm/data/listentities/` on the parent folder "מסמכים" (ID 2375135516 in this company) with `IncludeInheritedFolders:true, LoadProperties:true` returns **all documents in one call**, with net, VAT rate and the source-document link:
```json
{"ID":2389918621,"Folder":"2375135537",
 "Accounting_DefinitionEnum":[11],"Accounting_Number":[30000],
 "Accounting_Date":["2026-09-25T00:00:00+03:00"],"Accounting_Flags":[2],
 "Accounting_Description":["פרויקט: שיפוץ הרצל 12 - תשלום חשבונית 20000"],
 "Accounting_VATRate":[18.0],"Accounting_InsertDate":["2026-09-26T21:14:29+03:00"],
 "Accounting_DisplayCompanyValue":[11800.0],"Accounting_DisplayCompanyValueWithoutVAT":[11800.0],
 "Accounting_OriginalDocument":[{"ID":2389918613,"Name":"חשבונית מס / 20000","SchemaID":2375135542}],
 "Accounting_Customer":[{"ID":2389918411,"Name":"יזמות הגליל בע\"מ","SchemaID":2375133706}]}
```
- For the invoice (ID 2389918613): `DisplayCompanyValue` = 11800, `DisplayCompanyValueWithoutVAT` = 10000.
- For the credit (ID 2389918625): −1180 / −1000, with `Accounting_OriginalDocument` = חשבונית מס / 20001.
- Without `IncludeInheritedFolders`, the same call returns `[]`.
- `Filters:[{"Property":"Accounting_InsertDate","DateRange_From":"2026-09-26T21:14:25+03:00", …}]` plus `Order:{"Property":"Accounting_InsertDate","Descending":true}` worked. It returned exactly the 4 documents created after that time, newest first.
- **Caveat:** `Accounting_DefinitionEnum` uses an **internal** numbering, different from the API `DocumentType` enum. Observed: 7 = tax invoice, 11 = receipt, 8 = invoice-receipt, 2 = credit invoice. The child `Folder` id also identifies the type, e.g. 2375135542 "חשבוניות מס", 2375135537 "קבלות", 2375135543 "חשבוניות מס/קבלות", 2375135528 "חשבוניות זיכוי". Folder IDs are per company, so resolve them by name with `listfolders`.

`POST /website/companies/listquotas/` response:
```json
{"Data":{"Data":[{"ApplicationName":"OutgoingEmails","StatisticName":"Mails","Usage":0,"Quota":1000},
 {"ApplicationName":"Files","StatisticName":"Storage","Usage":0,"Quota":1000},
 {"ApplicationName":"ActionsBilling","StatisticName":"Operations","Usage":5,"Quota":100},
 {"ApplicationName":"ActionsBilling","StatisticName":"Obligo","Usage":0,"Quota":0}]},"Status":0}
```

### Round 2 (26 Sep 2026, 21:30–21:35 IL): after the owner enabled the modules in the UI

The owner turned on full expense management, budget management (ניהול תקציב), triggers and views management in the SUMIT website. No payment method was added. **25 more calls, all HTTP 200** (72 in total): 4 `addexpense` (1 rejected, then retried), 3 `documents/create`, 3 `listentities`, 2 each of `listquotas`, `getfolder`, `createentity`, `documents/list` and `listviews`, and 1 each of `listfolders`, `updateentity`, `getdetails`, `triggers/subscribe` and `triggers/unsubscribe`. **Operations: 5 → 11 of 100**, which is exactly the 3 expenses + 3 income documents. `createentity` (budget sections), `updateentity`, `subscribe`/`unsubscribe` and all reads didn't add Operations.

New folders appeared after the modules were enabled:
- "סעיפים תקציביים" (budget sections)
- "סיווגי סעיפים תקציביים" (budget-section groupings)
- "טריגרים" (triggers)
- "משימות אוטומציה" (automation tasks)
- trigger-action folders

**Budget sections (projects) work end to end through the API:**
- Schema: the "סעיפים תקציביים" folder has `BudgetManagement_Name` (required) and `BudgetManagement_Category` (סעיף על, i.e. parent section, an Entity). The documents folder gained **`BudgetManagement_BudgetItem`** (Entity).
- Create a section: `POST /crm/data/createentity/` with `{"Entity":{"Folder":"<סעיפים תקציביים id>","Properties":{"BudgetManagement_Name":"שיפוץ הרצל 12"}}}` returned `{"EntityID":2389921121}`. "פרגולה בית כהן" became 2389921016.
- **Tag at creation:**
  - `addexpense` with `"Properties":{"BudgetManagement_BudgetItem":2389921121}` ✅
  - `documents/create` with `"Details":{…,"Properties":{"BudgetManagement_BudgetItem":2389921016}}` ✅
- **Tag an existing, finalized invoice:** `POST /crm/data/updateentity/` with `{"Entity":{"ID":2389918613,"Folder":"<חשבוניות מס id>","Properties":{"BudgetManagement_BudgetItem":2389921121}}}` returned `Status 0` ✅. It also didn't consume an Operation.
- **Read back:** CRM `listentities` on "מסמכים" returns `"BudgetManagement_BudgetItem":[{"ID":2389921121,"Name":"שיפוץ הרצל 12","SchemaID":<budget folder>}]` on every tagged document, income and expense alike. **`documents/list` and `getdetails` don't return it.**

**Expenses:**
- `addexpense` now works. It needs a `Payments` entry: without one it failed with `"שורה #5: יש להזין מוטב/מחויב"` (payee required on line 5). **So the API can only create paid expenses** (type 15 חשבונית ותשלום לספק); it can't create an unpaid supplier invoice (16).
- Created 3 expenses:

  | DocumentID | No. | Supplier | Gross | Payment | Project |
  |---|---|---|---|---|---|
  | 2389921123 | 70000 | חומרי בניין השרון | 2,360 | credit card | הרצל |
  | 2389921236 | 70001 | חומרי בניין השרון | 590 | cash | הרצל |
  | 2389921253 | 70002 | אבי חשמלאי | 1,180 | bank transfer | כהן |

- **`documents/list` returns them:** `Type 15`, **negative** `CompanyValue` (−2360), `CustomerName` = the supplier, `ExternalReference` = the supplier's invoice number ("INV-4471").
- **CRM returns them:** child folder "חשבוניות ותשלומים לספקים", internal `DefinitionEnum` 13. It includes `Accounting_Customer` (the supplier; `SchemaID` = the "ספקים" folder), `Accounting_ExternalReference`, `Accounting_Date`, `Accounting_InsertDate`, `BudgetManagement_BudgetItem` and `Accounting_VATIncluded:true`.
- **VAT on API-created expenses isn't split:** `DisplayCompanyValueWithoutVAT` = gross (−2360/−2360), `Accounting_VATRate` is absent, and `getdetails` shows the line `VAT: null`. `addexpense` has no VAT field. Recognised VAT probably comes from the expense item's settings (❓ untested). Expenses keyed in through the UI or OCR may carry VAT.
- **Category:** the expense item ("פריט הוצאה") name is visible only in `getdetails` `Items[].Item.Name` ("חומרי בניין"). The CRM document row links lines only as entity IDs (`Accounting_Lines_Customer`).
- `getdetails` on an expense: `Payments[0].Type` 5 (CreditCard) with Visa/4242. Amounts are negative.

**Triggers (webhooks):**
- `POST /triggers/triggers/subscribe/` with `{"URL":"https://webhook.site/<temp>","Folder":"<מסמכים id>","View":<"כל המסמכים" view id>,"TriggerType":"Create"}` returned `Status 0`. View IDs come from `crm/views/listviews`. The documents folder also has built-in budget views such as "הכנסות לפי סעיף (קבלות)" and "הוצאות לפי סעיף (תשלומים)".
- **It fired.** Three new documents created at 21:32:06–07 IL were delivered to webhook.site as 3 separate POSTs, all at **21:33:22 IL, about 75 s later**, `application/json`. No signature header was seen.
- Payload (one per document):
  ```json
  {"Folder":2375135516,"EntityID":2389921274,"Type":"Create",
   "Properties":{"Accounting_Number":[10003],"Accounting_Date":["2026-09-26T00:00:00+03:00"],
     "Accounting_DisplayCompanyValue":[3540.0000],"Accounting_Description":["מקדמה/תשלום פרויקט"],
     "Accounting_Flags":[2],"Accounting_InsertDate":["2026-09-26T21:32:07+03:00"],"Property_M-5":[13],
     "Accounting_Customer":[{"ID":2389918411,"Name":"יזמות הגליל בע\"מ","SchemaID":2375133706}],
     "Property_M-4":[{"ID":2389921278,"Name":"תשלום עבודות","SchemaID":2375135501}]}}
  ```
  The fields follow the **view's columns**. There is no net or VAT, no budget section, and no document type, so treat the webhook as a "something changed" signal and re-read through the CRM.
- `unsubscribe` with the same URL returned `Status 0`, and the "טריגרים" CRM folder is empty afterwards. No further deliveries arrived at the test URL.
- **In production this needs the "צמיחה" (Growth) plan or higher** (99 ₪/mo + VAT billed annually) plus the Triggers, API and Views modules [S3][S6].

**Pagination:** with 11 documents, `PageSize:10` returned 10 rows and **`HasNextPage:true`** from both `documents/list` and CRM `listentities` ✅.


### Results per open point

| # | Open point | Result | Evidence |
|---|---|---|---|
| 1 | Auth = `Credentials{CompanyID, APIKey}` in the JSON body | **Confirmed** | `companies/getdetails` returned `Status 0` and the company profile. |
| 2 | `documents/list` `CompanyValue` includes VAT | **Confirmed** (gross) | Invoice net 10,000 → `CompanyValue` 11800.0. |
| 3 | Fields returned by `documents/list` | **Confirmed** as in the spec | No VAT, no net, no lines, no linkage. Credit notes come back **negative** (−1180). `Date` has a +03:00 offset. |
| 4 | Credit notes and sign | **Confirmed**: credits are negative in `list`, `getdetails` (UnitPrice −1000, VAT −180) and CRM. | |
| 5 | Expense documents appear in `documents/list` | **Confirmed (round 2)**: Type 15, negative value, supplier in `CustomerName`, supplier invoice number in `ExternalReference`. They also appear in CRM, with the budget section. Net = gross for API-created expenses (no VAT split). | Round 1: `DocumentTypes` 15–21 is accepted and returned `[]`. **Type 22 (SupplierPayment) is rejected by `list`:** `"Document type not supported: SupplierPayment"`. |
| 6 | Paging | **Confirmed (round 2)**: `HasNextPage:true` at 11 docs / PageSize 10, in both `list` and CRM. | Round 1: `PageSize` below 10 is clamped to 10 (2 → 5 docs returned). `StartIndex` is a 0-based **offset** (3 → the last 2 of 5). `HasNextPage=true` wasn't observed (fewer than 10 docs). **Default ordering isn't by date or number**, so sort client-side. |
| 7 | Filters | **Confirmed** | `DocumentTypes:[0]` + `DateFrom/DateTo` = one day returned only invoice 20001. |
| 8 | `getdetails` returns per-line VAT without `VATPerItem` | **Confirmed** | VAT 1080 / 720 on a normal invoice. |
| 9 | `getdetails` returns payment method and cheque date | **Confirmed** | `Type` 3 = BankTransfer, 4 = Cheque; cheque `DueDate` 2026-10-15. |
| 10 | Receipt ↔ invoice link | **Refuted in `list`/`getdetails`; Confirmed via CRM** | Only `Accounting_OriginalDocument` in CRM `listentities` has it (receipt → invoice 20000, credit → invoice 20001). |
| 11 | `IsClosed` meaning | **Still unknown** | Invoice 20000 is `IsClosed:true` after being fully paid by the linked receipt. Invoice 20001 is also `true` after only a **partial** credit (1,180 of 9,440), so it isn't a reliable "paid" flag. |
| 12 | Net / VAT readable without `getdetails` | **Confirmed** (new) | CRM `Accounting_DisplayCompanyValueWithoutVAT` + `Accounting_VATRate`, one call for all documents. |
| 13 | Incremental cursor | **Partly confirmed** | CRM filter/order on `Accounting_InsertDate` (creation time) works. No "last modified" property exists in the documents folder schema, so edits are still undetectable. |
| 14 | `getdetails` is a billed action (S18 claim) | **Refuted on the test plan** | Operations stayed at 5 after 4 `getdetails` plus about 20 list/CRM/quota calls. It equals the 5 successful creates. Failed creates weren't counted. |
| 15 | Which calls count against the API-call quota | **Still unknown** | `listquotas` shows **no API-call counter** (only Mails, Storage, Operations, Obligo). The "קריאות API" CRM folder exists but was empty. The ~400 calls/month cap couldn't be measured via the API. |
| 16 | Operations counter timing | **Observed** | Updates lag by about 1–2 min: showed 0 right after the first create, 1 after five, 5 a couple of minutes later. |
| 17 | Budget section / project readable via API | **Confirmed (round 2)**: create sections (`createentity`), tag at creation (`Properties`), re-tag finalized documents (`updateentity`), read back via CRM `BudgetManagement_BudgetItem`. **Not** in `documents/list` or `getdetails`. Needs the Budget module (Advanced plan in production [S13]). | Round 1: No budget property in the documents folder schema (48 properties listed). The test plan should allow installing it in the UI, since it "behaves like Advanced" [S14]. The API can't install it. |
| 18 | Customers / suppliers list | **Confirmed** | CRM folder "לקוחות" with `LoadProperties` returns `Customers_FullName`, `Customers_CompanyNumber`, etc. It includes two built-in records ("לקוח כללי", "SUMIT"). A "ספקים" folder exists. |
| 19 | Rate limit | **Not observed** | 47 calls, including a burst of 6 back-to-back calls, all HTTP 200 in about 490–770 ms. No rate-limit headers (CloudFront). The actual `Content-Type` is `application/json`, not text/plain as the spec says. |
| 20 | Triggers on the test plan | **Confirmed (round 2)**: register and remove via API, delivered about 75 s after creation, payload = view columns. Production needs Growth+ [S6]. | Round 1: `triggers/unsubscribe` (dummy URL, nothing registered) returned `"ההרשאה נדחתה: המודול טריגרים אינו מותקן בעסק"` (Triggers module not installed). There is no Triggers value in the install enum. |
| 21 | Business errors come back as HTTP 200 | **Confirmed** | All rejections were HTTP 200 with `Status:1` and a Hebrew/English `UserErrorMessage`. |
| 22 | VAT on expenses | **Refuted for API-created expenses**: no VAT split (`WithoutVAT` = gross, `VATRate` absent, line `VAT: null`). **Still unknown** for expenses keyed in through the UI or OCR, or with expense items that have recognised VAT. | Round 2 |
| 23 | Create unpaid supplier invoices via API | **Refuted**: `addexpense` requires a payment (`"יש להזין מוטב/מחויב"`) and always creates type 15. Types 16+ aren't supported by `documents/create`. Irrelevant for Flow's reads. | Round 2 |
| 24 | Which calls consume billed Operations | **Confirmed**: only successful document creation (`documents/create`, `addexpense`); 11 Operations = 11 documents. CRM create/update, trigger subscribe and all reads consumed none. The API-call counter itself isn't exposed. | Round 1 + 2 |
| 25 | Expense category | **Partly confirmed**: expense-item name is only in `getdetails` `Items[].Item.Name`. The CRM row carries only line entity IDs. | Round 2 |


---

## 2. Authentication

| Claim | Status | Source |
|---|---|---|
| Every request is `POST` with JSON. The body carries `"Credentials": {"CompanyID": <int64>, "APIKey": "<secret>"}`. There is no auth header. The spec declares no `securitySchemes`. | ✅ | S1 (`Core_APICredentials`) |
| A second credential type, `Core_APIPublicCredentials` (`CompanyID` + `APIPublicKey`), is used only by browser-safe payment endpoints: `creditguy/vault/tokenizesingleuse`, `gateway/gettransaction` and `gateway/getreferencenumbers`. | ✅ | S1 |
| Creating a key produces a **public key** (shown anytime) and a **private key**. The private key is shown in full only once; afterwards only its last 4 characters appear. Keys are managed under "API > מפתחות API". | ✅ | S2 |
| Keys are **auto-deleted after 120 [days] of no use**, with an email warning first. Continued use cancels the deletion. (The article says "120" with no unit; days is my reading.) | ✅ / ❓ unit | S2 |
| On a downgrade to the free plan ("פטור"), keys are kept but API access stops. API works from "התחלה" upward. | ✅ | S2 |
| The private `APIKey` must stay server-side. `APIPublicKey` is browser-safe. | 🟡 | S19 |
| **OAuth / delegated access:** none found. The spec only has static keys. Customers can't grant a third-party app scoped access through a consent screen. | ❓ (absence) | S1, S2 |
| **Key scopes / read-only keys:** nothing in the docs suggests keys can be limited. Assume a key has **full access** to the company, including creating documents and charging cards. | ❓ | S1, S2 |
| **Connecting many SUMIT customers:** possible, but only by storing each customer's `CompanyID` + `APIKey`. The spec has partner-style endpoints (`website/companies/create`, `website/users/create`, `website/permissions/set`, `website/users/loginredirect`), but they act *from* a company key. They aren't a marketplace or OAuth flow. | ✅ endpoints / ❓ partner program | S1 |
| Accounting offices ("מייצגים") get human UI access to client files through office-team management. That is UI permissions, not an API delegation mechanism. | ✅ | S22 |

**What this means for Flow:**
- Onboarding step: "In SUMIT, open API › API keys › create a private key, then paste your CompanyID and private key."
- Encrypt keys at rest (AES-GCM with a key held in the platform secret store). Never send them to the PWA.
- Validate a pasted key with `POST /website/companies/getdetails/`. It returns the company name and `CompanyType`, e.g. `VATExemptDealer` (עוסק פטור) vs `LicensedDealer` (עוסק מורשה), which also drives VAT handling [S1].
- Daily syncs keep the key "in use", which avoids the 120-day auto-deletion [S2].

---

## 3. Relevant endpoints (read side)

All endpoints are `POST https://api.sumit.co.il<path>` and take `Credentials` in the body [S1].

| Method | Path | Purpose | Key request fields | Key response fields | Notes |
|---|---|---|---|---|---|
| POST | `/accounting/documents/list/` | **Main sync endpoint.** Lists income and expense documents. | `DocumentTypes[]` (enum ints), `DateFrom`, `DateTo`, `DocumentNumberFrom/To`, `IncludeDrafts` (default false), `Paging{StartIndex, PageSize}` (default 10, min 10, **max 1000**) | `Documents[]`: `DocumentID`, `DocumentNumber`, `Type`, `Date`, `CustomerID`, `CustomerName`, `Currency`, `DocumentValue` (document currency), `CompanyValue` (ILS), `IsDraft`, `IsClosed`, `DueDate`, `Description`, `ExternalReference` (supplier invoice no.), `AssignmentNumber` (מספר הקצאה), `DocumentDownloadURL`; plus `HasNextPage` | ✅ S1. **No VAT, no line items, no payments, no custom properties, no "last modified" filter.** A third party says numeric type codes filter reliably and enum names don't 🟡 S18. Whether `CompanyValue` includes VAT is ❓ (S18 treats it as gross and back-calculates VAT). |
| POST | `/accounting/documents/getdetails/` | Full document | `DocumentID` (or `DocumentType` + `DocumentNumber`) | `Document` (customer object with `NoVAT`, `CompanyNumber`, etc.), `Items[]` (`Quantity`, `UnitPrice`, `TotalPrice`, **`VAT`**, `Item{ID, Name, SKU, Cost}`, `Description`), `Payments[]` (`Amount`, `Type`: Cash/BankTransfer/Cheque/CreditCard/Digital/TaxWithholding/Other, `Details_*` incl. cheque/transfer `DueDate`) | ✅ S1. Per-item `VAT` is documented as set only "when using VATPerItem" ❓, so it may be empty on normal documents. **A third party reports that `getdetails` and `getpdf` were billed as paid actions** 🟡 S18. Use sparingly and cache forever. |
| POST | `/accounting/documents/getpdf/` | PDF of a document | `DocumentID` | binary | ✅ S1. Prefer `DocumentDownloadURL` from the list response, which is free to open ❓. |
| POST | `/accounting/documents/getdebtreport/` | Open balance per customer | `DebitSource`, `CreditSource`, `IncludeDraftDocuments` | `Debts[]{CustomerID, Debt}` | ✅ S1. Useful for an "owed to me" figure. Possibly billable 🟡 S18. |
| POST | `/accounting/documents/getdebt/` | One customer's debt | customer id | debt | ✅ S1 |
| POST | `/billing/payments/list/` | Payments processed by **SUMIT billing** (credit card / direct debit) | `Date_From`, `Date_To`, `Valid`, `StartIndex` | `Payments[]{ID, CustomerID, Date, ValidPayment, Status, Amount, Currency, PaymentMethod{Type}, DocumentID}`, `HasNextPage` | ✅ S1. **Covers only SUMIT-cleared payments, not bank transfers or cheques.** For cash basis, use receipt-type documents instead (see §6). |
| POST | `/billing/payments/get/` | One payment | `PaymentID` | as above | ✅ S1 |
| POST | `/crm/schema/listfolders/` | Discover CRM folders (customers, suppliers, documents, budget sections, …) | `NameFilter` | `Folders[]{ID, Name}` | ✅ S1. Folder IDs are per-company numbers 🟡 S20. Folder names are ❓. |
| POST | `/crm/schema/getfolder/` | Folder schema (custom fields) | `Folder`, `IncludeProperties` | `Properties[]{ID, Name, APIName, ValueType, Category, Required}` | ✅ S1. The way to discover a "סעיף תקציבי" field ❓. |
| POST | `/crm/data/listentities/` | **Customers / suppliers / any card list**, with filters | `Folder` (required), `Filters[]{Property, Value, DateRange_From/To, Negative}`, `Order`, `Paging` (max 1000), `LoadProperties` | `Entities[]{ID, Folder, Properties{}}`, `HasNextPage` | ✅ S1. Documents appear to be CRM entities too: `DocumentID` is documented as the "EntityID when document is received through a trigger" [S1]. So listing the documents folder with `LoadProperties=true` *may* expose custom fields, budget section, VAT or date-modified ❓. **Test this first.** |
| POST | `/crm/data/getentity/` | One card with all fields | `EntityID`, `IncludeFields` | `Entity{ID, Folder, Properties}` | ✅ S1 |
| POST | `/crm/views/listviews/` | Views in a folder (needed for triggers) | `FolderID` | `Views[]{ID, Name}` | ✅ S1 |
| POST | `/accounting/incomeitems/list/` | Products/services | `Paging` | `IncomeItems[]{ID, Name, Description, Price, Cost, SKU, ExternalIdentifier}` | ✅ S1. Marked **alpha**, "may change without notice". |
| POST | `/stock/stock/list/` | Stock levels | `ItemIDs`, `ExcludeZeroStock` | `Stock[]{ID, Name, Stock}` | ✅ S1. Not needed. |
| POST | `/accounting/general/getvatrate/` | VAT rate for a date | `Date` | `Rate` | ✅ S1. Use it to split gross → net when VAT is missing. Cache per date range. |
| POST | `/website/companies/getdetails/` | Validate key, company profile | — | `Company{Name, CorporateNumber, CompanyType, …}` | ✅ S1. A third party found it free 🟡 S18. |
| POST | `/website/companies/listquotas/` | **API/action usage vs quota** | — | `Data[]{ApplicationName, StatisticName, Usage, Quota}` | ✅ S1. A third party verified it free 🟡 S18. Use it to self-throttle. |
| POST | `/triggers/triggers/subscribe/` / `unsubscribe/` | Register or remove a webhook | `URL`, `Folder`, `View` (int), `TriggerType` (`CreateOrUpdate`/`Create`/`Update`/`Archive`/`Delete`) | status only | ✅ S1. Plan requirements in §4. |

**Document types** (`Accounting_Typed_DocumentType`) [S1][S9]:

| Group | Types |
|---|---|
| Income (counted) | Invoice 0 (חשבונית מס), InvoiceAndReceipt 1 (חשבונית מס קבלה), Receipt 2 (קבלה), DonationReceipt 4, CreditInvoice 5 (חשבונית זיכוי), CreditInvoiceAndReceipt 6, CreditReceipt 7 (קבלת זיכוי), CreditDonationReceipt 14 |
| Income (non-accounting, ignore for P&L) | ProformaInvoice 3 (חשבון עסקה), Order 8, DeliveryNote 9, GoodsReturnNote 10, PurchasingOrder 11, PriceQuotation 12, PaymentRequest 13 |
| Expense | ExpenseInvoiceReceipt 15 (חשבונית ותשלום לספק), ExpenseInvoice 16 (חשבונית ספק), ExpenseReceipt 17 (תיעוד תשלום לספק), ExpenseRequest 18 (בקשת תשלום מספק; internal, not accounting [S11]), CreditExpenseInvoiceReceipt 19, CreditExpenseInvoice 20, CreditExpenseReceipt 21, SupplierPayment 22 |

**Does SUMIT store expenses?** Yes, as supplier documents (types 15–22). This requires "מצב ניהול הוצאות מלא" (full expense-management mode) to be on [S10][S11].
- Without that mode, customers can still upload expense files (unlimited on every plan [S3]). I don't know whether those uploads show up as structured documents in `documents/list` ❓.
- A third-party client lists expense documents via `documents/list` with codes like 15 🟡 S18.
- `addexpense` exists for writing expenses (supplier, lines, payments) [S1]. Flow doesn't need it.

**Suppliers and customers:** there is no dedicated "list customers" or "list suppliers" endpoint. Use `crm/data/listentities` with the right folder, found via `listfolders` [S1] ❓ folder names. For P&L, `CustomerID` + `CustomerName` on each document is often enough. On expense documents, that pair presumably holds the supplier ❓.

**Bank transactions / reconciliation:** SUMIT advertises "סנכרון חשבונות בנק" (bank account sync) on the Start plan and up [S3]. **The API has no endpoint for bank transactions or reconciliation** [S1]. `/books/transactions/createbatch/` is write-only, for journal entries [S1].

---

## 4. Webhooks (triggers) vs polling

| Claim | Status | Source |
|---|---|---|
| Triggers send an HTTP (JSON or FORM) webhook when a card in a chosen **folder + view** is **created, updated, archived or deleted**. | ✅ | S5, S7, S8 |
| Requirements: the **"צמיחה" (Growth) plan or higher** plus installed **Triggers**, **API** and **Views** modules. | ✅ | S6 |
| A trigger can be created in the UI, or via `POST /triggers/triggers/subscribe/` with `URL`, `Folder`, `View`, `TriggerType`. | ✅ | S1 |
| Delivery: SUMIT waits **10 s** for HTTP 200, then retries after 30 s. After **5 failures** the trigger is **paused**. Events are queued while paused and resent on re-enable. SUMIT advises storing the event and processing it asynchronously. | ✅ | S5 |
| The payload is the card's fields as defined by the **view** ("the view dictates what is sent"). | ✅ | S7 |
| A document's `DocumentID` equals the trigger's `EntityID`, so documents can be trigger sources. | ✅ | S1 (getdetails description) |
| Trigger executions count as "API calls / automation tasks" against the same quota. | ✅ (the pricing text groups "קריאות API/משימות אוטומציה" together) | S4 |
| Webhook signing / verification secret. | ❓ none documented. Use an unguessable per-tenant URL token. | — |

**Recommendation:** treat webhooks as an **optional accelerator** for Growth+ customers. Keep **polling as the baseline**, because Start-plan customers (the typical small contractor) can't use triggers.

---

## 5. Limits, format, pagination, sandbox

| Topic | Finding | Status | Source |
|---|---|---|---|
| Response format | HTTP 200 with a JSON envelope `{Status: 0 Success / 1 BusinessError / 2 TechnicalError, UserErrorMessage, TechnicalErrorDetails, Data}`. Business errors still return HTTP 200, so always check `Status`. Content type is declared as text/plain. | ✅ | S1 |
| Pagination | `Paging.StartIndex` + `PageSize` (10–1000) with `HasNextPage` on documents, income items and CRM entities. `billing/payments/list` has `StartIndex` only. | ✅ | S1 |
| Filters | Documents: type, date range, number range, drafts. **No "updated since" or status filter.** CRM entities: property filters and date ranges. | ✅ | S1 |
| Rate limit | **Not documented.** A third party reports **HTTP 403 with an empty body under rapid calls**; use exponential backoff. | 🟡 | S18 |
| Billing quota | API calls come as a monthly quota of 5 × the plan's included actions. Overage costs 25 % of the plan's extra-action price. | ✅ | S4 |
| Which calls are billed as "actions" | Creating a document is an action [S4]. A third party observed `getdetails` and `getpdf` being charged, and **infers** list calls only count as API calls. | 🟡 / ❓ | S18 |
| Quota visibility | `website/companies/listquotas` returns usage and quota. | ✅ | S1 |
| Sandbox | **Test plan ("תצורת בדיקות")**: free with no time limit, includes API keys, and module availability behaves like the Advanced plan. It is capped at about **100 actions and about 400 API calls per month**. Documents use the fictitious VAT no. **999999998**. Existing businesses can't be converted either way; open a separate "בדיקות" business. | ✅ | S14, S15 |
| Base URL | `https://api.sumit.co.il`. There is no separate sandbox host; the test plan is a separate company on production. | ✅ | S1, S14 |
| Support | SUMIT support does **not** help debug integrations. There is a Facebook community, a list of freelance developers, and paid support hours. | ✅ | S16 |
| Stability | `incomeitems/list` is marked alpha. The swagger is titled "SUMIT API - Full"; the portal shows "common actions only" by default. | ✅ | S1, S21 |

---

## 6. Pricing (the customer's SUMIT plan)

Prices are before VAT, from the live pricing iframe on 2026-09-26 [S3]:

| Plan | Price | Actions/mo | Extra action | API access | API calls included | Overage per API call (25 % of extra action) | Triggers | Budget sections (projects) |
|---|---|---|---|---|---|---|---|---|
| פטור (Free) | 0 | 10 | none | **No** [S2] | – | – | No | No |
| התחלה (Start) | **19 ₪/mo annual** (228 ₪/yr; 300 ₪/yr ≈ 25 ₪/mo monthly ❓ derived) | 50 | 0.35 ₪ | **Yes** | **250** | ≈0.0875 ₪ | No | No |
| צמיחה (Growth) | 99 ₪/mo annual (1,188 ₪/yr; ≈125 ₪/mo monthly ❓ derived) | 400 | 0.25 ₪ | Yes | 2,000 | 0.0625 ₪ [S4] | **Yes** [S3][S6] | No |
| מתקדם (Advanced) | 299 ₪/mo annual (3,588 ₪/yr; ≈375 ₪/mo monthly ❓ derived) | 1,500 | 0.23 ₪ | Yes | 7,500 | ≈0.0575 ₪ | Yes | **Yes** [S13] (also "בניית תיקיות עצמאית (ERP)", i.e. custom folders [S3]) |

- **Flow pays SUMIT nothing.** No developer fee or app-marketplace fee was found ❓.
- **The customer's plan covers the calls.** At about 60 calls/month, Flow uses about 25 % of the Start quota. Staying well inside it is a design requirement.

---

## 7. Gaps and risks for per-project cash-basis P&L

1. **Projects aren't a first-class API field.**
   - SUMIT's project concept is "סעיף על / סעיף תקציבי" on documents [S12]. It needs the Budget module, which is on the **Advanced plan (299 ₪/mo)** [S13].
   - The field isn't in `documents/list` or `getdetails` [S1]. It may be readable via `crm/data/listentities` on the documents folder with `LoadProperties` ❓.
   - Most contractors won't be on Advanced. **Flow should own the project mapping.**
2. **VAT isn't in the list response** [S1].
   - For net figures: use `getvatrate` × gross for עוסק מורשה/חברה, and 0 VAT for עוסק פטור (`CompanyType` from `companies/getdetails`, or `NoVAT` per customer) ❓ accuracy.
   - Documents with mixed or zero-VAT lines would be wrong without `getdetails`.
3. **Line items and payment details need `getdetails`, one call per document.** That can be billable 🟡 S18 and eats the 250-call quota fast.
4. **Cash vs accrual:**
   - Tax invoices (0) are accrual. Receipts (2) and invoice-receipts (1) represent cash received.
   - Cash-basis income = types 1, 2 minus 6, 7 (and 4/14 for non-profits).
   - Cash-basis expense = 15, 17, 22 minus 19, 21 (paid). Type 16 (supplier invoice) and 20 are unpaid accrual ❓. Confirm the semantics with an accountant.
   - Receipts linked to an earlier invoice must not be double-counted with that invoice. Flow shows **cash = receipts only**, and "invoiced / open" separately.
   - The receipt ↔ invoice link isn't in the list API ❓.
5. **Cheques and post-dated payments:** the actual cash date may be `Payments[].Details_Cheque.DueDate` (getdetails only), not the document date [S1].
6. **Expenses depend on customer setup.**
   - Structured expense documents exist only with full expense management turned on [S10][S11].
   - Many small contractors just upload receipts, or their bookkeeper records expenses elsewhere (e.g. SUMIT Books or another accounting system), so Flow's expense side may be empty ❓.
   - Plan for manual and CSV expense entry in Flow.
7. **No bank data via the API**, even though SUMIT syncs bank accounts in its UI [S1][S3]. You can't reconcile "actually cleared" amounts.
8. **No incremental cursor.**
   - There is no updated-since filter. Edits to finalized documents are rare because Israeli documents are immutable once issued. Cancellations produce credit documents ❓.
   - Budget-section edits after finalization *are* allowed [S13] and won't be detected except by re-scanning.
9. **Security:** keys are full-access, non-scoped and non-expiring (unless unused for 120 days) ❓ [S2]. A Flow breach could let an attacker issue invoices or charge cards on customers' accounts. Encrypt, restrict, and audit.
10. **Undocumented rate limiting** (403) 🟡 S18. Alpha endpoints. No integration support from SUMIT [S16].
11. **Foreign currency:** use `CompanyValue` (ILS) for P&L. `DocumentValue` is in the document currency [S1].

---

## 8. Open questions for the owner

1. Which SUMIT plan are the target contractors on? If many are on Free, they have no API and Flow can't pull anything [S2].
2. Is it acceptable that Flow's sync consumes the customer's SUMIT API quota? At about 60 calls/month that is about 25 % of Start's 250. Should Flow show quota usage (`listquotas`)?
3. How do contractors think of a "project"? One customer per project, a site address in the description, or a SUMIT budget section? This decides the default mapping rule.
4. Do target users record expenses in SUMIT with full expense management, or does their bookkeeper keep expenses elsewhere? If elsewhere, Flow needs manual/CSV/other-source expense entry.
5. Should the P&L be net of VAT (for עוסק מורשה) or gross? Is back-calculated VAT at the standard rate acceptable?
6. Is storing customers' full-access SUMIT private keys acceptable from a risk and legal standpoint (privacy, Israel's Amendment 13)? Should Flow ask customers for a dedicated key named "Flow"?
7. Is it OK to open a free SUMIT test-plan business for development [S14]? That needs a sign-up, which I didn't do.
8. Should Flow support Growth+ webhooks at launch, or polling only?
9. *(Done 26 Sep)* The owner enabled Expenses (full mode), Budget, Triggers and Views in "Flow Test"; verified in §1a round 2. **New question:** should Flow write project choices back to SUMIT budget sections (`updateentity`), or stay read-only?
10. *(New)* Is relying on the undocumented CRM `Accounting_*` fields acceptable, given that `documents/list` is kept as a fallback?

---

## 9. Recommended sync design (≤ $5/month total, < 2 s app load), revised after verification

### What changed after testing (§1a)

- **Primary data source switches from `documents/list` to CRM `listentities`** on the "מסמכים" folder, with `IncludeInheritedFolders:true, LoadProperties:true`. One call (up to 1,000 documents) returns:
  - gross, **net (without VAT)** and VAT rate
  - customer ID and name
  - date and **creation time**
  - description and external reference
  - status flags
  - the **source-document link** (receipt → invoice, credit → invoice)

  That removes the need for per-document `getdetails` for P&L totals and for cash/accrual matching.
- `documents/list` is kept as a cross-check and a fallback, because its enum and field names are the stable documented contract. The CRM field names (`Accounting_*`) and internal `DefinitionEnum` values are undocumented and could change.
- `getdetails` is used only for on-demand line items and cheque due dates. On the test plan it didn't consume billed actions.

### Architecture (unchanged)

- Cloudflare Workers + Cron + D1 (or Supabase free tier) at $0 on free tiers, $5/mo worst case.
- Tenant keys are encrypted at rest.
- The PWA reads only pre-aggregated rows from Flow's DB, with a service-worker / IndexedDB cache (stale-while-revalidate), for < 2 s loads.

### Onboarding (per tenant, about 4 calls)

1. `website/companies/getdetails`: validate the key and read `CompanyType` (VAT mode).
2. `crm/schema/listfolders`: resolve **per-company** folder IDs by name: "מסמכים" (parent), the child document-type folders, "לקוחות", "ספקים", and "סעיפים תקציביים" if present.
3. `crm/schema/getfolder` on "מסמכים" with `IncludeProperties`: detect optional fields, e.g. a budget-section property if the Budget module is installed. Store the property APINames.
4. `listquotas`: baseline for Operations.

### Initial backfill (about 1–3 calls)

- `crm/data/listentities`:
  - `Folder`: the "מסמכים" id, with `IncludeInheritedFolders:true` and `LoadProperties:true`
  - `Filters`: `[{"Property":"Accounting_Date","DateRange_From":"<start of previous tax year>"}]` ❓ (the date filter on `Accounting_Date` is untested; `Accounting_InsertDate` works)
  - `Order`: `Accounting_InsertDate` ascending
  - `PageSize`: 1000; page by `StartIndex` offset while `HasNextPage` is true
- Map each entity's child `Folder` id → Flow document type, using the folder names from onboarding rather than the internal `DefinitionEnum`.
- Store `Accounting_OriginalDocument` as `source_document_id`.

### Incremental sync (about 35–65 calls/month per tenant)

- **New documents:** CRM `listentities` with `Filters: Accounting_InsertDate >= last_seen_insert_date − 1 day`, ordered by `InsertDate`. This is **verified to work** and is usually 1 call.
- **Changes to existing documents** (cancellations, budget-section edits, `IsClosed`): no "modified" property exists. Do a **weekly re-scan** of the current tax year (1–2 calls). Cancellations should also appear as new credit/cancel documents (`Accounting_Cancel` / `Accounting_Cancelled` fields exist ❓ untested).
- **Cadence:** daily cron, plus an on-app-open refresh at most every 6 h through a background queue. The UI renders cached data immediately with a "last updated" stamp.
- **`getdetails`:** only when a user opens a document, or for receipts paid by cheque if Flow wants to recognise cash on the cheque's `DueDate` rather than the receipt date. Cache results forever.
- **Guardrails:**
  - Check `listquotas` weekly. It only exposes Operations, which Flow's read calls don't consume, so API-call usage has to be tracked by Flow itself, with a self-imposed cap of about 100 calls per tenant per month.
  - Retry `Status:2` / non-200 with backoff. Treat `Status:1` as a business error; don't retry it.
- **Webhooks (verified):** optional for Growth+ tenants with the Triggers and Views modules. Flow registers a `Create` or `CreateOrUpdate` trigger on the "מסמכים" folder + "כל המסמכים" view via `triggers/subscribe`, to `https://flow…/hooks/sumit/<tenant-token>`.
  - Delivery took about 75 s, one POST per document. The payload holds only the view columns and no signature, so the handler just enqueues "re-sync tenant" and returns 200 quickly (SUMIT waits 10 s, then retries 5 times [S5]).
  - The worker then does the usual 1-call CRM incremental read, debounced so a burst of events becomes one read.
  - Keep the daily poll as a safety net. Unsubscribe when a tenant disconnects.

### P&L computation (cash basis), using verified fields

- **Income cash:** receipts (child folder "קבלות"), invoice-receipts ("חשבוניות מס/קבלות"), minus credit receipts / credit invoice-receipts. Amount = `Accounting_DisplayCompanyValue` (gross). Net = `…WithoutVAT`.
  - Receipts show gross = net (11,800/11,800) because a receipt carries no VAT. For **net cash** on a receipt, use the net/gross ratio of its linked invoice (`Accounting_OriginalDocument`), or fall back to the VAT rate.
- **Accrual / "invoiced":** tax invoices minus credit invoices.
- **Avoid double counting:** a receipt linked to an invoice counts once in cash. The invoice counts in "invoiced". "Open balance" = invoice gross − Σ linked receipts and credits (don't rely on `IsClosed`).
- **Credits** are already negative. Sum directly.
- **Expenses (verified):** they come back in the same CRM call (child folder "חשבוניות ותשלומים לספקים"; also type 15 in `documents/list`) with **negative** amounts, supplier, supplier invoice number, date and budget section.
  - Cash out = paid expense types (15 חשבונית ותשלום, 17 תיעוד תשלום, and their credits). Supplier invoices (16) are payables.
  - **VAT:** `WithoutVAT` can equal gross (it did for API-created expenses). If `VATRate` is missing and the tenant is VAT-registered, show expenses gross and flag "VAT unknown". Don't guess the 18 % split, because many expenses (salaries, insurance, abroad) carry no VAT. **Amended by [0043](../decisions/0043-assumed-vat-on-expenses.md):** that display recommendation is withdrawn. An expense with no split assumes 18% unless the supplier is VAT-exempt.
  - Category needs `getdetails` (lazy).
  - Keep manual/CSV expense entry for tenants who don't use full expense management.
- **Project assignment:**
  1. **Verified:** if the tenant has the Budget module, read `BudgetManagement_BudgetItem` from the CRM document rows and map each SUMIT budget section to a Flow project. List the sections themselves via `listentities` on "סעיפים תקציביים" (name, parent section). Optionally, Flow can **write back** a project choice with `updateentity`. That is verified, allowed on finalized documents and costs no Operation, but it needs a write-capable key and the user's consent.
  2. Otherwise, Flow rules: customer → project, supplier → project, keyword in `Accounting_Description` (e.g. "פרויקט: …").
  3. Otherwise, a manual inbox.

### Remaining unknowns (not blocking)

1. VAT on expenses entered through the UI, OCR or WhatsApp, and whether expense items with recognised-VAT settings populate `WithoutVAT` / `VATRate`. Worth one UI-created expense plus 1 CRM read.
2. Whether `TriggerType:"Update"` fires on budget-section edits and payment linking (useful for detecting edits).
3. How API calls are metered. The API-call counter isn't visible via `listquotas`. Operations are visible.
4. Long-term stability of the undocumented CRM `Accounting_*` / `BudgetManagement_*` field names and internal `DefinitionEnum` values.
5. Rate limits under real multi-tenant load. None hit in 72 calls.
