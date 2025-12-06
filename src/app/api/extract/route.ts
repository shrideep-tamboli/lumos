import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { extract } from '@extractus/article-extractor';
import { getSubtitles } from 'youtube-caption-extractor';

const SUPADATA_API_BASE_URL = 'https://api.supadata.ai/v1';
const SUPADATA_POLL_INTERVAL_MS = 2000;
const SUPADATA_MAX_POLL_ATTEMPTS = 5;

// Supadata API types
type SupadataTranscriptChunk = {
  text: string;
  offset: number;
  duration: number;
  lang: string;
};

type SupadataTranscriptResponse = {
  content: string | SupadataTranscriptChunk[];
  lang: string;
  availableLangs: string[];
  jobId?: string;
};

type SupadataJobResponse = {
  jobId: string;
};

type SupadataJobStatus = {
  status: 'queued' | 'active' | 'completed' | 'failed';
  content?: string | SupadataTranscriptChunk[];
  lang?: string;
  availableLangs?: string[];
  error?: string;
};

// Supadata Metadata API types
type SupadataMetadataResponse = {
  platform: string;
  type: string;
  title: string | null;
  description: string | null;
  author: {
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  stats: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
  media: Array<{
    type: string;
    url: string;
    thumbnail: string | null;
  }>;
  publishedAt: string | null;
  url: string;
};

// --- Helper: Clean extracted text ---
function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ') // Remove HTML tags
    .replace(/\s+/g, ' ')     // Collapse whitespace
    .trim();
}

/**
 * Extract video ID from various YouTube URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Check if URL is a valid YouTube URL
 */
function isYouTubeUrl(url: string): boolean {
  const youtubePattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/;
  return youtubePattern.test(url.trim()) || /^[a-zA-Z0-9_-]{11}$/.test(url.trim());
}

/**
 * Check if URL is an Instagram post (reel/photo/video)
 */
function isInstagramPostUrl(url: string): boolean {
  const instagramPattern = /^(https?:\/\/)?(www\.)?(instagram\.com|instagr\.am)\/(p|reel|tv)\//i;
  return instagramPattern.test(url.trim());
}

/**
 * Check if URL is an X (Twitter) post
 */
function isXPostUrl(url: string): boolean {
  const xPattern = /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;
  return xPattern.test(url.trim());
}

/**
 * Check if URL is any X.com/Twitter URL (but not a direct post)
 * These URLs (trending, search, profiles) require JavaScript and won't work with our extractors
 */
function isUnsupportedXUrl(url: string): boolean {
  const xDomainPattern = /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\//i;
  // It's an X URL but NOT a direct post URL
  return xDomainPattern.test(url.trim()) && !isXPostUrl(url);
}

/**
 * Check if URL is any Instagram URL (but not a direct post)
 * These URLs (profiles, explore, stories) require JavaScript and won't work
 */
function isUnsupportedInstagramUrl(url: string): boolean {
  const instagramDomainPattern = /^(https?:\/\/)?(www\.)?(instagram\.com|instagr\.am)\//i;
  return instagramDomainPattern.test(url.trim()) && !isInstagramPostUrl(url);
}

/**
 * Poll Supadata transcript job status
 */
async function pollSupadataJob(jobId: string, apiKey: string): Promise<SupadataTranscriptResponse> {
  for (let attempt = 0; attempt < SUPADATA_MAX_POLL_ATTEMPTS; attempt++) {
    const jobResponse = await axios.get<SupadataJobStatus>(`${SUPADATA_API_BASE_URL}/transcript/${jobId}`, {
      headers: {
        'x-api-key': apiKey,
      },
    });

    const jobData = jobResponse.data;
    if (jobData?.status === 'completed' && jobData.content) {
      return {
        content: jobData.content,
        lang: jobData.lang || 'en',
        availableLangs: jobData.availableLangs || [],
      };
    }

    if (jobData?.status === 'failed') {
      throw new Error(jobData?.error || 'Supadata transcript job failed');
    }

    // Wait before next poll if not completed yet
    await new Promise((resolve) => setTimeout(resolve, SUPADATA_POLL_INTERVAL_MS));
  }

  throw new Error('Supadata transcript is still processing. Please try again later.');
}

/**
 * Fetch metadata from Supadata (includes caption for Instagram/X posts)
 * Returns null on errors (including rate limits) so we can fall back gracefully
 */
async function fetchSupadataMetadata(url: string, apiKey: string, retryCount = 0): Promise<SupadataMetadataResponse | null> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 3000;
  
  try {
    console.log(`Fetching Supadata metadata for: ${url} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    const response = await axios.get<SupadataMetadataResponse>(`${SUPADATA_API_BASE_URL}/metadata`, {
      params: { url },
      headers: { 'x-api-key': apiKey },
      timeout: 30000,
    });
    console.log('Supadata metadata response status:', response.status);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      console.error('Supadata metadata API rate limit exceeded (429)');
      
      // Retry on rate limit if we haven't exhausted retries
      if (retryCount < MAX_RETRIES) {
        console.log(`Metadata rate limited. Waiting ${RETRY_DELAY_MS}ms before retry ${retryCount + 2}...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        return fetchSupadataMetadata(url, apiKey, retryCount + 1);
      }
      
      console.error('Supadata metadata API rate limit exceeded (429) - all retries exhausted');
      return null;
    }
    console.error('Error fetching Supadata metadata:', error);
    return null;
  }
}

/**
 * Fetch transcript from Supadata (for videos/reels) with retry logic
 */
async function fetchSupadataTranscript(url: string, apiKey: string, retryCount = 0): Promise<string | null> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 3000; // 3 seconds between retries
  
  try {
    console.log(`Fetching Supadata transcript for: ${url} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    console.log('Using API key (first 10 chars):', apiKey?.substring(0, 10) + '...');
    
    const response = await axios.get<SupadataTranscriptResponse | SupadataJobResponse>(`${SUPADATA_API_BASE_URL}/transcript`, {
      params: {
        url,
        text: true,
        mode: 'auto',
      },
      headers: { 'x-api-key': apiKey },
      timeout: 60000,
    });

    console.log('Supadata transcript response status:', response.status);
    console.log('Supadata transcript response data:', JSON.stringify(response.data).substring(0, 500));

    let responseData = response.data;

    // If we got a job ID, poll for the result
    if ('jobId' in responseData && responseData.jobId) {
      console.log('Got job ID, polling for result:', responseData.jobId);
      responseData = await pollSupadataJob(responseData.jobId, apiKey);
    }

    if (!('content' in responseData)) {
      console.log('No content field in response');
      return null;
    }

    const finalResponse = responseData as SupadataTranscriptResponse;
    const transcriptContent = typeof finalResponse.content === 'string'
      ? finalResponse.content
      : Array.isArray(finalResponse.content)
        ? finalResponse.content.map((item: SupadataTranscriptChunk) => item.text).join(' ')
        : null;

    console.log('Transcript content length:', transcriptContent?.length || 0);
    return transcriptContent?.trim() || null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Supadata transcript API error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      
      // Retry on rate limit if we haven't exhausted retries
      if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
        console.log(`Rate limited. Waiting ${RETRY_DELAY_MS}ms before retry ${retryCount + 2}...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        return fetchSupadataTranscript(url, apiKey, retryCount + 1);
      }
      
      if (error.response?.status === 429) {
        console.error('Supadata transcript API rate limit exceeded (429) - all retries exhausted');
      }
    } else {
      console.error('Error fetching Supadata transcript:', error);
    }
    return null;
  }
}

/**
 * Extract content using Supadata for Instagram or X URLs
 * For Instagram posts/reels with video: prioritize transcript, fallback to caption
 * For Instagram posts without video: use caption
 * For X/Twitter: use caption + transcript if available
 */
async function extractSupadataContent(url: string): Promise<{
  content: string;
  title?: string;
  excerpt?: string;
  source: 'supadata' | 'supadata-transcript';
  author?: string;
  platform?: string;
}> {
  const apiKey = process.env.SUPADATA_API_KEY;

  if (!apiKey) {
    throw new Error('Supadata API key is not configured. Please set SUPADATA_API_KEY.');
  }

  console.log('Starting parallel fetch for metadata and transcript...');
  
  // Use Promise.allSettled so one failure doesn't block the other
  // This way we can still use transcript even if metadata rate-limits
  const [metadataResult, transcriptResult] = await Promise.allSettled([
    fetchSupadataMetadata(url, apiKey),
    fetchSupadataTranscript(url, apiKey),
  ]);

  const metadata = metadataResult.status === 'fulfilled' ? metadataResult.value : null;
  const transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;

  if (metadataResult.status === 'rejected') {
    console.log('Metadata fetch failed:', metadataResult.reason?.message || 'Unknown error');
  }
  if (transcriptResult.status === 'rejected') {
    console.log('Transcript fetch failed:', transcriptResult.reason?.message || 'Unknown error');
  }

  console.log('Parallel fetch complete:');
  console.log('  - metadata:', metadata ? 'received' : 'null/failed');
  console.log('  - transcript:', transcript ? `received (${transcript.length} chars)` : 'null/failed');

  console.log('Supadata fetch results:', {
    url,
    hasMetadata: !!metadata,
    hasTranscript: !!transcript,
    transcriptLength: transcript?.length || 0,
    metadataType: metadata?.type,
    mediaTypes: Array.isArray(metadata?.media) ? metadata.media.map(m => m.type) : 'N/A',
  });

  // Build content based on what we got
  const contentParts: string[] = [];
  let title = 'Social Media Post';
  let excerpt = '';
  let author = '';
  let platform = '';

  if (metadata) {
    platform = metadata.platform || '';
    author = metadata.author?.displayName || metadata.author?.username || '';
    
    // Caption is in title or description field
    const caption = metadata.title || metadata.description || '';

    // Check if this post has video content (either from media array or if we got a transcript)
    const hasVideoContent = transcript && transcript.trim().length > 0;

    if (hasVideoContent) {
      // For posts with video/transcript: prioritize transcript
      contentParts.push(`Transcript: ${transcript}`);
      title = `Video Transcript`;
      excerpt = `Video transcript: ${transcript.substring(0, 150)}...`;
      
      // Add caption as additional context if available
      if (caption) {
        contentParts.push(`Caption: ${caption}`);
      }
      console.log('Using transcript as primary content');
    } else if (caption) {
      // For posts without transcript: use caption
      contentParts.push(`Caption: ${caption}`);
      title = caption.substring(0, 100) + (caption.length > 100 ? '...' : '');
      excerpt = caption.substring(0, 200);
      console.log('Using caption as primary content (no transcript available)');
    }

    if (author) {
      excerpt = `@${metadata.author?.username || author}: ${excerpt}`;
    }
  } else if (transcript) {
    // No metadata but have transcript (edge case)
    contentParts.push(`Transcript: ${transcript}`);
    title = 'Video Transcript';
    excerpt = `Video transcript: ${transcript.substring(0, 150)}...`;
    console.log('Using transcript only (no metadata)');
  }

  // If we have no content at all, throw error
  if (contentParts.length === 0) {
    throw new Error('Could not extract any content (caption or transcript) from this post. The post may be private or unavailable.');
  }

  const finalContent = contentParts.join('\n\n');
  
  console.log(`\n========== FINAL CONTENT BEING RETURNED ==========`);
  console.log(`Has transcript: ${!!transcript}`);
  console.log(`Has metadata: ${!!metadata}`);
  console.log(`Content parts count: ${contentParts.length}`);
  console.log(`Content preview (first 500 chars): ${finalContent.substring(0, 500)}`);
  console.log(`=================================================\n`);

  return {
    content: finalContent,
    title,
    excerpt,
    source: transcript ? 'supadata-transcript' : 'supadata',
    author,
    platform,
  };
}

/**
 * Extract transcript from YouTube video
 */
async function extractYouTubeTranscript(url: string): Promise<{
  content: string;
  title?: string;
  excerpt?: string;
  source: 'youtube-transcript';
}> {
  // Extract video ID
  const videoId = extractVideoId(url.trim());
  
  if (!videoId) {
    throw new Error('Could not extract video ID from URL');
  }

  console.log('Extracting transcript for YouTube video:', videoId);

  // Fetch transcript using youtube-caption-extractor
  // Prioritize English, Hindi, and Indian regional languages
  const languagesToTry = [
    'en',  // English
    'hi',  // Hindi
    'ta',  // Tamil
    'te',  // Telugu
    'kn',  // Kannada
    'ml',  // Malayalam
    'bn',  // Bengali
    'gu',  // Gujarati
    'mr',  // Marathi
    'pa',  // Punjabi
    'ur',  // Urdu
    'or',  // Odia
    'as',  // Assamese
    'es',  // Spanish (fallback)
    'fr',  // French (fallback)
    'de',  // German (fallback)
  ];
  let transcriptItems: Array<{ text: string; start: string; dur: string }> | null = null;
  let lastError: Error | null = null;

  // First, try without specifying language (auto-detect - most reliable)
  try {
    console.log('Trying to fetch transcript without language parameter (auto-detect)');
    transcriptItems = await getSubtitles({ 
      videoID: videoId 
    });
    console.log(`Successfully fetched transcript with auto-detect, got ${transcriptItems.length} segments`);
  } catch (autoError) {
    console.log('Failed to fetch transcript with auto-detect, trying specific languages:', autoError);
    lastError = autoError instanceof Error ? autoError : new Error(String(autoError));
    
    // If auto-detect fails, try specific languages in priority order
    for (const lang of languagesToTry) {
      try {
        console.log(`Trying to fetch transcript with language: ${lang}`);
        transcriptItems = await getSubtitles({ 
          videoID: videoId, 
          lang: lang 
        });
        console.log(`Successfully fetched transcript with language: ${lang}, got ${transcriptItems.length} segments`);
        break; // Success, exit loop
      } catch (langError) {
        console.log(`Failed to fetch with language ${lang}:`, langError);
        lastError = langError instanceof Error ? langError : new Error(String(langError));
        continue; // Try next language
      }
    }
  }

  if (!transcriptItems || transcriptItems.length === 0) {
    const errorMessage = lastError 
      ? `No transcript available for this video. Error: ${lastError.message}`
      : 'No transcript available for this video. The video may not have captions enabled.';
    throw new Error(errorMessage);
  }

  // Combine all transcript items into a single text
  const transcriptText = transcriptItems
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    content: transcriptText,
    title: `YouTube Video: ${videoId}`,
    excerpt: `Video transcript with ${transcriptItems.length} segments`,
    source: 'youtube-transcript',
  };
}

// --- Helper: Extract article text ---
async function extractArticleText(url: string): Promise<{
  content: string;
  title?: string;
  excerpt?: string;
  source: 'article-extractor' | 'fallback';
}> {
  try {
    // First try with article-extractor
    const article = await extract(url);
    if (article?.content) {
      return {
        content: cleanText(article.content),
        title: article.title,
        excerpt: article.description,
        source: 'article-extractor',
      };
    }
  } catch (error) {
    console.error('Error with article-extractor:', error);
  }

  // Fallback to cheerio for basic extraction
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    
    // Try to get main content
    let content = '';
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.post-content',
      '.article-content',
      '.entry-content',
      'body',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        content = element.text();
        if (content.length > 100) break; // Found substantial content
      }
    }

    return {
      content: cleanText(content || response.data),
      title: $('title').first().text().trim(),
      excerpt: $('meta[property="og:description"]').attr('content') || 
               $('meta[name="description"]').attr('content') ||
               $('p').first().text().substring(0, 200) + '...',
      source: 'fallback',
    };
  } catch (error) {
    console.error('Error with fallback extraction:', error);
    throw new Error('Failed to extract content from the provided URL');
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'URL parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Check for unsupported X/Twitter URLs (trending, search, profiles)
    if (isUnsupportedXUrl(url)) {
      return NextResponse.json(
        { 
          error: 'Unsupported X/Twitter URL', 
          details: 'Only direct post URLs are supported (e.g., x.com/username/status/123456789). Trending pages, search results, and profile pages cannot be extracted. Please copy the URL of a specific post/tweet.' 
        },
        { status: 400 }
      );
    }

    // Check for unsupported Instagram URLs (profiles, explore, stories)
    if (isUnsupportedInstagramUrl(url)) {
      return NextResponse.json(
        { 
          error: 'Unsupported Instagram URL', 
          details: 'Only direct post URLs are supported (e.g., instagram.com/p/ABC123 or instagram.com/reel/ABC123). Profile pages, stories, and explore pages cannot be extracted. Please copy the URL of a specific post.' 
        },
        { status: 400 }
      );
    }

    let extractedData;
    
    // Check if it's a YouTube URL
    if (isYouTubeUrl(url)) {
      extractedData = await extractYouTubeTranscript(url);
    } else if (isInstagramPostUrl(url) || isXPostUrl(url)) {
      extractedData = await extractSupadataContent(url);
    } else {
      extractedData = await extractArticleText(url);
    }
    
    return NextResponse.json({
      url,
      ...extractedData,
      extractedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error extracting content from URL:', error);
    return NextResponse.json(
      { 
        error: 'Failed to extract content from the URL', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required in the request body' },
        { status: 400 }
      );
    }

    // Check for unsupported X/Twitter URLs (trending, search, profiles)
    if (isUnsupportedXUrl(url)) {
      return NextResponse.json(
        { 
          error: 'Unsupported X/Twitter URL', 
          details: 'Only direct post URLs are supported (e.g., x.com/username/status/123456789). Trending pages, search results, and profile pages cannot be extracted. Please copy the URL of a specific post/tweet.' 
        },
        { status: 400 }
      );
    }

    // Check for unsupported Instagram URLs (profiles, explore, stories)
    if (isUnsupportedInstagramUrl(url)) {
      return NextResponse.json(
        { 
          error: 'Unsupported Instagram URL', 
          details: 'Only direct post URLs are supported (e.g., instagram.com/p/ABC123 or instagram.com/reel/ABC123). Profile pages, stories, and explore pages cannot be extracted. Please copy the URL of a specific post.' 
        },
        { status: 400 }
      );
    }

    let extractedData;
    
    // Check if it's a YouTube URL
    if (isYouTubeUrl(url)) {
      extractedData = await extractYouTubeTranscript(url);
    } else if (isInstagramPostUrl(url) || isXPostUrl(url)) {
      extractedData = await extractSupadataContent(url);
    } else {
      extractedData = await extractArticleText(url);
    }
    
    return NextResponse.json({
      url,
      ...extractedData,
      extractedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in POST /api/extract:', error);
    return NextResponse.json(
      { 
        error: 'Failed to extract content from the URL', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

