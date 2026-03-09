import type { Company } from './types';

/**
 * Describes an available personalization variable for the email editor.
 */
export interface PersonalizationVariable {
  name: string;
  key: string;
  description: string;
}

/**
 * Returns the list of CRM variables available for email personalization.
 */
export function getAvailableVariables(): PersonalizationVariable[] {
  return [
    { name: 'Company Name', key: 'Company_Name', description: 'The company\'s name' },
    { name: 'Owner Name', key: 'Owner_Name', description: 'The company owner or contact name' },
    { name: 'Email', key: 'Email', description: 'The company\'s email address' },
    { name: 'Location', key: 'Location', description: 'The company\'s location' },
    { name: 'Status', key: 'Status', description: 'Current CRM status (e.g. Cold No Reply, Warm)' },
    { name: 'Source', key: 'Source', description: 'How the company was sourced' },
    { name: 'Instagram', key: 'Instagram', description: 'Instagram handle' },
    { name: 'Google Rating', key: 'Google_Rating', description: 'Google Maps rating' },
    { name: 'Google Reviews', key: 'Google_Reviews', description: 'Google Maps review count' },
  ];
}

const VARIABLE_MAP: Record<string, (c: Company) => string | undefined> = {
  Company_Name: (c) => c.company_name,
  Owner_Name: (c) => c.owner_name,
  Email: (c) => c.email,
  Location: (c) => c.company_location,
  Status: (c) => Array.isArray(c.status) ? c.status.join(', ') : undefined,
  Source: (c) => c.source,
  Instagram: (c) => c.instagram_handle,
  Google_Rating: (c) => c.google_rating,
  Google_Reviews: (c) => c.google_reviews_count,
};

/**
 * Resolves `{{Variable_Name}}` and `{{Variable_Name|fallback}}` placeholders
 * in a template string using the given company record.
 */
export function resolveVariables(template: string, company: Company): string {
  return template.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (_match, key: string, fallback?: string) => {
    const resolver = VARIABLE_MAP[key];
    const value = resolver ? resolver(company) : undefined;
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
    return fallback ?? '';
  });
}
