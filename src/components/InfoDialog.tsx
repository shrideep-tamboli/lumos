'use client';

import { useState } from 'react';

type TabType = 'overview' | 'sources' | 'whatsapp' | 'extension';

export default function InfoDialog() {
  const [isOpen, setIsOpen] = useState(true); // Open by default on first load
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'sources', label: 'Supported Sources' },
    { id: 'whatsapp', label: 'WhatsApp Bot' },
    { id: 'extension', label: 'Browser Extension' },
  ];

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-4 right-4 w-10 h-10 flex items-center justify-center bg-white border-2 border-black rounded-full hover:bg-black hover:text-white transition-all duration-200 shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 text-black"
        aria-label="How it works"
      >
        <span className="text-lg font-serif italic">i</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-8 pb-6 border-b-2 border-black">
              <div>
                <h2 className="text-3xl font-black text-black tracking-tight">LUMOS</h2>
                <p className="text-sm text-black mt-1 font-medium">AI-Powered Fact-Checking Platform</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-10 h-10 flex items-center justify-center border-2 border-black hover:bg-black hover:text-white transition-all duration-200 text-black"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="square" strokeLinejoin="miter" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b-2 border-black">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 px-6 py-4 text-sm font-bold uppercase tracking-wider transition-all duration-200 border-r-2 border-black last:border-r-0 ${
                    activeTab === tab.id
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-black hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
              {activeTab === 'overview' && (
                <div className="space-y-8">
                  {/* Mission Statement */}
                  <div className="border-l-4 border-black pl-6">
                    <p className="text-lg text-black leading-relaxed">
                      LUMOS is designed for <strong>news editors and journalists</strong> who need to quickly verify the credibility of news from any source. Get trust scores, source verification, and bias analysis in seconds.
                    </p>
                  </div>

                  {/* How It Works */}
                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">How It Works</h3>
                    <div className="grid gap-4">
                      {[
                        { step: '01', title: 'Content Extraction', desc: 'Automatically extracts text, transcripts, and captions from any URL or pasted content' },
                        { step: '02', title: 'Claim Identification', desc: 'AI identifies verifiable factual claims that can be checked against sources' },
                        { step: '03', title: 'Evidence Search', desc: 'Searches Google, news APIs, and trusted sources for supporting or refuting evidence' },
                        { step: '04', title: 'AI Verification', desc: 'Cross-references each claim with gathered evidence to generate verdicts' },
                        { step: '05', title: 'Trust Score Report', desc: 'Generates a trust score (0-100) with bias analysis and detailed breakdown' },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-4 items-start group">
                          <span className="bg-black text-white w-12 h-12 flex items-center justify-center font-black text-sm shrink-0 group-hover:bg-white group-hover:text-black group-hover:border-2 group-hover:border-black transition-all duration-200">
                            {item.step}
                          </span>
                          <div className="pt-1">
                            <p className="font-bold text-black">{item.title}</p>
                            <p className="text-sm text-black mt-1">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Trust Score Legend */}
                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">Trust Score Guide</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="border-2 border-black p-4 bg-green-50">
                        <div className="text-2xl font-black text-green-700">80-100</div>
                        <div className="text-sm font-bold uppercase tracking-wider mt-1 text-black">High Trust</div>
                        <p className="text-xs text-black mt-2">Claims are well-supported by reliable sources</p>
                      </div>
                      <div className="border-2 border-black p-4 bg-yellow-50">
                        <div className="text-2xl font-black text-yellow-700">50-79</div>
                        <div className="text-sm font-bold uppercase tracking-wider mt-1 text-black">Moderate</div>
                        <p className="text-xs text-black mt-2">Mixed evidence or partially verifiable claims</p>
                      </div>
                      <div className="border-2 border-black p-4 bg-red-50">
                        <div className="text-2xl font-black text-red-700">0-49</div>
                        <div className="text-sm font-bold uppercase tracking-wider mt-1 text-black">Low Trust</div>
                        <p className="text-xs text-black mt-2">Claims are refuted or lack credible evidence</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'sources' && (
                <div className="space-y-8">
                  <div className="border-l-4 border-black pl-6">
                    <p className="text-lg text-black leading-relaxed">
                      Analyze content from virtually any news source — news websites, social media, videos, or forwarded messages.
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    {[
                      {
                        title: 'News Websites',
                        desc: 'Any article URL — BBC, CNN, Times of India, The Hindu, Reuters, local news sites, blogs, and more.',
                        example: 'https://bbc.com/news/article...'
                      },
                      {
                        title: 'YouTube Videos',
                        desc: 'Extracts video transcripts and captions automatically. Supports Hindi, English, and regional languages.',
                        example: 'https://youtube.com/watch?v=...'
                      },
                      {
                        title: 'Instagram Posts & Reels',
                        desc: 'Analyzes captions and video transcripts from Instagram posts and reels via Supadata API.',
                        example: 'https://instagram.com/p/... or /reel/...'
                      },
                      {
                        title: 'X (Twitter) Posts',
                        desc: 'Fact-check tweets and X posts by pasting the direct post URL.',
                        example: 'https://x.com/user/status/...'
                      },
                    ].map((source) => (
                      <div key={source.title} className="border-2 border-black p-5 hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-all duration-200">
                        <h4 className="font-black text-black uppercase tracking-wider text-sm">{source.title}</h4>
                        <p className="text-sm text-black mt-3">{source.desc}</p>
                        <code className="block mt-4 text-xs bg-white p-3 border-2 border-black font-mono text-black break-all">
                          {source.example}
                        </code>
                      </div>
                    ))}
                  </div>

                  <div className="border-2 border-black p-5 bg-white">
                    <h4 className="font-black text-black uppercase tracking-wider text-sm">Direct Text Input</h4>
                    <p className="text-sm text-black mt-3">
                      Paste any text directly — WhatsApp forwards, copied messages, screenshot text, email content. Perfect for fact-checking viral claims that don&apos;t have a source URL.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'whatsapp' && (
                <div className="space-y-8">
                  <div className="border-l-4 border-black pl-6">
                    <p className="text-lg text-black leading-relaxed">
                      Fact-check news directly from WhatsApp. Forward suspicious messages to our bot and get instant verification results.
                    </p>
                  </div>

                  {/* Phone Number Box */}
                  <div className="border-2 border-black p-5 bg-white">
                    <p className="text-sm font-bold uppercase tracking-wider mb-2 text-black">WhatsApp Bot Number</p>
                    <code className="text-3xl font-black text-black">+1 (415) 523-8886</code>
                    <p className="text-sm text-black mt-2">Save this number to your contacts as &quot;LUMOS Bot&quot;</p>
                  </div>

                  {/* Join Code Box */}
                  <div className="border-2 border-black p-5 bg-black text-white">
                    <p className="text-sm font-bold uppercase tracking-wider mb-2">Join Code</p>
                    <code className="text-2xl font-black">join feature-win</code>
                    <p className="text-sm mt-2">Send this message to the number above to activate the bot</p>
                  </div>

                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">Setup Guide</h3>
                    <div className="space-y-4">
                      {[
                        { step: '01', title: 'Save the Bot Number', desc: 'Add the number above to your contacts as LUMOS Bot' },
                        { step: '02', title: 'Join the Sandbox', desc: 'Send "join feature-win" to activate the bot' },
                        { step: '03', title: 'Send Content', desc: 'Forward a message or paste a URL to get fact-check results' },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-4 items-start">
                          <span className="bg-black text-white w-10 h-10 flex items-center justify-center font-black text-xs shrink-0">
                            {item.step}
                          </span>
                          <div className="pt-1">
                            <p className="font-bold text-black">{item.title}</p>
                            <p className="text-sm text-black mt-1">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">Example Usage</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="border-2 border-black p-4">
                        <p className="font-bold text-sm uppercase tracking-wider mb-2 text-black">Send a URL</p>
                        <code className="block text-xs bg-white p-3 border-2 border-black font-mono text-black break-all">
                          https://example.com/breaking-news
                        </code>
                      </div>
                      <div className="border-2 border-black p-4">
                        <p className="font-bold text-sm uppercase tracking-wider mb-2 text-black">Forward Text</p>
                        <p className="text-xs text-black italic">
                          &quot;Breaking: Scientists discover that drinking coffee makes you live 200 years...&quot;
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">Response Format</h3>
                    <pre className="text-xs bg-black text-white p-5 overflow-x-auto font-mono leading-relaxed">
{`LUMOS FACT CHECK RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━

Article: [Title]

Trust Score: 85/100
Verdict: SUPPORTED

Analysis:
[Detailed explanation of findings]

Key Evidence:
• [Source 1] - Reuters
• [Source 2] - BBC News

━━━━━━━━━━━━━━━━━━━━━━━━
Powered by LUMOS`}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === 'extension' && (
                <div className="space-y-8">
                  <div className="border-l-4 border-black pl-6">
                    <p className="text-lg text-black leading-relaxed">
                      Install our browser extension to fact-check any article with one click — no copy-pasting required.
                    </p>
                  </div>

                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">Installation</h3>
                    <div className="space-y-4">
                      {[
                        { step: '01', title: 'Download Extension', desc: 'Click "Install Extension" on the main page to download the ZIP file' },
                        { step: '02', title: 'Open Chrome Extensions', desc: 'Navigate to chrome://extensions/ in your browser' },
                        { step: '03', title: 'Enable Developer Mode', desc: 'Toggle "Developer mode" ON in the top-right corner' },
                        { step: '04', title: 'Load Extension', desc: 'Click "Load unpacked" and select the extracted extension folder' },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-4 items-start">
                          <span className="bg-black text-white w-10 h-10 flex items-center justify-center font-black text-xs shrink-0">
                            {item.step}
                          </span>
                          <div className="pt-1">
                            <p className="font-bold text-black">{item.title}</p>
                            <p className="text-sm text-black mt-1">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">Usage</h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {[
                        'Navigate to article',
                        'Click LUMOS icon',
                        'Click "Analyze"',
                        'Wait 30-60 seconds',
                        'View results',
                      ].map((step, i) => (
                        <div key={i} className="border-2 border-black p-3 text-center">
                          <div className="text-lg font-black">{i + 1}</div>
                          <p className="text-xs mt-1 text-black">{step}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider mb-6 pb-2 border-b-2 border-black text-black">Features</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { title: 'One-Click', desc: 'Instant analysis' },
                        { title: 'Privacy First', desc: 'No data stored' },
                        { title: 'Detailed Reports', desc: 'Claim breakdown' },
                        { title: 'History', desc: 'Past analyses' },
                      ].map((feature) => (
                        <div key={feature.title} className="border-2 border-black p-4 text-center hover:bg-black hover:text-white transition-all duration-200 group">
                          <p className="font-black uppercase tracking-wider text-sm">{feature.title}</p>
                          <p className="text-xs mt-1 text-black group-hover:text-white">{feature.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t-2 border-black flex justify-between items-center bg-white">
              <p className="text-xs text-black font-medium">
                Built for journalists to combat misinformation
              </p>
              <button
                onClick={() => setIsOpen(false)}
                className="bg-black text-white font-bold uppercase tracking-wider py-3 px-8 text-sm border-2 border-black hover:bg-white hover:text-black transition-all duration-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
