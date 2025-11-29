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
 */
async function fetchSupadataMetadata(url: string, apiKey: string): Promise<SupadataMetadataResponse | null> {
  try {
    const response = await axios.get<SupadataMetadataResponse>(`${SUPADATA_API_BASE_URL}/metadata`, {
      params: { url },
      headers: { 'x-api-key': apiKey },
      timeout: 30000,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      console.error('Supadata metadata API rate limit exceeded (429)');
      throw new Error('Rate limit exceeded. Please try again in a few minutes.');
    }
    console.error('Error fetching Supadata metadata:', error);
    return null;
  }
}

/**
 * Fetch transcript from Supadata (for videos/reels)
 */
async function fetchSupadataTranscript(url: string, apiKey: string): Promise<string | null> {
  try {
    const response = await axios.get<SupadataTranscriptResponse | SupadataJobResponse>(`${SUPADATA_API_BASE_URL}/transcript`, {
      params: {
        url,
        text: true,
        mode: 'auto',
      },
      headers: { 'x-api-key': apiKey },
      timeout: 60000,
    });

    let responseData = response.data;

    // If we got a job ID, poll for the result
    if ('jobId' in responseData && responseData.jobId) {
      responseData = await pollSupadataJob(responseData.jobId, apiKey);
    }

    if (!('content' in responseData)) {
      return null;
    }

    const finalResponse = responseData as SupadataTranscriptResponse;
    const transcriptContent = typeof finalResponse.content === 'string'
      ? finalResponse.content
      : Array.isArray(finalResponse.content)
        ? finalResponse.content.map((item: SupadataTranscriptChunk) => item.text).join(' ')
        : null;

    return transcriptContent?.trim() || null;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      console.error('Supadata transcript API rate limit exceeded (429)');
      // Don't throw here - let metadata still work if available
    } else {
      console.error('Error fetching Supadata transcript:', error);
    }
    return null;
  }
}

/**
 * Extract content using Supadata for Instagram or X URLs
 * Combines metadata (caption) + transcript (for videos) for complete content
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

  // Fetch both metadata and transcript in parallel
  const [metadata, transcript] = await Promise.all([
    fetchSupadataMetadata(url, apiKey),
    fetchSupadataTranscript(url, apiKey),
  ]);

  // Build content from available data
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
    if (caption) {
      contentParts.push(`Caption: ${caption}`);
      title = caption.substring(0, 100) + (caption.length > 100 ? '...' : '');
      excerpt = caption.substring(0, 200);
    }

    if (author) {
      excerpt = `@${metadata.author?.username || author}: ${excerpt}`;
    }
  }

  if (transcript) {
    contentParts.push(`Transcript: ${transcript}`);
    if (!excerpt) {
      excerpt = `Video transcript: ${transcript.substring(0, 150)}...`;
    }
  }

  // If we have no content at all, throw error
  if (contentParts.length === 0) {
    throw new Error('Could not extract any content (caption or transcript) from this post. The post may be private or unavailable.');
  }

  return {
    content: contentParts.join('\n\n'),
    title,
    excerpt,
    source: metadata ? 'supadata' : 'supadata-transcript',
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

