/**
 * HubSpot Schema Setup Script
 * 
 * Creates all custom properties for Companies, Contacts, and Deals
 * as defined in HUBSPOT_CONTEXT.md
 * 
 * Run with: pnpm tsx packages/hubspot/src/setup-schema.ts
 */

import { Client } from "@hubspot/api-client";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the hubspot package directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const hubspotClient = new Client({
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

// ============================================
// PROPERTY DEFINITIONS FROM HUBSPOT_CONTEXT.md
// ============================================

interface PropertyDefinition {
    name: string;
    label: string;
    type: "string" | "number" | "date" | "enumeration" | "bool";
    fieldType: "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "booleancheckbox";
    groupName: string;
    description?: string;
    options?: { label: string; value: string; displayOrder: number }[];
}

// Company Custom Properties
const COMPANY_PROPERTIES: PropertyDefinition[] = [
    {
        name: "restaurant_status",
        label: "Restaurant Status",
        type: "enumeration",
        fieldType: "select",
        groupName: "companyinformation",
        description: "Current status of the restaurant in our sales pipeline",
        options: [
            { label: "Cold No Reply", value: "cold_no_reply", displayOrder: 1 },
            { label: "Replied", value: "replied", displayOrder: 2 },
            { label: "Warm", value: "warm", displayOrder: 3 },
            { label: "Booked", value: "booked", displayOrder: 4 },
            { label: "Paid", value: "paid", displayOrder: 5 },
            { label: "Client", value: "client", displayOrder: 6 },
            { label: "Excluded", value: "excluded", displayOrder: 7 },
        ],
    },
    {
        name: "owner_name",
        label: "Owner Name",
        type: "string",
        fieldType: "text",
        groupName: "companyinformation",
        description: "Name of the restaurant owner",
    },
    {
        name: "instagram_handle",
        label: "Instagram Handle",
        type: "string",
        fieldType: "text",
        groupName: "companyinformation",
        description: "Instagram username (without @)",
    },
    {
        name: "google_maps_link",
        label: "Google Maps Link",
        type: "string",
        fieldType: "text",
        groupName: "companyinformation",
        description: "Link to Google Maps listing",
    },
    {
        name: "google_rating",
        label: "Google Rating",
        type: "number",
        fieldType: "number",
        groupName: "companyinformation",
        description: "Google Maps rating (1.0 - 5.0)",
    },
    {
        name: "google_review_count",
        label: "Google Review Count",
        type: "number",
        fieldType: "number",
        groupName: "companyinformation",
        description: "Number of Google reviews",
    },
    {
        name: "pain_points",
        label: "Pain Points",
        type: "string",
        fieldType: "textarea",
        groupName: "companyinformation",
        description: "Identified pain points and challenges",
    },
    {
        name: "lead_source",
        label: "Lead Source",
        type: "enumeration",
        fieldType: "select",
        groupName: "companyinformation",
        description: "How we found this lead",
        options: [
            { label: "GMaps Scraper", value: "gmaps_scraper", displayOrder: 1 },
            { label: "Manual", value: "manual", displayOrder: 2 },
            { label: "Instagram", value: "instagram", displayOrder: 3 },
            { label: "Cold Calling", value: "cold_calling", displayOrder: 4 },
            { label: "Referral", value: "referral", displayOrder: 5 },
        ],
    },
    {
        name: "current_ods",
        label: "Current ODS (Ordering System)",
        type: "string",
        fieldType: "text",
        groupName: "companyinformation",
        description: "Current ordering/delivery systems used (e.g., DoorDash, UberEats)",
    },
    {
        name: "has_seo",
        label: "Has SEO",
        type: "enumeration",
        fieldType: "booleancheckbox",
        groupName: "companyinformation",
        description: "Whether the business has SEO optimization",
        options: [
            { label: "Yes", value: "true", displayOrder: 1 },
            { label: "No", value: "false", displayOrder: 2 },
        ],
    },
    {
        name: "offers_direct_delivery",
        label: "Offers Direct Delivery",
        type: "enumeration",
        fieldType: "booleancheckbox",
        groupName: "companyinformation",
        description: "Whether the business offers direct delivery",
        options: [
            { label: "Yes", value: "true", displayOrder: 1 },
            { label: "No", value: "false", displayOrder: 2 },
        ],
    },
    {
        name: "first_contacted_date",
        label: "First Contacted Date",
        type: "date",
        fieldType: "date",
        groupName: "companyinformation",
        description: "Date of first contact/outreach",
    },
    {
        name: "last_contacted_date",
        label: "Last Contacted Date",
        type: "date",
        fieldType: "date",
        groupName: "companyinformation",
        description: "Date of most recent contact",
    },
    {
        name: "contact_source",
        label: "Contact Source",
        type: "string",
        fieldType: "text",
        groupName: "companyinformation",
        description: "Source of contact information",
    },
    {
        name: "owner_email",
        label: "Owner Email",
        type: "string",
        fieldType: "text",
        groupName: "companyinformation",
        description: "Email address of the restaurant owner",
    },
];

// Contact Custom Properties
const CONTACT_PROPERTIES: PropertyDefinition[] = [
    {
        name: "contact_type",
        label: "Contact Type",
        type: "enumeration",
        fieldType: "select",
        groupName: "contactinformation",
        description: "Role of this contact at the business",
        options: [
            { label: "Owner", value: "owner", displayOrder: 1 },
            { label: "Manager", value: "manager", displayOrder: 2 },
            { label: "Receptionist", value: "receptionist", displayOrder: 3 },
            { label: "Decision Maker", value: "decision_maker", displayOrder: 4 },
        ],
    },
    {
        name: "best_call_time",
        label: "Best Call Time",
        type: "string",
        fieldType: "text",
        groupName: "contactinformation",
        description: "Preferred time for calls (e.g., Mon-Fri 2pm)",
    },
    {
        name: "timezone",
        label: "Timezone",
        type: "enumeration",
        fieldType: "select",
        groupName: "contactinformation",
        description: "Contact's timezone",
        options: [
            { label: "Eastern (ET)", value: "america_new_york", displayOrder: 1 },
            { label: "Central (CT)", value: "america_chicago", displayOrder: 2 },
            { label: "Mountain (MT)", value: "america_denver", displayOrder: 3 },
            { label: "Pacific (PT)", value: "america_los_angeles", displayOrder: 4 },
            { label: "Alaska (AKT)", value: "america_anchorage", displayOrder: 5 },
            { label: "Hawaii (HST)", value: "pacific_honolulu", displayOrder: 6 },
        ],
    },
];

// Deal Custom Properties (if needed beyond pipeline stages)
const DEAL_PROPERTIES: PropertyDefinition[] = [
    {
        name: "call_outcome",
        label: "Last Call Outcome",
        type: "enumeration",
        fieldType: "select",
        groupName: "dealinformation",
        description: "Outcome of the most recent call",
        options: [
            { label: "Interested", value: "interested", displayOrder: 1 },
            { label: "Not Interested", value: "not_interested", displayOrder: 2 },
            { label: "Callback Requested", value: "callback", displayOrder: 3 },
            { label: "No Answer", value: "no_answer", displayOrder: 4 },
            { label: "Wrong Number", value: "wrong_number", displayOrder: 5 },
            { label: "Voicemail", value: "voicemail", displayOrder: 6 },
            { label: "Fumbled", value: "fumbled", displayOrder: 7 },
        ],
    },
    {
        name: "interest_level",
        label: "Interest Level",
        type: "number",
        fieldType: "number",
        groupName: "dealinformation",
        description: "Interest level score (1-10)",
    },
];

// ============================================
// PIPELINE CONFIGURATION FROM HUBSPOT_CONTEXT.md
// ============================================

interface PipelineStage {
    label: string;
    displayOrder: number;
    metadata: {
        probability: string;
        isClosed?: string;
    };
}

const RESTAURANT_OUTREACH_PIPELINE = {
    label: "Restaurant Outreach",
    displayOrder: 0,
    stages: [
        { label: "Cold - No Reply", displayOrder: 0, metadata: { probability: "0.10" } },
        { label: "Callback Scheduled", displayOrder: 1, metadata: { probability: "0.20" } },
        { label: "Replied", displayOrder: 2, metadata: { probability: "0.30" } },
        { label: "Warm", displayOrder: 3, metadata: { probability: "0.40" } },
        { label: "Submitted", displayOrder: 4, metadata: { probability: "0.60" } },
        { label: "Demo Booked", displayOrder: 5, metadata: { probability: "0.75" } },
        { label: "Paid / Trial", displayOrder: 6, metadata: { probability: "0.90" } },
        { label: "Nurture", displayOrder: 7, metadata: { probability: "0.15" } },
        { label: "Closed Won - Client", displayOrder: 8, metadata: { probability: "1.0", isClosed: "true" } },
        { label: "Closed Lost - Rejected", displayOrder: 9, metadata: { probability: "0", isClosed: "true" } },
        { label: "Closed Lost - Unqualified", displayOrder: 10, metadata: { probability: "0", isClosed: "true" } },
        { label: "Closed Lost - Fumbled", displayOrder: 11, metadata: { probability: "0", isClosed: "true" } },
        { label: "Closed Lost - Dead End", displayOrder: 12, metadata: { probability: "0", isClosed: "true" } },
        { label: "Excluded", displayOrder: 13, metadata: { probability: "0", isClosed: "true" } },
    ] as PipelineStage[],
};

// ============================================
// PIPELINE CREATION FUNCTIONS
// ============================================

async function setupPipeline(): Promise<void> {
    console.log(`\n🔀 Setting up Deal Pipeline...`);
    console.log("─".repeat(50));

    try {
        // Get existing pipelines
        const existingPipelines = await hubspotClient.crm.pipelines.pipelinesApi.getAll("deals");

        if (existingPipelines.results.length === 0) {
            console.log("  ❌ No existing pipeline found");
            console.log("─".repeat(50));
            return;
        }

        // Use the first (default) pipeline
        const pipeline = existingPipelines.results[0];
        console.log(`  📋 Found pipeline: "${pipeline.label}" (ID: ${pipeline.id})`);
        console.log(`    Current stages: ${pipeline.stages.length}`);

        // Get existing stage labels to avoid duplicates
        const existingStageLabels = new Set(pipeline.stages.map(s => s.label));

        let added = 0;
        let skipped = 0;

        // Add missing stages
        for (const stage of RESTAURANT_OUTREACH_PIPELINE.stages) {
            if (existingStageLabels.has(stage.label)) {
                console.log(`    ✓ ${stage.label} - Already exists`);
                skipped++;
                continue;
            }

            try {
                await hubspotClient.crm.pipelines.pipelineStagesApi.create("deals", pipeline.id, {
                    label: stage.label,
                    displayOrder: stage.displayOrder,
                    metadata: stage.metadata,
                });
                const probability = parseFloat(stage.metadata.probability) * 100;
                const closed = stage.metadata.isClosed === "true" ? " (Closed)" : "";
                console.log(`    ✅ ${stage.label} - Created (${probability}%${closed})`);
                added++;
            } catch (stageError: any) {
                if (stageError?.body?.message?.includes("already exists")) {
                    console.log(`    ✓ ${stage.label} - Already exists`);
                    skipped++;
                } else {
                    console.log(`    ❌ ${stage.label} - Failed: ${stageError?.message || stageError}`);
                }
            }
        }

        console.log("─".repeat(50));
        console.log(`  Summary: ${added} stages added, ${skipped} already existed`);
        console.log("─".repeat(50));
    } catch (error: any) {
        console.error(`  ❌ Failed to setup pipeline: ${error?.message || error}`);
        console.log("─".repeat(50));
    }
}

// ============================================
// PROPERTY CREATION FUNCTIONS
// ============================================

async function createProperty(
    objectType: "companies" | "contacts" | "deals",
    property: PropertyDefinition
): Promise<{ success: boolean; existed: boolean }> {
    try {
        const propertyInput: any = {
            name: property.name,
            label: property.label,
            type: property.type,
            fieldType: property.fieldType,
            groupName: property.groupName,
            description: property.description || "",
        };

        // Add options for enumeration types
        if (property.type === "enumeration" && property.options) {
            propertyInput.options = property.options;
        }

        await hubspotClient.crm.properties.coreApi.create(objectType, propertyInput);
        return { success: true, existed: false };
    } catch (error: any) {
        // Handle "property already exists" error gracefully
        if (error?.code === 409 || error?.body?.category === "CONFLICT" ||
            error?.message?.includes("already exists") ||
            (error?.body?.message && error.body.message.includes("already exists"))) {
            return { success: true, existed: true };
        }
        throw error;
    }
}

async function setupProperties(
    objectType: "companies" | "contacts" | "deals",
    properties: PropertyDefinition[]
): Promise<void> {
    console.log(`\n📦 Setting up ${objectType.toUpperCase()} properties...`);
    console.log("─".repeat(50));

    let created = 0;
    let existed = 0;
    let failed = 0;

    for (const property of properties) {
        try {
            const result = await createProperty(objectType, property);
            if (result.existed) {
                console.log(`  ✓ ${property.label} (${property.name}) - Already exists`);
                existed++;
            } else {
                console.log(`  ✅ ${property.label} (${property.name}) - Created`);
                created++;
            }
        } catch (error: any) {
            console.error(`  ❌ ${property.label} (${property.name}) - Failed: ${error?.message || error}`);
            failed++;
        }
    }

    console.log("─".repeat(50));
    console.log(`  Summary: ${created} created, ${existed} already existed, ${failed} failed`);
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main(): Promise<void> {
    console.log("\n🚀 HubSpot Schema Setup");
    console.log("═".repeat(50));

    // Validate access token
    if (!process.env.HUBSPOT_ACCESS_TOKEN) {
        console.error("❌ Error: HUBSPOT_ACCESS_TOKEN not found in .env file");
        console.error("   Please add your HubSpot Private App access token to the .env file");
        process.exit(1);
    }

    try {
        // Test connection
        console.log("\n🔌 Testing HubSpot connection...");
        await hubspotClient.crm.companies.basicApi.getPage(1);
        console.log("  ✅ Connected successfully!");

        // Setup properties for each object type
        await setupProperties("companies", COMPANY_PROPERTIES);
        await setupProperties("contacts", CONTACT_PROPERTIES);
        await setupProperties("deals", DEAL_PROPERTIES);

        // Setup deal pipeline
        await setupPipeline();

        console.log("\n" + "═".repeat(50));
        console.log("✅ Schema setup complete!");
        console.log("═".repeat(50) + "\n");

    } catch (error: any) {
        if (error?.code === 401 || error?.body?.category === "UNAUTHORIZED") {
            console.error("\n❌ Authentication failed. Please check your HUBSPOT_ACCESS_TOKEN.");
            console.error("   Make sure your Private App has the required scopes:");
            console.error("   - crm.schemas.custom.read");
            console.error("   - crm.schemas.custom.write");
        } else {
            console.error("\n❌ Error:", error?.message || error);
        }
        process.exit(1);
    }
}

main();
