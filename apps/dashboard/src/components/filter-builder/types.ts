export type FilterLogic = 'AND' | 'OR';

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'enum'
  | 'multi_enum'
  | 'json_array'
  | 'rel_id'
  | 'rel_select'
  | 'rel_text'
  | 'rel_boolean'
  | 'rel_number'
  | 'rel_date';

export type OperatorKey =
  | 'is'
  | 'is_not'
  | 'is_any_of'
  | 'is_none_of'
  | 'has_any_of'
  | 'has_none_of'
  | 'has_all_of'
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'in_last_days'
  | 'more_than_days_ago'
  | 'between'
  | 'at_least'
  | 'at_most'
  | 'is_true'
  | 'is_false';

export type FieldGroup = 'Company' | 'Assignment' | 'Calls' | 'Notes' | 'Other';

export interface RelOption {
  id: string;
  label: string;
}

export type FilterScope = 'last' | 'any';

export interface ScopeVariant {
  key: string;
  type: FieldType;
  options?: readonly string[];
  relCollection?: 'users' | 'lead_categories';
  realField?: string;
}

export interface FilterFieldDef {
  key: string;
  label: string;
  type: FieldType;
  group?: FieldGroup;
  options?: readonly string[];
  relCollection?: 'users' | 'lead_categories';
  realField?: string;
  /** When set, this field is scopable: condition stores `scope` and resolves to one of these variants. */
  scopes?: { last: ScopeVariant; any: ScopeVariant };
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: OperatorKey;
  values: string[];
  /** Only meaningful when the field is scopable. */
  scope?: FilterScope;
}

export interface FilterRelData {
  users?: readonly RelOption[];
  lead_categories?: readonly RelOption[];
}
