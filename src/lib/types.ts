export type SplitMethod = 'equal' | 'percentage' | 'manual' | 'weighted';

export interface Profile { id: string; display_name: string }
export interface Group { id: string; name: string; created_by: string; created_at: string }
export interface MemberRow { id: string; group_id: string; user_id: string; role: 'owner' | 'member'; joined_at: string }
export interface MemberView { user_id: string; name: string; role: 'owner' | 'member' }

export interface Split {
  id: string; expense_id: string; member_id: string;
  share_amount_paise: number; percentage: number | null; weight: number | null;
}
export interface Expense {
  id: string; group_id: string; description: string; total_amount_paise: number;
  payer_id: string; created_by: string; expense_date: string; split_method: SplitMethod;
  category: string | null; created_at: string; updated_at: string; deleted_at: string | null;
  expense_splits: Split[];
}
export interface Settlement {
  id: string; group_id: string; payer_id: string; receiver_id: string; amount_paise: number;
  settlement_date: string; note: string | null; created_by: string; status: 'recorded' | 'voided';
  voided_at: string | null; created_at: string; updated_at: string;
}
export interface Balance {
  user_id: string; paid_paise: number; share_paise: number;
  settled_out_paise: number; settled_in_paise: number; net_paise: number;
}
export interface AuditLog {
  id: string; group_id: string; actor_id: string; entity_type: string; entity_id: string;
  action: string; previous_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
  created_at: string;
}
