# Extension-Backend Integration Summary

## Overview

Successfully integrated the Chrome extension with the existing Next.js backend API infrastructure. The extension no longer performs local fact-checking but instead delegates all analysis to the backend server.

## Changes Made

### 1. **background.js** - Complete Refactor
**Old Approach:**
- Loaded trusted sources from local JSON file
- Performed local content categorization
- Extracted claims using regex patterns
- Verified claims against local trusted source list
- Calculated trust scores locally

**New Approach:**
- Connects to backend API at `http://localhost:3000`
- Calls `/api/reclaimify` for content extraction and claim categorization
- Calls `/api/websearch` to find evidence for each claim
- Calls `/api/analyze/batch` to extract content from search results
- Calls `/api/factCheck` to verify claims using Gemini AI
- Receives aggregated results with trust scores

**Key Benefits:**
- Leverages powerful backend AI (Gemini) for accurate claim verification
- Uses Tavily/SerpAPI for real web searches
- Consistent analysis between website and extension
- Centralized logic - easier to maintain and update

### 2. **popup.js** - Simplified Flow
**Removed:**
- Complex fallback extraction logic
- Direct page content extraction
- Multiple retry mechanisms

**Updated:**
- Simplified to send only URL to background script
- Background script handles all API calls
- Polls chrome.storage for results
- Cleaner error handling

### 3. **content.js** - Streamlined
**Removed:**
- Auto-analysis on page load
- Readability integration
- Local text extraction

**Kept:**
- Result display functionality
- Trust badge rendering
- Claim highlighting
- Message listener for showing results

### 4. **manifest.json** - Updated Permissions
**Added:**
- `host_permissions` for `http://localhost:3000/*` (backend API)
- `host_permissions` for `http://localhost:3001/*` (alternate port)

**Removed:**
- Reference to `readability.js` in content_scripts

### 5. **Files Removed**
- ✅ `trusted-sources.json` - Backend handles source verification
- ✅ `readability.js` - Backend uses article-extractor library

### 6. **Documentation Updated**
- Created new `README.md` with backend setup instructions
- Archived old README as `README_OLD.md`
- Added troubleshooting section for common issues
- Documented API endpoint usage

## Architecture Flow

```
User clicks "Analyze This Page"
         ↓
    popup.js (gets URL)
         ↓
    background.js
         ↓
    ┌─────────────────────────────────────┐
    │  Backend API Calls (Sequential)     │
    ├─────────────────────────────────────┤
    │ 1. /api/reclaimify                  │
    │    - Extract article text           │
    │    - Categorize sentences           │
    │    - Identify verifiable claims     │
    │                                     │
    │ 2. /api/websearch                   │
    │    - Search for evidence per claim  │
    │    - Return top 3 URLs per claim    │
    │                                     │
    │ 3. /api/analyze/batch               │
    │    - Extract content from URLs      │
    │    - Group by claim                 │
    │                                     │
    │ 4. /api/factCheck                   │
    │    - Verify each claim with AI      │
    │    - Get verdict + trust score      │
    │    - Calculate average trust score  │
    └─────────────────────────────────────┘
         ↓
    Store results in chrome.storage
         ↓
    popup.js displays results
         ↓
    content.js shows badge on page
```

## Setup Requirements

### Backend Server
1. **Install dependencies:**
   ```bash
   cd /path/to/lumous
   npm install
   ```

2. **Configure environment variables** (`.env.local`):
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   TAVILY_API_KEY=your_tavily_api_key_here
   SERPAPI_KEY=your_serpapi_key_here
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```
   Server runs on `http://localhost:3000`

### Extension Installation
1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `/Users/s/Documents/Lumos/lumous/extension/`
5. Extension appears in toolbar

## Testing Checklist

- [ ] Backend server is running on port 3000
- [ ] Environment variables are configured
- [ ] Extension loads without errors in `chrome://extensions/`
- [ ] Can analyze a news article URL
- [ ] Results display correctly in popup
- [ ] Trust badge appears on page (optional)
- [ ] Claims are listed with verdicts
- [ ] Error handling works for invalid URLs

## Configuration Options

### Change Backend URL
Edit `extension/background.js` line 5:
```javascript
const API_BASE_URL = 'http://localhost:3000'; // Change to deployed URL
```

### Deployment Considerations
When deploying to production:
1. Update `API_BASE_URL` to production URL
2. Add production URL to `host_permissions` in manifest.json
3. Set up CORS headers on backend to allow extension origin
4. Consider adding authentication for API calls

## Common Issues & Solutions

### Issue: "Failed to process URL"
**Solution:** 
- Check backend server is running
- Verify API keys in `.env.local`
- Check browser console for specific error

### Issue: Extension doesn't load
**Solution:**
- Remove old version from `chrome://extensions/`
- Check manifest.json is valid JSON
- Look for errors in extension background page console

### Issue: Analysis timeout
**Solution:**
- Analysis can take 30-60 seconds
- Check backend terminal for progress
- Verify all API services (Gemini, Tavily) are responding

### Issue: CORS errors
**Solution:**
- Next.js API routes should handle CORS by default
- If deployed, add extension ID to CORS whitelist

## Performance Notes

- **Average analysis time:** 30-60 seconds
- **API calls per analysis:** 4 sequential calls
- **Rate limiting:** Backend handles Gemini API rate limits
- **Caching:** Results cached in chrome.storage by URL

## Future Enhancements

1. **Streaming Results:** Show progress as each API call completes
2. **Background Analysis:** Analyze pages automatically on load (optional)
3. **Batch Analysis:** Analyze multiple tabs at once
4. **Settings Panel:** Allow users to configure API URL, timeouts, etc.
5. **Result Export:** Download analysis reports as PDF/JSON
6. **Comparison Mode:** Compare multiple articles side-by-side

## API Endpoint Reference

### 1. GET /api/reclaimify
- **Query Params:** `url`, `categorize=true`, `disambiguate=true`
- **Returns:** Content + categorized sentences
- **Used for:** Initial content extraction

### 2. POST /api/websearch
- **Body:** `{ claims: [{ claim, search_date }], originalUrl }`
- **Returns:** `{ urls: string[][] }` (array per claim)
- **Used for:** Finding evidence sources

### 3. POST /api/analyze/batch
- **Body:** `{ urls: string[], claims: string[] }`
- **Returns:** `{ results: [{ url, content, claim, ... }] }`
- **Used for:** Extracting content from search results

### 4. POST /api/factCheck
- **Body:** `{ claims: [{ claim, content: string[] }] }`
- **Returns:** `{ results: [{ Verdict, Trust_Score, Reference }], averageTrustScore }`
- **Used for:** Final claim verification

## File Structure (Updated)

```
extension/
├── manifest.json          # Updated with host_permissions
├── popup.html            # UI unchanged
├── popup.js              # Simplified - no direct extraction
├── background.js         # Refactored for backend calls
├── content.js            # Streamlined - only display logic
├── history.html          # Unchanged
├── history.js            # Unchanged
├── icons/               # Unchanged
├── README.md            # New - backend setup guide
└── README_OLD.md        # Archived old documentation
```

## Conclusion

The extension now operates as a **thin client** that leverages the robust backend infrastructure for all analysis tasks. This provides:

✅ **Consistency** - Same analysis logic for web app and extension
✅ **Power** - AI-powered claim verification with Gemini
✅ **Accuracy** - Real web searches via Tavily/SerpAPI  
✅ **Maintainability** - Single source of truth in backend
✅ **Scalability** - Backend can be deployed independently

The integration is complete and ready for testing!
