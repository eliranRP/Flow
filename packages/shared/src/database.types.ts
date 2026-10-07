
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "allocations": {
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
                    "company_id": string,"created_at": string,"excluded_from_pnl": boolean,"hidden": boolean,"id": string,"is_default": boolean,"kind": Database["public"]['Enums']["category_kind"],"loan_part": Database["public"]['Enums']["loan_split_part"] | null,"name": string,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"excluded_from_pnl"?: boolean,"hidden"?: boolean,"id"?: string,"is_default"?: boolean,"kind": Database["public"]['Enums']["category_kind"],"loan_part"?: Database["public"]['Enums']["loan_split_part"] | null,"name": string,"sort_order": number,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"excluded_from_pnl"?: boolean,"hidden"?: boolean,"id"?: string,"is_default"?: boolean,"kind"?: Database["public"]['Enums']["category_kind"],"loan_part"?: Database["public"]['Enums']["loan_split_part"] | null,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "after_overhead": boolean,"created_at": string,"id": string,"is_demo": boolean,"last_sumit_company_id": number | null,"name": string,"owner_id": string,"tax_id": string | null,"updated_at": string,"vat_rate_bp": number,"vat_registered": boolean
                  }
                  Insert: {
                    "after_overhead"?: boolean,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"last_sumit_company_id"?: number | null,"name": string,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Update: {
                    "after_overhead"?: boolean,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"last_sumit_company_id"?: number | null,"name"?: string,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"company_integrations": {
                  Row: {
                    "company_id": string,"created_at": string,"enabled": boolean,"mode": string,"provider": string,"threshold": number,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"enabled"?: boolean,"mode"?: string,"provider": string,"threshold"?: number,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"enabled"?: boolean,"mode"?: string,"provider"?: string,"threshold"?: number,"updated_at"?: string
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
                    "annual_rate_ppm": number,"company_id": string,"created_at": string,"currency": string,"escrow_minor": number,"id": string,"name": string,"payment_minor": number,"principal_minor": number,"start_date": string,"term_months": number,"updated_at": string
                  }
                  Insert: {
                    "annual_rate_ppm": number,"company_id": string,"created_at"?: string,"currency": string,"escrow_minor": number,"id"?: string,"name": string,"payment_minor": number,"principal_minor": number,"start_date": string,"term_months": number,"updated_at"?: string
                  }
                  Update: {
                    "annual_rate_ppm"?: number,"company_id"?: string,"created_at"?: string,"currency"?: string,"escrow_minor"?: number,"id"?: string,"name"?: string,"payment_minor"?: number,"principal_minor"?: number,"start_date"?: string,"term_months"?: number,"updated_at"?: string
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
                },"projects": {
                  Row: {
                    "after_overhead": boolean | null,"budget_agorot": number | null,"company_id": string,"created_at": string,"id": string,"name": string,"state_label": string | null,"status": Database["public"]['Enums']["project_status"],"sumit_budget_section_id": number | null,"updated_at": string
                  }
                  Insert: {
                    "after_overhead"?: boolean | null,"budget_agorot"?: number | null,"company_id": string,"created_at"?: string,"id"?: string,"name": string,"state_label"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"sumit_budget_section_id"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "after_overhead"?: boolean | null,"budget_agorot"?: number | null,"company_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"state_label"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"sumit_budget_section_id"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"reassign_undo": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"prior_allocations": NonNullable<Json>,"prior_category_id": string | null,"prior_category_suggested": boolean | null,"prior_pnl_role": Database["public"]['Enums']["pnl_role"] | null,"prior_project_id": string | null,"prior_review_id": string | null,"prior_user_assigned": boolean,"transaction_id": string,"undone_at": string | null
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"prior_allocations": NonNullable<Json>,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_review_id"?: string | null,"prior_user_assigned": boolean,"transaction_id": string,"undone_at"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"prior_allocations"?: NonNullable<Json>,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_review_id"?: string | null,"prior_user_assigned"?: boolean,"transaction_id"?: string,"undone_at"?: string | null
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
                    "company_id": string,"created_at": string,"doc_fingerprint": string | null,"id": string,"prior_allocations": Json | null,"prior_category_id": string | null,"prior_category_suggested": boolean | null,"prior_pnl_role": Database["public"]['Enums']["pnl_role"] | null,"prior_project_id": string | null,"prior_remembered_category_id": string | null,"prior_user_assigned": boolean | null,"reason": string | null,"resolved_at": string | null,"status": Database["public"]['Enums']["review_status"],"transaction_id": string | null,"updated_at": string,"written_remembered_category_id": string | null
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"doc_fingerprint"?: string | null,"id"?: string,"prior_allocations"?: Json | null,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_remembered_category_id"?: string | null,"prior_user_assigned"?: boolean | null,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string,"written_remembered_category_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"doc_fingerprint"?: string | null,"id"?: string,"prior_allocations"?: Json | null,"prior_category_id"?: string | null,"prior_category_suggested"?: boolean | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_remembered_category_id"?: string | null,"prior_user_assigned"?: boolean | null,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string,"written_remembered_category_id"?: string | null
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
                    "amount_gross": number,"amount_net": number,"amount_original": number,"cash_date": string | null,"category_assigned": boolean,"category_id": string | null,"category_suggested": boolean,"company_id": string,"created_at": string,"currency": string,"customer_id": string | null,"description": string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind": Database["public"]['Enums']["doc_kind"],"external_id": string | null,"fx_rate": number | null,"fx_rate_date": string | null,"id": string,"idempotency_key": string,"line_status": Database["public"]['Enums']["line_status"],"linked_external_id": string | null,"pnl_role": Database["public"]['Enums']["pnl_role"] | null,"project_assigned": boolean,"project_id": string | null,"provider_meta": NonNullable<Json>,"removed_at": string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id": string | null,"updated_at": string,"user_assigned": boolean,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Insert: {
                    "amount_gross": number,"amount_net": number,"amount_original": number,"cash_date"?: string | null,"category_assigned"?: boolean,"category_id"?: string | null,"category_suggested"?: boolean,"company_id": string,"created_at"?: string,"currency"?: string,"customer_id"?: string | null,"description"?: string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"fx_rate"?: number | null,"fx_rate_date"?: string | null,"id"?: string,"idempotency_key": string,"line_status"?: Database["public"]['Enums']["line_status"],"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_assigned"?: boolean,"project_id"?: string | null,"provider_meta"?: NonNullable<Json>,"removed_at"?: string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"user_assigned"?: boolean,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Update: {
                    "amount_gross"?: number,"amount_net"?: number,"amount_original"?: number,"cash_date"?: string | null,"category_assigned"?: boolean,"category_id"?: string | null,"category_suggested"?: boolean,"company_id"?: string,"created_at"?: string,"currency"?: string,"customer_id"?: string | null,"description"?: string,"direction"?: Database["public"]['Enums']["txn_direction"],"doc_date"?: string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"fx_rate"?: number | null,"fx_rate_date"?: string | null,"id"?: string,"idempotency_key"?: string,"line_status"?: Database["public"]['Enums']["line_status"],"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_assigned"?: boolean,"project_id"?: string | null,"provider_meta"?: NonNullable<Json>,"removed_at"?: string | null,"source"?: Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"user_assigned"?: boolean,"vat_amount"?: number,"vat_status"?: Database["public"]['Enums']["vat_status"]
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
            "approve_review_item":
{ Args: { "p_category_id": string,"p_check_shown"?: boolean,"p_id": string,"p_project_id": string,"p_remember"?: boolean,"p_shown_category_id"?: string,"p_shown_project_id"?: string }; Returns: Json
                           },
"approve_split_review":
{ Args: { "p_id": string }; Returns: undefined
                           },
"bump_mcp_rate":
{ Args: { "p_kind": string,"p_token": string,"p_user": string }; Returns: Json
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
"clear_loan_split_review":
{ Args: { "p_transaction_id": string }; Returns: undefined
                           },
"collapse_split":
{ Args: { "p_id": string,"p_project_id": string }; Returns: string
                           },
"company_pnl":
{ Args: { "p_basis": string,"p_company_id": string,"p_from": string,"p_to": string }; Returns: Json
                           },
"create_category":
{ Args: { "p_kind": string,"p_name": string }; Returns: string
                           },
"create_company":
{ Args: { "p_name": string,"p_vat_registered": boolean }; Returns: string
                           },
"create_manual_entry":
{ Args: { "p_category_id"?: string,"p_description": string,"p_direction": string,"p_doc_date": string,"p_gross_agorot": number,"p_kind": string,"p_project_id"?: string,"p_vat_exempt"?: boolean }; Returns: string
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
"get_dashboard":
{ Args: { "p_basis"?: string,"p_from"?: string,"p_to"?: string }; Returns: Json
                           },
"get_home":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_project":
{ Args: { "p_id": string }; Returns: Json
                           } |
{ Args: { "p_basis": string,"p_id": string }; Returns: Json
                           },
"get_transaction":
{ Args: { "p_id": string }; Returns: Json
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
"list_project_category":
{ Args: { "p_category": string,"p_limit"?: number,"p_offset"?: number,"p_project": string }; Returns: Json
                           },
"list_review":
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
"mcp_add_loan":
{ Args: { "p_annual_rate_ppm": number,"p_currency": string,"p_escrow_minor": number,"p_idempotency_key": string,"p_name": string,"p_payment_minor": number,"p_principal_minor": number,"p_start_date": string,"p_term_months": number }; Returns: Json
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
"mcp_create_category":
{ Args: { "p_idempotency_key": string,"p_kind": string,"p_name": string }; Returns: Json
                           },
"mcp_create_project":
{ Args: { "p_idempotency_key": string,"p_name": string,"p_status"?: string }; Returns: Json
                           },
"mcp_credential_status":
{ Args: { "p_user": string }; Returns: Json
                           },
"mcp_hide_category":
{ Args: { "p_category_id": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_list_loans":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"mcp_set_category_pnl":
{ Args: { "p_category_id": string,"p_excluded": boolean,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_set_expense_category":
{ Args: { "p_category_id": string,"p_idempotency_key": string,"p_transaction_id": string }; Returns: Json
                           },
"mcp_sync_bank_begin":
{ Args: { "p_idempotency_key": string }; Returns: Json
                           },
"mcp_sync_bank_finish":
{ Args: { "p_idempotency_key": string,"p_response": Json }; Returns: undefined
                           },
"mcp_undo":
{ Args: { "p_id": string,"p_idempotency_key": string,"p_kind": string }; Returns: Json
                           },
"mcp_undo_batch":
{ Args: { "p_batch_key": string,"p_idempotency_key": string }; Returns: Json
                           },
"mcp_update_loan":
{ Args: { "p_idempotency_key": string,"p_loan_id": string,"p_patch": Json }; Returns: Json
                           },
"merge_category":
{ Args: { "p_from": string,"p_into": string }; Returns: undefined
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
"note_sumit_rejection":
{ Args: { "p_code": string,"p_company": string }; Returns: Json
                           },
"note_sync_failure":
{ Args: { "p_code": string,"p_company": string }; Returns: string
                           },
"project_waiting":
{ Args: { "p_project": string }; Returns: Json
                           },
"read_jev_api_key":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"reassign_transaction":
{ Args: { "p_category_id": string,"p_id": string,"p_project_id": string }; Returns: string
                           },
"reopen_review":
{ Args: { "p_id": string }; Returns: undefined
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
"revoke_mcp_credential":
{ Args: { "p_id": string,"p_user": string }; Returns: Json
                           },
"save_split":
{ Args: { "p_shares": Json,"p_transaction_id": string }; Returns: undefined
                           },
"search_transactions":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_query"?: string,"p_scope"?: string }; Returns: Json
                           },
"set_after_overhead":
{ Args: { "p_on": boolean,"p_project_id"?: string }; Returns: undefined
                           },
"set_category_excluded_from_pnl":
{ Args: { "p_excluded": boolean,"p_id": string }; Returns: undefined
                           },
"set_category_hidden":
{ Args: { "p_hidden": boolean,"p_id": string }; Returns: undefined
                           },
"set_company_integration":
{ Args: { "p_enabled": boolean,"p_mode"?: string,"p_provider"?: string,"p_threshold"?: number }; Returns: Json
                           },
"set_import_from":
{ Args: { "p_from": string,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: undefined
                           },
"set_supplier_settings":
{ Args: { "p_id": string,"p_vat_exempt": boolean }; Returns: undefined
                           },
"set_transaction_category":
{ Args: { "p_category_id": string,"p_id": string,"p_resolve"?: boolean }; Returns: string
                           },
"stamp_connector_sync":
{ Args: { "p_company": string,"p_provider": Database["public"]['Enums']["connector_provider"] }; Returns: undefined
                           },
"stamp_sumit_sync":
{ Args: { "p_company": string }; Returns: undefined
                           },
"store_mcp_credential":
{ Args: { "p_expires_at": string,"p_pepper_kid": string,"p_scope": (string)[],"p_token_hash": string,"p_user": string }; Returns: string
                           },
"sumit_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"sync_review_queue":
{ Args: { "p_company_id": string }; Returns: number
                           },
"touch_mcp_credential":
{ Args: { "p_id": string }; Returns: undefined
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
"upsert_sumit_documents":
{ Args: { "p_company": string,"p_docs": Json }; Returns: number
                           }
          }
          Enums: {
            "category_kind": "expense"|"income","connector_provider": "sumit"|"mercury","doc_kind": "invoice"|"receipt"|"invoice_receipt"|"credit"|"expense"|"other","line_status": "pending"|"posted"|"void","loan_split_part": "interest"|"escrow"|"principal","pnl_role": "project"|"shared"|"overhead","project_status": "active"|"finished","review_status": "open"|"approved"|"skipped"|"changed","split_method": "equal"|"income_share"|"manual"|"worker_days","txn_direction": "income"|"expense","txn_source": "sumit"|"manual"|"photo"|"mercury","vat_status": "source"|"derived"|"assumed"|"unknown"
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
            "category_kind": ["expense", "income"],"connector_provider": ["sumit", "mercury"],"doc_kind": ["invoice", "receipt", "invoice_receipt", "credit", "expense", "other"],"line_status": ["pending", "posted", "void"],"loan_split_part": ["interest", "escrow", "principal"],"pnl_role": ["project", "shared", "overhead"],"project_status": ["active", "finished"],"review_status": ["open", "approved", "skipped", "changed"],"split_method": ["equal", "income_share", "manual", "worker_days"],"txn_direction": ["income", "expense"],"txn_source": ["sumit", "manual", "photo", "mercury"],"vat_status": ["source", "derived", "assumed", "unknown"]
          }
        }
} as const

