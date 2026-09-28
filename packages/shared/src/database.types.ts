
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "agg_month": {
                  Row: {
                    "basis": string,"company_id": string,"expense_agorot": number,"income_agorot": number,"net_profit_agorot": number,"ym": string
                  }
                  Insert: {
                    "basis": string,"company_id": string,"expense_agorot": number,"income_agorot": number,"net_profit_agorot": number,"ym": string
                  }
                  Update: {
                    "basis"?: string,"company_id"?: string,"expense_agorot"?: number,"income_agorot"?: number,"net_profit_agorot"?: number,"ym"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agg_month_company_id_fkey"
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
                },"applied_op": {
                  Row: {
                    "client_op_id": string,"company_id": string,"created_at": string,"result": NonNullable<Json>
                  }
                  Insert: {
                    "client_op_id": string,"company_id": string,"created_at"?: string,"result": NonNullable<Json>
                  }
                  Update: {
                    "client_op_id"?: string,"company_id"?: string,"created_at"?: string,"result"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "applied_op_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
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
                    "company_id": string,"created_at": string,"hidden": boolean,"id": string,"is_default": boolean,"kind": Database["public"]['Enums']["category_kind"],"name": string,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"hidden"?: boolean,"id"?: string,"is_default"?: boolean,"kind": Database["public"]['Enums']["category_kind"],"name": string,"sort_order": number,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"hidden"?: boolean,"id"?: string,"is_default"?: boolean,"kind"?: Database["public"]['Enums']["category_kind"],"name"?: string,"sort_order"?: number,"updated_at"?: string
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
                    "created_at": string,"id": string,"is_demo": boolean,"name": string,"owner_id": string,"tax_id": string | null,"updated_at": string,"vat_rate_bp": number,"vat_registered": boolean
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_demo"?: boolean,"name": string,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_demo"?: boolean,"name"?: string,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"company_member": {
                  Row: {
                    "company_id": string,"role": string,"user_id": string
                  }
                  Insert: {
                    "company_id": string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "company_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_member_company_id_fkey"
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
                },"dirty_month": {
                  Row: {
                    "company_id": string,"ym": string
                  }
                  Insert: {
                    "company_id": string,"ym": string
                  }
                  Update: {
                    "company_id"?: string,"ym"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "dirty_month_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"home_snapshot": {
                  Row: {
                    "company_id": string,"computed_at": string,"payload": NonNullable<Json>,"period_key": string,"version": number
                  }
                  Insert: {
                    "company_id": string,"computed_at"?: string,"payload": NonNullable<Json>,"period_key": string,"version"?: number
                  }
                  Update: {
                    "company_id"?: string,"computed_at"?: string,"payload"?: NonNullable<Json>,"period_key"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "home_snapshot_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_outbox": {
                  Row: {
                    "body": string,"company_id": string,"created_at": string,"id": string,"kind": string,"local_date": string,"sent_at": string | null,"status": string,"title": string,"url": string
                  }
                  Insert: {
                    "body": string,"company_id": string,"created_at"?: string,"id"?: string,"kind": string,"local_date": string,"sent_at"?: string | null,"status"?: string,"title": string,"url": string
                  }
                  Update: {
                    "body"?: string,"company_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"local_date"?: string,"sent_at"?: string | null,"status"?: string,"title"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_outbox_company_id_fkey"
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
                },"projects": {
                  Row: {
                    "budget_agorot": number | null,"company_id": string,"created_at": string,"id": string,"name": string,"state_label": string | null,"status": Database["public"]['Enums']["project_status"],"sumit_budget_section_id": number | null,"updated_at": string
                  }
                  Insert: {
                    "budget_agorot"?: number | null,"company_id": string,"created_at"?: string,"id"?: string,"name": string,"state_label"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"sumit_budget_section_id"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "budget_agorot"?: number | null,"company_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"state_label"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"sumit_budget_section_id"?: number | null,"updated_at"?: string
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
                },"push_subscription": {
                  Row: {
                    "auth_secret": string,"company_id": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string
                  }
                  Insert: {
                    "auth_secret": string,"company_id": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string
                  }
                  Update: {
                    "auth_secret"?: string,"company_id"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscription_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"review_queue": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"reason": string | null,"resolved_at": string | null,"status": Database["public"]['Enums']["review_status"],"transaction_id": string | null,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string
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
                },"rum_sample": {
                  Row: {
                    "company_id": string | null,"created_at": string,"id": number,"lcp_ms": number | null,"path": string | null
                  }
                  Insert: {
                    "company_id"?: string | null,"created_at"?: string,"id"?: never,"lcp_ms"?: number | null,"path"?: string | null
                  }
                  Update: {
                    "company_id"?: string | null,"created_at"?: string,"id"?: never,"lcp_ms"?: number | null,"path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rum_sample_company_id_fkey"
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
                },"sumit_call_log": {
                  Row: {
                    "called_at": string,"company_id": string,"id": number,"purpose": string
                  }
                  Insert: {
                    "called_at"?: string,"company_id": string,"id"?: never,"purpose": string
                  }
                  Update: {
                    "called_at"?: string,"company_id"?: string,"id"?: never,"purpose"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sumit_call_log_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"sumit_connections": {
                  Row: {
                    "calls_cap": number,"calls_count": number,"calls_month": string | null,"company_id": string,"created_at": string,"dek_ciphertext": string,"dek_nonce": string,"drift_fields": string | null,"hook_token": string,"id": string,"kek_version": string,"key_ciphertext": string,"key_nonce": string,"last_error": string | null,"last_sync_at": string | null,"sumit_company_id": number | null,"updated_at": string
                  }
                  Insert: {
                    "calls_cap"?: number,"calls_count"?: number,"calls_month"?: string | null,"company_id": string,"created_at"?: string,"dek_ciphertext": string,"dek_nonce": string,"drift_fields"?: string | null,"hook_token"?: string,"id"?: string,"kek_version": string,"key_ciphertext": string,"key_nonce": string,"last_error"?: string | null,"last_sync_at"?: string | null,"sumit_company_id"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "calls_cap"?: number,"calls_count"?: number,"calls_month"?: string | null,"company_id"?: string,"created_at"?: string,"dek_ciphertext"?: string,"dek_nonce"?: string,"drift_fields"?: string | null,"hook_token"?: string,"id"?: string,"kek_version"?: string,"key_ciphertext"?: string,"key_nonce"?: string,"last_error"?: string | null,"last_sync_at"?: string | null,"sumit_company_id"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sumit_connections_company_id_fkey"
      columns: ["company_id"]
isOneToOne: true
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"sumit_refresh_requests": {
                  Row: {
                    "claimed_at": string | null,"company_id": string,"id": number,"purpose": string,"requested_at": string
                  }
                  Insert: {
                    "claimed_at"?: string | null,"company_id": string,"id"?: never,"purpose"?: string,"requested_at"?: string
                  }
                  Update: {
                    "claimed_at"?: string | null,"company_id"?: string,"id"?: never,"purpose"?: string,"requested_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sumit_refresh_requests_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
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
                },"transactions": {
                  Row: {
                    "amount_gross": number,"amount_net": number,"cash_date": string | null,"category_id": string | null,"company_id": string,"created_at": string,"customer_id": string | null,"description": string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind": Database["public"]['Enums']["doc_kind"],"external_id": string | null,"id": string,"idempotency_key": string,"linked_external_id": string | null,"pnl_role": Database["public"]['Enums']["pnl_role"] | null,"project_id": string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id": string | null,"updated_at": string,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Insert: {
                    "amount_gross": number,"amount_net": number,"cash_date"?: string | null,"category_id"?: string | null,"company_id": string,"created_at"?: string,"customer_id"?: string | null,"description"?: string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"id"?: string,"idempotency_key": string,"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_id"?: string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Update: {
                    "amount_gross"?: number,"amount_net"?: number,"cash_date"?: string | null,"category_id"?: string | null,"company_id"?: string,"created_at"?: string,"customer_id"?: string | null,"description"?: string,"direction"?: Database["public"]['Enums']["txn_direction"],"doc_date"?: string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"id"?: string,"idempotency_key"?: string,"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_id"?: string | null,"source"?: Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"vat_amount"?: number,"vat_status"?: Database["public"]['Enums']["vat_status"]
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
            "sumit_connection_status": {
                  Row: {
                    "company_id": string | null,"connected": boolean | null,"last_error": string | null,"last_sync_at": string | null,"sumit_company_id": number | null
                  }
                  Insert: {
                           "company_id"?: string | null,"connected"?: never,"last_error"?: string | null,"last_sync_at"?: string | null,"sumit_company_id"?: number | null
                         }
                        Update: {
                           "company_id"?: string | null,"connected"?: never,"last_error"?: string | null,"last_sync_at"?: string | null,"sumit_company_id"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "sumit_connections_company_id_fkey"
      columns: ["company_id"]
isOneToOne: true
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "apply_queued_op":
{ Args: { "p_args": Json,"p_client_op_id": string,"p_name": string }; Returns: Json
                           },
"company_pnl":
{ Args: { "p_basis": string,"p_company_id": string,"p_from": string,"p_to": string }; Returns: Json
                           },
"create_company":
{ Args: { "p_name": string,"p_vat_registered": boolean }; Returns: string
                           },
"create_manual_entry":
{ Args: { "p_category_id": string,"p_client_op_id"?: string,"p_description": string,"p_direction": string,"p_doc_date": string,"p_gross_agorot": number,"p_kind": string,"p_project_id": string,"p_vat_exempt": boolean }; Returns: string
                           },
"custom_access_token_hook":
{ Args: { "event": Json }; Returns: Json
                           },
"delete_transaction":
{ Args: { "p_id": string }; Returns: undefined
                           },
"disconnect_sumit":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"dispatch_notifications":
{ Args: { "p_now"?: string }; Returns: number
                           },
"export_ledger":
{ Args: { "p_from"?: string,"p_to"?: string }; Returns: Json
                           },
"get_dashboard":
{ Args: { "p_basis"?: string,"p_from"?: string,"p_to"?: string }; Returns: Json
                           },
"get_home":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_project":
{ Args: { "p_id": string }; Returns: Json
                           },
"get_transaction":
{ Args: { "p_id": string }; Returns: Json
                           },
"list_categories":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_review":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_unpaid":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"log_rum":
{ Args: { "p_lcp_ms": number,"p_path": string }; Returns: undefined
                           },
"map_budget_section":
{ Args: { "p_name": string,"p_project_id": string,"p_section_id": number }; Returns: string
                           },
"merge_category":
{ Args: { "p_from": string,"p_into": string }; Returns: undefined
                           },
"push_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"read_home_snapshot":
{ Args: { "p_known"?: Json }; Returns: Json
                           },
"refresh_company_months":
{ Args: { "p_company_id": string,"p_months": (string)[] }; Returns: undefined
                           },
"refresh_dirty":
{ Args: { "p_company_id"?: string }; Returns: number
                           },
"register_push":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string }; Returns: undefined
                           },
"request_refresh":
{ Args: { "p_purpose"?: string }; Returns: Json
                           },
"reserve_sumit_call":
{ Args: { "p_company_id": string,"p_purpose": string }; Returns: boolean
                           },
"resolve_review":
{ Args: { "p_action": string,"p_category_id": string,"p_id": string,"p_project_id": string }; Returns: undefined
                           },
"save_split":
{ Args: { "p_shares": Json,"p_transaction_id": string }; Returns: undefined
                           },
"set_category_hidden":
{ Args: { "p_hidden": boolean,"p_id": string }; Returns: undefined
                           },
"sumit_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"sync_review_queue":
{ Args: { "p_company_id": string }; Returns: number
                           },
"unregister_push":
{ Args: { "p_endpoint": string }; Returns: undefined
                           },
"upsert_project":
{ Args: { "p_budget_agorot": number,"p_id": string,"p_name": string,"p_status": string }; Returns: string
                           }
          }
          Enums: {
            "category_kind": "expense"|"income","doc_kind": "invoice"|"receipt"|"invoice_receipt"|"credit"|"expense"|"other","pnl_role": "project"|"shared"|"overhead","project_status": "active"|"finished","review_status": "open"|"approved"|"skipped"|"changed","split_method": "equal"|"income_share"|"manual"|"worker_days","txn_direction": "income"|"expense","txn_source": "sumit"|"hapoalim"|"manual"|"photo","vat_status": "source"|"derived"|"assumed"|"unknown"
          }
          CompositeTypes: {
            [_ in never]: never
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
            "category_kind": ["expense", "income"],"doc_kind": ["invoice", "receipt", "invoice_receipt", "credit", "expense", "other"],"pnl_role": ["project", "shared", "overhead"],"project_status": ["active", "finished"],"review_status": ["open", "approved", "skipped", "changed"],"split_method": ["equal", "income_share", "manual", "worker_days"],"txn_direction": ["income", "expense"],"txn_source": ["sumit", "hapoalim", "manual", "photo"],"vat_status": ["source", "derived", "assumed", "unknown"]
          }
        }
} as const

