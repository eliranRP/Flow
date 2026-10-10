
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "active_companies": {
                  Row: {
                    "company_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "company_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "company_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "active_companies_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"allocations": {
                  Row: {
                    "amount_net": number,"company_id": string,"created_at": string,"id": string,"project_id": string,"share_bp": number,"transaction_id": string,"updated_at": string
                  }
                  Insert: {
                    "amount_net": number,"company_id": string,"created_at"?: string,"id"?: string,"project_id": string,"share_bp": number,"transaction_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_net"?: number,"company_id"?: string,"created_at"?: string,"id"?: string,"project_id"?: string,"share_bp"?: number,"transaction_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "allocations_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "allocations_company_id_project_id_fkey"
      columns: ["company_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "allocations_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string,"company_id": string,"created_at": string,"entity": string,"entity_id": string | null,"id": number,"meta": NonNullable<Json>
                  }
                  Insert: {
                    "action": string,"actor_id": string,"company_id": string,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: never,"meta"?: NonNullable<Json>
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"company_id"?: string,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: never,"meta"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "company_id": string,"created_at": string,"excluded_from_pnl": boolean,"group_name": string | null,"hidden": boolean,"id": string,"in_cash": boolean,"is_default": boolean,"kind": Database["public"]['Enums']["category_kind"],"loan_part": Database["public"]['Enums']["loan_split_part"] | null,"name": string,"parent_id": string | null,"rehab": boolean | null,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"excluded_from_pnl"?: boolean,"group_name"?: string | null,"hidden"?: boolean,"id"?: string,"in_cash"?: boolean,"is_default"?: boolean,"kind": Database["public"]['Enums']["category_kind"],"loan_part"?: Database["public"]['Enums']["loan_split_part"] | null,"name": string,"parent_id"?: string | null,"rehab"?: boolean | null,"sort_order": number,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"excluded_from_pnl"?: boolean,"group_name"?: string | null,"hidden"?: boolean,"id"?: string,"in_cash"?: boolean,"is_default"?: boolean,"kind"?: Database["public"]['Enums']["category_kind"],"loan_part"?: Database["public"]['Enums']["loan_split_part"] | null,"name"?: string,"parent_id"?: string | null,"rehab"?: boolean | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categories_parent_fkey"
      columns: ["company_id","parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "after_overhead": boolean,"base_currency": string,"cash_basis": string,"created_at": string,"id": string,"is_demo": boolean,"last_sumit_company_id": number | null,"name": string,"overhead_project_id": string | null,"owner_id": string,"tax_id": string | null,"updated_at": string,"vat_rate_bp": number,"vat_registered": boolean
                  }
                  Insert: {
                    "after_overhead"?: boolean,"base_currency"?: string,"cash_basis"?: string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"last_sumit_company_id"?: number | null,"name": string,"overhead_project_id"?: string | null,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Update: {
                    "after_overhead"?: boolean,"base_currency"?: string,"cash_basis"?: string,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"last_sumit_company_id"?: number | null,"name"?: string,"overhead_project_id"?: string | null,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "companies_overhead_project_fk"
      columns: ["id","overhead_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"company_integrations": {
                  Row: {
                    "company_id": string,"created_at": string,"daily_call_cap": number,"enabled": boolean,"mode": string,"provider": string,"threshold": number,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"daily_call_cap"?: number,"enabled"?: boolean,"mode"?: string,"provider": string,"threshold"?: number,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"daily_call_cap"?: number,"enabled"?: boolean,"mode"?: string,"provider"?: string,"threshold"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_integrations_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"company_invites": {
                  Row: {
                    "company_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"email": string,"id": string,"invited_by": string | null,"role": string,"status": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"email": string,"id"?: string,"invited_by"?: string | null,"role": string,"status"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"email"?: string,"id"?: string,"invited_by"?: string | null,"role"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_invites_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"company_members": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"invited_by": string | null,"role": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"invited_by"?: string | null,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_members_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"company_viewers": {
                  Row: {
                    "company_id": string,"created_at": string,"user_id": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_viewers_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"connector_connections": {
                  Row: {
                    "account_labels": NonNullable<Json>,"company_id": string,"created_at": string,"dek_ciphertext": string,"dek_nonce": string,"envelope_version": string,"id": string,"import_from": string | null,"kek_ref": string,"kek_version": string,"key_ciphertext": string,"key_nonce": string,"last_error": string | null,"last_sync_at": string | null,"next_attempt_at": string | null,"provider": Database["public"]['Enums']["connector_provider"],"reject_attempts": number,"settings": NonNullable<Json>,"sync_claimed_at": string | null,"sync_cursor": string | null,"updated_at": string
                  }
                  Insert: {
                    "account_labels"?: NonNullable<Json>,"company_id": string,"created_at"?: string,"dek_ciphertext": string,"dek_nonce": string,"envelope_version": string,"id"?: string,"import_from"?: string | null,"kek_ref": string,"kek_version": string,"key_ciphertext": string,"key_nonce": string,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"provider": Database["public"]['Enums']["connector_provider"],"reject_attempts"?: number,"settings"?: NonNullable<Json>,"sync_claimed_at"?: string | null,"sync_cursor"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_labels"?: NonNullable<Json>,"company_id"?: string,"created_at"?: string,"dek_ciphertext"?: string,"dek_nonce"?: string,"envelope_version"?: string,"id"?: string,"import_from"?: string | null,"kek_ref"?: string,"kek_version"?: string,"key_ciphertext"?: string,"key_nonce"?: string,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"provider"?: Database["public"]['Enums']["connector_provider"],"reject_attempts"?: number,"settings"?: NonNullable<Json>,"sync_claimed_at"?: string | null,"sync_cursor"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connector_connections_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"connector_refresh_requests": {
                  Row: {
                    "claimed_at": string | null,"company_id": string,"forced": boolean,"id": number,"provider": Database["public"]['Enums']["connector_provider"],"requested_at": string
                  }
                  Insert: {
                    "claimed_at"?: string | null,"company_id": string,"forced"?: boolean,"id"?: never,"provider": Database["public"]['Enums']["connector_provider"],"requested_at"?: string
                  }
                  Update: {
                    "claimed_at"?: string | null,"company_id"?: string,"forced"?: boolean,"id"?: never,"provider"?: Database["public"]['Enums']["connector_provider"],"requested_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connector_refresh_requests_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"connector_skips": {
                  Row: {
                    "company_id": string,"external_id": string | null,"id": number,"provider": Database["public"]['Enums']["connector_provider"],"reason": string,"skipped_at": string
                  }
                  Insert: {
                    "company_id": string,"external_id"?: string | null,"id"?: never,"provider": Database["public"]['Enums']["connector_provider"],"reason": string,"skipped_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"external_id"?: string | null,"id"?: never,"provider"?: Database["public"]['Enums']["connector_provider"],"reason"?: string,"skipped_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connector_skips_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "company_id": string,"company_number": string | null,"created_at": string,"id": string,"name": string,"sumit_external_id": number | null,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"company_number"?: string | null,"created_at"?: string,"id"?: string,"name": string,"sumit_external_id"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"company_number"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"sumit_external_id"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_paid_marks": {
                  Row: {
                    "company_id": string,"marked_at": string,"marked_by": string | null,"transaction_id": string
                  }
                  Insert: {
                    "company_id": string,"marked_at"?: string,"marked_by"?: string | null,"transaction_id": string
                  }
                  Update: {
                    "company_id"?: string,"marked_at"?: string,"marked_by"?: string | null,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_paid_marks_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_paid_marks_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"jev_line_failures": {
                  Row: {
                    "attempts": number,"company_id": string,"model_version": string,"retry_after": string,"transaction_id": string,"updated_at": string
                  }
                  Insert: {
                    "attempts"?: number,"company_id": string,"model_version": string,"retry_after": string,"transaction_id": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"company_id"?: string,"model_version"?: string,"retry_after"?: string,"transaction_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jev_line_failures_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"jev_outcomes": {
                  Row: {
                    "category_match": boolean | null,"company_id": string,"confidence": number,"final_category_id": string | null,"final_project_id": string | null,"model_version": string,"project_match": boolean | null,"resolved_at": string,"review_status": Database["public"]['Enums']["review_status"],"suggested_category_id": string | null,"suggested_project_id": string | null,"suggestion_id": string,"transaction_id": string
                  }
                  Insert: {
                    "category_match"?: boolean | null,"company_id": string,"confidence": number,"final_category_id"?: string | null,"final_project_id"?: string | null,"model_version": string,"project_match"?: boolean | null,"resolved_at"?: string,"review_status": Database["public"]['Enums']["review_status"],"suggested_category_id"?: string | null,"suggested_project_id"?: string | null,"suggestion_id": string,"transaction_id": string
                  }
                  Update: {
                    "category_match"?: boolean | null,"company_id"?: string,"confidence"?: number,"final_category_id"?: string | null,"final_project_id"?: string | null,"model_version"?: string,"project_match"?: boolean | null,"resolved_at"?: string,"review_status"?: Database["public"]['Enums']["review_status"],"suggested_category_id"?: string | null,"suggested_project_id"?: string | null,"suggestion_id"?: string,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jev_outcomes_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "jev_outcomes_suggestion_id_fkey"
      columns: ["suggestion_id"]
isOneToOne: false
      referencedRelation: "tag_suggestions"
      referencedColumns: ["id"]
    }
                  ]
                },"jev_prefills": {
                  Row: {
                    "category_id": string | null,"company_id": string,"confidence": number | null,"created_at": string,"id": string,"model_version": string | null,"prior_allocations": NonNullable<Json>,"prior_category_id": string | null,"prior_category_suggested": boolean,"prior_project_id": string | null,"project_id": string | null,"transaction_id": string,"undone_at": string | null,"undone_by": string | null
                  }
                  Insert: {
                    "category_id"?: string | null,"company_id": string,"confidence"?: number | null,"created_at"?: string,"id"?: string,"model_version"?: string | null,"prior_allocations"?: NonNullable<Json>,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean,"prior_project_id"?: string | null,"project_id"?: string | null,"transaction_id": string,"undone_at"?: string | null,"undone_by"?: string | null
                  }
                  Update: {
                    "category_id"?: string | null,"company_id"?: string,"confidence"?: number | null,"created_at"?: string,"id"?: string,"model_version"?: string | null,"prior_allocations"?: NonNullable<Json>,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean,"prior_project_id"?: string | null,"project_id"?: string | null,"transaction_id"?: string,"undone_at"?: string | null,"undone_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "jev_prefills_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"jev_usage": {
                  Row: {
                    "calls": number,"company_id": string,"failed": number,"finished_at": string | null,"id": string,"input_tokens": number,"output_tokens": number,"reserved": number,"run_id": string,"started_at": string,"tagged": number,"usage_day": string
                  }
                  Insert: {
                    "calls"?: number,"company_id": string,"failed"?: number,"finished_at"?: string | null,"id"?: string,"input_tokens"?: number,"output_tokens"?: number,"reserved": number,"run_id": string,"started_at"?: string,"tagged"?: number,"usage_day"?: string
                  }
                  Update: {
                    "calls"?: number,"company_id"?: string,"failed"?: number,"finished_at"?: string | null,"id"?: string,"input_tokens"?: number,"output_tokens"?: number,"reserved"?: number,"run_id"?: string,"started_at"?: string,"tagged"?: number,"usage_day"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jev_usage_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"line_splits": {
                  Row: {
                    "amount_minor": number,"category_id": string,"company_id": string,"created_at": string,"id": string,"is_rest": boolean,"ordinal": number,"percent": number | null,"project_id": string | null,"transaction_id": string
                  }
                  Insert: {
                    "amount_minor": number,"category_id": string,"company_id": string,"created_at"?: string,"id"?: string,"is_rest"?: boolean,"ordinal": number,"percent"?: number | null,"project_id"?: string | null,"transaction_id": string
                  }
                  Update: {
                    "amount_minor"?: number,"category_id"?: string,"company_id"?: string,"created_at"?: string,"id"?: string,"is_rest"?: boolean,"ordinal"?: number,"percent"?: number | null,"project_id"?: string | null,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "line_splits_company_id_category_id_fkey"
      columns: ["company_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "line_splits_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "line_splits_company_id_project_id_fkey"
      columns: ["company_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "line_splits_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"loan_rates": {
                  Row: {
                    "annual_rate_ppm": number,"company_id": string,"created_at": string,"effective_date": string,"id": string,"loan_id": string,"updated_at": string
                  }
                  Insert: {
                    "annual_rate_ppm": number,"company_id": string,"created_at"?: string,"effective_date": string,"id"?: string,"loan_id": string,"updated_at"?: string
                  }
                  Update: {
                    "annual_rate_ppm"?: number,"company_id"?: string,"created_at"?: string,"effective_date"?: string,"id"?: string,"loan_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "loan_rates_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "loan_rates_company_id_loan_id_fkey"
      columns: ["company_id","loan_id"]
isOneToOne: false
      referencedRelation: "loan_balances"
      referencedColumns: ["company_id","loan_id"]
    },{
      foreignKeyName: "loan_rates_company_id_loan_id_fkey"
      columns: ["company_id","loan_id"]
isOneToOne: false
      referencedRelation: "loans"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"loan_splits": {
                  Row: {
                    "amount_minor": number,"category_id": string,"company_id": string,"created_at": string,"id": string,"loan_id": string,"needs_review": boolean,"part": Database["public"]['Enums']["loan_split_part"],"scheduled_minor": number,"transaction_id": string,"updated_at": string
                  }
                  Insert: {
                    "amount_minor": number,"category_id": string,"company_id": string,"created_at"?: string,"id"?: string,"loan_id": string,"needs_review"?: boolean,"part": Database["public"]['Enums']["loan_split_part"],"scheduled_minor": number,"transaction_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"category_id"?: string,"company_id"?: string,"created_at"?: string,"id"?: string,"loan_id"?: string,"needs_review"?: boolean,"part"?: Database["public"]['Enums']["loan_split_part"],"scheduled_minor"?: number,"transaction_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "loan_splits_company_id_category_id_fkey"
      columns: ["company_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "loan_splits_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "loan_splits_company_id_loan_id_fkey"
      columns: ["company_id","loan_id"]
isOneToOne: false
      referencedRelation: "loan_balances"
      referencedColumns: ["company_id","loan_id"]
    },{
      foreignKeyName: "loan_splits_company_id_loan_id_fkey"
      columns: ["company_id","loan_id"]
isOneToOne: false
      referencedRelation: "loans"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "loan_splits_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"loans": {
                  Row: {
                    "amortization_months": number | null,"annual_rate_ppm": number,"closed_on": string | null,"company_id": string,"created_at": string,"currency": string,"escrow_category_id": string | null,"escrow_minor": number,"fees_category_id": string | null,"id": string,"interest_category_id": string | null,"interest_only_months": number | null,"kind": Database["public"]['Enums']["loan_kind"],"name": string,"payment_minor": number | null,"principal_category_id": string | null,"principal_minor": number,"project_id": string | null,"rate_index": string | null,"rate_margin_ppm": number | null,"sort_order": number | null,"start_date": string,"status": Database["public"]['Enums']["loan_status"],"term_months": number | null,"updated_at": string
                  }
                  Insert: {
                    "amortization_months"?: number | null,"annual_rate_ppm": number,"closed_on"?: string | null,"company_id": string,"created_at"?: string,"currency": string,"escrow_category_id"?: string | null,"escrow_minor": number,"fees_category_id"?: string | null,"id"?: string,"interest_category_id"?: string | null,"interest_only_months"?: number | null,"kind"?: Database["public"]['Enums']["loan_kind"],"name": string,"payment_minor"?: number | null,"principal_category_id"?: string | null,"principal_minor": number,"project_id"?: string | null,"rate_index"?: string | null,"rate_margin_ppm"?: number | null,"sort_order"?: number | null,"start_date": string,"status"?: Database["public"]['Enums']["loan_status"],"term_months"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "amortization_months"?: number | null,"annual_rate_ppm"?: number,"closed_on"?: string | null,"company_id"?: string,"created_at"?: string,"currency"?: string,"escrow_category_id"?: string | null,"escrow_minor"?: number,"fees_category_id"?: string | null,"id"?: string,"interest_category_id"?: string | null,"interest_only_months"?: number | null,"kind"?: Database["public"]['Enums']["loan_kind"],"name"?: string,"payment_minor"?: number | null,"principal_category_id"?: string | null,"principal_minor"?: number,"project_id"?: string | null,"rate_index"?: string | null,"rate_margin_ppm"?: number | null,"sort_order"?: number | null,"start_date"?: string,"status"?: Database["public"]['Enums']["loan_status"],"term_months"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "loans_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "loans_company_id_project_id_fkey"
      columns: ["company_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "loans_escrow_category_fkey"
      columns: ["company_id","escrow_category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "loans_fees_category_fkey"
      columns: ["company_id","fees_category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "loans_interest_category_fkey"
      columns: ["company_id","interest_category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "loans_principal_category_fkey"
      columns: ["company_id","principal_category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"notification_prefs": {
                  Row: {
                    "evening_reminder": boolean,"evening_sent_on": string | null,"new_line_mark": string | null,"new_transaction": boolean,"prompt_answered_at": string | null,"updated_at": string,"user_id": string,"weekly_sent_on": string | null,"weekly_summary": boolean
                  }
                  Insert: {
                    "evening_reminder"?: boolean,"evening_sent_on"?: string | null,"new_line_mark"?: string | null,"new_transaction"?: boolean,"prompt_answered_at"?: string | null,"updated_at"?: string,"user_id": string,"weekly_sent_on"?: string | null,"weekly_summary"?: boolean
                  }
                  Update: {
                    "evening_reminder"?: boolean,"evening_sent_on"?: string | null,"new_line_mark"?: string | null,"new_transaction"?: boolean,"prompt_answered_at"?: string | null,"updated_at"?: string,"user_id"?: string,"weekly_sent_on"?: string | null,"weekly_summary"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"overhead": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"transaction_id": string,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"transaction_id": string,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"transaction_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "overhead_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "overhead_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"party_external_refs": {
                  Row: {
                    "company_id": string,"customer_id": string | null,"external_id": string,"kind": string,"provider": Database["public"]['Enums']["connector_provider"],"supplier_id": string | null
                  }
                  Insert: {
                    "company_id": string,"customer_id"?: string | null,"external_id": string,"kind": string,"provider": Database["public"]['Enums']["connector_provider"],"supplier_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"customer_id"?: string | null,"external_id"?: string,"kind"?: string,"provider"?: Database["public"]['Enums']["connector_provider"],"supplier_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_external_refs_company_id_customer_id_fkey"
      columns: ["company_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "party_external_refs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "party_external_refs_company_id_supplier_id_fkey"
      columns: ["company_id","supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"project_groups": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_groups_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "after_overhead": boolean | null,"arv_minor": number | null,"budget_agorot": number | null,"company_id": string,"created_at": string,"group_id": string | null,"id": string,"investment_currency": string,"name": string,"purchase_minor": number | null,"state_label": string | null,"status": Database["public"]['Enums']["project_status"],"sumit_budget_section_id": number | null,"updated_at": string,"value_date": string | null,"value_minor": number | null
                  }
                  Insert: {
                    "after_overhead"?: boolean | null,"arv_minor"?: number | null,"budget_agorot"?: number | null,"company_id": string,"created_at"?: string,"group_id"?: string | null,"id"?: string,"investment_currency"?: string,"name": string,"purchase_minor"?: number | null,"state_label"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"sumit_budget_section_id"?: number | null,"updated_at"?: string,"value_date"?: string | null,"value_minor"?: number | null
                  }
                  Update: {
                    "after_overhead"?: boolean | null,"arv_minor"?: number | null,"budget_agorot"?: number | null,"company_id"?: string,"created_at"?: string,"group_id"?: string | null,"id"?: string,"investment_currency"?: string,"name"?: string,"purchase_minor"?: number | null,"state_label"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"sumit_budget_section_id"?: number | null,"updated_at"?: string,"value_date"?: string | null,"value_minor"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_group_fkey"
      columns: ["company_id","group_id"]
isOneToOne: false
      referencedRelation: "project_groups"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"updated_at": string,"user_agent": string | null,"user_id": string
                  }
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"updated_at"?: string,"user_agent"?: string | null,"user_id": string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"updated_at"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reassign_undo": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"prior_allocations": NonNullable<Json>,"prior_category_assigned": boolean | null,"prior_category_id": string | null,"prior_category_suggested": boolean | null,"prior_pnl_role": Database["public"]['Enums']["pnl_role"] | null,"prior_project_id": string | null,"prior_review_id": string | null,"prior_user_assigned": boolean,"transaction_id": string,"undone_at": string | null
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"prior_allocations": NonNullable<Json>,"prior_category_assigned"?: boolean | null,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_review_id"?: string | null,"prior_user_assigned": boolean,"transaction_id": string,"undone_at"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"prior_allocations"?: NonNullable<Json>,"prior_category_assigned"?: boolean | null,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_review_id"?: string | null,"prior_user_assigned"?: boolean,"transaction_id"?: string,"undone_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reassign_undo_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reassign_undo_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"review_queue": {
                  Row: {
                    "company_id": string,"created_at": string,"doc_fingerprint": string | null,"id": string,"paired_category_id": string | null,"paired_project_id": string | null,"paired_with": string | null,"prior_allocations": Json | null,"prior_category_assigned": boolean | null,"prior_category_id": string | null,"prior_category_suggested": boolean | null,"prior_pnl_role": Database["public"]['Enums']["pnl_role"] | null,"prior_project_assigned": boolean | null,"prior_project_id": string | null,"prior_remembered_category_id": string | null,"prior_user_assigned": boolean | null,"reason": string | null,"resolved_at": string | null,"status": Database["public"]['Enums']["review_status"],"transaction_id": string | null,"updated_at": string,"written_remembered_category_id": string | null
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"doc_fingerprint"?: string | null,"id"?: string,"paired_category_id"?: string | null,"paired_project_id"?: string | null,"paired_with"?: string | null,"prior_allocations"?: Json | null,"prior_category_assigned"?: boolean | null,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_assigned"?: boolean | null,"prior_project_id"?: string | null,"prior_remembered_category_id"?: string | null,"prior_user_assigned"?: boolean | null,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string,"written_remembered_category_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"doc_fingerprint"?: string | null,"id"?: string,"paired_category_id"?: string | null,"paired_project_id"?: string | null,"paired_with"?: string | null,"prior_allocations"?: Json | null,"prior_category_assigned"?: boolean | null,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_assigned"?: boolean | null,"prior_project_id"?: string | null,"prior_remembered_category_id"?: string | null,"prior_user_assigned"?: boolean | null,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string,"written_remembered_category_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_queue_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "review_queue_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "review_queue_paired_with_fkey"
      columns: ["paired_with"]
isOneToOne: false
      referencedRelation: "review_queue"
      referencedColumns: ["id"]
    }
                  ]
                },"setup_states": {
                  Row: {
                    "company_id": string,"state": NonNullable<Json>,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "company_id": string,"state"?: NonNullable<Json>,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "company_id"?: string,"state"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "setup_states_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"split_rule_targets": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"month": string | null,"project_id": string,"rule_id": string,"share_bp": number,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"month"?: string | null,"project_id": string,"rule_id": string,"share_bp": number,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"month"?: string | null,"project_id"?: string,"rule_id"?: string,"share_bp"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "split_rule_targets_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "split_rule_targets_company_id_project_id_fkey"
      columns: ["company_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "split_rule_targets_company_id_rule_id_fkey"
      columns: ["company_id","rule_id"]
isOneToOne: false
      referencedRelation: "split_rules"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"split_rules": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"label": string,"method": Database["public"]['Enums']["split_method"],"supplier_id": string | null,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"label": string,"method": Database["public"]['Enums']["split_method"],"supplier_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"label"?: string,"method"?: Database["public"]['Enums']["split_method"],"supplier_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "split_rules_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "split_rules_company_id_supplier_id_fkey"
      columns: ["company_id","supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "company_id": string,"company_number": string | null,"created_at": string,"id": string,"name": string,"remembered_category_id": string | null,"remembered_project_id": string | null,"sumit_external_id": number | null,"updated_at": string,"vat_exempt": boolean
                  }
                  Insert: {
                    "company_id": string,"company_number"?: string | null,"created_at"?: string,"id"?: string,"name": string,"remembered_category_id"?: string | null,"remembered_project_id"?: string | null,"sumit_external_id"?: number | null,"updated_at"?: string,"vat_exempt"?: boolean
                  }
                  Update: {
                    "company_id"?: string,"company_number"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"remembered_category_id"?: string | null,"remembered_project_id"?: string | null,"sumit_external_id"?: number | null,"updated_at"?: string,"vat_exempt"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "suppliers_company_id_remembered_category_id_fkey"
      columns: ["company_id","remembered_category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "suppliers_company_id_remembered_project_id_fkey"
      columns: ["company_id","remembered_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"tag_suggestions": {
                  Row: {
                    "answers": NonNullable<Json>,"company_id": string,"confidence": number,"created_at": string,"id": string,"model_version": string,"response_model": string,"transaction_id": string
                  }
                  Insert: {
                    "answers": NonNullable<Json>,"company_id": string,"confidence": number,"created_at"?: string,"id"?: string,"model_version": string,"response_model": string,"transaction_id": string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"company_id"?: string,"confidence"?: number,"created_at"?: string,"id"?: string,"model_version"?: string,"response_model"?: string,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tag_suggestions_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tag_suggestions_company_id_transaction_id_fkey"
      columns: ["company_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["company_id","id"]
    }
                  ]
                },"transactions": {
                  Row: {
                    "amount_gross": number,"amount_net": number,"amount_original": number,"cash_date": string | null,"category_assigned": boolean,"category_id": string | null,"category_suggested": boolean,"company_id": string,"created_at": string,"currency": string,"customer_id": string | null,"description": string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind": Database["public"]['Enums']["doc_kind"],"external_id": string | null,"fx_rate": number | null,"fx_rate_date": string | null,"id": string,"idempotency_key": string,"in_cash_override": boolean | null,"in_pnl_override": boolean | null,"line_status": Database["public"]['Enums']["line_status"],"linked_external_id": string | null,"pnl_role": Database["public"]['Enums']["pnl_role"] | null,"project_assigned": boolean,"project_id": string | null,"provider_meta": NonNullable<Json>,"removed_at": string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id": string | null,"updated_at": string,"user_assigned": boolean,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Insert: {
                    "amount_gross": number,"amount_net": number,"amount_original": number,"cash_date"?: string | null,"category_assigned"?: boolean,"category_id"?: string | null,"category_suggested"?: boolean,"company_id": string,"created_at"?: string,"currency"?: string,"customer_id"?: string | null,"description"?: string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"fx_rate"?: number | null,"fx_rate_date"?: string | null,"id"?: string,"idempotency_key": string,"in_cash_override"?: boolean | null,"in_pnl_override"?: boolean | null,"line_status"?: Database["public"]['Enums']["line_status"],"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_assigned"?: boolean,"project_id"?: string | null,"provider_meta"?: NonNullable<Json>,"removed_at"?: string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"user_assigned"?: boolean,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Update: {
                    "amount_gross"?: number,"amount_net"?: number,"amount_original"?: number,"cash_date"?: string | null,"category_assigned"?: boolean,"category_id"?: string | null,"category_suggested"?: boolean,"company_id"?: string,"created_at"?: string,"currency"?: string,"customer_id"?: string | null,"description"?: string,"direction"?: Database["public"]['Enums']["txn_direction"],"doc_date"?: string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"fx_rate"?: number | null,"fx_rate_date"?: string | null,"id"?: string,"idempotency_key"?: string,"in_cash_override"?: boolean | null,"in_pnl_override"?: boolean | null,"line_status"?: Database["public"]['Enums']["line_status"],"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_assigned"?: boolean,"project_id"?: string | null,"provider_meta"?: NonNullable<Json>,"removed_at"?: string | null,"source"?: Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"user_assigned"?: boolean,"vat_amount"?: number,"vat_status"?: Database["public"]['Enums']["vat_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_company_id_category_id_fkey"
      columns: ["company_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "transactions_company_id_customer_id_fkey"
      columns: ["company_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "transactions_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_company_id_project_id_fkey"
      columns: ["company_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["company_id","id"]
    },{
      foreignKeyName: "transactions_company_id_supplier_id_fkey"
      columns: ["company_id","supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["company_id","id"]
    }
                  ]
                }
          }
          Views: {
            "connector_connection_status": {
                  Row: {
                    "account_labels": Json | null,"company_id": string | null,"connected": boolean | null,"import_from": string | null,"last_error": string | null,"last_sync_at": string | null,"next_attempt_at": string | null,"provider": Database["public"]['Enums']["connector_provider"] | null,"skip_count": number | null,"syncing": boolean | null
                  }
                  Insert: {
                           "account_labels"?: Json | null,"company_id"?: string | null,"connected"?: never,"import_from"?: string | null,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"provider"?: Database["public"]['Enums']["connector_provider"] | null,"skip_count"?: never,"syncing"?: never
                         }
                        Update: {
                           "account_labels"?: Json | null,"company_id"?: string | null,"connected"?: never,"import_from"?: string | null,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"provider"?: Database["public"]['Enums']["connector_provider"] | null,"skip_count"?: never,"syncing"?: never
                         }
                        Relationships: [
                    {
      foreignKeyName: "connector_connections_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"loan_balances": {
                  Row: {
                    "balance_minor": number | null,"company_id": string | null,"currency": string | null,"flagged_parts": number | null,"loan_id": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "loans_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"sumit_connection_status": {
                  Row: {
                    "company_id": string | null,"connected": boolean | null,"last_error": string | null,"last_sync_at": string | null,"sumit_company_id": number | null
                  }
                  Insert: {
                           "company_id"?: never,"connected"?: never,"last_error"?: never,"last_sync_at"?: never,"sumit_company_id"?: never
                         }
                        Update: {
                           "company_id"?: never,"connected"?: never,"last_error"?: never,"last_sync_at"?: never,"sumit_company_id"?: never
                         }
                        Relationships: [
                    
                  ]
                },"sumit_connections": {
                  Row: {
                    "company_id": string | null,"created_at": string | null,"dek_ciphertext": string | null,"dek_nonce": string | null,"envelope_version": string | null,"id": string | null,"kek_version": string | null,"key_ciphertext": string | null,"key_nonce": string | null,"last_error": string | null,"last_sync_at": string | null,"next_attempt_at": string | null,"reject_attempts": number | null,"sumit_company_id": number | null,"updated_at": string | null
                  }
                  Insert: {
                           "company_id"?: string | null,"created_at"?: string | null,"dek_ciphertext"?: string | null,"dek_nonce"?: string | null,"envelope_version"?: string | null,"id"?: string | null,"kek_version"?: string | null,"key_ciphertext"?: string | null,"key_nonce"?: string | null,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"reject_attempts"?: number | null,"sumit_company_id"?: number | null,"updated_at"?: string | null
                         }
                        Update: {
                           "company_id"?: string | null,"created_at"?: string | null,"dek_ciphertext"?: string | null,"dek_nonce"?: string | null,"envelope_version"?: string | null,"id"?: string | null,"kek_version"?: string | null,"key_ciphertext"?: string | null,"key_nonce"?: string | null,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"reject_attempts"?: number | null,"sumit_company_id"?: number | null,"updated_at"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"sumit_refresh_requests": {
                  Row: {
                    "claimed_at": string | null,"company_id": string | null,"id": number | null,"requested_at": string | null
                  }
                  Insert: {
                           "claimed_at"?: string | null,"company_id"?: string | null,"id"?: number | null,"requested_at"?: string | null
                         }
                        Update: {
                           "claimed_at"?: string | null,"company_id"?: string | null,"id"?: number | null,"requested_at"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "connector_refresh_requests_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "accept_invite":
{ Args: { "p_invite_id": string }; Returns: Json
                           },
"answer_push_prompt":
{ Args: { "p_yes": boolean }; Returns: Json
                           },
"apply_starter_categories":
{ Args: { "p_set": string }; Returns: Json
                           },
"approve_review_item":
{ Args: { "p_category_id": string,"p_check_shown"?: boolean,"p_id": string,"p_project_id": string,"p_remember"?: boolean,"p_shown_category_id"?: string,"p_shown_project_id"?: string }; Returns: Json
                           },
"approve_split_review":
{ Args: { "p_id": string }; Returns: undefined
                           } |
{ Args: { "p_category_id": string,"p_id": string }; Returns: undefined
                           },
"bump_mcp_rate":
{ Args: { "p_kind": string,"p_token": string,"p_user": string }; Returns: Json
                           },
"cancel_invite":
{ Args: { "p_invite_id": string }; Returns: Json
                           },
"cash_month_lines":
{ Args: { "p_currency"?: string,"p_limit"?: number,"p_month": string,"p_offset"?: number,"p_side": string }; Returns: Json
                           },
"cash_months":
{ Args: { "p_months"?: number,"p_today"?: string }; Returns: Json
                           },
"cash_year_months":
{ Args: { "p_today"?: string,"p_year": number }; Returns: Json
                           },
"cash_years":
{ Args: { "p_today"?: string }; Returns: Json
                           },
"claim_connector_refreshes":
{ Args: { "p_limit": number }; Returns: {
              "company_id": string,"id": number,"provider": Database["public"]['Enums']["connector_provider"]
            }[]
                           } |
{ Args: { "p_limit": number,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: {
              "company_id": string,"id": number,"provider": Database["public"]['Enums']["connector_provider"]
            }[]
                           },
"clear_loan_split":
{ Args: { "p_transaction_id": string }; Returns: Json
                           },
"clear_loan_split_review":
{ Args: { "p_transaction_id": string }; Returns: undefined
                           },
"collapse_split":
{ Args: { "p_id": string,"p_project_id": string }; Returns: string
                           },
"company_pnl":
{ Args: { "p_basis": string,"p_company_id": string,"p_from": string,"p_to": string }; Returns: Json
                           },
"company_pnl_basis":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"create_category":
{ Args: { "p_kind": string,"p_name": string }; Returns: string
                           } |
{ Args: { "p_kind": string,"p_name": string,"p_parent_id": string }; Returns: string
                           },
"create_company":
{ Args: { "p_name": string,"p_vat_registered": boolean }; Returns: string
                           },
"create_manual_entry":
{ Args: { "p_category_id"?: string,"p_description": string,"p_direction": string,"p_doc_date": string,"p_gross_agorot": number,"p_kind": string,"p_project_id"?: string,"p_vat_exempt"?: boolean }; Returns: string
                           },
"decline_invite":
{ Args: { "p_invite_id": string }; Returns: Json
                           },
"delete_category":
{ Args: { "p_category_id": string }; Returns: Json
                           },
"delete_loan":
{ Args: { "p_loan_id": string }; Returns: Json
                           },
"delete_project_group":
{ Args: { "p_id": string }; Returns: Json
                           },
"delete_transaction":
{ Args: { "p_id": string }; Returns: undefined
                           },
"disconnect_connector":
{ Args: { "p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: undefined
                           },
"disconnect_sumit":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"expected_months":
{ Args: { "p_months"?: number,"p_project_id"?: string,"p_today"?: string }; Returns: Json
                           },
"get_breakdown":
{ Args: { "p_basis"?: string,"p_direction": string,"p_from"?: string,"p_group_by"?: string,"p_to"?: string }; Returns: Json
                           },
"get_breakdown_lines":
{ Args: { "p_basis"?: string,"p_currency": string,"p_direction": string,"p_excluded"?: boolean,"p_from"?: string,"p_group_by": string,"p_group_key": string,"p_limit"?: number,"p_offset"?: number,"p_to"?: string }; Returns: Json
                           },
"get_dashboard":
{ Args: { "p_basis"?: string,"p_from"?: string,"p_to"?: string }; Returns: Json
                           },
"get_home":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_line_meta":
{ Args: { "p_ids": (string)[] }; Returns: Json
                           },
"get_line_split":
{ Args: { "p_transaction_id": string }; Returns: Json
                           },
"get_loan_split":
{ Args: { "p_transaction_id": string }; Returns: Json
                           },
"get_notification_prefs":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_profit_months":
{ Args: { "p_basis"?: string,"p_from"?: string,"p_project_id"?: string,"p_to"?: string }; Returns: Json
                           },
"get_project":
{ Args: { "p_id": string }; Returns: Json
                           } |
{ Args: { "p_basis": string,"p_from"?: string,"p_id": string,"p_to"?: string }; Returns: Json
                           },
"get_project_group":
{ Args: { "p_basis"?: string,"p_from"?: string,"p_id": string,"p_to"?: string }; Returns: Json
                           },
"get_transaction":
{ Args: { "p_id": string }; Returns: Json
                           },
"invite_member":
{ Args: { "p_email": string,"p_role"?: string }; Returns: Json
                           },
"jev_finish_usage":
{ Args: { "p_calls": number,"p_company": string,"p_failed"?: number,"p_input_tokens"?: number,"p_output_tokens"?: number,"p_run": string,"p_tagged"?: number }; Returns: undefined
                           },
"jev_key_status":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"jev_line_flags":
{ Args: { "p_company": string,"p_ids": (string)[] }; Returns: Json
                           },
"jev_mark_failed":
{ Args: { "p_company": string,"p_model": string,"p_transaction": string }; Returns: undefined
                           },
"jev_prefill":
{ Args: { "p_category"?: string,"p_company": string,"p_confidence"?: number,"p_model"?: string,"p_project"?: string,"p_transaction": string }; Returns: Json
                           },
"jev_projects":
{ Args: { "p_company": string }; Returns: Json
                           },
"jev_release_lease":
{ Args: { "p_holder": string }; Returns: undefined
                           },
"jev_reserve_calls":
{ Args: { "p_company": string,"p_run": string,"p_want": number }; Returns: number
                           },
"jev_suggestions":
{ Args: { "p_transaction_ids": (string)[] }; Returns: Json
                           },
"jev_supplier_history":
{ Args: { "p_company": string,"p_per"?: number,"p_suppliers": (string)[] }; Returns: Json
                           },
"jev_take_lease":
{ Args: { "p_holder": string,"p_seconds"?: number }; Returns: boolean
                           },
"list_auto_assigned_today":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_categories":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_due_connector_refreshes":
{ Args: { "p_limit": number }; Returns: {
              "company_id": string,"id": number,"provider": Database["public"]['Enums']["connector_provider"]
            }[]
                           },
"list_due_refresh_requests":
{ Args: { "p_limit": number }; Returns: {
              "company_id": string,"id": number
            }[]
                           },
"list_my_companies":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_project_category":
{ Args: { "p_basis"?: string,"p_category": string,"p_currency"?: string,"p_from"?: string,"p_limit"?: number,"p_offset"?: number,"p_project": string,"p_to"?: string }; Returns: Json
                           },
"list_project_groups":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_review":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_skipped_review":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_team":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_unpaid":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"lookup_mcp_credential":
{ Args: { "p_pepper_kid": string,"p_token_hash": string }; Returns: Json
                           },
"map_budget_section":
{ Args: { "p_name"?: string,"p_project_id"?: string,"p_section_id": number }; Returns: string
                           },
"match_lines":
{ Args: { "p_currency"?: string,"p_direction"?: string,"p_rows": Json,"p_window_days"?: number }; Returns: Json
                           },
"mcp_add_loan":
{ Args: { "p_amortization_months"?: number,"p_annual_rate_ppm": number,"p_currency": string,"p_escrow_minor": number,"p_idempotency_key": string,"p_interest_only_months"?: number,"p_kind"?: string,"p_name": string,"p_payment_minor": number,"p_principal_minor": number,"p_project_id"?: string,"p_start_date": string,"p_term_months": number }; Returns: Json
                           },
"mcp_assign_expense":
{ Args: { "p_category_id": string,"p_idempotency_key": string,"p_project_id": string,"p_remember"?: boolean,"p_transaction_id": string }; Returns: Json
                           },
"mcp_assign_expense_split":
{ Args: { "p_category_id"?: string,"p_idempotency_key": string,"p_shares": Json,"p_transaction_id": string }; Returns: Json
                           },
"mcp_assign_expenses":
{ Args: { "p_idempotency_key": string,"p_items": Json }; Returns: Json
                           },
"mcp_attach_loan_payment":
{ Args: { "p_idempotency_key": string,"p_loan_id": string,"p_parts": Json,"p_transaction_id": string }; Returns: Json
                           },
"mcp_company_loan_currency":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"mcp_create_categories":
{ Args: { "p_idempotency_key": string,"p_items": Json }; Returns: Json
                           },
"mcp_create_category":
{ Args: { "p_idempotency_key": string,"p_kind": string,"p_name": string }; Returns: Json
                           } |
{ Args: { "p_idempotency_key": string,"p_kind": string,"p_name": string,"p_parent_id": string }; Returns: Json
                           },
"mcp_create_project":
{ Args: { "p_idempotency_key": string,"p_name": string,"p_status"?: string }; Returns: Json
                           },
"mcp_create_project_group":
{ Args: { "p_idempotency_key": string,"p_name": string }; Returns: Json
                           },
"mcp_create_projects":
{ Args: { "p_idempotency_key": string,"p_items": Json }; Returns: Json
                           },
"mcp_credential_status":
{ Args: { "p_user": string }; Returns: Json
                           },
"mcp_delete_category":
{ Args: { "p_category_id": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_delete_loan":
{ Args: { "p_idempotency_key": string,"p_loan_id": string }; Returns: Json
                           },
"mcp_detach_loan_payment":
{ Args: { "p_idempotency_key": string,"p_transaction_id": string }; Returns: Json
                           },
"mcp_hide_category":
{ Args: { "p_category_id": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_invite_member":
{ Args: { "p_email": string,"p_idempotency_key": string,"p_role": string }; Returns: Json
                           },
"mcp_jev_accuracy":
{ Args: { "p_from"?: string,"p_to"?: string }; Returns: Json
                           },
"mcp_jev_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"mcp_jev_suggestions":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"mcp_list_loans":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"mcp_loan_payments":
{ Args: { "p_loan_id": string }; Returns: Json
                           },
"mcp_move_category_lines":
{ Args: { "p_from": string,"p_idempotency_key": string,"p_into": string }; Returns: Json
                           },
"mcp_remove_member":
{ Args: { "p_idempotency_key": string,"p_user_id": string }; Returns: Json
                           },
"mcp_rename_category":
{ Args: { "p_category_id": string,"p_idempotency_key": string,"p_name": string }; Returns: Json
                           },
"mcp_rename_company":
{ Args: { "p_idempotency_key": string,"p_name": string }; Returns: Json
                           },
"mcp_reorder_loans":
{ Args: { "p_idempotency_key": string,"p_loan_ids": (string)[] }; Returns: Json
                           },
"mcp_review_anomalies":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"mcp_set_cash_basis":
{ Args: { "p_basis": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_set_category_cash":
{ Args: { "p_category_id": string,"p_idempotency_key": string,"p_in_cash": boolean }; Returns: Json
                           },
"mcp_set_category_group":
{ Args: { "p_category_id": string,"p_group_name": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_set_category_parent":
{ Args: { "p_category_id": string,"p_idempotency_key": string,"p_parent_id": string }; Returns: Json
                           },
"mcp_set_category_pnl":
{ Args: { "p_category_id": string,"p_excluded": boolean,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_set_category_rehab":
{ Args: { "p_category_id": string,"p_idempotency_key": string,"p_rehab": boolean }; Returns: Json
                           },
"mcp_set_company_currency":
{ Args: { "p_currency": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_set_expense_category":
{ Args: { "p_category_id": string,"p_idempotency_key": string,"p_transaction_id": string }; Returns: Json
                           },
"mcp_set_index_rate":
{ Args: { "p_annual_rate_ppm": number,"p_effective_date": string,"p_idempotency_key": string,"p_rate_index": string }; Returns: Json
                           },
"mcp_set_invoice_paid":
{ Args: { "p_idempotency_key": string,"p_paid": boolean,"p_transaction_id": string }; Returns: Json
                           },
"mcp_set_jev_mode":
{ Args: { "p_enabled": boolean,"p_idempotency_key": string,"p_mode"?: string,"p_threshold"?: number }; Returns: Json
                           },
"mcp_set_line_cash":
{ Args: { "p_idempotency_key": string,"p_in_cash": boolean,"p_transaction_id": string }; Returns: Json
                           },
"mcp_set_line_pnl":
{ Args: { "p_idempotency_key": string,"p_in_pnl": boolean,"p_transaction_id": string }; Returns: Json
                           },
"mcp_set_lines_cash":
{ Args: { "p_idempotency_key": string,"p_items": Json }; Returns: Json
                           },
"mcp_set_lines_pnl":
{ Args: { "p_idempotency_key": string,"p_items": Json }; Returns: Json
                           },
"mcp_set_loan_index":
{ Args: { "p_idempotency_key": string,"p_loan_id": string,"p_margin_ppm": number,"p_rate_index": string }; Returns: Json
                           },
"mcp_set_loan_rate":
{ Args: { "p_annual_rate_ppm": number,"p_effective_date": string,"p_idempotency_key": string,"p_loan_id": string }; Returns: Json
                           },
"mcp_set_member_role":
{ Args: { "p_idempotency_key": string,"p_role": string,"p_user_id": string }; Returns: Json
                           },
"mcp_set_overhead_project":
{ Args: { "p_idempotency_key": string,"p_project_id": string }; Returns: Json
                           },
"mcp_set_project_group":
{ Args: { "p_group_id": string,"p_idempotency_key": string,"p_project_id": string }; Returns: Json
                           },
"mcp_set_project_investment":
{ Args: { "p_idempotency_key": string,"p_patch": Json,"p_project_id": string }; Returns: Json
                           },
"mcp_split_line":
{ Args: { "p_idempotency_key": string,"p_parts": Json,"p_transaction_id": string }; Returns: Json
                           },
"mcp_sync_bank_begin":
{ Args: { "p_idempotency_key": string }; Returns: Json
                           },
"mcp_sync_bank_finish":
{ Args: { "p_job_id": string,"p_response": Json }; Returns: Json
                           },
"mcp_sync_status":
{ Args: { "p_job_id": string }; Returns: Json
                           },
"mcp_undo":
{ Args: { "p_id": string,"p_idempotency_key": string,"p_kind": string }; Returns: Json
                           },
"mcp_undo_batch":
{ Args: { "p_batch_key": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_undo_jev_prefill":
{ Args: { "p_idempotency_key": string,"p_transaction_id": string }; Returns: Json
                           },
"mcp_update_loan":
{ Args: { "p_idempotency_key": string,"p_loan_id": string,"p_patch": Json }; Returns: Json
                           },
"merge_category":
{ Args: { "p_from": string,"p_into": string }; Returns: undefined
                           },
"missing_bills":
{ Args: { "p_today"?: string }; Returns: Json
                           },
"move_category_lines":
{ Args: { "p_from": string,"p_into": string }; Returns: Json
                           },
"my_invites":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"note_auth_failure":
{ Args: { "p_address": string }; Returns: Json
                           },
"note_connector_failure":
{ Args: { "p_code": string,"p_company": string,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: string
                           },
"note_connector_rejection":
{ Args: { "p_code": string,"p_company": string,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: Json
                           },
"note_push_results":
{ Args: { "p_gone": (string)[],"p_reminded": (string)[] }; Returns: undefined
                           },
"note_sumit_rejection":
{ Args: { "p_code": string,"p_company": string }; Returns: Json
                           },
"note_sync_failure":
{ Args: { "p_code": string,"p_company": string }; Returns: string
                           },
"owner_company_for":
{ Args: { "p_hint"?: string,"p_user": string }; Returns: string
                           },
"project_category_months":
{ Args: { "p_months"?: number,"p_project_id": string,"p_today"?: string }; Returns: Json
                           },
"project_waiting":
{ Args: { "p_project": string }; Returns: Json
                           },
"push_claim_targets":
{ Args: { "p_kind": string }; Returns: {
              "auth": string,"endpoint": string,"fresh": number,"p256dh": string,"user_id": string,"waiting": number
            }[]
                           },
"push_evening_targets":
{ Args: Record<PropertyKey, never>; Returns: {
              "auth": string,"endpoint": string,"p256dh": string,"user_id": string,"waiting": number
            }[]
                           },
"push_subscribe":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string,"p_user_agent"?: string }; Returns: undefined
                           },
"push_unsubscribe":
{ Args: { "p_endpoint": string }; Returns: undefined
                           },
"read_jev_api_key":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"reassign_transaction":
{ Args: { "p_category_id": string,"p_id": string,"p_project_id": string }; Returns: string
                           },
"remove_member":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"rename_category":
{ Args: { "p_category_id": string,"p_name": string }; Returns: Json
                           },
"rename_company":
{ Args: { "p_company_id": string,"p_name": string }; Returns: Json
                           },
"reopen_invite":
{ Args: { "p_invite_id": string }; Returns: Json
                           },
"reopen_review":
{ Args: { "p_id": string }; Returns: undefined
                           },
"reorder_loans":
{ Args: { "p_loan_ids": (string)[] }; Returns: Json
                           },
"replace_connector_connection":
{ Args: { "p_company": string,"p_dek_ciphertext": string,"p_dek_nonce": string,"p_envelope_version": string,"p_kek_version": string,"p_key_ciphertext": string,"p_key_nonce": string,"p_provider": Database["public"]['Enums']["connector_provider"],"p_settings": Json,"p_validated": boolean }; Returns: undefined
                           },
"replace_sumit_connection":
{ Args: { "p_company": string,"p_dek_ciphertext": string,"p_dek_nonce": string,"p_envelope_version": string,"p_kek_version": string,"p_key_ciphertext": string,"p_key_nonce": string,"p_sumit_company_id": number,"p_validated": boolean }; Returns: undefined
                           },
"request_connector_refresh":
{ Args: { "p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: string
                           },
"resolve_review":
{ Args: { "p_action": string,"p_category_id"?: string,"p_id": string,"p_project_id"?: string,"p_remember"?: boolean,"p_resolve"?: boolean }; Returns: undefined
                           },
"restore_category":
{ Args: { "p_category_id": string }; Returns: Json
                           },
"restore_loan":
{ Args: { "p_loan_id": string }; Returns: Json
                           },
"review_anomalies":
{ Args: { "p_transaction_ids": (string)[] }; Returns: Json
                           },
"revoke_mcp_credential":
{ Args: { "p_id": string,"p_user": string }; Returns: Json
                           },
"save_line_split":
{ Args: { "p_parts": Json,"p_preview"?: boolean,"p_transaction_id": string }; Returns: Json
                           },
"save_loan_split":
{ Args: { "p_loan_id": string,"p_parts": Json,"p_preview"?: boolean,"p_transaction_id": string }; Returns: Json
                           },
"save_split":
{ Args: { "p_shares": Json,"p_transaction_id": string }; Returns: undefined
                           },
"search_transactions":
{ Args: { "p_amount_max"?: number,"p_amount_min"?: number,"p_category"?: string,"p_category_exact"?: boolean,"p_direction"?: string,"p_from"?: string,"p_limit"?: number,"p_offset"?: number,"p_project"?: string,"p_query"?: string,"p_scope"?: string,"p_to"?: string }; Returns: Json
                           },
"set_after_overhead":
{ Args: { "p_on": boolean,"p_project_id"?: string }; Returns: undefined
                           },
"set_cash_basis":
{ Args: { "p_basis": string }; Returns: Json
                           },
"set_category_cash":
{ Args: { "p_category_id": string,"p_in_cash": boolean }; Returns: Json
                           },
"set_category_excluded_from_pnl":
{ Args: { "p_excluded": boolean,"p_id": string }; Returns: undefined
                           },
"set_category_group":
{ Args: { "p_category_id": string,"p_group_name": string }; Returns: Json
                           },
"set_category_hidden":
{ Args: { "p_hidden": boolean,"p_id": string }; Returns: undefined
                           },
"set_category_parent":
{ Args: { "p_category_id": string,"p_parent_id": string }; Returns: Json
                           },
"set_category_rehab":
{ Args: { "p_category_id": string,"p_rehab": boolean }; Returns: Json
                           },
"set_company_currency":
{ Args: { "p_currency": string }; Returns: Json
                           },
"set_company_integration":
{ Args: { "p_enabled": boolean,"p_mode"?: string,"p_provider"?: string,"p_threshold"?: number }; Returns: Json
                           },
"set_import_from":
{ Args: { "p_from": string,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: undefined
                           },
"set_invoice_paid":
{ Args: { "p_id": string,"p_paid": boolean }; Returns: Json
                           },
"set_member_role":
{ Args: { "p_role": string,"p_user_id": string }; Returns: Json
                           },
"set_notification_prefs":
{ Args: { "p_evening_reminder"?: boolean,"p_new_transaction"?: boolean,"p_weekly_summary"?: boolean }; Returns: Json
                           },
"set_overhead_project":
{ Args: { "p_project_id": string }; Returns: undefined
                           },
"set_project_group":
{ Args: { "p_group_id": string,"p_project_id": string }; Returns: Json
                           },
"set_project_investment":
{ Args: { "p_patch": Json,"p_project_id": string }; Returns: Json
                           },
"set_supplier_settings":
{ Args: { "p_id": string,"p_vat_exempt": boolean }; Returns: undefined
                           },
"set_transaction_cash":
{ Args: { "p_id": string,"p_in_cash": boolean }; Returns: Json
                           },
"set_transaction_category":
{ Args: { "p_category_id": string,"p_id": string,"p_resolve"?: boolean }; Returns: string
                           },
"set_transaction_pnl":
{ Args: { "p_id": string,"p_in_pnl": boolean }; Returns: Json
                           },
"stamp_connector_sync":
{ Args: { "p_company": string,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: undefined
                           },
"stamp_sumit_sync":
{ Args: { "p_company": string }; Returns: undefined
                           },
"store_mcp_credential":
{ Args: { "p_expires_at": string,"p_hint"?: string,"p_pepper_kid": string,"p_scope": (string)[],"p_token_hash": string,"p_user": string }; Returns: string
                           },
"sumit_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"switch_company":
{ Args: { "p_company_id": string }; Returns: Json
                           },
"sync_review_queue":
{ Args: { "p_company_id": string }; Returns: number
                           },
"touch_mcp_credential":
{ Args: { "p_id": string }; Returns: undefined
                           },
"undo_category_move":
{ Args: { "p_move_id": string }; Returns: undefined
                           },
"undo_jev_prefill":
{ Args: { "p_transaction_id": string }; Returns: Json
                           },
"undo_reassign":
{ Args: { "p_id": string }; Returns: undefined
                           },
"upsert_connector_lines":
{ Args: { "p_company": string,"p_expected_prev_cursor": string,"p_lines": Json,"p_next_cursor": string,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: Database["public"]['CompositeTypes']["connector_upsert_result"]
                          SetofOptions: {
        from: "*"
        to: "connector_upsert_result"
        isOneToOne: true
        isSetofReturn: false
      } },
"upsert_project":
{ Args: { "p_budget_agorot"?: number,"p_id"?: string,"p_name"?: string,"p_status"?: string }; Returns: string
                           },
"upsert_project_group":
{ Args: { "p_id": string,"p_name": string }; Returns: string
                           },
"upsert_sumit_documents":
{ Args: { "p_company": string,"p_docs": Json }; Returns: number
                           }
          }
          Enums: {
            "category_kind": "expense"|"income","connector_provider": "sumit"|"mercury","doc_kind": "invoice"|"receipt"|"invoice_receipt"|"credit"|"expense"|"other","line_status": "pending"|"posted"|"void","loan_kind": "amortizing"|"interest_only"|"balloon"|"demand","loan_split_part": "interest"|"escrow"|"principal"|"fees","loan_status": "open"|"paid_off"|"closed","pnl_role": "project"|"shared"|"overhead","project_status": "active"|"finished","review_status": "open"|"approved"|"skipped"|"changed","split_method": "equal"|"income_share"|"manual"|"worker_days","txn_direction": "income"|"expense","txn_source": "sumit"|"manual"|"photo"|"mercury","vat_status": "source"|"derived"|"assumed"|"unknown"
          }
          CompositeTypes: {
            "connector_upsert_result": {
                        "inserted": number | null,"updated": number | null,"removed": number | null,"skipped": number | null
                      }
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "category_kind": ["expense", "income"],"connector_provider": ["sumit", "mercury"],"doc_kind": ["invoice", "receipt", "invoice_receipt", "credit", "expense", "other"],"line_status": ["pending", "posted", "void"],"loan_kind": ["amortizing", "interest_only", "balloon", "demand"],"loan_split_part": ["interest", "escrow", "principal", "fees"],"loan_status": ["open", "paid_off", "closed"],"pnl_role": ["project", "shared", "overhead"],"project_status": ["active", "finished"],"review_status": ["open", "approved", "skipped", "changed"],"split_method": ["equal", "income_share", "manual", "worker_days"],"txn_direction": ["income", "expense"],"txn_source": ["sumit", "manual", "photo", "mercury"],"vat_status": ["source", "derived", "assumed", "unknown"]
          }
        }
} as const

