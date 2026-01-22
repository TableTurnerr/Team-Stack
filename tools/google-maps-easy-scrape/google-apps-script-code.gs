/**
 * Google Apps Script for Google Maps Easy Scrape Extension
 * 
 * This script reads exclusion data from a Google Sheet and returns it as JSON.
 * The sheet should have:
 * - Column A: Restaurant Names to Exclude (header in A1)
 * - Column B: Categories/Industries that shouldn't be included (header in B1)
 * 
 * Instructions:
 * 1. Create a new Google Sheet with the exclusion data
 * 2. Open Tools > Script editor in the sheet
 * 3. Paste this code
 * 4. Replace 'YOUR_SHEET_NAME' with your actual sheet name (or use the active sheet)
 * 5. Deploy as a web app:
 *    - Click Deploy > New deployment
 *    - Select type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone (or Anyone with Google account)
 *    - Click Deploy
 * 6. Copy the Web app URL and update the HARDCODED_IGNORE_URL in popup.js
 */

function doGet(e) {
  try {    
    // Use the active spreadsheet (recommended if you're deploying from the same sheet)
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet.getActiveSheet();
    
    // Get all data from the sheet
    var data = sheet.getDataRange().getValues();
    
    // Skip the header row (row 1)
    var names = [];
    var industries = [];
    
    // Start from row 2 (index 1) since row 1 (index 0) is the header
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      
      // Column A (index 0): Restaurant Names to Exclude
      if (row[0] && String(row[0]).trim() !== '') {
        names.push(String(row[0]).trim());
      }
      
      // Column B (index 1): Categories/Industries to Exclude
      if (row[1] && String(row[1]).trim() !== '') {
        industries.push(String(row[1]).trim());
      }
    }
    
    // Create the response object
    var response = {
      names: names,
      industries: industries
    };
    
    // Return as JSON
    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Return error as JSON
    return ContentService
      .createTextOutput(JSON.stringify({
        error: error.toString(),
        names: [],
        industries: []
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
