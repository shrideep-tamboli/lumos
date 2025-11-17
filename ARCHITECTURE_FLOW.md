# Extension Backend Integration - Visual Flow

## Complete Analysis Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER INTERACTION                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    User visits news article page
                                    │
                    User clicks extension icon
                                    │
                    Clicks "🔍 Analyze This Page"
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         POPUP.JS (Frontend)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  • Gets current tab URL                                                  │
│  • Gets page title and domain                                            │
│  • Sends message to background.js                                        │
│  • Shows "Analyzing..." status                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      BACKGROUND.JS (Service Worker)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Receives: { url, title, domain }                                       │
│                                                                          │
│  📡 STEP 1: CONTENT EXTRACTION                                          │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ GET /api/reclaimify?url=...&categorize=true                │        │
│  │                                                             │        │
│  │ Backend:                                                    │        │
│  │ • Scrapes article using article-extractor or cheerio       │        │
│  │ • Splits into sentences                                     │        │
│  │ • Categorizes: Verifiable / Partially / Not Verifiable     │        │
│  │ • Rewrites partially verifiable claims                     │        │
│  │ • Disambiguates claims                                      │        │
│  │ • Decomposes into atomic claims                             │        │
│  │                                                             │        │
│  │ Returns: { content, categorizedSentences }                 │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                    │                                     │
│         Extract verifiable claims only                                  │
│         claims = sentences where category === 'Verifiable'              │
│                                    │                                     │
│                                    ▼                                     │
│  📡 STEP 2: WEB SEARCH FOR EVIDENCE                                    │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ POST /api/websearch                                         │        │
│  │                                                             │        │
│  │ Body: { claims: [{ claim, search_date }], originalUrl }   │        │
│  │                                                             │        │
│  │ Backend:                                                    │        │
│  │ • Searches Tavily API for each claim                       │        │
│  │ • Fallback to SerpAPI (DuckDuckGo) if needed              │        │
│  │ • Returns top 3 URLs per claim                             │        │
│  │ • Excludes original article domain                         │        │
│  │                                                             │        │
│  │ Returns: { urls: string[][] }  // array per claim         │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                    │                                     │
│         Flatten URLs for batch processing                               │
│         flattenedUrls = urls.flat()                                    │
│                                    │                                     │
│                                    ▼                                     │
│  📡 STEP 3: EXTRACT CONTENT FROM SEARCH RESULTS                        │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ POST /api/analyze/batch                                     │        │
│  │                                                             │        │
│  │ Body: { urls: [url1, url2, ...], claims: [claim1, ...] }  │        │
│  │                                                             │        │
│  │ Backend:                                                    │        │
│  │ • Scrapes each URL in parallel                             │        │
│  │ • Extracts clean text content                              │        │
│  │ • Associates content with original claim                   │        │
│  │ • Calculates relevance scores                              │        │
│  │                                                             │        │
│  │ Returns: { results: [{ url, content, claim, ... }] }      │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                    │                                     │
│         Group content by claim                                          │
│         contentsByClaim[claim] = [content1, content2, ...]             │
│                                    │                                     │
│                                    ▼                                     │
│  📡 STEP 4: AI FACT-CHECKING                                           │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ POST /api/factCheck                                         │        │
│  │                                                             │        │
│  │ Body: { claims: [{ claim, content: [src1, src2, ...] }] } │        │
│  │                                                             │        │
│  │ Backend:                                                    │        │
│  │ • Generates embeddings for claims and content              │        │
│  │ • Finds most relevant sentences (top 3 per source)         │        │
│  │ • Calls Gemini AI with claim + evidence                    │        │
│  │ • Gets structured response:                                 │        │
│  │   - Verdict: Support/Contradict/Unclear/etc.              │        │
│  │   - Trust_Score: 0-100                                     │        │
│  │   - Reference: Supporting quotes                           │        │
│  │ • Calculates average trust score                           │        │
│  │                                                             │        │
│  │ Returns: { results: [...], averageTrustScore: 75 }        │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                    │                                     │
│         Merge all results                                               │
│                                    │                                     │
│                                    ▼                                     │
│  💾 STORE RESULTS                                                       │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ chrome.storage.local.set({                                  │        │
│  │   [`analysis_${url}`]: {                                    │        │
│  │     url, title, domain, category,                           │        │
│  │     overall_score: averageTrustScore / 100,                │        │
│  │     verdict: "TRUSTWORTHY" / "MIXED" / etc.,               │        │
│  │     claims: [{ text, score, verdict, reference }],         │        │
│  │     analyzed_at: timestamp                                  │        │
│  │   }                                                          │        │
│  │ })                                                           │        │
│  └────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         POPUP.JS (Display Results)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  • Polls chrome.storage for results                                     │
│  • Displays trust score (0-100%)                                        │
│  • Shows verdict with emoji (✅/⚠️/❌)                                   │
│  • Lists claims with individual scores                                  │
│  • Color codes claims (green/yellow/red)                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONTENT.JS (Optional Visual)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  • Receives message with results                                         │
│  • Shows floating trust badge on page                                    │
│  • Highlights low-trust claims in article                                │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Summary

### Input:
```javascript
{
  url: "https://example.com/article",
  title: "Breaking News Story",
  domain: "example.com"
}
```

### After Step 1 (Reclaimify):
```javascript
{
  content: "Full article text...",
  categorizedSentences: [
    { sentence: "Claim 1", category: "Verifiable" },
    { sentence: "Opinion", category: "Not Verifiable" },
    { sentence: "Claim 2", category: "Verifiable" }
  ]
}
```

### After Step 2 (WebSearch):
```javascript
{
  urls: [
    ["https://source1.com", "https://source2.com", "https://source3.com"], // Claim 1
    ["https://source4.com", "https://source5.com", "https://source6.com"]  // Claim 2
  ]
}
```

### After Step 3 (Batch Analysis):
```javascript
{
  results: [
    { claim: "Claim 1", url: "https://source1.com", content: "Evidence text..." },
    { claim: "Claim 1", url: "https://source2.com", content: "More evidence..." },
    // ... 6 results total (3 per claim)
  ]
}
```

### After Step 4 (FactCheck):
```javascript
{
  results: [
    {
      claim: "Claim 1",
      Verdict: "Support",
      Trust_Score: 85,
      Reference: ["Quote from source 1", "Quote from source 2"]
    },
    {
      claim: "Claim 2",
      Verdict: "Unclear",
      Trust_Score: 50,
      Reference: ["Conflicting evidence"]
    }
  ],
  averageTrustScore: 67.5
}
```

### Final Output (Stored):
```javascript
{
  url: "https://example.com/article",
  title: "Breaking News Story",
  domain: "example.com",
  category: "politics",
  overall_score: 0.675,
  verdict: "GENERALLY RELIABLE",
  claims: [
    {
      text: "Claim 1",
      score: 0.85,
      verification_status: "Support",
      reasoning: "Quote from source 1; Quote from source 2"
    },
    {
      text: "Claim 2",
      score: 0.50,
      verification_status: "Unclear",
      reasoning: "Conflicting evidence"
    }
  ],
  analyzed_at: "2024-11-16T10:30:00Z"
}
```

## Performance Metrics

| Step | Operation | Avg Time | API Used |
|------|-----------|----------|----------|
| 1 | Content Extraction | 2-5s | article-extractor |
| 2 | Web Search | 5-10s | Tavily + SerpAPI |
| 3 | Batch Analysis | 10-20s | article-extractor (parallel) |
| 4 | Fact Checking | 15-30s | Gemini AI |
| **Total** | **End-to-End** | **30-60s** | - |

## Error Handling

Each step has fallback mechanisms:
- **Step 1:** Fallback from article-extractor to cheerio
- **Step 2:** Fallback from Tavily to SerpAPI
- **Step 3:** Individual URL failures don't stop batch
- **Step 4:** Batched processing with error placeholders

## Caching Strategy

- Results cached by URL in `chrome.storage.local`
- Subsequent analyses of same URL are instant
- Cache can be cleared manually
- History limited to 50 most recent analyses
