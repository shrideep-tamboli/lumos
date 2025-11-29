import { NextResponse } from 'next/server';
import { tavily } from '@tavily/core';

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

// Helper function to check if a URL points to a PDF
function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith('.pdf') || 
         url.toLowerCase().includes('.pdf?') ||
         url.toLowerCase().includes('/pdf/');
}

// Helper function to filter out PDF URLs from an array of URLs
function filterPdfUrls(urls: string[]): string[] {
  return urls.filter(url => !isPdfUrl(url));
}

interface Claim {
  claim: string;
  search_date: string;
}

interface WebSearchRequest {
  claims: Claim[];
  search_date: string;
  originalUrl?: string;
}

// Google CSE API response types
interface GoogleCSEItem {
  link?: string;
  title?: string;
  snippet?: string;
  [key: string]: unknown;
}

// DuckDuckGo result type
interface DDGOrganicResult {
  link?: string;
  [key: string]: unknown;
}

// --- GOOGLE Programmable Search Engine Search ---
async function googleSearch(query: string, originalUrl?: string): Promise<string[]> {
  try {
    // Remove date from query as it might be too restrictive
    const cleanQuery = query.replace(/\d{4}-\d{2}-\d{2}$/, '').trim();
    
    // Build search parameters
    const params = new URLSearchParams({
      q: cleanQuery,
      key: process.env.GOOGLE_CSE_API_KEY || '',
      cx: process.env.GOOGLE_CSE_CX || '',
      num: '5',
      lr: 'lang_en',
      cr: 'countryIN',
      safe: 'active',
      dateRestrict: 'y1'  // Search within the last year
    });

    const url = `https://www.googleapis.com/customsearch/v1?${params}`;

    const response = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(12000),
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Google CSE API Error:', response.status, errorData);
      return [];
    }

    const data = await response.json();

    if (!data.items?.length) {
      console.log('Google CSE returned no items for query:', cleanQuery);
      return [];
    }

    const results = filterPdfUrls(
      (data.items || [])
        .filter((item: GoogleCSEItem) => item.link && !item.link.includes('google.com'))
        .map((item: GoogleCSEItem) => item.link as string)
        .filter((url: string) => {
          try {
            const urlObj = new URL(url);
            return !originalUrl || urlObj.hostname !== new URL(originalUrl).hostname;
          } catch {
            return false; // Skip invalid URLs
          }
        })
    ).slice(0, 3);

    console.log(`Google CSE results for "${cleanQuery}":`, results);
    return results;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Google CSE failed:", errorMessage);
    return [];
  }
}

// --- FALLBACK: Tavily ---
async function tavilySearch(query: string, originalUrl?: string): Promise<string[]> {
  try {
    const tavilyResponse = await tvly.search(query, {
      include_answer: false,
      include_raw_content: false,
      include_domains: [],
      exclude_domains: originalUrl ? [new URL(originalUrl).hostname] : [],
      max_results: 3
    });

    return filterPdfUrls(
      (tavilyResponse.results || [])
        .map(r => r.url)
        .filter((u: string | undefined): u is string => !!u)
    );
  } catch (err) {
    console.error("Tavily failed:", err);
    return [];
  }
}

// --- FINAL FALLBACK: DuckDuckGo via SerpAPI ---
async function duckduckgoSearch(query: string, originalUrl?: string): Promise<string[]> {
  try {
    const ddgResponse = await fetch(
      `https://serpapi.com/search?engine=duckduckgo&q=${encodeURIComponent(query)}&kl=us-en&api_key=${process.env.SERPAPI_KEY}`,
      {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!ddgResponse.ok) return [];

    const ddgData = await ddgResponse.json();

    return filterPdfUrls(
      (ddgData.organic_results || [])
        .map((r: DDGOrganicResult) => r.link)
        .filter((u?: string): u is string => !!u)
        .filter((u: string) => !originalUrl || new URL(u).hostname !== new URL(originalUrl).hostname)
    ).slice(0, 3);
  } catch (error) {
    console.error("DuckDuckGo fallback failed:", error);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { claims, originalUrl } = await request.json() as WebSearchRequest;

    if (!claims?.length) {
      return NextResponse.json({ error: 'No claims provided' }, { status: 400 });
    }

    const searchPromises = claims.map(async (claim) => {
      const searchQuery = `${claim.claim} ${claim.search_date || ''}`.trim();

      let urls: string[] = [];
      let source = 'none';

      // 1️⃣ TRY GOOGLE FIRST
      try {
        urls = await googleSearch(searchQuery, originalUrl);
        if (urls.length > 0) {
          console.log(`Google search successful for query: ${searchQuery}`);
          source = 'google';
          return { urls, source };
        }
        console.log(`Google returned no results for query: ${searchQuery}`);
      } catch (error) {
        console.error('Google search failed, falling back to Tavily:', error);
      }

      // 2️⃣ FALLBACK → TAVILY
      try {
        const tavilyUrls = await tavilySearch(searchQuery, originalUrl);
        if (tavilyUrls.length > 0) {
          console.log(`Tavily search successful for query: ${searchQuery}`);
          urls = tavilyUrls;
          source = 'tavily';
        } else {
          console.log(`Tavily returned no results for query: ${searchQuery}`);
        }
      } catch (error) {
        console.error('Tavily search failed, falling back to DuckDuckGo:', error);
      }

      // 3️⃣ FINAL FALLBACK → DUCKDUCKGO (only if we don't have enough results)
      if (urls.length < 3) {
        try {
          const ddgUrls = await duckduckgoSearch(searchQuery, originalUrl);
          console.log(`DuckDuckGo returned ${ddgUrls.length} results for query: ${searchQuery}`);
          
          for (const u of ddgUrls) {
            if (urls.length >= 3) break;
            if (!urls.includes(u)) urls.push(u);
          }
          
          if (urls.length > 0 && source === 'none') {
            source = 'duckduckgo';
          }
        } catch (error) {
          console.error('DuckDuckGo search failed:', error);
        }
      }

      return { urls, source };
    });

    const results = await Promise.all(searchPromises);

    const urlsPerClaim = results.map(r => r.urls);
    const sources = results.map(r => r.source);

    const successful = urlsPerClaim.filter(u => u.length > 0).length;

    const errors = claims.map((claim, index) => ({
      claim: claim.claim,
      stage: 'search',
      source: sources[index],
      error: urlsPerClaim[index].length === 0 ? `No results found (tried: ${sources[index]})` : ''
    })).filter(e => e.error);

    return NextResponse.json({
      urls: urlsPerClaim,
      metrics: {
        totalSearches: claims.length,
        successfulSearches: successful,
        failedSearches: claims.length - successful,
        sources: sources.reduce((acc, src) => {
          acc[src] = (acc[src] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        errors
      }
    });

  } catch (error) {
    console.error("Web search error:", error);
    return NextResponse.json({ error: "Web search failed" }, { status: 500 });
  }
}
