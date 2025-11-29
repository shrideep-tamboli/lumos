# WhatsApp Bot Integration

This folder contains the WhatsApp bot integration for Lumous, allowing users to fact-check news articles and text directly through WhatsApp using Twilio.

## Features

- Send a URL to receive fact-check results for the article
- Send plain text to receive fact-check results
- Receive formatted results with:
  - Trust Score (with color emoji indicators)
  - Verdict (Support, Partially Support, Unclear, Contradict, Refute)
  - Analysis/Reason
  - Key Evidence (up to 2 references)

## Setup Instructions

### 1. Create a Twilio Account

1. Sign up for a [Twilio account](https://www.twilio.com/try-twilio)
2. Navigate to the [Twilio Console](https://console.twilio.com/)

### 2. Set Up Twilio WhatsApp Sandbox

1. Go to **Messaging** > **Try it out** > **Send a WhatsApp message**
2. Follow the instructions to join the sandbox:
   - Save the Twilio sandbox number to your phone contacts
   - Send the provided join code (e.g., "join <sandbox-code>") to the sandbox number

### 3. Configure Environment Variables

Add the following environment variables to your deployment:

```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
BASE_URL=https://lumous.vercel.app
```

| Variable | Description | Example |
|----------|-------------|---------|
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID (found in Twilio Console) | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token (found in Twilio Console) | `your_auth_token_here` |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp number. For testing, use Twilio's sandbox number. For production, use your purchased WhatsApp-enabled number. | `whatsapp:+14155238886` (sandbox) |
| `BASE_URL` | Base URL of your Lumous deployment | `https://lumous.vercel.app` |

> **Note:** The number `+14155238886` shown above is Twilio's shared sandbox number for testing only. For production use, you must purchase a WhatsApp-enabled Twilio number and complete the WhatsApp Business API registration process.

### 4. Configure Webhook URL

1. In Twilio Console, go to **Messaging** > **Try it out** > **Send a WhatsApp message**
2. Click on **Sandbox settings**
3. Set the **"When a message comes in"** webhook URL to:
   ```
   https://your-domain.vercel.app/api/whatsapp
   ```
4. Set the HTTP method to **POST**
5. Save the configuration

## Usage

### For Users

1. **Join the Sandbox** (for testing):
   - Add the Twilio sandbox number to your contacts
   - Send the join message (e.g., "join <code>") to the WhatsApp number

2. **Send Content to Fact-Check**:
   - **URL**: Send a news article URL to get it analyzed
     ```
     https://example.com/news-article
     ```
   - **Text**: Send plain text to fact-check claims directly
     ```
     The Earth is flat and the moon landing was faked.
     ```

3. **Receive Results**:
   - You'll first receive an "Analyzing..." message
   - Then you'll get the formatted fact-check results

### Response Format

```
📊 Lumous Fact Check Results

📰 Article: [Article Title]

🟢 Trust Score: 85/100
✅ Verdict: Support

📝 Analysis:
[Detailed analysis of the claim]

🔍 Key Evidence:
1. [Reference 1]
2. [Reference 2]

---
🌐 Powered by Lumous
📱 lumous.vercel.app
```

### Trust Score Indicators

| Emoji | Score Range | Meaning |
|-------|-------------|---------|
| 🟢 | 80-100 | High trust - Well supported |
| 🟡 | 50-79 | Moderate trust - Partially supported |
| 🟠 | 20-49 | Low trust - Limited support |
| 🔴 | 0-19 | Very low trust - Not supported |

### Verdict Indicators

| Emoji | Verdict | Meaning |
|-------|---------|---------|
| ✅ | Support | Claim is well supported by evidence |
| 🔶 | Partially Support | Claim has some supporting evidence |
| ❓ | Unclear | Insufficient evidence to verify |
| ⚠️ | Contradict | Evidence contradicts the claim |
| ❌ | Refute | Evidence strongly refutes the claim |

## Production Deployment

For production use, you'll need to:

1. **Purchase a WhatsApp-enabled Twilio number** or request access to the WhatsApp Business API
2. **Register your WhatsApp Business Profile** with Meta/Facebook
3. **Get your templates approved** for outbound messaging (if needed)
4. **Update the webhook URL** to your production domain

## Troubleshooting

### Common Issues

1. **No response from bot**:
   - Check that environment variables are set correctly
   - Verify the webhook URL is configured in Twilio
   - Check server logs for errors

2. **"Could not extract content" error**:
   - The URL might be blocked or have anti-scraping measures
   - Try sending the text content directly

3. **Timeout errors**:
   - The fact-check API might be overloaded
   - Try again after a few minutes

## Technical Details

- **Endpoint**: `POST /api/whatsapp`
- **Content Type**: Receives `application/x-www-form-urlencoded` from Twilio
- **Response**: Returns empty TwiML (`<Response></Response>`) immediately
- **Processing**: Async background processing to avoid Twilio's 15-second timeout
- **Character Limit**: Content is limited to 2000 characters before fact-checking

## Security Notes

- Keep your `TWILIO_AUTH_TOKEN` secret
- Use environment variables, never commit credentials
- Consider implementing request validation using Twilio's request validation
