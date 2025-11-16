import { NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { extract } from '@extractus/article-extractor';
import { getSubtitles } from 'youtube-caption-extractor';

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

