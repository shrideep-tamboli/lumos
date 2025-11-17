# Quick Start Guide - Lumous Extension

## 🚀 Quick Setup (5 minutes)

### Step 1: Install Dependencies & Start Backend

```bash
cd /Users/s/Documents/Lumos/lumous
npm install
npm run dev
```

Backend should start on `http://localhost:3000`

### Step 2: Configure API Keys

Create `.env.local` in the project root:

```env
GEMINI_API_KEY=your_key_here
TAVILY_API_KEY=your_key_here
SERPAPI_KEY=your_key_here
```

**Get API Keys:**
- **Gemini:** https://aistudio.google.com/app/apikey
- **Tavily:** https://tavily.com/ (sign up for free)
- **SerpAPI:** https://serpapi.com/ (or use default key)

### Step 3: Install Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked**
4. Select: `/Users/s/Documents/Lumos/lumous/extension/`
5. Extension icon appears in toolbar ✅

### Step 4: Test It!

1. Navigate to any news article (e.g., https://www.bbc.com/news)
2. Click the extension icon
3. Click "🔍 Analyze This Page"
4. Wait 30-60 seconds
5. See trust score and claims!

---

## 🛠️ Troubleshooting

### Backend won't start
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### "Failed to process URL" error
- ✅ Check backend is running on port 3000
- ✅ Verify `.env.local` has all API keys
- ✅ Check browser console (F12) for errors

### Extension doesn't appear
- ✅ Remove old version from chrome://extensions/
- ✅ Reload the extension
- ✅ Check for manifest.json errors

### Analysis takes forever
- Normal! First analysis: 30-60 seconds
- Check backend terminal for progress
- Subsequent analyses of same URL are instant (cached)

---

## 📁 Project Structure

```
lumous/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main web app
│   │   └── api/
│   │       ├── reclaimify/       # Content extraction
│   │       ├── websearch/        # Evidence search
│   │       ├── analyze/batch/    # Batch URL analysis
│   │       └── factCheck/        # AI verification
│   └── components/
├── extension/                    # Chrome extension
│   ├── manifest.json
│   ├── popup.html/js
│   ├── background.js             # API orchestrator
│   └── content.js
├── package.json
├── .env.local                    # API keys (create this!)
└── INTEGRATION_SUMMARY.md        # Detailed docs
```

---

## 🎯 How It Works

1. **You:** Click "Analyze This Page"
2. **Extension:** Sends URL to backend
3. **Backend:** 
   - Extracts article text
   - Identifies verifiable claims
   - Searches web for evidence
   - AI verifies each claim
4. **Extension:** Shows trust score + claims

---

## 🔗 Useful Links

- **Web App:** http://localhost:3000
- **Extension Page:** chrome://extensions/
- **API Docs:** See INTEGRATION_SUMMARY.md

---

## 🎉 You're Ready!

Extension is now connected to the backend. Test it on real articles and enjoy accurate fact-checking!

**Need Help?** Check `INTEGRATION_SUMMARY.md` for detailed information.
