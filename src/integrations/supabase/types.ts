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
      global_briefs: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          headline: string
          id: string
          scope: string
          sources: Json | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          headline: string
          id?: string
          scope?: string
          sources?: Json | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          headline?: string
          id?: string
          scope?: string
          sources?: Json | null
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
      project_compliance: {
        Row: {
          approval_status: string
          authority: string | null
          created_at: string
          decided_at: string | null
          document_url: string | null
          finding: string | null
          id: string
          item_type: string
          notes: string | null
          project_id: number
          review_notes: string | null
          reviewed_by: string | null
          source_url: string | null
          status: string
          submitted_by: string | null
          submitted_by_ai: boolean
          updated_at: string
        }
        Insert: {
          approval_status?: string
          authority?: string | null
          created_at?: string
          decided_at?: string | null
          document_url?: string | null
          finding?: string | null
          id?: string
          item_type: string
          notes?: string | null
          project_id: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
        }
        Update: {
          approval_status?: string
          authority?: string | null
          created_at?: string
          decided_at?: string | null
          document_url?: string | null
          finding?: string | null
          id?: string
          item_type?: string
          notes?: string | null
          project_id?: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
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
          approval_status: string
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
          submitted_by: string | null
          submitted_by_ai: boolean
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          approval_status?: string
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
          submitted_by?: string | null
          submitted_by_ai?: boolean
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          approval_status?: string
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
          amount_npr: number | null
          amount_usd: number | null
          approval_status: string
          committed_at: string | null
          created_at: string
          currency: string | null
          disbursed_amount: number | null
          id: string
          lender_terms: string | null
          notes: string | null
          project_id: number
          review_notes: string | null
          reviewed_by: string | null
          source_name: string
          source_type: string
          source_url: string | null
          submitted_by: string | null
          submitted_by_ai: boolean
          updated_at: string
        }
        Insert: {
          amount_npr?: number | null
          amount_usd?: number | null
          approval_status?: string
          committed_at?: string | null
          created_at?: string
          currency?: string | null
          disbursed_amount?: number | null
          id?: string
          lender_terms?: string | null
          notes?: string | null
          project_id: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_name: string
          source_type: string
          source_url?: string | null
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
        }
        Update: {
          amount_npr?: number | null
          amount_usd?: number | null
          approval_status?: string
          committed_at?: string | null
          created_at?: string
          currency?: string | null
          disbursed_amount?: number | null
          id?: string
          lender_terms?: string | null
          notes?: string | null
          project_id?: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_name?: string
          source_type?: string
          source_url?: string | null
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
          approval_status: string
          baseline_value: number | null
          created_at: string
          id: string
          measured_at: string | null
          methodology: string | null
          metric_type: string
          metric_value: number | null
          notes: string | null
          project_id: number
          review_notes: string | null
          reviewed_by: string | null
          source_url: string | null
          submitted_by: string | null
          submitted_by_ai: boolean
          target_value: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string
          baseline_value?: number | null
          created_at?: string
          id?: string
          measured_at?: string | null
          methodology?: string | null
          metric_type: string
          metric_value?: number | null
          notes?: string | null
          project_id: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          submitted_by?: string | null
          submitted_by_ai?: boolean
          target_value?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string
          baseline_value?: number | null
          created_at?: string
          id?: string
          measured_at?: string | null
          methodology?: string | null
          metric_type?: string
          metric_value?: number | null
          notes?: string | null
          project_id?: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
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
          completed_date: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          id: number
          milestone_date: string | null
          order_index: number | null
          project_id: number | null
          stage: string | null
          status: string | null
          title: string
        }
        Insert: {
          completed_date?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: number
          milestone_date?: string | null
          order_index?: number | null
          project_id?: number | null
          stage?: string | null
          status?: string | null
          title: string
        }
        Update: {
          completed_date?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: number
          milestone_date?: string | null
          order_index?: number | null
          project_id?: number | null
          stage?: string | null
          status?: string | null
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
          approval_status: string
          awardee_id: string | null
          awardee_name: string | null
          bid_open_at: string | null
          contract_awarded_at: string | null
          contract_type: string | null
          contract_value_npr: number | null
          created_at: string
          id: string
          notes: string | null
          procurement_method: string | null
          project_id: number
          review_notes: string | null
          reviewed_by: string | null
          source_url: string | null
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
          approval_status?: string
          awardee_id?: string | null
          awardee_name?: string | null
          bid_open_at?: string | null
          contract_awarded_at?: string | null
          contract_type?: string | null
          contract_value_npr?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          procurement_method?: string | null
          project_id: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
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
          approval_status?: string
          awardee_id?: string | null
          awardee_name?: string | null
          bid_open_at?: string | null
          contract_awarded_at?: string | null
          contract_type?: string | null
          contract_value_npr?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          procurement_method?: string | null
          project_id?: number
          review_notes?: string | null
          reviewed_by?: string | null
          source_url?: string | null
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
      project_risks: {
        Row: {
          approval_status: string
          category: string
          created_at: string
          description: string | null
          id: string
          project_id: number
          reported_at: string | null
          resolved_at: string | null
          review_notes: string | null
          reviewed_by: string | null
          severity: string
          source_url: string | null
          status: string
          submitted_by: string | null
          submitted_by_ai: boolean
          title: string
          updated_at: string
        }
        Insert: {
          approval_status?: string
          category: string
          created_at?: string
          description?: string | null
          id?: string
          project_id: number
          reported_at?: string | null
          resolved_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          severity: string
          source_url?: string | null
          status?: string
          submitted_by?: string | null
          submitted_by_ai?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          approval_status?: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          project_id?: number
          reported_at?: string | null
          resolved_at?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          severity?: string
          source_url?: string | null
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
          approval_status: string
          created_at: string | null
          id: number
          project_id: number | null
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
          approval_status?: string
          created_at?: string | null
          id?: number
          project_id?: number | null
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
          approval_status?: string
          created_at?: string | null
          id?: number
          project_id?: number | null
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
          approval_status: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          id: string
          notes: string | null
          org_name: string
          project_id: number
          review_notes: string | null
          reviewed_by: string | null
          role: string
          source_url: string | null
          submitted_by: string | null
          submitted_by_ai: boolean
          updated_at: string
          website: string | null
        }
        Insert: {
          approval_status?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          org_name: string
          project_id: number
          review_notes?: string | null
          reviewed_by?: string | null
          role: string
          source_url?: string | null
          submitted_by?: string | null
          submitted_by_ai?: boolean
          updated_at?: string
          website?: string | null
        }
        Update: {
          approval_status?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          org_name?: string
          project_id?: number
          review_notes?: string | null
          reviewed_by?: string | null
          role?: string
          source_url?: string | null
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
          approval_status: string
          author_id: string | null
          content: string | null
          created_at: string | null
          id: number
          image_url: string | null
          project_id: number | null
          published: boolean | null
          review_notes: string | null
          reviewed_by: string | null
          submitted_by_ai: boolean
          title: string
          update_date: string | null
          update_text: string | null
          update_type: string | null
        }
        Insert: {
          approval_status?: string
          author_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: number
          image_url?: string | null
          project_id?: number | null
          published?: boolean | null
          review_notes?: string | null
          reviewed_by?: string | null
          submitted_by_ai?: boolean
          title: string
          update_date?: string | null
          update_text?: string | null
          update_type?: string | null
        }
        Update: {
          approval_status?: string
          author_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: number
          image_url?: string | null
          project_id?: number | null
          published?: boolean | null
          review_notes?: string | null
          reviewed_by?: string | null
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
          approval_status: string | null
          budget: number | null
          budget_npr: number | null
          contractor: string | null
          coordinates: string | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          detailed_description: string | null
          district: string | null
          esia_status: string | null
          estimated_beneficiaries: number | null
          expected_completion: string | null
          funding_agency: string | null
          funding_committed_npr: number | null
          funding_disbursed_npr: number | null
          id: number
          image_url: string | null
          implementing_agency: string | null
          is_approved: boolean | null
          is_delayed: boolean | null
          is_featured: boolean | null
          last_audit_at: string | null
          last_audit_finding: string | null
          last_comprehensive_analysis_at: string | null
          last_verified_date: string | null
          latitude: number | null
          location_text: string | null
          longitude: number | null
          municipality: string | null
          procurement_method: string | null
          progress_percent: number | null
          progress_stage: string | null
          project_type: string | null
          province: string | null
          review_notes: string | null
          review_status:
            | Database["public"]["Enums"]["review_status_type"]
            | null
          reviewed_at: string | null
          reviewed_by: string | null
          sector: string | null
          sector_id: number | null
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
          approval_status?: string | null
          budget?: number | null
          budget_npr?: number | null
          contractor?: string | null
          coordinates?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          detailed_description?: string | null
          district?: string | null
          esia_status?: string | null
          estimated_beneficiaries?: number | null
          expected_completion?: string | null
          funding_agency?: string | null
          funding_committed_npr?: number | null
          funding_disbursed_npr?: number | null
          id?: number
          image_url?: string | null
          implementing_agency?: string | null
          is_approved?: boolean | null
          is_delayed?: boolean | null
          is_featured?: boolean | null
          last_audit_at?: string | null
          last_audit_finding?: string | null
          last_comprehensive_analysis_at?: string | null
          last_verified_date?: string | null
          latitude?: number | null
          location_text?: string | null
          longitude?: number | null
          municipality?: string | null
          procurement_method?: string | null
          progress_percent?: number | null
          progress_stage?: string | null
          project_type?: string | null
          province?: string | null
          review_notes?: string | null
          review_status?:
            | Database["public"]["Enums"]["review_status_type"]
            | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sector?: string | null
          sector_id?: number | null
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
          approval_status?: string | null
          budget?: number | null
          budget_npr?: number | null
          contractor?: string | null
          coordinates?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          detailed_description?: string | null
          district?: string | null
          esia_status?: string | null
          estimated_beneficiaries?: number | null
          expected_completion?: string | null
          funding_agency?: string | null
          funding_committed_npr?: number | null
          funding_disbursed_npr?: number | null
          id?: number
          image_url?: string | null
          implementing_agency?: string | null
          is_approved?: boolean | null
          is_delayed?: boolean | null
          is_featured?: boolean | null
          last_audit_at?: string | null
          last_audit_finding?: string | null
          last_comprehensive_analysis_at?: string | null
          last_verified_date?: string | null
          latitude?: number | null
          location_text?: string | null
          longitude?: number | null
          municipality?: string | null
          procurement_method?: string | null
          progress_percent?: number | null
          progress_stage?: string | null
          project_type?: string | null
          province?: string | null
          review_notes?: string | null
          review_status?:
            | Database["public"]["Enums"]["review_status_type"]
            | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sector?: string | null
          sector_id?: number | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_coadmin: { Args: { _user_id: string }; Returns: boolean }
      is_moderator: { Args: { _user_id: string }; Returns: boolean }
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
<claude-code-hint v="1" type="plugin" value="supabase@claude-plugins-official" />