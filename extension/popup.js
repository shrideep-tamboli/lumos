// Popup script for fact-checking interface with backend integration

document.getElementById("analyze").addEventListener("click", analyzePage);
document.getElementById("reanalyze").addEventListener("click", () => {
  // Clear cached result and re-analyze
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    await chrome.storage.local.remove([`analysis_${tab.url}`]);
    document.getElementById("resultsView").classList.add("hidden");
    document.getElementById("initialState").classList.remove("hidden");
    analyzePage();
  });
});

// View logs link
document.getElementById("logsLink").addEventListener("click", (e) => {
  e.preventDefault();
  // Open the extension's background page for logs
  chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  alert('To view logs:\\n\\n1. Click "Details" on this extension\\n2. Click "Inspect views: service worker"\\n3. Go to Console tab\\n\\nOr press F12 on any page and check Console.');
});

// Check if page is already analyzed on load
window.addEventListener('DOMContentLoaded', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const result = await chrome.storage.local.get([`analysis_${tab.url}`]);
  if (result[`analysis_${tab.url}`]) {
    displayResults(result[`analysis_${tab.url}`]);
  }
});

async function analyzePage() {
  const analyzeBtn = document.getElementById("analyze");
  const status = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  const initialState = document.getElementById("initialState");
  const resultsView = document.getElementById("resultsView");
  
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing...";
  status.className = "status loading";
  status.style.display = "flex";
  statusText.textContent = "Extracting content from page...";
  
  console.log("🔍 [Popup] Starting analysis...");
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if tab is valid
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      throw new Error("Cannot analyze browser internal pages");
    }
    
    console.log("🔍 [Popup] Analyzing URL:", tab.url);
    statusText.textContent = "Sending to backend for analysis...";
    
    // Send analysis request to background script with URL
    chrome.runtime.sendMessage({
      action: "analyzeArticle",
      data: {
        url: tab.url,
        title: tab.title,
        domain: new URL(tab.url).hostname,
        tab: { id: tab.id }
      }
    });
    
    // Wait for background script to process
    statusText.textContent = "Analyzing claims and verifying facts...";
    
    // Poll for results with timeout
    let pollCount = 0;
    const maxPolls = 180; // 3 minutes max
    
    const progressMessages = [
      "Extracting article content...",
      "Identifying verifiable claims...",
      "Searching for evidence...",
      "Cross-referencing sources...",
      "Fact-checking claims...",
      "Calculating trust scores...",
      "Finalizing analysis..."
    ];
    
    const checkResults = async () => {
      pollCount++;
      
      // Update progress message
      const progressIndex = Math.min(Math.floor(pollCount / 20), progressMessages.length - 1);
      statusText.textContent = progressMessages[progressIndex];
      
      console.log(`🔍 [Popup] Poll #${pollCount} - checking for results...`);
      
      const result = await chrome.storage.local.get([`analysis_${tab.url}`]);
      
      if (result[`analysis_${tab.url}`]) {
        console.log('✅ [Popup] Found analysis result!');
        displayResults(result[`analysis_${tab.url}`]);
        status.style.display = "none";
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "🔍 Analyze This Page";
      } else if (pollCount >= maxPolls) {
        // Timeout after 3 minutes
        throw new Error("Analysis timeout - please try again");
      } else {
        setTimeout(checkResults, 1000); // Check every second
      }
    };
    
    // Start checking after 2 seconds
    setTimeout(checkResults, 2000);
    
  } catch (error) {
    console.error("❌ [Popup] Error:", error);
    status.className = "status error";
    status.style.display = "block";
    statusText.textContent = `✗ ${error.message}`;
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "🔍 Analyze This Page";
  }
}

function displayResults(data) {
  const initialState = document.getElementById("initialState");
  const resultsView = document.getElementById("resultsView");
  const scoreCircle = document.getElementById("scoreCircle");
  const scoreValue = document.getElementById("scoreValue");
  const scoreLabel = document.getElementById("scoreLabel");
  const claimsInfo = document.getElementById("claimsInfo");
  const claimsList = document.getElementById("claimsList");
  const claimsCount = document.getElementById("claimsCount");
  
  // Hide initial state, show results
  initialState.classList.add("hidden");
  resultsView.classList.remove("hidden");
  
  console.log("📊 [Popup] Displaying results:", JSON.stringify(data, null, 2));
  console.log("📊 [Popup] Claims array:", data.claims);
  console.log("📊 [Popup] Claims count:", data.claims?.length);
  
  // Check if there's an error or no claims
  if (data.error) {
    scoreCircle.className = "score-circle low";
    scoreValue.textContent = "⚠️";
    scoreLabel.textContent = data.error;
    claimsInfo.textContent = "Unable to verify content";
    claimsCount.textContent = "0";
    claimsList.innerHTML = `
      <div class="empty-claims">
        <div class="icon">⚠️</div>
        <div style="font-weight:600;margin-bottom:8px;">${data.error}</div>
        <div style="font-size:12px;color:#888;">This article may not contain factual claims that can be verified, or the content could not be extracted properly.</div>
      </div>
    `;
    return;
  }
  
  const score = data.overall_score || 0;
  const scorePercent = Math.round(score * 100);
  
  scoreValue.textContent = scorePercent;
  scoreCircle.className = "score-circle";
  if (scorePercent > 70) {
    scoreCircle.classList.add("high");
    scoreLabel.textContent = data.verdict || "✅ Highly Trustworthy";
  } else if (scorePercent > 40) {
    scoreCircle.classList.add("medium");
    scoreLabel.textContent = data.verdict || "⚠️ Mixed Credibility";
  } else {
    scoreCircle.classList.add("low");
    scoreLabel.textContent = data.verdict || "❌ Low Credibility";
  }
  
  // Get claims array - handle different possible structures
  let claims = [];
  if (Array.isArray(data.claims)) {
    claims = data.claims;
  } else if (data.claims && typeof data.claims === 'object') {
    // Maybe it's an object with claims inside
    claims = Object.values(data.claims);
  }
  
  console.log("📊 [Popup] Processed claims:", claims);
  
  const totalClaims = claims.length;
  const category = data.category || "general";
  const credible = claims.filter(c => (c.score || 0) >= 0.7).length;
  const questionable = claims.filter(c => (c.score || 0) >= 0.4 && (c.score || 0) < 0.7).length;
  const suspicious = claims.filter(c => (c.score || 0) < 0.4).length;
  
  claimsInfo.innerHTML = `
    <div>${category.charAt(0).toUpperCase() + category.slice(1)} content</div>
    <div style="margin-top:4px;">✅ ${credible} &nbsp; ⚠️ ${questionable} &nbsp; ❌ ${suspicious}</div>
  `;
  claimsCount.textContent = totalClaims;
  
  // Clear and populate claims list
  claimsList.innerHTML = "";
  
  if (claims.length > 0) {
    console.log("📊 [Popup] Rendering", claims.length, "claims");
    
    claims.forEach((claim, index) => {
      console.log(`📊 [Popup] Claim ${index}:`, claim);
      
      const claimDiv = document.createElement("div");
      claimDiv.className = "claim-item";
      
      // Handle different score field names
      const claimScore = claim.score || claim.trust_score || claim.trustScore || 0;
      const normalizedScore = claimScore > 1 ? claimScore / 100 : claimScore;
      
      if (normalizedScore >= 0.7) claimDiv.classList.add("true");
      else if (normalizedScore >= 0.4) claimDiv.classList.add("mixed");
      else claimDiv.classList.add("false");
      
      // Get the raw trust score (0-100) from the claim data
      const rawTrustScore = claim.raw_trust_score || claim.trustScore || claim.trust_score || Math.round(normalizedScore * 100);
      
      // Determine badge type
      let badgeClass = 'unclear';
      let badgeText = 'Unclear';
      if (normalizedScore >= 0.7) {
        badgeClass = 'verified';
        badgeText = 'Verified';
      } else if (normalizedScore < 0.4) {
        badgeClass = 'disputed';
        badgeText = 'Disputed';
      }
      
      // Get claim text - handle different field names
      const claimText = claim.text || claim.claim || claim.content || 'Unknown claim';
      const verificationStatus = claim.verification_status || claim.verdict || claim.status || '';
      const reasoning = claim.reasoning || claim.reference || claim.explanation || '';
      
      claimDiv.innerHTML = `
        <div class="claim-text">${escapeHtml(claimText)}</div>
        <div class="claim-score">
          <span class="claim-badge ${badgeClass}">${badgeText}</span>
          <span>Score: ${rawTrustScore}%</span>
          ${verificationStatus ? `<span>• ${verificationStatus}</span>` : ''}
        </div>
        ${reasoning ? `<div class="claim-reasoning">${escapeHtml(String(reasoning).substring(0, 150))}${String(reasoning).length > 150 ? '...' : ''}</div>` : ''}
      `;
      claimsList.appendChild(claimDiv);
    });
    
    console.log("📊 [Popup] Claims list innerHTML length:", claimsList.innerHTML.length);
  } else {
    console.log("📊 [Popup] No claims to display");
    claimsList.innerHTML = `
      <div class="empty-claims">
        <div class="icon">📭</div>
        <div>No claims detected</div>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
