import { NextResponse } from 'next/server';
import axios from 'axios';

interface SerperNewsResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
  source: string;
  imageUrl?: string;
  [key: string]: unknown;
}

interface SerperResponse {
  news: SerperNewsResult[];
  [key: string]: unknown;
}

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
  searchParams?: {
    num?: number;        // Number of results (1-10)
    lr?: string;         // Language restriction (e.g., 'lang_en')
    cr?: string;         // Country restriction (e.g., 'countryIN')
    dateRestrict?: string; // Date restriction (e.g., 'y1' for last year)
    location?: string;   // Location for Serper API (e.g., 'Chhattisgarh, India')
  };
}

// Google CSE API response types
interface GoogleCSEItem {
  link?: string;
  title?: string;
  snippet?: string;
  [key: string]: unknown;
}


// Map Google CSE date restrictions to Serper's time-based search (tbs) format
function mapDateRestrictToTbs(dateRestrict?: string): string {
  if (!dateRestrict) return 'qdr:y1'; // Default to 1 year
  
  const match = dateRestrict.match(/^(\d+)([dmy])/);
  if (!match) return 'qdr:y1';
  
  const [, num, unit] = match;
  const unitMap: Record<string, string> = {
    'd': 'd',
    'm': 'm',
    'y': 'y'
  };
  
  return `qdr:${unitMap[unit] || 'y'}${num}`;
}

// --- Serper News API Search ---
async function searchSerperNews(query: string, searchParams: WebSearchRequest['searchParams'] = {}): Promise<string[]> {
  console.log('📰 Falling back to Serper News API for query:', query);
  try {
    const tbs = mapDateRestrictToTbs(searchParams?.dateRestrict);
    const country = searchParams?.cr?.replace('country', '').toLowerCase() || 'in';
    const language = searchParams?.lr?.replace('lang_', '') || 'en';
    
    const response = await axios.post<SerperResponse>(
      'https://google.serper.dev/news',
      {
        q: query,
        gl: country,
        hl: language,
        tbs: tbs,
        location: searchParams?.location || undefined,
      },
      {
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY || '',
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      }
    );

    if (!response.data?.news?.length) {
      console.log('❌ Serper News API returned no results for query:', query);
      return [];
    }

    // Filter and process results
    const results = response.data.news
      .map(item => item.link)
      .filter((link): link is string => !!link)
      .filter(link => !isPdfUrl(link));

    console.log(`✅ Serper News API returned ${results.length} results for "${query}":`, results);
    return results.slice(0, 5); // Return max 5 results
  } catch (error) {
    console.error('Error in Serper News API:', error);
    throw error; // Re-throw to be handled by the caller
  }
}

// --- GOOGLE Programmable Search Engine Search ---
async function googleSearch(
  query: string, 
  originalUrl?: string, 
  searchParams: WebSearchRequest['searchParams'] = {}
): Promise<string[]> {
  console.log('🔍 Using Google Custom Search API for query:', query);
  try {
    // Remove trailing ISO date from query as it might be too restrictive
    const cleanQuery = query.replace(/\d{4}-\d{2}-\d{2}$/, '').trim();
    
    
    // Build search parameters with defaults
    const params = new URLSearchParams({
      q: cleanQuery,
      key: process.env.GOOGLE_CSE_API_KEY || '',
      cx: process.env.GOOGLE_CSE_CX || '',
      num: (searchParams.num || 5).toString(),
      lr: searchParams.lr || 'lang_en',
      cr: searchParams.cr || 'countryIN',
      safe: 'active',
      dateRestrict: searchParams.dateRestrict || 'y1'  // Default: search within the last year
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

    console.log(`✅ Google CSE returned ${results.length} results for "${cleanQuery}":`, results);
    return results;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Google CSE failed, falling back to Serper News API:", errorMessage);
    
    // Fallback to Serper News API
    try {
      const newsResults = await searchSerperNews(query, searchParams);
      return newsResults;
    } catch (serperError) {
      console.error("Serper News API also failed:", serperError);
      return [];
    }
  }
}


export async function POST(request: Request) {
  try {
    const requestBody = await request.json() as WebSearchRequest;
    const { claims, originalUrl } = requestBody;

    if (!claims?.length) {
      return NextResponse.json({ error: 'No claims provided' }, { status: 400 });
    }

    // Sanitize claim text (remove placeholders like [Date])
    const sanitizeClaimQuery = (text: string): string => {
      return text
        .replace(/\[[^\]]+\]/g, ' ') // remove [Placeholders]
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    };

    const searchPromises = claims.map(async (claim) => {
      const base = sanitizeClaimQuery(claim.claim || '');
      const searchQuery = `${base} ${claim.search_date || ''}`.trim();

      let urls: string[] = [];
      let source = 'none';

      // 1️⃣ TRY GOOGLE SEARCH
      try {
        urls = await googleSearch(searchQuery, originalUrl, requestBody.searchParams);
        if (urls.length > 0) {
          console.log(`Google search successful for query: ${searchQuery}`);
          source = 'google';
        } else {
          console.log(`Google returned no results for query: ${searchQuery}`);
        }
      } catch (error) {
        console.error('Google search failed:', error);
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
