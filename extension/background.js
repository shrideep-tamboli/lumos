// Background service worker for fact-checking with backend integration

console.log("🔍 Trust Score Analyzer: Background worker loaded");

// Backend API base URL - change this to your deployed URL or keep localhost:3000 for development
const API_BASE_URL = 'http://localhost:3000';

// Test API connection on startup
async function testConnection() {
  try {
    const response = await fetch(`${API_BASE_URL}/`, { method: 'GET' });
    if (response.ok) {
      console.log('✅ Backend connection successful!');
      return true;
    }
  } catch (error) {
    console.error('❌ Backend connection failed:', error);
  }
  return false;
}

testConnection();

// Listen for analysis requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Received message:', request.action, 'Data:', request.data);
  
  if (request.action === "analyzeArticle") {
    console.log('🚀 Starting analysis for URL:', request.data.url);
    handleAnalysis(request.data, sender.tab || request.data.tab);
    sendResponse({ success: true });
  }
  
  if (request.action === "openReport") {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    sendResponse({ success: true });
  }
  
  return true;
});

// Main analysis handler using backend APIs
async function handleAnalysis(data, tab) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 STARTING ARTICLE ANALYSIS (Backend Mode)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📰 Title: ${data.title}`);
  console.log(`🔗 URL: ${data.url}`);
  console.log(`🌐 Domain: ${data.domain}`);
  console.log("");
  
  // Declare variables at function scope to avoid undefined errors
  let extractData = null;
  let reclaimifyData = null;
  
  try {
    // Step 1: Extract content from URL using /api/extract
    console.log("STEP 1: Extracting content from URL...");
    console.log(`🔗 Calling: ${API_BASE_URL}/api/extract`);
    
    const extractResponse = await fetch(
      `${API_BASE_URL}/api/extract?url=${encodeURIComponent(data.url)}`
    ).catch(err => {
      console.error("❌ Fetch error for extract:", err);
      throw new Error(`Failed to fetch: ${err.message}`);
    });
    
    console.log(`📡 Extract response status: ${extractResponse.status}`);
    
    if (!extractResponse.ok) {
      const errorText = await extractResponse.text();
      console.error(`❌ Extract error response: ${errorText}`);
      throw new Error('Failed to extract content from URL');
    }
    
    extractData = await extractResponse.json();
    console.log(`✅ Extracted content (${extractData.content?.length || 0} characters)`);
    console.log("");
    
    // Step 2: Call /api/reclaimify to process content and extract claims
    console.log("STEP 2: Processing content and extracting verifiable claims...");
    console.log(`🔗 Calling: ${API_BASE_URL}/api/reclaimify`);
    
    const reclaimifyResponse = await fetch(
      `${API_BASE_URL}/api/reclaimify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: data.url,
          content: extractData.content,
          title: extractData.title,
          excerpt: extractData.excerpt
        })
      }
    ).catch(err => {
      console.error("❌ Fetch error for reclaimify:", err);
      throw new Error(`Failed to fetch: ${err.message}`);
    });
    
    console.log(`📡 Reclaimify response status: ${reclaimifyResponse.status}`);
    
    if (!reclaimifyResponse.ok) {
      const errorText = await reclaimifyResponse.text();
      console.error(`❌ Reclaimify error response: ${errorText}`);
      throw new Error('Failed to process URL');
    }
    
    reclaimifyData = await reclaimifyResponse.json();
    console.log(`✅ Extracted ${reclaimifyData.sentences?.length || 0} sentences`);
    console.log(`✅ Found ${reclaimifyData.verifiableClaims?.length || 0} verifiable claims`);
    console.log("");
    
    // Use the new verifiableClaims array from the unified API
    // This contains the final processed claims ready for fact-checking
    const rawClaims = Array.isArray(reclaimifyData.verifiableClaims) 
      ? reclaimifyData.verifiableClaims 
      : [];
    
    // Apply additional filtering for quality control
    const verifiableList = rawClaims.filter((sentence) => {
      // Filter out short sentences or sentences that are likely excerpts/summaries
      const trimmed = sentence.trim();
      if (trimmed.length < 20) return false; // Too short
      if (trimmed.toLowerCase().startsWith('but she') || 
          trimmed.toLowerCase().startsWith('but he') ||
          trimmed.toLowerCase().startsWith('however she') ||
          trimmed.toLowerCase().startsWith('however he')) {
        // These are likely contextual follow-ups, not standalone claims
        return false;
      }
      return true;
    });
    
    if (verifiableList.length === 0) {
      throw new Error('No verifiable claims found in the article');
    }

    const searchDate = new Date().toISOString().split('T')[0];
    const claimsData = {
      claims: verifiableList.map((claim) => ({ claim, search_date: searchDate })),
      search_date: searchDate,
    };
    
    console.log(`📝 Found ${claimsData.claims.length} verifiable claims`);
    console.log("");
    
    // Step 3: Call /api/websearch to get search results for each claim
    console.log("STEP 3: Searching for evidence...");
    const webSearchResponse = await fetch(`${API_BASE_URL}/api/websearch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        claims: claimsData.claims,
        search_date: searchDate,
        originalUrl: data.url
      })
    });

    if (!webSearchResponse.ok) {
      throw new Error('Failed to perform web search');
    }
    
    const webSearchData = await webSearchResponse.json();
    const urlsPerClaim = Array.isArray(webSearchData?.urls) ? webSearchData.urls : [];
    console.log(`✅ Found search results for ${urlsPerClaim.filter(urls => urls.length > 0).length} claims`);
    console.log("");
    
    // Flatten URLs for batch extraction and create claim mapping
    const flattenedUrls = [];
    const claimsOnePerUrl = [];
    
    urlsPerClaim.forEach((urls, claimIndex) => {
      urls.forEach(url => {
        if (url) {
          flattenedUrls.push(url);
          claimsOnePerUrl.push(claimsData.claims[claimIndex]?.claim || '');
        }
      });
    });

    // Step 4: Call /api/analyze/batch to extract content from URLs
    console.log("STEP 4: Extracting content from search results...");
    
    if (flattenedUrls.length === 0) {
      throw new Error('No valid URLs found for analysis');
    }
    
    const batchResponse = await fetch(`${API_BASE_URL}/api/analyze/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        urls: flattenedUrls,
        claims: claimsOnePerUrl
      })
    });

    if (!batchResponse.ok) {
      throw new Error('Failed to analyze content');
    }

    const batchData = await batchResponse.json();
    const batchResults = Array.isArray(batchData?.results) ? batchData.results : [];
    console.log(`✅ Extracted content from ${batchResults.length} sources`);
    console.log("");

    // Group extracted contents per claim for fact checking
    const contentsByClaim = {};
    
    batchResults.forEach((result) => {
      const claimKey = (result?.claim || '').toString().trim();
      const content = (result?.content || '').toString().trim();
      
      if (claimKey && content) {
        if (!contentsByClaim[claimKey]) {
          contentsByClaim[claimKey] = [];
        }
        contentsByClaim[claimKey].push(content);
      }
    });

    // Step 5: Call /api/factCheck with claims and their associated content
    // Process in smaller batches to avoid timeout
    console.log("STEP 5: Fact-checking claims in batches...");
    
    const factCheckClaims = Object.entries(contentsByClaim).map(([claim, content]) => ({
      claim,
      content: content.length === 1 ? content[0] : content
    }));

    let factCheckResults = [];
    let totalTrustScore = 0;
    let trustScoreCount = 0;
    let averageTrustScore = 50; // Default value
    
    // Process fact-checking in batches of 2 claims at a time (reduced from 3)
    // This significantly reduces embedding generation and prevents timeouts
    const FACT_CHECK_BATCH_SIZE = 2;
    
    if (factCheckClaims.length > 0) {
      for (let i = 0; i < factCheckClaims.length; i += FACT_CHECK_BATCH_SIZE) {
        const batch = factCheckClaims.slice(i, i + FACT_CHECK_BATCH_SIZE);
        const batchNumber = Math.floor(i / FACT_CHECK_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(factCheckClaims.length / FACT_CHECK_BATCH_SIZE);
        
        console.log(`  📦 Processing fact-check batch ${batchNumber}/${totalBatches} (${batch.length} claims)`);
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout per batch
          
          const factCheckResponse = await fetch(`${API_BASE_URL}/api/factCheck`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              claims: batch
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!factCheckResponse.ok) {
            console.error(`  ❌ Batch ${batchNumber} failed with status: ${factCheckResponse.status}`);
            // Add placeholder results for failed batch
            batch.forEach(({ claim }) => {
              factCheckResults.push({
                claim,
                Verdict: 'Unclear',
                Reference: ['Failed to fact-check'],
                Trust_Score: 50
              });
              totalTrustScore += 50;
              trustScoreCount++;
            });
            continue;
          }
          
          const fcJson = await factCheckResponse.json();
          const batchResults = Array.isArray(fcJson?.results) ? fcJson.results : [];
          const batchAvgScore = typeof fcJson?.averageTrustScore === 'number' ? fcJson.averageTrustScore : 50;
          
          console.log(`  ✅ Batch ${batchNumber} complete: ${batchResults.length} claims verified (avg score: ${batchAvgScore})`);
          
          factCheckResults.push(...batchResults);
          totalTrustScore += batchAvgScore * batchResults.length;
          trustScoreCount += batchResults.length;
          
        } catch (error) {
          console.error(`  ❌ Error processing batch ${batchNumber}:`, error.message);
          // Add placeholder results for error batch
          batch.forEach(({ claim }) => {
            factCheckResults.push({
              claim,
              Verdict: 'Unclear',
              Reference: [error.name === 'AbortError' ? 'Timeout during fact-checking' : 'Error during fact-checking'],
              Trust_Score: 50
            });
            totalTrustScore += 50;
            trustScoreCount++;
          });
        }
        
        // Add a small delay between batches to avoid overwhelming the API
        if (i + FACT_CHECK_BATCH_SIZE < factCheckClaims.length) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }
      }
      
      // Calculate overall average trust score
      averageTrustScore = trustScoreCount > 0 ? Math.round(totalTrustScore / trustScoreCount) : 50;
      console.log(`✅ All fact-checking batches complete. Total: ${factCheckResults.length} claims, Avg score: ${averageTrustScore}`);
    }
    console.log("");
    
    // Merge results with fact-check data
    const groupedByClaim = {};
    batchResults.forEach((r) => {
      const k = (r?.claim || '').toString().trim();
      if (!k) return;
      if (!groupedByClaim[k]) groupedByClaim[k] = [];
      groupedByClaim[k].push({
        url: String(r?.url || ''),
        content: String(r?.content || ''),
        title: r?.title || undefined,
        excerpt: r?.excerpt || undefined,
        error: r?.error || undefined,
        relevantChunks: Array.isArray(r?.relevantChunks) ? r.relevantChunks : []
      });
    });

    const claims = claimsData.claims.map((c, index) => {
      const claimText = c.claim;
      const group = groupedByClaim[claimText] || [];
      const representative = group.length > 0 ? group[0] : { url: '', content: '' };
      const fc = factCheckResults.find((r) => (r?.claim || '').toString().trim() === claimText.trim());
      
      const verdict = fc?.Verdict || fc?.verdict || 'Unclear';
      const trustScore = typeof fc?.Trust_Score === 'number' ? fc.Trust_Score :
                        typeof fc?.trustScore === 'number' ? fc.trustScore :
                        typeof fc?.trust_score === 'number' ? fc.trust_score : 50;
      
      return {
        text: claimText,
        score: trustScore / 100, // Normalize to 0-1 for overall score calculation
        raw_trust_score: trustScore, // Keep the raw 0-100 score for display
        verification_status: verdict,
        verified_by: [representative.url].filter(u => u),
        types: [],
        reasoning: Array.isArray(fc?.Reference) ? fc.Reference.join('; ') : fc?.reference || ''
      };
    });

    // Calculate overall score from average trust score
    const overall_score = averageTrustScore / 100; // Normalize to 0-1
    
    // Categorize content based on claims
    const category = categorizeFromClaims(claims);
    
    // Generate verdict
    let verdict, verdictEmoji;
    if (overall_score >= 0.75) {
      verdict = "HIGHLY TRUSTWORTHY";
      verdictEmoji = "✅";
    } else if (overall_score >= 0.60) {
      verdict = "GENERALLY RELIABLE";
      verdictEmoji = "👍";
    } else if (overall_score >= 0.45) {
      verdict = "MIXED CREDIBILITY";
      verdictEmoji = "⚠️";
    } else if (overall_score >= 0.30) {
      verdict = "QUESTIONABLE";
      verdictEmoji = "⚡";
    } else {
      verdict = "LIKELY UNRELIABLE";
      verdictEmoji = "❌";
    }
    
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`${verdictEmoji} ANALYSIS COMPLETE: ${verdict}`);
    console.log(`🎯 Overall Trust Score: ${(overall_score * 100).toFixed(1)}%`);
    console.log(`📂 Category: ${category}`);
    console.log(`📝 Claims Analyzed: ${claims.length}`);
    console.log(`✅ Credible Claims: ${claims.filter(c => c.score >= 0.7).length}`);
    console.log(`⚠️ Questionable Claims: ${claims.filter(c => c.score < 0.7 && c.score >= 0.4).length}`);
    console.log(`❌ Suspicious Claims: ${claims.filter(c => c.score < 0.4).length}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    
    // Prepare results
    const results = {
      url: data.url,
      title: data.title,
      domain: data.domain,
      category: category,
      overall_score: overall_score,
      verdict: verdict,
      claims: claims,
      analyzed_at: new Date().toISOString(),
      text_length: reclaimifyData.content?.length || 0
    };
    
    // Save results to storage
    console.log('💾 Saving results to storage with key:', `analysis_${data.url}`);
    console.log('💾 Results object:', JSON.stringify(results, null, 2));
    
    await chrome.storage.local.set({ 
      [`analysis_${data.url}`]: results 
    });
    
    console.log('✅ Results saved to chrome.storage.local');
    
    // Verify it was saved
    const verification = await chrome.storage.local.get([`analysis_${data.url}`]);
    console.log('🔍 Verification - data in storage:', verification);
    
    // Also add to history
    const historyResult = await chrome.storage.local.get(['extractions']);
    const extractions = historyResult.extractions || [];
    extractions.unshift(results);
    if (extractions.length > 50) extractions.splice(50);
    await chrome.storage.local.set({ extractions: extractions });
    
    // Send results back to content script (if tab exists)
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: "showResults",
          data: results
        });
      } catch (error) {
        console.log("Could not send results to content script:", error.message);
      }
    }
    
  } catch (error) {
    console.error("❌ ANALYSIS ERROR:", error);
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    // Check if we have any partial results to save
    let hasPartialResults = false;
    let partialResults = null;
    
    try {
      // If we got through some steps, try to save what we have
      if (typeof extractData !== 'undefined' && extractData) {
        hasPartialResults = true;
        
        const category = 'general';
        const verdict = 'ANALYSIS INCOMPLETE';
        const overall_score = 0.5;
        
        partialResults = {
          url: data.url,
          title: data.title,
          domain: data.domain,
          category: category,
          overall_score: overall_score,
          verdict: verdict,
          claims: [],
          error: error.message,
          analyzed_at: new Date().toISOString(),
          text_length: extractData.content?.length || 0,
          partial: true
        };
      }
    } catch (partialError) {
      console.error("Could not create partial results:", partialError);
    }
    
    // Save error state or partial results
    const errorResult = partialResults || {
      url: data.url,
      title: data.title,
      domain: data.domain,
      category: 'error',
      overall_score: 0.5,
      verdict: 'ERROR',
      claims: [],
      error: error.message,
      analyzed_at: new Date().toISOString()
    };
    
    console.log('💾 Saving error/partial result:', errorResult);
    
    await chrome.storage.local.set({ 
      [`analysis_${data.url}`]: errorResult 
    });
  }
}

// Simple category detection from claims text
function categorizeFromClaims(claims) {
  const allText = claims.map(c => c.text).join(' ').toLowerCase();
  
  if (/politic|election|government|minister/i.test(allText)) return 'politics';
  if (/health|medical|disease|covid|vaccine/i.test(allText)) return 'health';
  if (/science|research|study/i.test(allText)) return 'science';
  if (/tech|software|app|ai/i.test(allText)) return 'technology';
  if (/economy|market|stock|financial/i.test(allText)) return 'economy';
  if (/climate|environment|carbon/i.test(allText)) return 'climate';
  
  return 'general';
}


// Background service worker for fact-checking

console.log("🔍 Trust Score Analyzer: Background worker loaded");

// Load trusted sources
let trustedSources = {};
fetch(chrome.runtime.getURL('trusted-sources.json'))
  .then(r => r.json())
  .then(data => {
    trustedSources = data;
    console.log("✅ Loaded trusted sources:", Object.keys(trustedSources));
  })
  .catch(error => {
    console.error("❌ Failed to load trusted sources:", error);
    // Fallback to basic general sources
    trustedSources = {
      general: {
        sources: ['reuters.com', 'apnews.com', 'bbc.com'],
        weight: 0.8
      }
    };
  });

// Listen for analysis requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeArticle") {
    handleAnalysis(request.data, sender.tab || request.data.tab);
    sendResponse({ success: true });
  }
  
  if (request.action === "openReport") {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    sendResponse({ success: true });
  }
  
  return true;
});

// Main analysis handler
async function handleAnalysis(data, tab) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 STARTING ARTICLE ANALYSIS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📰 Title: ${data.title}`);
  console.log(`🔗 URL: ${data.url}`);
  console.log(`🌐 Domain: ${data.domain}`);
  console.log(`📏 Text length: ${data.text.length} characters`);
  console.log("");
  
  try {
    // Step 1: Categorize the content
    console.log("STEP 1: Categorizing content...");
    const category = categorizeContent(data.text);
    console.log("");
    
    // Step 2: Extract verifiable claims
    console.log("STEP 2: Extracting verifiable claims...");
    const claims = extractClaims(data.text);
    console.log("");
    
    // Step 3: Verify each claim against trusted sources
    console.log("STEP 3: Verifying claims against trusted sources...");
    const verifiedClaims = await Promise.all(
      claims.map(claim => verifyClaim(claim, category, data.domain))
    );
    console.log("");
    
    // Step 4: Calculate overall trust score
    console.log("STEP 4: Calculating overall trust score...");
    const overall_score = calculateOverallScore(verifiedClaims, data.domain);
    console.log("");
    
    // Step 5: Generate verdict
    let verdict, verdictEmoji;
    if (overall_score >= 0.75) {
      verdict = "HIGHLY TRUSTWORTHY";
      verdictEmoji = "✅";
    } else if (overall_score >= 0.60) {
      verdict = "GENERALLY RELIABLE";
      verdictEmoji = "👍";
    } else if (overall_score >= 0.45) {
      verdict = "MIXED CREDIBILITY";
      verdictEmoji = "⚠️";
    } else if (overall_score >= 0.30) {
      verdict = "QUESTIONABLE";
      verdictEmoji = "⚡";
    } else {
      verdict = "LIKELY UNRELIABLE";
      verdictEmoji = "❌";
    }
    
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`${verdictEmoji} ANALYSIS COMPLETE: ${verdict}`);
    console.log(`🎯 Overall Trust Score: ${(overall_score * 100).toFixed(1)}%`);
    console.log(`📂 Category: ${category}`);
    console.log(`📝 Claims Analyzed: ${verifiedClaims.length}`);
    console.log(`✅ Credible Claims: ${verifiedClaims.filter(c => c.score >= 0.7).length}`);
    console.log(`⚠️ Questionable Claims: ${verifiedClaims.filter(c => c.score < 0.7 && c.score >= 0.4).length}`);
    console.log(`❌ Suspicious Claims: ${verifiedClaims.filter(c => c.score < 0.4).length}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    
    // Step 6: Prepare results
    const results = {
      url: data.url,
      title: data.title,
      domain: data.domain,
      category: category,
      overall_score: overall_score,
      verdict: verdict,
      claims: verifiedClaims,
      analyzed_at: new Date().toISOString(),
      text_length: data.text.length
    };
    
    // Save results to storage
    await chrome.storage.local.set({ 
      [`analysis_${data.url}`]: results 
    });
    
    // Also add to history
    const historyResult = await chrome.storage.local.get(['extractions']);
    const extractions = historyResult.extractions || [];
    extractions.unshift(results);
    if (extractions.length > 50) extractions.splice(50);
    await chrome.storage.local.set({ extractions: extractions });
    
    // Send results back to content script (if tab exists)
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: "showResults",
          data: results
        });
      } catch (error) {
        console.log("Could not send results to content script:", error.message);
      }
    }
    
  } catch (error) {
    console.error("❌ ANALYSIS ERROR:", error);
    console.error(error.stack);
  }
}

// Categorize content based on comprehensive analysis
function categorizeContent(text) {
  const lower = text.toLowerCase();
  
  // More comprehensive category patterns with weighted scoring
  const categories = {
    politics: {
      primary: ['election', 'government', 'minister', 'parliament', 'congress', 'senate', 'political party', 'legislation', 'policy', 'vote', 'president', 'prime minister', 'democratic', 'republican', 'campaign'],
      secondary: ['politician', 'governance', 'administration', 'cabinet', 'referendum', 'ballot', 'constituency'],
      weight: 1.0
    },
    health: {
      primary: ['disease', 'medical', 'doctor', 'hospital', 'covid', 'vaccine', 'treatment', 'patient', 'diagnosis', 'health', 'pandemic', 'epidemic', 'clinical trial', 'medication', 'symptoms'],
      secondary: ['medicine', 'clinic', 'healthcare', 'physician', 'surgery', 'therapy', 'prescription'],
      weight: 1.0
    },
    science: {
      primary: ['research', 'study', 'scientist', 'discovery', 'experiment', 'peer review', 'journal', 'publication', 'hypothesis', 'theory', 'data analysis', 'laboratory'],
      secondary: ['academic', 'researcher', 'findings', 'methodology', 'evidence'],
      weight: 0.9
    },
    technology: {
      primary: ['software', 'app', 'artificial intelligence', 'machine learning', 'startup', 'tech company', 'algorithm', 'programming', 'cyber', 'digital', 'innovation'],
      secondary: ['technology', 'coding', 'developer', 'platform', 'device', 'gadget'],
      weight: 0.9
    },
    economy: {
      primary: ['economy', 'market', 'stock', 'gdp', 'inflation', 'recession', 'financial', 'trade', 'investment', 'interest rate', 'central bank', 'fiscal'],
      secondary: ['business', 'revenue', 'profit', 'loss', 'economic growth', 'unemployment'],
      weight: 1.0
    },
    climate: {
      primary: ['climate change', 'global warming', 'carbon emissions', 'renewable energy', 'sustainability', 'greenhouse gas', 'paris agreement', 'fossil fuel'],
      secondary: ['climate', 'environment', 'pollution', 'green energy', 'carbon footprint'],
      weight: 1.0
    },
    sports: {
      primary: ['championship', 'tournament', 'league', 'world cup', 'olympics', 'player transfer', 'match result'],
      secondary: ['sports', 'game', 'match', 'player', 'team', 'score', 'cricket', 'football', 'basketball'],
      weight: 0.7
    },
    entertainment: {
      primary: ['box office', 'album release', 'movie premiere', 'awards ceremony', 'celebrity'],
      secondary: ['movie', 'film', 'actor', 'actress', 'music', 'concert', 'song', 'hollywood'],
      weight: 0.6
    },
    education: {
      primary: ['education policy', 'university ranking', 'exam results', 'school curriculum', 'student admission'],
      secondary: ['education', 'school', 'university', 'student', 'teacher', 'degree', 'college'],
      weight: 0.8
    },
    legal: {
      primary: ['court ruling', 'verdict', 'lawsuit', 'supreme court', 'legal case', 'prosecution', 'defense'],
      secondary: ['court', 'judge', 'law', 'legal', 'attorney', 'justice', 'trial'],
      weight: 0.9
    },
    space: {
      primary: ['space mission', 'rocket launch', 'satellite', 'astronaut', 'mars mission', 'nasa', 'spacex'],
      secondary: ['space', 'rocket', 'moon', 'orbit', 'spacecraft', 'cosmos'],
      weight: 0.8
    },
    cybersecurity: {
      primary: ['data breach', 'cyber attack', 'ransomware', 'hacking incident', 'security vulnerability'],
      secondary: ['hack', 'malware', 'phishing', 'encryption', 'cybersecurity'],
      weight: 0.9
    }
  };
  
  const categoryScores = {};
  
  // Calculate weighted scores for each category
  for (const [category, patterns] of Object.entries(categories)) {
    let score = 0;
    
    // Primary keywords worth more
    patterns.primary.forEach(keyword => {
      const regex = new RegExp('\\b' + keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'gi');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length * 3; // Primary keywords worth 3x
      }
    });
    
    // Secondary keywords
    patterns.secondary.forEach(keyword => {
      const regex = new RegExp('\\b' + keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'gi');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length * 1; // Secondary keywords worth 1x
      }
    });
    
    // Apply category weight
    categoryScores[category] = score * patterns.weight;
  }
  
  // Find category with highest score
  let detectedCategory = 'general';
  let maxScore = 0;
  
  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedCategory = category;
    }
  }
  
  // Require minimum threshold to avoid misclassification
  if (maxScore < 3) {
    detectedCategory = 'general';
  }
  
  console.log('📊 Category scores:', categoryScores);
  console.log(`✅ Detected category: ${detectedCategory} (score: ${maxScore})`);
  
  return detectedCategory;
}

// Extract claims from text with intelligent detection
function extractClaims(text) {
  // Split into sentences more intelligently
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 300); // Reasonable claim length
  
  const claims = [];
  
  // Patterns that indicate factual/verifiable claims
  const factualIndicators = [
    // Numerical claims
    { pattern: /\d+%/, score: 0.8, type: 'percentage' },
    { pattern: /\$\d+|\d+\s*(million|billion|trillion|thousand)/, score: 0.9, type: 'financial' },
    { pattern: /\d+\s*(people|patients|cases|deaths|victims)/, score: 0.9, type: 'statistical' },
    
    // Temporal claims
    { pattern: /\b(19|20)\d{2}\b/, score: 0.7, type: 'year' },
    { pattern: /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i, score: 0.8, type: 'date' },
    
    // Attribution (claims with sources)
    { pattern: /according to|as per|reported by|stated by|announced by/i, score: 0.9, type: 'attributed' },
    { pattern: /\b(study|research|report|survey|poll|investigation)\s+(found|showed|revealed|indicated|suggests)/i, score: 0.95, type: 'research' },
    
    // Quotes from officials/experts
    { pattern: /"[^"]+".*said|stated|announced|declared/i, score: 0.85, type: 'quote' },
    
    // Action/event claims
    { pattern: /\b(increased|decreased|rose|fell|dropped|grew|declined|surged)\b/i, score: 0.7, type: 'change' },
    { pattern: /\b(confirmed|denied|approved|rejected|signed|passed|banned|authorized)/i, score: 0.8, type: 'action' },
    
    // Comparative claims
    { pattern: /\b(higher|lower|more|less|greater|fewer|better|worse)\s+than\b/i, score: 0.75, type: 'comparison' },
    
    // Scientific claims
    { pattern: /\b(causes|caused|linked to|associated with|correlation|effect|impact)\b/i, score: 0.8, type: 'causal' }
  ];
  
  for (const sentence of sentences) {
    let claimScore = 0;
    const matchedTypes = [];
    
    // Check each factual indicator
    for (const indicator of factualIndicators) {
      if (indicator.pattern.test(sentence)) {
        claimScore += indicator.score;
        matchedTypes.push(indicator.type);
      }
    }
    
    // Reduce score for opinion indicators
    const opinionIndicators = [
      /\b(i think|i believe|in my opinion|seems like|probably|maybe|perhaps|might|could be)/i,
      /\b(beautiful|ugly|good|bad|terrible|wonderful|amazing)\b/i // Subjective adjectives
    ];
    
    for (const pattern of opinionIndicators) {
      if (pattern.test(sentence)) {
        claimScore -= 0.5;
      }
    }
    
    // Must have minimum score to be considered a claim
    if (claimScore >= 0.7) {
      claims.push({
        text: sentence,
        score: null,
        confidence: Math.min(1, claimScore),
        types: matchedTypes,
        verified_by: [],
        verification_status: 'pending'
      });
    }
  }
  
  // Sort by confidence and limit to top 10 claims
  claims.sort((a, b) => b.confidence - a.confidence);
  const topClaims = claims.slice(0, 10);
  
  console.log(`📝 Extracted ${topClaims.length} high-confidence claims from ${sentences.length} sentences`);
  topClaims.forEach((claim, i) => {
    console.log(`  ${i+1}. [${(claim.confidence * 100).toFixed(0)}%] ${claim.text.substring(0, 80)}...`);
  });
  
  return topClaims;
}

// Verify claim against trusted sources with sophisticated scoring
async function verifyClaim(claim, category, sourceDomain) {
  console.log(`🔍 Verifying claim: "${claim.text.substring(0, 60)}..."`);
  
  // Get trusted sources for this category
  const categoryData = trustedSources[category] || trustedSources['general'];
  
  if (!categoryData || !categoryData.sources) {
    console.warn(`⚠️ No trusted sources found for category: ${category}`);
    return {
      ...claim,
      score: 0.5,
      verified_by: [],
      verification_status: 'Unknown - No trusted sources for category'
    };
  }
  
  const trustedList = categoryData.sources;
  const categoryWeight = categoryData.weight || 0.8;
  
  // Step 1: Check if source domain is in trusted list
  const domainParts = sourceDomain.split('.');
  const baseDomain = domainParts.slice(-2).join('.'); // e.g., "example.com" from "news.example.com"
  
  let isDomainTrusted = false;
  let trustLevel = 'untrusted';
  
  for (const trustedSource of trustedList) {
    if (sourceDomain.includes(trustedSource) || 
        trustedSource.includes(sourceDomain) ||
        baseDomain === trustedSource ||
        trustedSource.endsWith(baseDomain)) {
      isDomainTrusted = true;
      trustLevel = 'trusted';
      break;
    }
  }
  
  console.log(`  📍 Domain ${sourceDomain} is ${isDomainTrusted ? 'TRUSTED' : 'NOT TRUSTED'} for ${category}`);
  
  // Step 2: Base score calculation
  let score = 0.5; // Neutral starting point
  
  // Domain trust heavily influences score
  if (isDomainTrusted) {
    score = 0.75 * categoryWeight; // Trusted domain gets high base score
  } else {
    score = 0.30; // Untrusted domain starts low
  }
  
  // Step 3: Claim quality analysis
  const claimText = claim.text.toLowerCase();
  
  // Positive indicators (increase trust)
  const positiveIndicators = [
    { pattern: /according to|as per|cited by/i, boost: 0.10, reason: 'has attribution' },
    { pattern: /\b(study|research|report)\s+(found|showed|revealed)/i, boost: 0.15, reason: 'references research' },
    { pattern: /\bpeer[- ]reviewed\b/i, boost: 0.20, reason: 'peer-reviewed source' },
    { pattern: /\b(university|institute|agency|organization)\b/i, boost: 0.08, reason: 'institutional source' },
    { pattern: /"[^"]+".*\b(said|stated|announced)/i, boost: 0.12, reason: 'direct quote' },
    { pattern: /\b(data|statistics|figures|numbers)\b/i, boost: 0.08, reason: 'contains data' },
    { pattern: /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i, boost: 0.07, reason: 'specific date' },
    { pattern: /\d+(\.\d+)?%/, boost: 0.06, reason: 'specific percentage' },
    { pattern: /\b(confirmed|verified|authenticated|validated)\b/i, boost: 0.10, reason: 'verification language' }
  ];
  
  // Negative indicators (decrease trust)
  const negativeIndicators = [
    { pattern: /\b(shocking|unbelievable|secret|exposed|revealed|they don't want you to know)/i, penalty: 0.25, reason: 'sensational language' },
    { pattern: /\b(miracle|cure|breakthrough|revolutionary)\b/i, penalty: 0.15, reason: 'exaggeration' },
    { pattern: /\b(always|never|everyone|nobody|all|none)\b/i, penalty: 0.10, reason: 'absolute claims' },
    { pattern: /!!!|!!|\?\?/i, penalty: 0.15, reason: 'excessive punctuation' },
    { pattern: /\b(i think|i believe|in my opinion|seems like|probably|maybe)\b/i, penalty: 0.20, reason: 'opinion/speculation' },
    { pattern: /\b(claim|allegedly|reportedly|rumor|speculation)\b/i, penalty: 0.12, reason: 'unverified language' },
    { pattern: /\b(anonymous|unnamed|undisclosed)\s+(source|official)/i, penalty: 0.15, reason: 'anonymous sources' }
  ];
  
  const reasons = [];
  
  // Apply positive indicators
  for (const indicator of positiveIndicators) {
    if (indicator.pattern.test(claimText)) {
      score += indicator.boost;
      reasons.push(`+${indicator.reason}`);
      console.log(`  ✅ ${indicator.reason} (+${indicator.boost.toFixed(2)})`);
    }
  }
  
  // Apply negative indicators
  for (const indicator of negativeIndicators) {
    if (indicator.pattern.test(claimText)) {
      score -= indicator.penalty;
      reasons.push(`-${indicator.reason}`);
      console.log(`  ❌ ${indicator.reason} (-${indicator.penalty.toFixed(2)})`);
    }
  }
  
  // Step 4: Cross-reference check (simulated - in production would actually search)
  // In a real implementation, we would:
  // 1. Extract key entities/facts from the claim
  // 2. Search each trusted source for mentions
  // 3. Compare similarity of claims
  // For now, we simulate based on domain trust and claim quality
  
  const verifiedBy = [];
  if (isDomainTrusted) {
    verifiedBy.push(sourceDomain);
    
    // Bonus: if claim has research/study keywords and is from trusted domain
    if (/\b(study|research|report)\b/i.test(claimText)) {
      score += 0.10;
      reasons.push('+research from trusted source');
      console.log(`  ✅ Research claim from trusted source (+0.10)`);
    }
  }
  
  // Step 5: Claim type specific adjustments
  if (claim.types && claim.types.length > 0) {
    // Multiple verification types increase confidence
    if (claim.types.length >= 3) {
      score += 0.05;
      reasons.push('+multiple verification types');
    }
    
    // Research/attributed claims are more trustworthy
    if (claim.types.includes('research') || claim.types.includes('attributed')) {
      score += 0.08;
      reasons.push('+high-quality claim type');
    }
  }
  
  // Clamp score between 0 and 1
  score = Math.max(0, Math.min(1, score));
  
  // Determine verification status
  let status;
  if (score >= 0.75) {
    status = 'Highly Credible';
  } else if (score >= 0.60) {
    status = 'Likely True';
  } else if (score >= 0.45) {
    status = 'Mixed/Uncertain';
  } else if (score >= 0.30) {
    status = 'Questionable';
  } else {
    status = 'Likely False';
  }
  
  console.log(`  📊 Final score: ${(score * 100).toFixed(1)}% - ${status}`);
  
  return {
    text: claim.text,
    score: Math.round(score * 100) / 100,
    confidence: claim.confidence,
    types: claim.types,
    verified_by: verifiedBy,
    verification_status: status,
    trust_level: trustLevel,
    reasoning: reasons.join(', ')
  };
}

// Calculate overall trust score with weighted analysis
function calculateOverallScore(claims, domain) {
  if (claims.length === 0) {
    console.log('⚠️ No claims found, defaulting to 0.5');
    return 0.5;
  }
  
  console.log(`📊 Calculating overall score from ${claims.length} claims`);
  
  // Step 1: Calculate base score from claims
  let totalScore = 0;
  let totalWeight = 0;
  
  claims.forEach((claim, index) => {
    // Weight claims by their confidence
    // Higher confidence claims have more impact on overall score
    const weight = claim.confidence || 1.0;
    totalScore += claim.score * weight;
    totalWeight += weight;
    
    console.log(`  Claim ${index + 1}: score=${(claim.score * 100).toFixed(1)}%, confidence=${(claim.confidence * 100).toFixed(1)}%, weight=${weight.toFixed(2)}`);
  });
  
  const avgClaimScore = totalWeight > 0 ? totalScore / totalWeight : 0.5;
  console.log(`  Average weighted claim score: ${(avgClaimScore * 100).toFixed(1)}%`);
  
  // Step 2: Domain credibility bonus/penalty
  let domainModifier = 0;
  let isDomainTrusted = false;
  
  // Check if domain is in any trusted category
  for (const [category, categoryData] of Object.entries(trustedSources)) {
    if (categoryData.sources) {
      for (const trustedSource of categoryData.sources) {
        if (domain.includes(trustedSource) || trustedSource.includes(domain)) {
          isDomainTrusted = true;
          domainModifier = 0.10; // 10% bonus for trusted domain
          console.log(`  ✅ Domain ${domain} is trusted in ${category} (+${domainModifier})`);
          break;
        }
      }
      if (isDomainTrusted) break;
    }
  }
  
  if (!isDomainTrusted) {
    domainModifier = -0.05; // 5% penalty for unknown domain
    console.log(`  ⚠️ Domain ${domain} not in trusted sources (${domainModifier})`);
  }
  
  // Step 3: Consistency check
  // If all claims have similar scores, increase confidence
  const scores = claims.map(c => c.score);
  const variance = calculateVariance(scores);
  const consistencyBonus = variance < 0.05 ? 0.05 : 0; // Low variance = consistent = bonus
  
  if (consistencyBonus > 0) {
    console.log(`  ✅ Claims are consistent (variance=${variance.toFixed(3)}) (+${consistencyBonus})`);
  }
  
  // Step 4: Quality check
  // More high-quality claims = higher overall score
  const highQualityClaims = claims.filter(c => c.score >= 0.7).length;
  const qualityRatio = highQualityClaims / claims.length;
  const qualityBonus = qualityRatio >= 0.6 ? 0.05 : 0; // 60%+ high quality = bonus
  
  if (qualityBonus > 0) {
    console.log(`  ✅ High quality ratio (${(qualityRatio * 100).toFixed(0)}% of claims) (+${qualityBonus})`);
  }
  
  // Step 5: Calculate final score
  let finalScore = avgClaimScore + domainModifier + consistencyBonus + qualityBonus;
  
  // Clamp between 0 and 1
  finalScore = Math.max(0, Math.min(1, finalScore));
  
  console.log(`  🎯 Final overall score: ${(finalScore * 100).toFixed(1)}%`);
  console.log(`     - Base (weighted avg): ${(avgClaimScore * 100).toFixed(1)}%`);
  console.log(`     - Domain modifier: ${(domainModifier * 100).toFixed(1)}%`);
  console.log(`     - Consistency bonus: ${(consistencyBonus * 100).toFixed(1)}%`);
  console.log(`     - Quality bonus: ${(qualityBonus * 100).toFixed(1)}%`);
  
  return Math.round(finalScore * 100) / 100; // Round to 2 decimals
}

// Helper function to calculate variance
function calculateVariance(numbers) {
  if (numbers.length === 0) return 0;
  
  const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
  const variance = squaredDiffs.reduce((sum, n) => sum + n, 0) / numbers.length;
  
  return variance;
}
