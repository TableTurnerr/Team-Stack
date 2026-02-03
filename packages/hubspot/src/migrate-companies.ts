/**
 * Company Migration Script (Scaffold)
 * 
 * Starting point for migrating companies from CSV or PocketBase to HubSpot.
 * 
 * Run with: pnpm tsx packages/hubspot/src/migrate-companies.ts
 */

import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/companies";
import * as dotenv from "dotenv";
import * as fs from "fs-extra";
import csvParser from "csv-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the hubspot package directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ============================================
// HUBSPOT CLIENT SETUP
// ============================================

const hubspotClient = new Client({
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

// ============================================
// TYPE DEFINITIONS
// ============================================

interface CompanyInput {
    // Standard HubSpot properties
    name: string;
    phone?: string;
    website?: string;
    city?: string;
    state?: string;
    industry?: string;

    // Custom properties (from HUBSPOT_CONTEXT.md)
    restaurant_status?:
    | "cold_no_reply"
    | "replied"
    | "warm"
    | "booked"
    | "paid"
    | "client"
    | "excluded";
    owner_name?: string;
    instagram_handle?: string;
    google_maps_link?: string;
    google_rating?: number;
    google_review_count?: number;
    pain_points?: string;
    lead_source?:
    | "gmaps_scraper"
    | "manual"
    | "instagram"
    | "cold_calling"
    | "referral";
    current_ods?: string;
    has_seo?: boolean;
    offers_direct_delivery?: boolean;
    first_contacted_date?: string; // ISO date string
    last_contacted_date?: string;
    contact_source?: string;
    owner_email?: string;
}

// ============================================
// HUBSPOT API FUNCTIONS
// ============================================

/**
 * Create a company in HubSpot with custom properties
 */
async function createCompany(company: CompanyInput): Promise<string> {
    // Build properties object, filtering out undefined values
    const properties: Record<string, string | number | boolean> = {
        name: company.name,
        industry: company.industry || "Restaurants",
    };

    // Add optional standard properties
    if (company.phone) properties.phone = company.phone;
    if (company.website) properties.website = company.website;
    if (company.city) properties.city = company.city;
    if (company.state) properties.state = company.state;

    // Add custom properties
    if (company.restaurant_status) properties.restaurant_status = company.restaurant_status;
    if (company.owner_name) properties.owner_name = company.owner_name;
    if (company.instagram_handle) properties.instagram_handle = company.instagram_handle;
    if (company.google_maps_link) properties.google_maps_link = company.google_maps_link;
    if (company.google_rating !== undefined) properties.google_rating = company.google_rating;
    if (company.google_review_count !== undefined) properties.google_review_count = company.google_review_count;
    if (company.pain_points) properties.pain_points = company.pain_points;
    if (company.lead_source) properties.lead_source = company.lead_source;
    if (company.current_ods) properties.current_ods = company.current_ods;
    if (company.has_seo !== undefined) properties.has_seo = company.has_seo;
    if (company.offers_direct_delivery !== undefined) properties.offers_direct_delivery = company.offers_direct_delivery;
    if (company.first_contacted_date) properties.first_contacted_date = company.first_contacted_date;
    if (company.last_contacted_date) properties.last_contacted_date = company.last_contacted_date;
    if (company.contact_source) properties.contact_source = company.contact_source;
    if (company.owner_email) properties.owner_email = company.owner_email;

    const response = await hubspotClient.crm.companies.basicApi.create({
        properties: properties as Record<string, string>,
        associations: [],
    });

    return response.id;
}

/**
 * Search for existing company by name to avoid duplicates
 */
async function findCompanyByName(name: string): Promise<string | null> {
    try {
        const response = await hubspotClient.crm.companies.searchApi.doSearch({
            filterGroups: [
                {
                    filters: [
                        {
                            propertyName: "name",
                            operator: FilterOperatorEnum.Eq,
                            value: name,
                        },
                    ],
                },
            ],
            properties: ["name"],
            limit: 1,
        });

        return response.results.length > 0 ? response.results[0].id : null;
    } catch {
        return null;
    }
}

// ============================================
// CSV IMPORT FUNCTIONS
// ============================================

/**
 * Read companies from a CSV file
 */
async function readCompaniesFromCSV(filePath: string): Promise<CompanyInput[]> {
    const companies: CompanyInput[] = [];

    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on("data", (row: Record<string, string>) => {
                // Map CSV columns to CompanyInput
                // Adjust these mappings based on your actual CSV structure
                const company: CompanyInput = {
                    name: row.name || row.Restaurant || row.company_name || "",
                    phone: row.phone || row["Phone No"] || "",
                    website: row.website || "",
                    city: row.city || row.Location || "",
                    state: row.state || "",
                    owner_name: row.owner_name || row["Owner/Receptionist"] || "",
                    instagram_handle: row.instagram_handle || "",
                    pain_points: row.pain_points || row["Pain Points / Pre Call Notes"] || "",
                    lead_source: mapLeadSource(row.Source || row.lead_source),
                    current_ods: row.current_ods || "",
                    restaurant_status: mapStatus(row.Status || row.restaurant_status),
                };

                if (company.name) {
                    companies.push(company);
                }
            })
            .on("end", () => resolve(companies))
            .on("error", reject);
    });
}

/**
 * Map source string to lead_source enum value
 */
function mapLeadSource(source: string | undefined): CompanyInput["lead_source"] | undefined {
    if (!source) return undefined;
    const normalized = source.toLowerCase();
    if (normalized.includes("instagram")) return "instagram";
    if (normalized.includes("gmap") || normalized.includes("google")) return "gmaps_scraper";
    if (normalized.includes("referral")) return "referral";
    if (normalized.includes("cold") || normalized.includes("call")) return "cold_calling";
    return "manual";
}

/**
 * Map status string to restaurant_status enum value
 */
function mapStatus(status: string | undefined): CompanyInput["restaurant_status"] | undefined {
    if (!status) return undefined;
    const normalized = status.toLowerCase();
    if (normalized.includes("cold")) return "cold_no_reply";
    if (normalized.includes("replied") || normalized.includes("callback")) return "replied";
    if (normalized.includes("warm") || normalized.includes("interested")) return "warm";
    if (normalized.includes("booked") || normalized.includes("submitted")) return "booked";
    if (normalized.includes("paid")) return "paid";
    if (normalized.includes("client") || normalized.includes("close")) return "client";
    if (normalized.includes("excluded") || normalized.includes("rejected")) return "excluded";
    return "cold_no_reply";
}

// ============================================
// MIGRATION FUNCTIONS
// ============================================

/**
 * Migrate companies from CSV to HubSpot
 */
async function migrateFromCSV(csvPath: string): Promise<void> {
    console.log(`\n📂 Reading companies from: ${csvPath}`);

    const companies = await readCompaniesFromCSV(csvPath);
    console.log(`  Found ${companies.length} companies\n`);

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const company of companies) {
        try {
            // Check if company already exists
            const existingId = await findCompanyByName(company.name);

            if (existingId) {
                console.log(`  ⏭️  ${company.name} - Already exists (ID: ${existingId})`);
                skipped++;
                continue;
            }

            const newId = await createCompany(company);
            console.log(`  ✅ ${company.name} - Created (ID: ${newId})`);
            created++;

            // Rate limiting - HubSpot allows 100 requests per 10 seconds
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
            console.error(`  ❌ ${company.name} - Failed: ${error?.message || error}`);
            failed++;
        }
    }

    console.log("\n" + "─".repeat(50));
    console.log(`Migration complete: ${created} created, ${skipped} skipped, ${failed} failed`);
}

// ============================================
// DEMO: CREATE A SINGLE COMPANY
// ============================================

async function demoCreateCompany(): Promise<void> {
    console.log("\n📝 Demo: Creating a test company with custom properties...\n");

    const testCompany: CompanyInput = {
        name: "Demo Restaurant - Test",
        phone: "+1 555-123-4567",
        website: "https://demo-restaurant.com",
        city: "New York",
        state: "NY",
        industry: "Restaurants",

        // Custom properties
        restaurant_status: "warm",
        owner_name: "John Demo",
        instagram_handle: "demorestaurant",
        google_rating: 4.5,
        google_review_count: 150,
        pain_points: "No direct online ordering, losing money to DoorDash fees",
        lead_source: "cold_calling",
        current_ods: "DoorDash, UberEats",
        has_seo: false,
        offers_direct_delivery: false,
    };

    try {
        const companyId = await createCompany(testCompany);
        console.log(`✅ Created demo company with ID: ${companyId}`);
        console.log(`   View at: https://app.hubspot.com/contacts/YOUR_HUB_ID/company/${companyId}`);
    } catch (error: any) {
        console.error(`❌ Failed to create demo company: ${error?.message || error}`);
    }
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main(): Promise<void> {
    console.log("\n🏢 HubSpot Company Migration Script");
    console.log("═".repeat(50));

    if (!process.env.HUBSPOT_ACCESS_TOKEN) {
        console.error("❌ Error: HUBSPOT_ACCESS_TOKEN not found in .env file");
        process.exit(1);
    }

    // Parse command line arguments
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case "demo":
            // Create a single demo company
            await demoCreateCompany();
            break;

        case "csv":
            // Import from CSV file
            const csvPath = args[1];
            if (!csvPath) {
                console.error("❌ Please provide CSV file path: pnpm tsx src/migrate-companies.ts csv ./path/to/file.csv");
                process.exit(1);
            }
            await migrateFromCSV(csvPath);
            break;

        default:
            console.log("\nUsage:");
            console.log("  pnpm tsx src/migrate-companies.ts demo     - Create a test company");
            console.log("  pnpm tsx src/migrate-companies.ts csv <file>  - Import from CSV file");
            console.log("\nExample:");
            console.log("  pnpm tsx packages/hubspot/src/migrate-companies.ts csv packages/google-sheets/Owner\\ Outreach\\ -\\ Master\\ List.csv");
    }
}

main();
