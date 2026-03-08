import { NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface ParsedTransaction {
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  description: string;
  date: string;
  is_recurring: boolean;
  recurring_frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  category_hint?: string;
  tags: string[];
  fee_amount?: number;
  vendor?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface InvoiceParseResult {
  document_type: 'invoice' | 'receipt' | 'bank_statement' | 'subscription' | 'other';
  vendor?: string;
  transactions: ParsedTransaction[];
  raw_total?: number;
  currency?: string;
  notes?: string;
}

const SYSTEM_PROMPT = `You are a financial document parser. Analyze the provided document (invoice, receipt, bank statement, or subscription confirmation) and extract all financial transactions.

Return a JSON object with this exact structure:
{
  "document_type": "invoice|receipt|bank_statement|subscription|other",
  "vendor": "company/entity name if identifiable",
  "raw_total": total amount as number or null,
  "currency": "ISO 4217 currency code (USD, PKR, GBP, EUR, AED, CAD, AUD, SGD, INR, SAR)",
  "notes": "any important observations",
  "transactions": [
    {
      "type": "income or expense",
      "amount": number (positive, no currency symbols),
      "currency": "ISO 4217 currency code",
      "description": "clear, concise description of what this transaction is for",
      "date": "YYYY-MM-DD format, use document date if only one date found",
      "is_recurring": boolean — true if this is a subscription/recurring charge (look for keywords: subscription, monthly, annual, renewal, recurring, plan, retainer, license, SaaS),
      "recurring_frequency": "daily|weekly|monthly|yearly — only if is_recurring is true",
      "category_hint": "suggested category: Software, Marketing, Payroll, Rent, Utilities, Sales Revenue, Service Revenue, Consulting, Travel, Office Supplies, etc.",
      "tags": ["array", "of", "relevant", "lowercase", "tags"],
      "fee_amount": number or null (any extra fees/taxes/surcharges beyond the main amount),
      "vendor": "specific vendor for this line item if different from main vendor",
      "confidence": "high|medium|low — how confident you are in this extraction"
    }
  ]
}

Rules:
- If the document is an invoice you're paying = expense transactions
- If the document is an invoice you sent / money coming in = income transactions
- Default to expense if ambiguous
- For bank statements, extract EACH transaction as a separate entry
- For invoices with line items, create one transaction per line item or one combined if items are too granular
- Detect recurring even from context clues (e.g. "Invoice #12 of 12", "Monthly Plan", "Annual Subscription")
- If no date found, use today's date
- Always return valid JSON only — no markdown, no explanation outside the JSON`;

export async function POST(request: Request) {
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  let fileData: string;
  let mimeType: string;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type. Use PDF or image (JPG, PNG, WebP).' }, { status: 400 });
    }

    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 20MB.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    fileData = Buffer.from(bytes).toString('base64');
    mimeType = file.type;
  } catch {
    return NextResponse.json({ error: 'Failed to read uploaded file' }, { status: 400 });
  }

  // For PDFs, use the Gemini Files API (upload first, then reference by URI).
  // For images, inline base64 works fine.
  let filePart: Record<string, unknown>;

  if (mimeType === 'application/pdf') {
    // Upload to Gemini Files API
    const uploadRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Header-Content-Length': String(Buffer.from(fileData, 'base64').length),
          'X-Goog-Upload-Header-Content-Type': 'application/pdf',
        },
        body: Buffer.from(fileData, 'base64'),
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('Gemini Files upload error:', uploadRes.status, errText);
      return NextResponse.json(
        { error: `Failed to upload PDF to Gemini (${uploadRes.status})`, detail: errText },
        { status: 502 }
      );
    }

    const uploadData = await uploadRes.json();
    const fileUri = uploadData?.file?.uri;
    if (!fileUri) {
      return NextResponse.json({ error: 'Gemini Files API did not return a file URI' }, { status: 502 });
    }

    filePart = { file_data: { mime_type: 'application/pdf', file_uri: fileUri } };
  } else {
    filePart = { inline_data: { mime_type: mimeType, data: fileData } };
  }

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: SYSTEM_PROMPT }, filePart],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      return NextResponse.json(
        { error: `Gemini API error: ${geminiRes.status}`, detail: errText },
        { status: 502 }
      );
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let parsed: InvoiceParseResult;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from a markdown code block if Gemini wrapped it
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        console.error('Failed to parse Gemini response:', rawText);
        return NextResponse.json({ error: 'Could not parse AI response as JSON' }, { status: 502 });
      }
    }

    // Sanitize & validate
    if (!Array.isArray(parsed.transactions)) {
      parsed.transactions = [];
    }

    const VALID_CURRENCIES = ['USD', 'PKR', 'GBP', 'EUR', 'AED', 'CAD', 'AUD', 'SGD', 'INR', 'SAR'];

    parsed.transactions = parsed.transactions.map(t => ({
      ...t,
      type: t.type === 'income' ? 'income' : 'expense',
      amount: Math.abs(Number(t.amount) || 0),
      currency: VALID_CURRENCIES.includes(t.currency?.toUpperCase()) ? t.currency.toUpperCase() : 'USD',
      is_recurring: Boolean(t.is_recurring),
      tags: Array.isArray(t.tags) ? t.tags : [],
      fee_amount: t.fee_amount ? Math.abs(Number(t.fee_amount)) : undefined,
      confidence: ['high', 'medium', 'low'].includes(t.confidence) ? t.confidence : 'medium',
    }));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Invoice parse error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
