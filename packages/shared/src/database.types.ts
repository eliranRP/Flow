
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
                    "after_overhead": boolean,"created_at": string,"id": string,"is_demo": boolean,"name": string,"owner_id": string,"tax_id": string | null,"updated_at": string,"vat_rate_bp": number,"vat_registered": boolean
                  }
                  Insert: {
                    "after_overhead"?: boolean,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"name": string,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Update: {
                    "after_overhead"?: boolean,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"name"?: string,"owner_id"?: string,"tax_id"?: string | null,"updated_at"?: string,"vat_rate_bp"?: number,"vat_registered"?: boolean
                  }
                  Relationships: [
                    
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
                    "company_id": string,"created_at": string,"id": string,"prior_allocations": NonNullable<Json>,"prior_category_id": string | null,"prior_pnl_role": Database["public"]['Enums']["pnl_role"] | null,"prior_project_id": string | null,"prior_review_id": string | null,"prior_user_assigned": boolean,"transaction_id": string,"undone_at": string | null
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"prior_allocations": NonNullable<Json>,"prior_category_id"?: string | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_review_id"?: string | null,"prior_user_assigned": boolean,"transaction_id": string,"undone_at"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"prior_allocations"?: NonNullable<Json>,"prior_category_id"?: string | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_review_id"?: string | null,"prior_user_assigned"?: boolean,"transaction_id"?: string,"undone_at"?: string | null
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
                    "company_id": string,"created_at": string,"doc_fingerprint": string | null,"id": string,"prior_allocations": Json | null,"prior_category_id": string | null,"prior_pnl_role": Database["public"]['Enums']["pnl_role"] | null,"prior_project_id": string | null,"prior_remembered_category_id": string | null,"prior_user_assigned": boolean | null,"reason": string | null,"resolved_at": string | null,"status": Database["public"]['Enums']["review_status"],"transaction_id": string | null,"updated_at": string,"written_remembered_category_id": string | null
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"doc_fingerprint"?: string | null,"id"?: string,"prior_allocations"?: Json | null,"prior_category_id"?: string | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_remembered_category_id"?: string | null,"prior_user_assigned"?: boolean | null,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string,"written_remembered_category_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"doc_fingerprint"?: string | null,"id"?: string,"prior_allocations"?: Json | null,"prior_category_id"?: string | null,"prior_pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"prior_project_id"?: string | null,"prior_remembered_category_id"?: string | null,"prior_user_assigned"?: boolean | null,"reason"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["review_status"],"transaction_id"?: string | null,"updated_at"?: string,"written_remembered_category_id"?: string | null
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
                },"sumit_connections": {
                  Row: {
                    "company_id": string,"created_at": string,"dek_ciphertext": string,"dek_nonce": string,"envelope_version": string | null,"id": string,"kek_version": string,"key_ciphertext": string,"key_nonce": string,"last_error": string | null,"last_sync_at": string | null,"next_attempt_at": string | null,"reject_attempts": number,"sumit_company_id": number | null,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"dek_ciphertext": string,"dek_nonce": string,"envelope_version"?: string | null,"id"?: string,"kek_version": string,"key_ciphertext": string,"key_nonce": string,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"reject_attempts"?: number,"sumit_company_id"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"dek_ciphertext"?: string,"dek_nonce"?: string,"envelope_version"?: string | null,"id"?: string,"kek_version"?: string,"key_ciphertext"?: string,"key_nonce"?: string,"last_error"?: string | null,"last_sync_at"?: string | null,"next_attempt_at"?: string | null,"reject_attempts"?: number,"sumit_company_id"?: number | null,"updated_at"?: string
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
                    "claimed_at": string | null,"company_id": string,"id": number,"requested_at": string
                  }
                  Insert: {
                    "claimed_at"?: string | null,"company_id": string,"id"?: never,"requested_at"?: string
                  }
                  Update: {
                    "claimed_at"?: string | null,"company_id"?: string,"id"?: never,"requested_at"?: string
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
                    "amount_gross": number,"amount_net": number,"cash_date": string | null,"category_id": string | null,"company_id": string,"created_at": string,"customer_id": string | null,"description": string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind": Database["public"]['Enums']["doc_kind"],"external_id": string | null,"id": string,"idempotency_key": string,"linked_external_id": string | null,"pnl_role": Database["public"]['Enums']["pnl_role"] | null,"project_id": string | null,"removed_at": string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id": string | null,"updated_at": string,"user_assigned": boolean,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Insert: {
                    "amount_gross": number,"amount_net": number,"cash_date"?: string | null,"category_id"?: string | null,"company_id": string,"created_at"?: string,"customer_id"?: string | null,"description"?: string,"direction": Database["public"]['Enums']["txn_direction"],"doc_date": string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"id"?: string,"idempotency_key": string,"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_id"?: string | null,"removed_at"?: string | null,"source": Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"user_assigned"?: boolean,"vat_amount": number,"vat_status": Database["public"]['Enums']["vat_status"]
                  }
                  Update: {
                    "amount_gross"?: number,"amount_net"?: number,"cash_date"?: string | null,"category_id"?: string | null,"company_id"?: string,"created_at"?: string,"customer_id"?: string | null,"description"?: string,"direction"?: Database["public"]['Enums']["txn_direction"],"doc_date"?: string,"doc_kind"?: Database["public"]['Enums']["doc_kind"],"external_id"?: string | null,"id"?: string,"idempotency_key"?: string,"linked_external_id"?: string | null,"pnl_role"?: Database["public"]['Enums']["pnl_role"] | null,"project_id"?: string | null,"removed_at"?: string | null,"source"?: Database["public"]['Enums']["txn_source"],"supplier_id"?: string | null,"updated_at"?: string,"user_assigned"?: boolean,"vat_amount"?: number,"vat_status"?: Database["public"]['Enums']["vat_status"]
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
"map_budget_section":
{ Args: { "p_name"?: string,"p_project_id"?: string,"p_section_id": number }; Returns: string
                           },
"merge_category":
{ Args: { "p_from": string,"p_into": string }; Returns: undefined
                           },
"reassign_transaction":
{ Args: { "p_category_id": string,"p_id": string,"p_project_id": string }; Returns: string
                           },
"reopen_review":
{ Args: { "p_id": string }; Returns: undefined
                           },
"resolve_review":
{ Args: { "p_action": string,"p_category_id"?: string,"p_id": string,"p_project_id"?: string,"p_remember"?: boolean }; Returns: undefined
                           },
"save_split":
{ Args: { "p_shares": Json,"p_transaction_id": string }; Returns: undefined
                           },
"set_after_overhead":
{ Args: { "p_on": boolean,"p_project_id"?: string }; Returns: undefined
                           },
"set_category_hidden":
{ Args: { "p_hidden": boolean,"p_id": string }; Returns: undefined
                           },
"set_supplier_settings":
{ Args: { "p_id": string,"p_vat_exempt": boolean }; Returns: undefined
                           },
"stamp_sumit_sync":
{ Args: { "p_company": string }; Returns: undefined
                           },
"sumit_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"sync_review_queue":
{ Args: { "p_company_id": string }; Returns: number
                           },
"undo_reassign":
{ Args: { "p_id": string }; Returns: undefined
                           },
"upsert_project":
{ Args: { "p_budget_agorot"?: number,"p_id"?: string,"p_name"?: string,"p_status"?: string }; Returns: string
                           },
"upsert_sumit_documents":
{ Args: { "p_company": string,"p_docs": Json }; Returns: number
                           }
          }
          Enums: {
            "category_kind": "expense"|"income","doc_kind": "invoice"|"receipt"|"invoice_receipt"|"credit"|"expense"|"other","pnl_role": "project"|"shared"|"overhead","project_status": "active"|"finished","review_status": "open"|"approved"|"skipped"|"changed","split_method": "equal"|"income_share"|"manual"|"worker_days","txn_direction": "income"|"expense","txn_source": "sumit"|"manual"|"photo","vat_status": "source"|"derived"|"assumed"|"unknown"
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
            "category_kind": ["expense", "income"],"doc_kind": ["invoice", "receipt", "invoice_receipt", "credit", "expense", "other"],"pnl_role": ["project", "shared", "overhead"],"project_status": ["active", "finished"],"review_status": ["open", "approved", "skipped", "changed"],"split_method": ["equal", "income_share", "manual", "worker_days"],"txn_direction": ["income", "expense"],"txn_source": ["sumit", "manual", "photo"],"vat_status": ["source", "derived", "assumed", "unknown"]
          }
        }
} as const

