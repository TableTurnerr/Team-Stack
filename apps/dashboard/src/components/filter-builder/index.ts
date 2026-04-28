export type {
  FilterCondition,
  FilterFieldDef,
  FilterLogic,
  FilterRelData,
  FieldType,
  FieldGroup,
  OperatorKey,
  RelOption,
} from './types';

export {
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  operatorsForType,
  defaultOperatorForType,
  isValuelessOp,
  isMultiValueOp,
  isRangeOp,
  isNumberValueOp,
} from './operators';

export {
  buildClause,
  buildDirectFilter,
  escapeFilterString,
  isRelFilterField,
  relFieldParts,
  isJsonArrayRelField,
} from './build-filter';

export { fetchIdsForRelCondition } from './build-rel-filter';

export {
  runFilterSearch,
  fetchAllMatchingIds,
  readyConditions,
} from './filter-search';
export type { FilterSearchInput, FilterSearchResult } from './filter-search';

export { FilterBuilder, makeCondition, activeConditionCount } from './FilterBuilder';
export type { FilterBuilderProps } from './FilterBuilder';

export { FilterChips } from './FilterChips';
export { MultiValuePicker } from './MultiValuePicker';

export {
  useFilterSelection,
  shouldConfirmSelectAll,
  SELECT_ALL_CONFIRM_THRESHOLD,
} from './use-filter-selection';
export type { SelectionMode, UseFilterSelectionResult, AllFilteredState } from './use-filter-selection';
