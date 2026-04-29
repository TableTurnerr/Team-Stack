import type { FieldType, OperatorKey } from './types';

export const OPERATORS_BY_TYPE: Record<FieldType, readonly OperatorKey[]> = {
  text:        ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  number:      ['equals', 'at_least', 'at_most', 'between'],
  date:        ['before', 'after', 'on_or_before', 'on_or_after', 'in_last_days', 'more_than_days_ago', 'between', 'is_empty', 'is_not_empty'],
  boolean:     ['is_true', 'is_false'],
  enum:        ['is', 'is_not', 'is_any_of', 'is_none_of'],
  multi_enum:  ['has_any_of', 'has_none_of', 'has_all_of', 'is_empty', 'is_not_empty'],
  json_array:  ['has_any_of', 'has_none_of', 'has_all_of', 'is_empty', 'is_not_empty'],
  rel_id:      ['is_any_of', 'is_none_of', 'is_empty', 'is_not_empty'],
  rel_select:  ['has_any_of', 'has_none_of'],
  rel_text:    ['contains', 'not_contains'],
  rel_boolean: ['is_true', 'is_false'],
  rel_number:  ['equals', 'at_least', 'at_most', 'between'],
  rel_date:    ['before', 'after', 'on_or_before', 'on_or_after', 'in_last_days', 'more_than_days_ago', 'between'],
};

export const OPERATOR_LABELS: Record<OperatorKey, string> = {
  is: 'is',
  is_not: 'is not',
  is_any_of: 'is any of',
  is_none_of: 'is none of',
  has_any_of: 'has any of',
  has_none_of: 'has none of',
  has_all_of: 'has all of',
  contains: 'contains',
  not_contains: "doesn't contain",
  equals: 'equals',
  not_equals: 'not equals',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  before: 'before',
  after: 'after',
  on_or_before: 'on or before',
  on_or_after: 'on or after',
  in_last_days: 'in the last N days',
  more_than_days_ago: 'more than N days ago',
  between: 'between',
  at_least: 'at least',
  at_most: 'at most',
  is_true: 'is true',
  is_false: 'is false',
};

const VALUELESS_OPS = new Set<OperatorKey>(['is_empty', 'is_not_empty', 'is_true', 'is_false']);
const MULTI_VALUE_OPS = new Set<OperatorKey>(['is_any_of', 'is_none_of', 'has_any_of', 'has_none_of', 'has_all_of']);
const RANGE_OPS = new Set<OperatorKey>(['between']);
const NUMBER_VALUE_OPS = new Set<OperatorKey>(['in_last_days', 'more_than_days_ago']);

export function isValuelessOp(op: OperatorKey): boolean {
  return VALUELESS_OPS.has(op);
}

export function isMultiValueOp(op: OperatorKey): boolean {
  return MULTI_VALUE_OPS.has(op);
}

export function isRangeOp(op: OperatorKey): boolean {
  return RANGE_OPS.has(op);
}

export function isNumberValueOp(op: OperatorKey): boolean {
  return NUMBER_VALUE_OPS.has(op);
}

export function operatorsForType(type: FieldType): readonly OperatorKey[] {
  return OPERATORS_BY_TYPE[type] ?? OPERATORS_BY_TYPE.text;
}

export function defaultOperatorForType(type: FieldType): OperatorKey {
  return operatorsForType(type)[0];
}
