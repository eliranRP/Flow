export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<T extends Record<string, unknown>> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      companies: Table<{
        id: string;
        owner_id: string;
        name: string;
        tax_id: string | null;
        vat_rate_bp: number;
        is_demo: boolean;
        created_at: string;
        updated_at: string;
      }>;
      categories: Table<{
        id: string;
        company_id: string;
        name: string;
        kind: "expense" | "income";
        sort_order: number;
        is_default: boolean;
        hidden: boolean;
        created_at: string;
        updated_at: string;
      }>;
      projects: Table<{
        id: string;
        company_id: string;
        name: string;
        status: "active" | "finished";
        state_label: string | null;
        budget_agorot: number | null;
        sumit_budget_section_id: number | null;
        created_at: string;
        updated_at: string;
      }>;
      customers: Table<{
        id: string;
        company_id: string;
        name: string;
        company_number: string | null;
        sumit_external_id: number | null;
        created_at: string;
        updated_at: string;
      }>;
      suppliers: Table<{
        id: string;
        company_id: string;
        name: string;
        company_number: string | null;
        vat_exempt: boolean;
        remembered_project_id: string | null;
        remembered_category_id: string | null;
        sumit_external_id: number | null;
        created_at: string;
        updated_at: string;
      }>;
      transactions: Table<{
        id: string;
        company_id: string;
        direction: "income" | "expense";
        doc_kind: "invoice" | "receipt" | "invoice_receipt" | "credit" | "expense" | "other";
        pnl_role: "project" | "shared" | "overhead" | null;
        amount_gross: number;
        amount_net: number;
        vat_amount: number;
        vat_status: "source" | "derived" | "assumed" | "unknown";
        doc_date: string;
        cash_date: string | null;
        source: "sumit" | "hapoalim" | "manual" | "photo";
        external_id: string | null;
        idempotency_key: string;
        project_id: string | null;
        customer_id: string | null;
        supplier_id: string | null;
        category_id: string | null;
        description: string;
        linked_external_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
      allocations: Table<{
        id: string;
        company_id: string;
        transaction_id: string;
        project_id: string;
        share_bp: number;
        amount_net: number;
        created_at: string;
        updated_at: string;
      }>;
      split_rules: Table<{
        id: string;
        company_id: string;
        supplier_id: string | null;
        method: "equal" | "income_share" | "manual" | "worker_days";
        label: string;
        created_at: string;
        updated_at: string;
      }>;
      split_rule_targets: Table<{
        id: string;
        company_id: string;
        rule_id: string;
        project_id: string;
        month: string | null;
        share_bp: number;
        created_at: string;
        updated_at: string;
      }>;
      overhead: Table<{
        id: string;
        company_id: string;
        transaction_id: string;
        created_at: string;
        updated_at: string;
      }>;
      review_queue: Table<{
        id: string;
        company_id: string;
        transaction_id: string | null;
        status: "open" | "approved" | "skipped" | "changed";
        reason: string | null;
        created_at: string;
        updated_at: string;
        resolved_at: string | null;
      }>;
      sumit_connections: Table<{
        id: string;
        company_id: string;
        sumit_company_id: number | null;
        created_at: string;
        updated_at: string;
      }>;
      audit_log: Table<{
        id: number;
        company_id: string;
        actor_id: string;
        action: string;
        entity: string;
        entity_id: string | null;
        meta: Json;
        created_at: string;
      }>;
    };
    Views: {
      sumit_connection_status: {
        Row: {
          company_id: string;
          sumit_company_id: number | null;
          connected: boolean;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_home: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
    };
    Enums: {
      txn_direction: "income" | "expense";
      vat_status: "source" | "derived" | "assumed" | "unknown";
      txn_source: "sumit" | "hapoalim" | "manual" | "photo";
      pnl_role: "project" | "shared" | "overhead";
      doc_kind: "invoice" | "receipt" | "invoice_receipt" | "credit" | "expense" | "other";
      project_status: "active" | "finished";
      category_kind: "expense" | "income";
      review_status: "open" | "approved" | "skipped" | "changed";
      split_method: "equal" | "income_share" | "manual" | "worker_days";
    };
    CompositeTypes: Record<string, never>;
  };
};
