export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_slots: {
        Row: {
          active: boolean | null
          ad_html: string | null
          advertiser: string | null
          created_at: string | null
          ends_at: string | null
          id: number
          image_url: string | null
          is_active: boolean | null
          placement: string | null
          slot_key: string
          starts_at: string | null
          target_url: string | null
          title: string
        }
        Insert: {
          active?: boolean | null
          ad_html?: string | null
          advertiser?: string | null
          created_at?: string | null
          ends_at?: string | null
          id?: number
          image_url?: string | null
          is_active?: boolean | null
          placement?: string | null
          slot_key: string
          starts_at?: string | null
          target_url?: string | null
          title: string
        }
        Update: {
          active?: boolean | null
          ad_html?: string | null
          advertiser?: string | null
          created_at?: string | null
          ends_at?: string | null
          id?: number
          image_url?: string | null
          is_active?: boolean | null
          placement?: string | null
          slot_key?: string
          starts_at?: string | null
          target_url?: string | null
          title?: string
        }
        Relationships: []
      }
      admin_removal_proposals: {
        Row: {
          created_at: string
          executed_at: string | null
          id: string
          proposed_by: string
          reason: string
          status: string
          target_user_id: string
        }
        Insert: {
          created_at?: string
          executed_at?: string | null
          id?: string
          proposed_by: string
          reason: string
          status?: string
          target_user_id: string
        }
        Update: {
          created_at?: string
          executed_at?: string | null
          id?: string
          proposed_by?: string
          reason?: string
          status?: string
          target_user_id?: string
        }
        Relationships: []
      }
      admin_removal_votes: {
        Row: {
          created_at: string
          id: string
          proposal_id: string
          vote: string
          voter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          proposal_id: string
          vote: string
          voter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          proposal_id?: string
          vote?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_removal_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "admin_removal_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_buckets: {
        Row: {
          created_at: string
          days: number | null
          enabled: boolean
          id: string
          include_domains: string[]
          max_results: number
          name: string
          notes: string | null
          query_template: string
          search_depth: string
          sector_filter: string[]
          sort_order: number
          topic: string | null
        }
        Insert: {
          created_at?: string
          days?: number | null
          enabled?: boolean
          id?: string
          include_domains?: string[]
          max_results?: number
          name: string
          notes?: string | null
          query_template: string
          search_depth?: string
          sector_filter?: string[]
          sort_order?: number
          topic?: string | null
        }
        Update: {
          created_at?: string
          days?: number | null
          enabled?: boolean
          id?: string
          include_domains?: string[]
          max_results?: number
          name?: string
          notes?: string | null
          query_template?: string
          search_depth?: string
          sector_filter?: string[]
          sort_order?: number
          topic?: string | null
        }
        Relationships: []
      }
      analysis_jobs: {
        Row: {
          attempts: number
          enqueued_at: string
          enqueued_by: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          project_id: number
          run_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          enqueued_by?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          project_id: number
          run_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          enqueued_by?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          project_id?: number
          run_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          credits_checked_at: string | null
          credits_total: number | null
          credits_used: number | null
          exhausted_reason: string | null
          id: string
          is_exhausted: boolean
          key_value: string
          label: string | null
          last_exhausted_at: string | null
          last_succeeded_at: string | null
          position: number
          provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credits_checked_at?: string | null
          credits_total?: number | null
          credits_used?: number | null
          exhausted_reason?: string | null
          id?: string
          is_exhausted?: boolean
          key_value: string
          label?: string | null
          last_exhausted_at?: string | null
          last_succeeded_at?: string | null
          position?: number
          provider: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credits_checked_at?: string | null
          credits_total?: number | null
          credits_used?: number | null
          exhausted_reason?: string | null
          id?: string
          is_exhausted?: boolean
          key_value?: string
          label?: string | null
          last_exhausted_at?: string | null
          last_succeeded_at?: string | null
          position?: number
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_project_metrics: {
        Row: {
          analysis_runs: number
          approvals: number
          computed_at: string
          day: string
          new_detail_rows: number
          new_projects: number
          new_updates: number
          rejections: number
          sherlock_errors: number
          sherlock_inserted: number
          sherlock_jobs_run: number
        }
        Insert: {
          analysis_runs?: number
          approvals?: number
          computed_at?: string
          day: string
          new_detail_rows?: number
          new_projects?: number
          new_updates?: number
          rejections?: number
          sherlock_errors?: number
          sherlock_inserted?: number
          sherlock_jobs_run?: number
        }
        Update: {
          analysis_runs?: number
          approvals?: number
          computed_at?: string
          day?: string
          new_detail_rows?: number
          new_projects?: number
          new_updates?: number
          rejections?: number
          sherlock_errors?: number
          sherlock_inserted?: number
          sherlock_jobs_run?: number
        }
        Relationships: []
      }
      global_briefs: {
        Row: {
          ai_tag: string | null
          batch_id: string | null
          body: string
          created_at: string
          created_by: string | null
          display_eligible: boolean
          headline: string
          id: string
          importance: number | null
          scope: string
          scope_province: string | null
          scope_sector: string | null
          sources: Json | null
        }
        Insert: {
          ai_tag?: string | null
          batch_id?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          display_eligible?: boolean
          headline: string
          id?: string
          importance?: number | null
          scope?: string
          scope_province?: string | null
          scope_sector?: string | null
          sources?: Json | null
        }
        Update: {
          ai_tag?: string | null
          batch_id?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          display_eligible?: boolean
          headline?: string
          id?: string
          importance?: number | null
          scope?: string
          scope_province?: string | null
          scope_sector?: string | null
          sources?: Json | null
        }
        Relationships: []
      }
      internal_notifier_config: {
        Row: {
          id: number
          internal_token: string | null
          send_alert_url: string | null
        }
        Insert: {
          id?: number
          internal_token?: string | null
          send_alert_url?: string | null
        }
        Update: {
          id?: number
          internal_token?: string | null
          send_alert_url?: string | null
        }
        Relationships: []
      }
      municipalities: {
        Row: {
          district: string
          id: number
          kind: string
          name: string
          province: string
        }
        Insert: {
          district: string
          id?: number
          kind: string
          name: string
          province: string
        }
        Update: {
          district?: string
          id?: number
          kind?: string
          name?: string
          province?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          details: Json
          id: number
          kind: string
          sent_at: string
        }
        Insert: {
          details?: Json
          id?: number
          kind: string
          sent_at?: string
        }
        Update: {
          details?: Json
          id?: number
          kind?: string
          sent_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          organization: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          organization?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          organization?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      project_analysis_runs: {
        Row: {
          ai_tag: string | null
          bucket_status: Json
          deduped_per_table: Json
          errors: string[]
          finished_at: string | null
          gaps_and_contradictions: string[]
          id: string
          inserted_per_table: Json
          invoked_by: string | null
          narrative_summary: string | null
          project_id: number
          started_at: string
          status: string
        }
        Insert: {
          ai_tag?: string | null
          bucket_status?: Json
          deduped_per_table?: Json
          errors?: string[]
          finished_at?: string | null
          gaps_and_contradictions?: string[]
          id?: string
          inserted_per_table?: Json
          invoked_by?: string | null
          narrative_summary?: string | null
          project_id: number
          started_at?: string
          status?: string
        }
        Update: {
          ai_tag?: string | null
          bucket_status?: Json
          deduped_per_table?: Json
          errors?: string[]
          finished_at?: string | null
          gaps_and_contradictions?: string[]
          id?: string
          inserted_per_table?: Json
          invoked_by?: string | null
          narrative_summary?: string | null
          project_id?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_analysis_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_compliance: {
        Row: {
          ai_tag: string | null
          approval_status: string
          authority: string | null
          confidence_score: number | null
          created_at: string
          decided_at: string | null
          document_url: string | null
          finding: string | null
          id: string
          item_type: string
          notes: string | null
          project_id: number
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          source_url: string | null
          sources: Json
          status: string
          submitted_by: string | null
          submitted_by_ai: boolean
          updated_at: string
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          authority?: string | null
          confidence_score?: number | null
          created_at?: string
          decided_at?: string | null
          document_url?: string | null
          finding?: string | null
          id?: string
          item_type: string
          notes?: string | null
          project_id: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          sources?: Json
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          authority?: string | null
          confidence_score?: number | null
          created_at?: string
          decided_at?: string | null
          document_url?: string | null
          finding?: string | null
          id?: string
          item_type?: string
          notes?: string | null
          project_id?: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          sources?: Json
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_compliance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          ai_tag: string | null
          approval_status: string
          confidence_score: number | null
          created_at: string
          doc_type: string
          file_size_bytes: number | null
          id: string
          language: string | null
          notes: string | null
          project_id: number
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          source_org: string | null
          sources: Json
          submitted_by: string | null
          submitted_by_ai: boolean
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          confidence_score?: number | null
          created_at?: string
          doc_type: string
          file_size_bytes?: number | null
          id?: string
          language?: string | null
          notes?: string | null
          project_id: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_org?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          confidence_score?: number | null
          created_at?: string
          doc_type?: string
          file_size_bytes?: number | null
          id?: string
          language?: string | null
          notes?: string | null
          project_id?: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_org?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_funding: {
        Row: {
          ai_tag: string | null
          amount_npr: number | null
          amount_usd: number | null
          approval_status: string
          committed_at: string | null
          confidence_score: number | null
          created_at: string
          currency: string | null
          disbursed_amount: number | null
          id: string
          lender_terms: string | null
          notes: string | null
          project_id: number
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          source_name: string
          source_type: string
          source_url: string | null
          sources: Json
          submitted_by: string | null
          submitted_by_ai: boolean
          updated_at: string
        }
        Insert: {
          ai_tag?: string | null
          amount_npr?: number | null
          amount_usd?: number | null
          approval_status?: string
          committed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          disbursed_amount?: number | null
          id?: string
          lender_terms?: string | null
          notes?: string | null
          project_id: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_name: string
          source_type: string
          source_url?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
        }
        Update: {
          ai_tag?: string | null
          amount_npr?: number | null
          amount_usd?: number | null
          approval_status?: string
          committed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          disbursed_amount?: number | null
          id?: string
          lender_terms?: string | null
          notes?: string | null
          project_id?: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_name?: string
          source_type?: string
          source_url?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_funding_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_impact: {
        Row: {
          ai_tag: string | null
          approval_status: string
          baseline_value: number | null
          confidence_score: number | null
          created_at: string
          id: string
          measured_at: string | null
          methodology: string | null
          metric_type: string
          metric_value: number | null
          notes: string | null
          project_id: number
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          source_url: string | null
          sources: Json
          submitted_by: string | null
          submitted_by_ai: boolean
          target_value: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          baseline_value?: number | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          measured_at?: string | null
          methodology?: string | null
          metric_type: string
          metric_value?: number | null
          notes?: string | null
          project_id: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          target_value?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          baseline_value?: number | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          measured_at?: string | null
          methodology?: string | null
          metric_type?: string
          metric_value?: number | null
          notes?: string | null
          project_id?: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          target_value?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_impact_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          ai_tag: string | null
          approval_status: string
          completed_date: string | null
          confidence_score: number | null
          created_at: string | null
          description: string | null
          due_date: string | null
          id: number
          milestone_date: string | null
          order_index: number | null
          project_id: number | null
          reviewed_by: string | null
          sources: Json
          stage: string | null
          status: string | null
          submitted_by_ai: boolean
          title: string
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          completed_date?: string | null
          confidence_score?: number | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: number
          milestone_date?: string | null
          order_index?: number | null
          project_id?: number | null
          reviewed_by?: string | null
          sources?: Json
          stage?: string | null
          status?: string | null
          submitted_by_ai?: boolean
          title: string
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          completed_date?: string | null
          confidence_score?: number | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: number
          milestone_date?: string | null
          order_index?: number | null
          project_id?: number | null
          reviewed_by?: string | null
          sources?: Json
          stage?: string | null
          status?: string | null
          submitted_by_ai?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_procurement: {
        Row: {
          ai_tag: string | null
          approval_status: string
          awardee_id: string | null
          awardee_name: string | null
          bid_open_at: string | null
          confidence_score: number | null
          contract_awarded_at: string | null
          contract_type: string | null
          contract_value_npr: number | null
          created_at: string
          id: string
          notes: string | null
          procurement_method: string | null
          project_id: number
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          source_url: string | null
          sources: Json
          status: string
          submitted_by: string | null
          submitted_by_ai: boolean
          tender_id_external: string | null
          tender_published_at: string | null
          tender_title: string
          tender_url: string | null
          updated_at: string
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          awardee_id?: string | null
          awardee_name?: string | null
          bid_open_at?: string | null
          confidence_score?: number | null
          contract_awarded_at?: string | null
          contract_type?: string | null
          contract_value_npr?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          procurement_method?: string | null
          project_id: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          sources?: Json
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          tender_id_external?: string | null
          tender_published_at?: string | null
          tender_title: string
          tender_url?: string | null
          updated_at?: string
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          awardee_id?: string | null
          awardee_name?: string | null
          bid_open_at?: string | null
          confidence_score?: number | null
          contract_awarded_at?: string | null
          contract_type?: string | null
          contract_value_npr?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          procurement_method?: string | null
          project_id?: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          sources?: Json
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          tender_id_external?: string | null
          tender_published_at?: string | null
          tender_title?: string
          tender_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_procurement_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_reviews: {
        Row: {
          action: string
          created_at: string
          id: string
          notes: string | null
          reviewer_id: string | null
          reviewer_role: string | null
          target_id: string
          target_table: string
          was_admin: boolean
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewer_id?: string | null
          reviewer_role?: string | null
          target_id: string
          target_table: string
          was_admin?: boolean
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewer_id?: string | null
          reviewer_role?: string | null
          target_id?: string
          target_table?: string
          was_admin?: boolean
        }
        Relationships: []
      }
      project_risks: {
        Row: {
          ai_tag: string | null
          approval_status: string
          category: string
          confidence_score: number | null
          created_at: string
          description: string | null
          id: string
          project_id: number
          published_at: string | null
          reported_at: string | null
          resolved_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          severity: string
          source_url: string | null
          sources: Json
          status: string
          submitted_by: string | null
          submitted_by_ai: boolean
          title: string
          updated_at: string
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          category: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          id?: string
          project_id: number
          published_at?: string | null
          reported_at?: string | null
          resolved_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          severity: string
          source_url?: string | null
          sources?: Json
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          category?: string
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          id?: string
          project_id?: number
          published_at?: string | null
          reported_at?: string | null
          resolved_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          severity?: string
          source_url?: string | null
          sources?: Json
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_risks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sources: {
        Row: {
          added_by: string | null
          ai_tag: string | null
          approval_status: string
          confidence_score: number | null
          created_at: string | null
          id: number
          project_id: number | null
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          source_type: string | null
          submitted_by_ai: boolean
          title: string
          url: string
          verified: boolean | null
          verified_by: string | null
        }
        Insert: {
          added_by?: string | null
          ai_tag?: string | null
          approval_status?: string
          confidence_score?: number | null
          created_at?: string | null
          id?: number
          project_id?: number | null
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_type?: string | null
          submitted_by_ai?: boolean
          title: string
          url: string
          verified?: boolean | null
          verified_by?: string | null
        }
        Update: {
          added_by?: string | null
          ai_tag?: string | null
          approval_status?: string
          confidence_score?: number | null
          created_at?: string | null
          id?: number
          project_id?: number | null
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          source_type?: string | null
          submitted_by_ai?: boolean
          title?: string
          url?: string
          verified?: boolean | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stakeholders: {
        Row: {
          ai_tag: string | null
          approval_status: string
          confidence_score: number | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          id: string
          notes: string | null
          org_name: string
          project_id: number
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          role: string
          source_url: string | null
          sources: Json
          submitted_by: string | null
          submitted_by_ai: boolean
          updated_at: string
          website: string | null
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          confidence_score?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          org_name: string
          project_id: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          role: string
          source_url?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
          website?: string | null
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          confidence_score?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          org_name?: string
          project_id?: number
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          role?: string
          source_url?: string | null
          sources?: Json
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_stakeholders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_updates: {
        Row: {
          ai_tag: string | null
          approval_status: string
          author_id: string | null
          confidence_score: number | null
          content: string | null
          created_at: string | null
          id: number
          image_url: string | null
          project_id: number | null
          published: boolean | null
          published_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          sources: Json
          submitted_by_ai: boolean
          title: string
          update_date: string | null
          update_text: string | null
          update_type: string | null
        }
        Insert: {
          ai_tag?: string | null
          approval_status?: string
          author_id?: string | null
          confidence_score?: number | null
          content?: string | null
          created_at?: string | null
          id?: number
          image_url?: string | null
          project_id?: number | null
          published?: boolean | null
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          sources?: Json
          submitted_by_ai?: boolean
          title: string
          update_date?: string | null
          update_text?: string | null
          update_type?: string | null
        }
        Update: {
          ai_tag?: string | null
          approval_status?: string
          author_id?: string | null
          confidence_score?: number | null
          content?: string | null
          created_at?: string | null
          id?: number
          image_url?: string | null
          project_id?: number | null
          published?: boolean | null
          published_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          sources?: Json
          submitted_by_ai?: boolean
          title?: string
          update_date?: string | null
          update_text?: string | null
          update_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_completion: string | null
          ai_tag: string | null
          approval_status: string | null
          budget: number | null
          budget_npr: number | null
          confidence_score: number | null
          contractor: string | null
          coordinates: string | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          detailed_description: string | null
          district: string | null
          districts: string[]
          esia_status: string | null
          estimated_beneficiaries: number | null
          expected_completion: string | null
          funding_agency: string | null
          funding_committed_npr: number | null
          funding_disbursed_npr: number | null
          id: number
          image_url: string | null
          image_urls: string[]
          implementing_agency: string | null
          is_approved: boolean | null
          is_delayed: boolean | null
          is_featured: boolean | null
          is_rastra_gaurav: boolean
          last_activity_at: string | null
          last_audit_at: string | null
          last_audit_finding: string | null
          last_comprehensive_analysis_at: string | null
          last_verified_date: string | null
          latitude: number | null
          location_text: string | null
          longitude: number | null
          municipalities: string[]
          municipality: string | null
          national_pride: boolean
          procurement_method: string | null
          progress_percent: number | null
          progress_stage: string | null
          project_type: string | null
          province: string | null
          provinces: string[]
          published_at: string | null
          reported_progress_as_of: string | null
          reported_progress_percent: number | null
          reported_progress_quote: string | null
          reported_progress_source_url: string | null
          review_notes: string | null
          review_status:
            | Database["public"]["Enums"]["review_status_type"]
            | null
          reviewed_at: string | null
          reviewed_by: string | null
          sector: string | null
          sector_id: number | null
          sectors: string[]
          short_description: string | null
          slug: string | null
          source_type: string | null
          source_url: string | null
          start_date: string | null
          status: string | null
          submitted_by: string | null
          submitted_by_ai: boolean
          submitted_by_email: string | null
          submitted_by_name: string | null
          title: string
          updated_at: string | null
          user_id: string | null
          verification_status: string | null
          ward: number | null
        }
        Insert: {
          actual_completion?: string | null
          ai_tag?: string | null
          approval_status?: string | null
          budget?: number | null
          budget_npr?: number | null
          confidence_score?: number | null
          contractor?: string | null
          coordinates?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          detailed_description?: string | null
          district?: string | null
          districts?: string[]
          esia_status?: string | null
          estimated_beneficiaries?: number | null
          expected_completion?: string | null
          funding_agency?: string | null
          funding_committed_npr?: number | null
          funding_disbursed_npr?: number | null
          id?: number
          image_url?: string | null
          image_urls?: string[]
          implementing_agency?: string | null
          is_approved?: boolean | null
          is_delayed?: boolean | null
          is_featured?: boolean | null
          is_rastra_gaurav?: boolean
          last_activity_at?: string | null
          last_audit_at?: string | null
          last_audit_finding?: string | null
          last_comprehensive_analysis_at?: string | null
          last_verified_date?: string | null
          latitude?: number | null
          location_text?: string | null
          longitude?: number | null
          municipalities?: string[]
          municipality?: string | null
          national_pride?: boolean
          procurement_method?: string | null
          progress_percent?: number | null
          progress_stage?: string | null
          project_type?: string | null
          province?: string | null
          provinces?: string[]
          published_at?: string | null
          reported_progress_as_of?: string | null
          reported_progress_percent?: number | null
          reported_progress_quote?: string | null
          reported_progress_source_url?: string | null
          review_notes?: string | null
          review_status?:
            | Database["public"]["Enums"]["review_status_type"]
            | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sector?: string | null
          sector_id?: number | null
          sectors?: string[]
          short_description?: string | null
          slug?: string | null
          source_type?: string | null
          source_url?: string | null
          start_date?: string | null
          status?: string | null
          submitted_by?: string | null
          submitted_by_ai?: boolean
          submitted_by_email?: string | null
          submitted_by_name?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
          verification_status?: string | null
          ward?: number | null
        }
        Update: {
          actual_completion?: string | null
          ai_tag?: string | null
          approval_status?: string | null
          budget?: number | null
          budget_npr?: number | null
          confidence_score?: number | null
          contractor?: string | null
          coordinates?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          detailed_description?: string | null
          district?: string | null
          districts?: string[]
          esia_status?: string | null
          estimated_beneficiaries?: number | null
          expected_completion?: string | null
          funding_agency?: string | null
          funding_committed_npr?: number | null
          funding_disbursed_npr?: number | null
          id?: number
          image_url?: string | null
          image_urls?: string[]
          implementing_agency?: string | null
          is_approved?: boolean | null
          is_delayed?: boolean | null
          is_featured?: boolean | null
          is_rastra_gaurav?: boolean
          last_activity_at?: string | null
          last_audit_at?: string | null
          last_audit_finding?: string | null
          last_comprehensive_analysis_at?: string | null
          last_verified_date?: string | null
          latitude?: number | null
          location_text?: string | null
          longitude?: number | null
          municipalities?: string[]
          municipality?: string | null
          national_pride?: boolean
          procurement_method?: string | null
          progress_percent?: number | null
          progress_stage?: string | null
          project_type?: string | null
          province?: string | null
          provinces?: string[]
          published_at?: string | null
          reported_progress_as_of?: string | null
          reported_progress_percent?: number | null
          reported_progress_quote?: string | null
          reported_progress_source_url?: string | null
          review_notes?: string | null
          review_status?:
            | Database["public"]["Enums"]["review_status_type"]
            | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sector?: string | null
          sector_id?: number | null
          sectors?: string[]
          short_description?: string | null
          slug?: string | null
          source_type?: string | null
          source_url?: string | null
          start_date?: string | null
          status?: string | null
          submitted_by?: string | null
          submitted_by_ai?: boolean
          submitted_by_email?: string | null
          submitted_by_name?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
          verification_status?: string | null
          ward?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      sectors: {
        Row: {
          icon: string | null
          id: number
          name: string
        }
        Insert: {
          icon?: string | null
          id?: number
          name: string
        }
        Update: {
          icon?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      sherlock_filters: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          label: string
          last_inserted: number | null
          last_run_at: string | null
          max_results: number
          region: string | null
          topic: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          last_inserted?: number | null
          last_run_at?: string | null
          max_results?: number
          region?: string | null
          topic?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          last_inserted?: number | null
          last_run_at?: string | null
          max_results?: number
          region?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      sherlock_jobs: {
        Row: {
          enqueued_at: string
          enqueued_by: string | null
          error_text: string | null
          finished_at: string | null
          id: string
          inserted: number | null
          kind: string
          last_diagnostic: Json | null
          params: Json
          priority: number
          skipped: number | null
          started_at: string | null
          status: string
          sweep_id: string | null
        }
        Insert: {
          enqueued_at?: string
          enqueued_by?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          inserted?: number | null
          kind: string
          last_diagnostic?: Json | null
          params?: Json
          priority?: number
          skipped?: number | null
          started_at?: string | null
          status?: string
          sweep_id?: string | null
        }
        Update: {
          enqueued_at?: string
          enqueued_by?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          inserted?: number | null
          kind?: string
          last_diagnostic?: Json | null
          params?: Json
          priority?: number
          skipped?: number | null
          started_at?: string | null
          status?: string
          sweep_id?: string | null
        }
        Relationships: []
      }
      sherlock_live_state: {
        Row: {
          enqueued_count: number
          golive_heartbeat_at: string | null
          golive_session_id: string | null
          golive_started_at: string | null
          id: number
          include_districts: boolean
          is_live: boolean
          last_advanced_at: string | null
          last_advanced_by: string | null
          last_district: string | null
          last_province: string | null
          last_sector: string | null
          last_stopped_reason: string | null
          livecheck_heartbeat_at: string | null
          livecheck_session_id: string | null
          livecheck_started_at: string | null
          local_session_id: string | null
          local_started_at: string | null
          national_pride: boolean
          per_query_max: number
          provinces: string[]
          sectors: string[]
          started_at: string | null
          started_by: string | null
          stopped_at: string | null
          updated_at: string
        }
        Insert: {
          enqueued_count?: number
          golive_heartbeat_at?: string | null
          golive_session_id?: string | null
          golive_started_at?: string | null
          id?: number
          include_districts?: boolean
          is_live?: boolean
          last_advanced_at?: string | null
          last_advanced_by?: string | null
          last_district?: string | null
          last_province?: string | null
          last_sector?: string | null
          last_stopped_reason?: string | null
          livecheck_heartbeat_at?: string | null
          livecheck_session_id?: string | null
          livecheck_started_at?: string | null
          local_session_id?: string | null
          local_started_at?: string | null
          national_pride?: boolean
          per_query_max?: number
          provinces?: string[]
          sectors?: string[]
          started_at?: string | null
          started_by?: string | null
          stopped_at?: string | null
          updated_at?: string
        }
        Update: {
          enqueued_count?: number
          golive_heartbeat_at?: string | null
          golive_session_id?: string | null
          golive_started_at?: string | null
          id?: number
          include_districts?: boolean
          is_live?: boolean
          last_advanced_at?: string | null
          last_advanced_by?: string | null
          last_district?: string | null
          last_province?: string | null
          last_sector?: string | null
          last_stopped_reason?: string | null
          livecheck_heartbeat_at?: string | null
          livecheck_session_id?: string | null
          livecheck_started_at?: string | null
          local_session_id?: string | null
          local_started_at?: string | null
          national_pride?: boolean
          per_query_max?: number
          provinces?: string[]
          sectors?: string[]
          started_at?: string | null
          started_by?: string | null
          stopped_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sherlock_secrets: {
        Row: {
          id: number
          key: string
          updated_at: string
          url: string
        }
        Insert: {
          id?: number
          key: string
          updated_at?: string
          url: string
        }
        Update: {
          id?: number
          key?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      sherlock_sweeps: {
        Row: {
          cadence: string
          created_at: string
          created_by: string | null
          cron_job_id: number | null
          enabled: boolean
          id: string
          include_districts: boolean
          label: string
          last_run_at: string | null
          last_run_note: string | null
          national_pride: boolean
          per_query_max: number
          provinces: string[]
          sectors: string[]
        }
        Insert: {
          cadence: string
          created_at?: string
          created_by?: string | null
          cron_job_id?: number | null
          enabled?: boolean
          id?: string
          include_districts?: boolean
          label: string
          last_run_at?: string | null
          last_run_note?: string | null
          national_pride?: boolean
          per_query_max?: number
          provinces?: string[]
          sectors?: string[]
        }
        Update: {
          cadence?: string
          created_at?: string
          created_by?: string | null
          cron_job_id?: number | null
          enabled?: boolean
          id?: string
          include_districts?: boolean
          label?: string
          last_run_at?: string | null
          last_run_note?: string | null
          national_pride?: boolean
          per_query_max?: number
          provinces?: string[]
          sectors?: string[]
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          auto_analysis_on_approval_enabled: boolean
          auto_approve_enabled: boolean
          auto_approve_threshold: number
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_analysis_on_approval_enabled?: boolean
          auto_approve_enabled?: boolean
          auto_approve_threshold?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_analysis_on_approval_enabled?: boolean
          auto_approve_enabled?: boolean
          auto_approve_threshold?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: number
          role: Database["public"]["Enums"]["app_role"] | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          role?: Database["public"]["Enums"]["app_role"] | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          role?: Database["public"]["Enums"]["app_role"] | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_count: { Args: never; Returns: number }
      analysis_drain_once: { Args: never; Returns: Json }
      analysis_patch_bucket_status: {
        Args: { p_bucket: string; p_patch: Json; p_run_id: string }
        Returns: undefined
      }
      analysis_reap_stuck_jobs: {
        Args: { p_max_minutes?: number }
        Returns: Json
      }
      bulk_approve_pending: {
        Args: { p_project_id?: number; p_threshold?: number }
        Returns: Json
      }
      compute_daily_project_metrics: {
        Args: { p_day?: string }
        Returns: {
          analysis_runs: number
          approvals: number
          computed_at: string
          day: string
          new_detail_rows: number
          new_projects: number
          new_updates: number
          rejections: number
          sherlock_errors: number
          sherlock_inserted: number
          sherlock_jobs_run: number
        }
        SetofOptions: {
          from: "*"
          to: "daily_project_metrics"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_coadmin: { Args: { _user_id: string }; Returns: boolean }
      is_moderator: { Args: { _user_id: string }; Returns: boolean }
      project_moderation_summary: {
        Args: { p_threshold?: number }
        Returns: {
          buckets: Json
          confidence_score: number
          project_id: number
          slug: string
          title: string
          total_approved: number
          total_pending: number
          total_pending_eligible: number
        }[]
      }
      rebuild_daily_project_metrics: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      run_daily_briefs_now: { Args: never; Returns: Json }
      sherlock_drain_queue_once: { Args: never; Returns: Json }
      sherlock_enqueue_sweep: { Args: { p_sweep_id: string }; Returns: Json }
      sherlock_live_feed_tick: { Args: never; Returns: Json }
      sherlock_reap_stuck_jobs: {
        Args: { p_max_minutes?: number }
        Returns: Json
      }
      sherlock_run_all_active: { Args: never; Returns: Json }
      sherlock_run_sweep_now: { Args: { p_sweep_id: string }; Returns: Json }
      sweep_auto_approve_now: { Args: never; Returns: Json }
      user_contribution_count: { Args: { _user_id: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "reviewer" | "contributor" | "coadmin"
      approval_status_enum:
        | "pending"
        | "approved"
        | "rejected"
        | "changes_requested"
      milestone_status: "pending" | "in_progress" | "completed" | "delayed"
      project_status:
        | "proposed"
        | "approved"
        | "in_progress"
        | "delayed"
        | "completed"
        | "cancelled"
      review_status_type: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "reviewer", "contributor", "coadmin"],
      approval_status_enum: [
        "pending",
        "approved",
        "rejected",
        "changes_requested",
      ],
      milestone_status: ["pending", "in_progress", "completed", "delayed"],
      project_status: [
        "proposed",
        "approved",
        "in_progress",
        "delayed",
        "completed",
        "cancelled",
      ],
      review_status_type: ["pending", "approved", "rejected"],
    },
  },
} as const
npx : <claude-code-hint v="1" type="plugin" value="supabase@claude-plugins-official" />
At line:13 char:1
+ npx supabase gen types typescript --project-id vlioybqqswbohdhpnjym 2 ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (<claude-code-hi...ns-official" />:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
