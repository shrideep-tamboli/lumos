import { NextResponse } from 'next/server';
import twilio from 'twilio';

// Environment variables
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
const BASE_URL = process.env.BASE_URL || 'https://lumous.vercel.app';

// Initialize Twilio client
const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN 
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) 
  : null;

// =====================================================
// TYPES
// =====================================================

interface FactCheckResult {
  claim: string;
  verdict?: string;
  Verdict?: string;
  reason?: string;
  Reason?: string;
  reference?: string | string[];
  Reference?: string | string[];
  trustScore?: number;
  Trust_Score?: number;
  trust_score?: number;
}

interface ReclaimifyResponse {
  url?: string;
  content?: string;
  title?: string;
  verifiableClaims?: string[];
  processedSentences?: Array<{
    category: string;
    originalSentence: string;
    finalClaim?: string;
    implicitClaims?: Array<string | { claim: string }>;
  }>;
  categorizedSentences?: Array<{
    category: string;
    sentence: string;
  }>;
  error?: string;
}

interface WebSearchResponse {
  urls: string[][];
  error?: string;
}

interface BatchAnalysisResult {
  claim?: string;
  url?: string;
  content?: string;
  title?: string;
  error?: string;
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Extract URL from text message
 */
function extractUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return null;
  
  try {
    new URL(urlMatch[0]);
    return urlMatch[0];
  } catch {
    return null;
  }
}

/**
 * Get remaining text after removing URL
 */
function getTextWithoutUrl(text: string, url: string | null): string {
  if (!url) return text.trim();
  return text.replace(url, '').trim();
}

/**
 * Get emoji based on trust score
 */
function getTrustEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  if (score >= 40) return '🟠';
  return '🔴';
}

/**
 * Get emoji based on verdict
 */
function getVerdictEmoji(verdict: string): string {
  const v = verdict?.toLowerCase() || '';
  if (v.includes('support') && !v.includes('partial')) return '✅';
  if (v.includes('partial')) return '🔶';
  if (v.includes('unclear')) return '❓';
  if (v.includes('contradict')) return '⚠️';
  if (v.includes('refute')) return '❌';
  return '❓';
}

/**
 * Normalize verdict to consistent format
 */
function normalizeVerdict(result: FactCheckResult): string {
  return result.verdict || result.Verdict || 'Unknown';
}

/**
 * Normalize trust score to consistent format
 */
function normalizeTrustScore(result: FactCheckResult): number {
  return result.trustScore ?? result.Trust_Score ?? result.trust_score ?? 0;
}

/**
 * Normalize reason to consistent format
 */
function normalizeReason(result: FactCheckResult): string {
  return result.reason || result.Reason || 'No analysis available';
}

/**
 * Send WhatsApp message via Twilio
 */
async function sendWhatsAppMessage(to: string, message: string): Promise<boolean> {
  if (!twilioClient) {
    console.error('Twilio client not configured');
    return false;
  }
  
  if (!TWILIO_WHATSAPP_NUMBER) {
    console.error('TWILIO_WHATSAPP_NUMBER not set');
    return false;
  }
  
  try {
    // WhatsApp has a 1600 character limit per message
    if (message.length > 1500) {
      // Split into multiple messages
      const chunks = splitMessage(message, 1500);
      for (const chunk of chunks) {
        await twilioClient.messages.create({
          body: chunk,
          from: TWILIO_WHATSAPP_NUMBER,
          to: to
        });
        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      await twilioClient.messages.create({
        body: message,
        from: TWILIO_WHATSAPP_NUMBER,
        to: to
      });
    }
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return false;
  }
}

/**
 * Split long message into chunks
 */
function splitMessage(message: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = message;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    
    // Find a good break point (newline or space)
    let breakPoint = remaining.lastIndexOf('\n', maxLength);
    if (breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakPoint < maxLength / 2) {
      breakPoint = maxLength;
    }
    
    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trim();
  }
  
  return chunks;
}

/**
 * Extract verifiable claims from reclaimify response
 */
function extractVerifiableClaims(data: ReclaimifyResponse): string[] {
  // Try verifiableClaims array first
  if (Array.isArray(data.verifiableClaims) && data.verifiableClaims.length > 0) {
    return data.verifiableClaims.filter(s => typeof s === 'string' && s.trim().length > 0);
  }
  
  // Try processedSentences
  if (Array.isArray(data.processedSentences)) {
    const claims = data.processedSentences
      .flatMap(p => {
        if (Array.isArray(p?.implicitClaims) && p.implicitClaims.length > 0) {
          return p.implicitClaims
            .map(c => typeof c === 'string' ? c : c.claim)
            .filter(s => s && s.trim().length > 0);
        }
        if (p?.finalClaim?.trim()) {
          return [p.finalClaim.trim()];
        }
        return [];
      })
      .filter(s => s.length > 0);
    
    if (claims.length > 0) return claims;
  }
  
  // Try categorizedSentences
  if (Array.isArray(data.categorizedSentences)) {
    return data.categorizedSentences
      .filter(item => item.category === 'Verifiable')
      .map(item => item.sentence);
  }
  
  return [];
}

/**
 * Format the final response message for WhatsApp
 */
function formatResponse(
  title: string | undefined,
  avgScore: number,
  verdictCounts: Record<string, number>,
  claimResults: Array<{ claim: string; verdict: string; score: number; reason: string }>
): string {
  let msg = '📊 *LUMOUS FACT CHECK RESULTS*\n';
  msg += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  if (title) {
    const truncatedTitle = title.length > 80 ? title.slice(0, 80) + '...' : title;
    msg += `📰 *Article:* ${truncatedTitle}\n\n`;
  }
  
  // Overall score
  const scoreEmoji = getTrustEmoji(avgScore);
  msg += `${scoreEmoji} *Overall Trust Score: ${avgScore.toFixed(0)}/100*\n\n`;
  
  // Verdict summary
  msg += '📈 *Verdict Summary:*\n';
  if (verdictCounts.support > 0) msg += `   ✅ Support: ${verdictCounts.support}\n`;
  if (verdictCounts.partial > 0) msg += `   🔶 Partially Support: ${verdictCounts.partial}\n`;
  if (verdictCounts.unclear > 0) msg += `   ❓ Unclear: ${verdictCounts.unclear}\n`;
  if (verdictCounts.contradict > 0) msg += `   ⚠️ Contradict: ${verdictCounts.contradict}\n`;
  if (verdictCounts.refute > 0) msg += `   ❌ Refute: ${verdictCounts.refute}\n`;
  msg += '\n';
  
  // Individual claims (show top 5)
  msg += '🔍 *Claims Analysis:*\n';
  msg += '───────────────────\n';
  
  const claimsToShow = claimResults.slice(0, 5);
  claimsToShow.forEach((cr, idx) => {
    const claimText = cr.claim.length > 100 ? cr.claim.slice(0, 100) + '...' : cr.claim;
    const verdictEmoji = getVerdictEmoji(cr.verdict);
    
    msg += `\n*${idx + 1}. ${claimText}*\n`;
    msg += `   ${verdictEmoji} ${cr.verdict} (${cr.score}/100)\n`;
    
    // Short reason (max 150 chars)
    if (cr.reason && cr.reason !== 'No analysis available') {
      const shortReason = cr.reason.length > 150 ? cr.reason.slice(0, 150) + '...' : cr.reason;
      msg += `   📝 ${shortReason}\n`;
    }
  });
  
  if (claimResults.length > 5) {
    msg += `\n_...and ${claimResults.length - 5} more claims analyzed_\n`;
  }
  
  msg += '\n━━━━━━━━━━━━━━━━━━━━━━\n';
  msg += '🌐 _Powered by Lumous_\n';
  msg += '🔗 lumous.vercel.app';
  
  return msg;
}

// =====================================================
// MAIN PROCESSING PIPELINE
// =====================================================

async function runFullPipeline(
  userMessage: string,
  senderPhone: string,
  messageSid: string
): Promise<void> {
  const logPrefix = `[${messageSid}]`;
  console.log(`${logPrefix} Starting full pipeline`);
  
  try {
    // Step 0: Send initial message
    await sendWhatsAppMessage(senderPhone, '🔍 *Analyzing your content...*\n\nThis may take 30-60 seconds. I\'ll check each claim against multiple sources.');
    
    // Step 1: Extract content from URL or use text directly
    const url = extractUrl(userMessage);
    const additionalText = getTextWithoutUrl(userMessage, url);
    
    let contentToAnalyze = '';
    let articleTitle: string | undefined;
    
    if (url) {
      console.log(`${logPrefix} Step 1: Extracting content from URL: ${url}`);
      
      try {
        const extractResponse = await fetch(`${BASE_URL}/api/extract?url=${encodeURIComponent(url)}`);
        const extractData = await extractResponse.json();
        
        if (!extractResponse.ok || extractData.error) {
          console.error(`${logPrefix} Extract failed:`, extractData.error);
          // Fall back to any text provided
          if (additionalText.length > 50) {
            contentToAnalyze = additionalText;
          } else {
            await sendWhatsAppMessage(senderPhone, '❌ Could not extract content from the URL. Please try sharing the article text directly.');
            return;
          }
        } else {
          contentToAnalyze = extractData.content || '';
          articleTitle = extractData.title;
        }
      } catch (err) {
        console.error(`${logPrefix} Extract error:`, err);
        if (additionalText.length > 50) {
          contentToAnalyze = additionalText;
        } else {
          await sendWhatsAppMessage(senderPhone, '❌ Error accessing the URL. Please try again or share the text directly.');
          return;
        }
      }
    } else {
      // No URL, use text directly
      contentToAnalyze = userMessage;
    }
    
    if (contentToAnalyze.length < 50) {
      await sendWhatsAppMessage(senderPhone, '❌ The message is too short to analyze. Please share a news article link or longer text.');
      return;
    }
    
    // Step 2: Claimify - Extract verifiable claims
    console.log(`${logPrefix} Step 2: Extracting claims via reclaimify`);
    
    let verifiableClaims: string[] = [];
    
    try {
      const reclaimifyResponse = await fetch(`${BASE_URL}/api/reclaimify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url || '',
          content: contentToAnalyze,
          title: articleTitle || ''
        })
      });
      
      const reclaimifyData: ReclaimifyResponse = await reclaimifyResponse.json();
      
      if (reclaimifyData.error) {
        console.error(`${logPrefix} Reclaimify error:`, reclaimifyData.error);
      } else {
        verifiableClaims = extractVerifiableClaims(reclaimifyData);
        if (!articleTitle && reclaimifyData.title) {
          articleTitle = reclaimifyData.title;
        }
      }
    } catch (err) {
      console.error(`${logPrefix} Reclaimify fetch error:`, err);
    }
    
    if (verifiableClaims.length === 0) {
      await sendWhatsAppMessage(senderPhone, '❌ Could not extract any verifiable claims from this content. Try sharing a different article.');
      return;
    }
    
    console.log(`${logPrefix} Found ${verifiableClaims.length} verifiable claims`);
    
    // Limit to 10 claims for WhatsApp (speed + message length)
    const claimsToProcess = verifiableClaims.slice(0, 10);
    const searchDate = new Date().toISOString().split('T')[0];
    const claimsData = claimsToProcess.map(claim => ({ claim, search_date: searchDate }));
    
    // Step 3: Web Search - Find sources for each claim
    console.log(`${logPrefix} Step 3: Web search for ${claimsToProcess.length} claims`);
    
    let urlsPerClaim: string[][] = [];
    
    try {
      const webSearchResponse = await fetch(`${BASE_URL}/api/websearch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claims: claimsData,
          search_date: searchDate,
          originalUrl: url || ''
        })
      });
      
      const webSearchData: WebSearchResponse = await webSearchResponse.json();
      
      if (webSearchData.error) {
        console.error(`${logPrefix} WebSearch error:`, webSearchData.error);
      } else {
        urlsPerClaim = webSearchData.urls || [];
      }
    } catch (err) {
      console.error(`${logPrefix} WebSearch fetch error:`, err);
    }
    
    // Step 4: Batch Analysis - Extract content from search results
    console.log(`${logPrefix} Step 4: Batch analysis`);
    
    // Flatten URLs and map to claims
    const flattenedUrls: string[] = [];
    const claimsOnePerUrl: string[] = [];
    
    urlsPerClaim.forEach((urls, claimIndex) => {
      (urls || []).forEach(sourceUrl => {
        if (typeof sourceUrl === 'string' && sourceUrl.trim()) {
          flattenedUrls.push(sourceUrl.trim());
          claimsOnePerUrl.push(claimsToProcess[claimIndex] || '');
        }
      });
    });
    
    let batchResults: BatchAnalysisResult[] = [];
    
    if (flattenedUrls.length > 0) {
      try {
        const batchResponse = await fetch(`${BASE_URL}/api/analyze/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: flattenedUrls.slice(0, 30), // Limit for speed
            claims: claimsOnePerUrl.slice(0, 30)
          })
        });
        
        const batchData = await batchResponse.json();
        batchResults = Array.isArray(batchData?.results) ? batchData.results : [];
      } catch (err) {
        console.error(`${logPrefix} Batch analysis error:`, err);
      }
    }
    
    // Group content by claim
    const contentsByClaim: Record<string, string[]> = {};
    batchResults.forEach(result => {
      const claimKey = (result?.claim || '').trim();
      const content = (result?.content || '').trim();
      if (claimKey && content) {
        if (!contentsByClaim[claimKey]) contentsByClaim[claimKey] = [];
        contentsByClaim[claimKey].push(content);
      }
    });
    
    // Step 5: Fact Check - Verify each claim
    console.log(`${logPrefix} Step 5: Fact checking`);
    
    const factCheckClaims = Object.entries(contentsByClaim).map(([claim, contents]) => ({
      claim,
      content: contents.length === 1 ? contents[0] : contents
    }));
    
    // If no content was found, fall back to checking claims without external sources
    if (factCheckClaims.length === 0) {
      claimsToProcess.forEach(claim => {
        factCheckClaims.push({ claim, content: claim });
      });
    }
    
    const factCheckResults: FactCheckResult[] = [];
    
    // Process fact checks (in batches of 3 for speed)
    const batchSize = 3;
    for (let i = 0; i < factCheckClaims.length; i += batchSize) {
      const batch = factCheckClaims.slice(i, i + batchSize);
      
      const promises = batch.map(async (claimData) => {
        try {
          const response = await fetch(`${BASE_URL}/api/factCheck`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claims: [claimData] })
          });
          
          const data = await response.json();
          if (data.results && data.results.length > 0) {
            return data.results[0] as FactCheckResult;
          }
        } catch (err) {
          console.error(`${logPrefix} Fact check error for claim:`, err);
        }
        return null;
      });
      
      const results = await Promise.all(promises);
      results.forEach(r => { if (r) factCheckResults.push(r); });
    }
    
    if (factCheckResults.length === 0) {
      await sendWhatsAppMessage(senderPhone, '❌ Could not complete fact checking. Please try again later.');
      return;
    }
    
    // Step 6: Calculate metrics and format response
    console.log(`${logPrefix} Step 6: Formatting response`);
    
    const verdictCounts = { support: 0, partial: 0, unclear: 0, contradict: 0, refute: 0 };
    const claimResultsFormatted: Array<{ claim: string; verdict: string; score: number; reason: string }> = [];
    let totalScore = 0;
    
    factCheckResults.forEach(fc => {
      const verdict = normalizeVerdict(fc);
      const score = normalizeTrustScore(fc);
      const reason = normalizeReason(fc);
      
      totalScore += score;
      
      const v = verdict.toLowerCase();
      if (v.includes('support') && !v.includes('partial')) verdictCounts.support++;
      else if (v.includes('partial')) verdictCounts.partial++;
      else if (v.includes('unclear')) verdictCounts.unclear++;
      else if (v.includes('contradict')) verdictCounts.contradict++;
      else if (v.includes('refute')) verdictCounts.refute++;
      
      claimResultsFormatted.push({
        claim: fc.claim || 'Unknown claim',
        verdict,
        score,
        reason
      });
    });
    
    const avgScore = factCheckResults.length > 0 ? totalScore / factCheckResults.length : 0;
    
    // Format and send response
    const responseMessage = formatResponse(articleTitle, avgScore, verdictCounts, claimResultsFormatted);
    await sendWhatsAppMessage(senderPhone, responseMessage);
    
    console.log(`${logPrefix} Pipeline complete. Sent results for ${factCheckResults.length} claims.`);
    
  } catch (error) {
    console.error(`${logPrefix} Pipeline error:`, error);
    await sendWhatsAppMessage(senderPhone, '❌ An error occurred while processing your request. Please try again.');
  }
}

// =====================================================
// WEBHOOK HANDLERS
// =====================================================

/**
 * POST handler for Twilio WhatsApp webhook
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    
    const body = formData.get('Body') as string | null;
    const from = formData.get('From') as string | null;
    const messageSid = formData.get('MessageSid') as string | null;
    
    console.log(`[WhatsApp] Received: SID=${messageSid}, From=${from}, Body=${body?.slice(0, 100)}...`);
    
    if (!body || !from || !messageSid) {
      console.error('[WhatsApp] Missing required fields');
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }
    
    // Run pipeline asynchronously (don't await - Twilio has 15s timeout)
    runFullPipeline(body, from, messageSid).catch(err => {
      console.error(`[${messageSid}] Background error:`, err);
    });
    
    // Return empty TwiML immediately
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
    
  } catch (error) {
    console.error('[WhatsApp] Webhook error:', error);
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}

/**
 * GET handler for webhook verification (optional)
 */
export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    message: 'Lumous WhatsApp Bot webhook is active',
    timestamp: new Date().toISOString()
  });
}
